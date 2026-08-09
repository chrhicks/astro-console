/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- SQLite test probes intentionally name the exact row shape they verify. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openOriginDatabase } from '../persistence/database.ts'
import { processRecommendedSet } from '../persistence/library-sqlite-repository.ts'
import { installM27Fixture } from '../services/runtime-bootstrap.ts'
import {
  executeProcessCommand,
  processSnapshot,
  recordProcessPressure,
  settleProcessWork,
} from '../services/process-workspace.ts'
import { createProcessWorkWorker } from '../workers/process-work-worker.ts'

const owner = {
  personId: 'owner-chicks',
  clientId: 'desktop-owner',
  role: 'owner' as const,
  capability: 'controlCapable' as const,
}

function setReview(
  database: ReturnType<typeof openOriginDatabase>,
  assetId: string,
  decision: 'accepted' | 'rejected',
  revision = 1,
) {
  const row = database
    .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
    .get(assetId) as { detail: string }
  const detail = JSON.parse(row.detail) as Record<string, unknown>
  const review = {
    revision,
    decision,
    updatedAt: '2026-08-09T00:00:00.000Z',
  }
  database
    .prepare('UPDATE library_assets SET detail=? WHERE asset_id=?')
    .run(JSON.stringify({ ...detail, review }), assetId)
  database
    .prepare(
      'INSERT INTO asset_reviews VALUES (?,?,?) ON CONFLICT(asset_id) DO UPDATE SET revision=excluded.revision,review=excluded.review',
    )
    .run(assetId, revision, JSON.stringify(review))
}

test('recommended Process selection requires resolved review and freezes exact decisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-selection-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const rows = database
    .prepare(
      "SELECT asset_id,comparison_group_id FROM library_assets WHERE role='original' AND comparison_group_id='m27-stack-1' ORDER BY sharpness DESC",
    )
    .all() as Array<{ asset_id: string; comparison_group_id: string }>
  assert.equal(rows.length, 2)
  assert.ok(rows[0] && rows[1])
  const unresolved = executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        selection: 'recommended',
        sourceAssetIds: [rows[0].asset_id],
        idempotencyKey: 'selection-unresolved',
      },
    },
    owner,
  )
  assert.deepEqual(unresolved, {
    outcome: 'rejected',
    reason: 'SourceReviewRequired',
  })
  setReview(database, rows[0].asset_id, 'accepted')
  setReview(database, rows[1].asset_id, 'rejected')
  const recommendation = processRecommendedSet(
    database,
    rows[0].comparison_group_id,
  )
  assert.deepEqual(
    recommendation.candidates.map((candidate) => candidate.effectiveDecision),
    ['include', 'exclude'],
  )
  const accepted = executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        selection: 'recommended',
        sourceAssetIds: [rows[0].asset_id],
        idempotencyKey: 'selection-resolved',
      },
    },
    owner,
  )
  assert.equal(accepted.outcome, 'accepted')
  const frozen = processSnapshot(database, owner).sessions[0]?.selection
  assert.ok(frozen)
  assert.deepEqual(
    frozen.candidates.map((candidate) => candidate.effectiveDecision),
    ['include', 'exclude'],
  )
  setReview(database, rows[0].asset_id, 'rejected', 2)
  setReview(database, rows[1].asset_id, 'accepted', 2)
  assert.deepEqual(
    processSnapshot(database, owner).sessions[0]?.selection,
    frozen,
  )
  database.close()
})

test('Process accepts before durable Build work and a separate worker checkpoints every stage', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-worker-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  const accepted = executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'process-worker-start',
      },
    },
    owner,
  )
  assert.equal(accepted.outcome, 'accepted')
  assert.equal(processSnapshot(database, owner).sessions[0]?.phase, 'build')
  const row = database
    .prepare('SELECT state,stage,attempts FROM processing_work')
    .get() as { state: string; stage: string; attempts: number }
  assert.deepEqual(
    { ...row },
    {
      state: 'pending',
      stage: 'validate',
      attempts: 0,
    },
  )

  const worker = createProcessWorkWorker({
    database,
    outputRoot: join(root, 'outputs'),
  })
  for (const stage of ['validate', 'calibrate', 'debayer', 'align', 'evaluate'])
    assert.deepEqual(worker.pass(), { outcome: 'checkpointed', stage })
  assert.deepEqual(worker.pass(), { outcome: 'completed', kind: 'build' })
  assert.equal(processSnapshot(database, owner).sessions[0]?.phase, 'develop')
  const settled = database
    .prepare('SELECT state,checkpoint,attempts FROM processing_work')
    .get() as { state: string; checkpoint: string; attempts: number }
  assert.deepEqual(
    { ...settled },
    {
      state: 'settled',
      checkpoint: 'evaluate',
      attempts: 6,
    },
  )
  const session = processSnapshot(database, owner).sessions[0]
  assert.ok(session)
  const paths = database
    .prepare('SELECT path FROM processing_artifacts WHERE session_id=?')
    .all(session.sessionId) as Array<{
    path: string
  }>
  assert.ok(paths.length > 0)
  assert.equal(
    executeProcessCommand(
      database,
      {
        commandId: crypto.randomUUID(),
        command: {
          _tag: 'DiscardProcessingSession',
          sessionId: session.sessionId,
          expectedProcessingRevision: session.revision,
          confirmationId: `discard-${session.sessionId}`,
          idempotencyKey: 'discard-worker-artifacts',
        },
      },
      owner,
    ).outcome,
    'accepted',
  )
  assert.deepEqual(worker.pass(), { outcome: 'completed', kind: 'cleanup' })
  assert.equal(
    (
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM processing_artifacts WHERE session_id=?',
        )
        .get(session.sessionId) as { count: number }
    ).count,
    0,
  )
  assert.ok(paths.every((artifact) => !existsSync(artifact.path)))
  assert.equal(
    (
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM library_assets WHERE asset_id=?',
        )
        .get(source.asset_id) as { count: number }
    ).count,
    1,
  )
  database.close()
})

test('Process retries failed Align from the Debayer checkpoint without rerunning prior stages', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-align-retry-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'align-failure-start',
      },
    },
    owner,
  )
  const worker = createProcessWorkWorker({
    database,
    outputRoot: join(root, 'outputs'),
    failBuildStage: 'align',
  })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'validate',
  })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'calibrate',
  })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'debayer',
  })
  assert.deepEqual(worker.pass(), { outcome: 'failed', kind: 'build' })
  const failed = database
    .prepare(
      "SELECT state,stage,checkpoint,attempts FROM processing_work WHERE kind='build'",
    )
    .get() as {
    state: string
    stage: string
    checkpoint: string
    attempts: number
  }
  assert.deepEqual(
    { ...failed },
    {
      state: 'failed',
      stage: 'align',
      checkpoint: 'debayer',
      attempts: 4,
    },
  )
  const session = processSnapshot(database, owner).sessions[0]
  assert.ok(session)
  assert.equal(
    executeProcessCommand(
      database,
      {
        commandId: crypto.randomUUID(),
        command: {
          _tag: 'RetryProcessingBuild',
          sessionId: session.sessionId,
          expectedProcessingRevision: session.revision,
          checkpoint: 'debayer',
          idempotencyKey: 'align-retry',
        },
      },
      owner,
    ).outcome,
    'accepted',
  )
  assert.deepEqual(worker.pass(), { outcome: 'checkpointed', stage: 'align' })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'evaluate',
  })
  assert.deepEqual(worker.pass(), { outcome: 'completed', kind: 'build' })
  assert.equal(processSnapshot(database, owner).sessions[0]?.phase, 'develop')
  assert.equal(
    (
      database
        .prepare("SELECT attempts FROM processing_work WHERE kind='build'")
        .get() as { attempts: number }
    ).attempts,
    7,
  )
  database.close()
})

test('Process worker continues during capture and obeys measured memory and storage pressure', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-pressure-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'pressure-start',
      },
    },
    owner,
  )
  const worker = createProcessWorkWorker({
    database,
    outputRoot: join(root, 'outputs'),
  })
  recordProcessPressure(database, {
    memoryUsedFraction: 0.5,
    storageFreeGiB: 100,
    thermalCelsius: 40,
    acquisitionWriteBacklogMiB: 0,
    captureActive: true,
  })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'validate',
  })
  recordProcessPressure(database, {
    memoryUsedFraction: 0.95,
    storageFreeGiB: 100,
    thermalCelsius: 40,
    acquisitionWriteBacklogMiB: 0,
    captureActive: false,
  })
  assert.deepEqual(worker.pass(), { outcome: 'pressureThrottled' })
  assert.equal(
    processSnapshot(database, owner).pressure.reason,
    'MemoryPressure',
  )
  recordProcessPressure(database, {
    memoryUsedFraction: 0.5,
    storageFreeGiB: 5,
    thermalCelsius: 40,
    acquisitionWriteBacklogMiB: 0,
    captureActive: false,
  })
  assert.deepEqual(worker.pass(), { outcome: 'pressurePaused' })
  assert.equal(
    processSnapshot(database, owner).pressure.reason,
    'StorageReserveProtected',
  )
  recordProcessPressure(database, {
    memoryUsedFraction: 0.5,
    storageFreeGiB: 100,
    thermalCelsius: 40,
    acquisitionWriteBacklogMiB: 0,
    captureActive: false,
  })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'calibrate',
  })
  database.close()
})

test('Process restart does not replay a claimed output and stale settlement is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-no-replay-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'process-worker-claimed',
      },
    },
    owner,
  )
  const work = database
    .prepare('SELECT work_id FROM processing_work')
    .get() as { work_id: string }
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='old-claim',claimed_at='2026-08-09T00:00:00.000Z',attempts=1",
    )
    .run()
  const worker = createProcessWorkWorker({
    database,
    outputRoot: join(root, 'outputs'),
  })
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'validate',
  })
  assert.equal(
    settleProcessWork(database, work.work_id, 'different-claim', {
      outcome: 'completed',
      checksum: 'sha256:stale',
    }).outcome,
    'stale',
  )
  assert.equal(processSnapshot(database, owner).sessions[0]?.phase, 'build')
  database.close()
})

test('Process restart verifies and promotes a claim-token temporary output', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-temp-gap-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'process-worker-temp-gap',
      },
    },
    owner,
  )
  const work = database
    .prepare('SELECT work_id,payload FROM processing_work')
    .get() as { work_id: string; payload: string }
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='temp-claim',claimed_at='2026-08-09T00:00:00.000Z',attempts=1",
    )
    .run()
  const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex')
  const outputRoot = join(root, 'outputs')
  const finalPath = join(
    outputRoot,
    `${digest(`${work.work_id}:validate`)}.json`,
  )
  const temporaryPath = `${finalPath}.temp-claim.tmp`
  const bytes = JSON.stringify({
    adapter: 'deterministic-file-v1',
    kind: 'build',
    stage: 'validate',
    payloadDigest: digest(work.payload),
  })
  const worker = createProcessWorkWorker({ database, outputRoot })
  writeFileSync(temporaryPath, bytes)
  assert.deepEqual(worker.pass(), {
    outcome: 'checkpointed',
    stage: 'validate',
  })
  assert.equal(existsSync(temporaryPath), false)
  assert.equal(existsSync(finalPath), true)
  database.close()
})

test('Process rejects a claimed worker completion after its domain transition becomes stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-stale-transition-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'stale-transition-start',
      },
    },
    owner,
  )
  const work = database
    .prepare('SELECT work_id FROM processing_work')
    .get() as { work_id: string }
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='stale-domain',attempts=1,claimed_at='2026-08-09T00:00:00.000Z'",
    )
    .run()
  const stored = database
    .prepare('SELECT state FROM processing_workspace WHERE id=1')
    .get() as { state: string }
  const state = JSON.parse(stored.state) as {
    sessions: Array<Record<string, unknown>>
  }
  const session = state.sessions[0]
  assert.ok(session)
  session.phase = 'develop'
  session.baseImage = {
    _tag: 'SourceAsset',
    assetId: source.asset_id,
    checksum: `sha256:${source.asset_id}`,
  }
  database
    .prepare('UPDATE processing_workspace SET state=? WHERE id=1')
    .run(JSON.stringify(state))
  const before = (
    database
      .prepare('SELECT state FROM processing_workspace WHERE id=1')
      .get() as { state: string }
  ).state
  assert.equal(
    settleProcessWork(database, work.work_id, 'stale-domain', {
      outcome: 'completed',
      checksum: 'sha256:stale-domain',
    }).outcome,
    'stale',
  )
  assert.equal(
    (
      database
        .prepare('SELECT state FROM processing_workspace WHERE id=1')
        .get() as { state: string }
    ).state,
    before,
  )
  assert.equal(
    (
      database
        .prepare('SELECT state FROM processing_work WHERE work_id=?')
        .get(work.work_id) as { state: string }
    ).state,
    'superseded',
  )
  database.close()
})

test('Process rejects stale Save completion without settling work or adding an asset', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-process-stale-save-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  installM27Fixture(database, 'fixture')
  const source = database
    .prepare(
      "SELECT asset_id FROM library_assets WHERE role='original' LIMIT 1",
    )
    .get() as { asset_id: string }
  executeProcessCommand(
    database,
    {
      commandId: crypto.randomUUID(),
      command: {
        _tag: 'StartProcessingSession',
        sourceAssetIds: [source.asset_id],
        idempotencyKey: 'stale-save-start',
      },
    },
    owner,
  )
  const worker = createProcessWorkWorker({
    database,
    outputRoot: join(root, 'outputs'),
  })
  for (let pass = 0; pass < 6; pass += 1) worker.pass()
  const session = processSnapshot(database, owner).sessions[0]
  assert.ok(session)
  assert.equal(
    executeProcessCommand(
      database,
      {
        commandId: crypto.randomUUID(),
        command: {
          _tag: 'SaveProcessingArtifacts',
          sessionId: session.sessionId,
          expectedProcessingRevision: session.revision,
          artifacts: [
            {
              outputId: `linear-${session.sessionId}`,
              format: 'fits',
              role: 'linearMaster',
            },
          ],
          idempotencyKey: 'stale-save-request',
        },
      },
      owner,
    ).outcome,
    'accepted',
  )
  const work = database
    .prepare("SELECT work_id FROM processing_work WHERE kind='save'")
    .get() as { work_id: string }
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='stale-save',attempts=1,claimed_at='2026-08-09T00:00:00.000Z' WHERE work_id=?",
    )
    .run(work.work_id)
  const stored = database
    .prepare('SELECT state FROM processing_workspace WHERE id=1')
    .get() as { state: string }
  const state = JSON.parse(stored.state) as {
    sessions: Array<Record<string, unknown>>
  }
  const storedSession = state.sessions[0]
  assert.ok(storedSession)
  storedSession.baseImage = {
    _tag: 'DerivedOutput',
    outputId: 'linear-stale',
    checksum: 'sha256:stale',
  }
  database
    .prepare('UPDATE processing_workspace SET state=? WHERE id=1')
    .run(JSON.stringify(state))
  const before = JSON.stringify(state)
  const assetCount = (
    database.prepare('SELECT COUNT(*) AS count FROM library_assets').get() as {
      count: number
    }
  ).count
  assert.equal(
    settleProcessWork(database, work.work_id, 'stale-save', {
      outcome: 'completed',
      checksum: 'sha256:stale-save',
      artifacts: [
        { path: join(root, 'stale-save.fits'), checksum: 'sha256:stale-save' },
      ],
    }).outcome,
    'stale',
  )
  assert.equal(
    (
      database
        .prepare('SELECT state FROM processing_workspace WHERE id=1')
        .get() as { state: string }
    ).state,
    before,
  )
  assert.equal(
    (
      database
        .prepare('SELECT state FROM processing_work WHERE work_id=?')
        .get(work.work_id) as { state: string }
    ).state,
    'superseded',
  )
  assert.equal(
    (
      database
        .prepare('SELECT COUNT(*) AS count FROM library_assets')
        .get() as {
        count: number
      }
    ).count,
    assetCount,
  )
  database.close()
})
