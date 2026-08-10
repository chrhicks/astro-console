/* eslint-disable @typescript-eslint/no-non-null-assertion -- Focused fixture helpers assert the seeded project shape before exact evidence checks. */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The old-shape restart probe intentionally removes fields from persisted JSON. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Schema } from 'effect'
import { openOriginDatabase } from '../persistence/database.ts'
import { seedLibrary } from '../persistence/library-sqlite-repository.ts'
import {
  executeProcessCommand,
  processSnapshot,
} from '../services/process-workspace.ts'
import { createProcessWorkWorker } from '../workers/process-work-worker.ts'

const owner = {
  personId: 'owner-calibration',
  clientId: 'desktop-calibration',
  role: 'owner' as const,
  capability: 'controlCapable' as const,
}

const execute = (
  database: ReturnType<typeof openOriginDatabase>,
  command: object,
) =>
  executeProcessCommand(
    database,
    { commandId: crypto.randomUUID(), command },
    owner,
  )

const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex')

function prewriteExactCalibrationOutput(
  root: string,
  database: ReturnType<typeof openOriginDatabase>,
) {
  const row = Schema.decodeUnknownSync(
    Schema.Struct({ work_id: Schema.String, payload: Schema.String }),
  )(
    database
      .prepare(
        "SELECT work_id,payload FROM processing_work WHERE kind='projectStage' AND state='pending' ORDER BY rowid DESC LIMIT 1",
      )
      .get(),
  )
  const attempt = processSnapshot(
    database,
    owner,
  ).projects[0]!.stages[0]!.attempts.at(-1)!
  const light = attempt.sourceRevisions.find(
    (source) => source.role === 'Lights',
  )!
  const mainBytes = JSON.stringify({
    adapter: 'deterministic-calibration-adapter-v1',
    kind: 'projectStage',
    stage: 'Calibration',
    payloadDigest: digest(row.payload),
  })
  const evidenceChecksum = `sha256:${digest(mainBytes)}`
  const outputBytes = JSON.stringify({
    kind: 'deterministicCalibrationEvidence',
    sourceAssetId: light.assetId,
    sourceAssetRevision: light.assetRevision,
    frozenEvidenceChecksum: evidenceChecksum,
    settings: attempt.settings,
    recommendations: attempt.recommendations,
    overrides: attempt.overrides,
    toolIdentity: attempt.toolIdentity,
  })
  const path = join(
    root,
    `${digest(`${row.work_id}:Calibration`)}.json.1.calibration.json`,
  )
  writeFileSync(path, outputBytes, { flag: 'wx' })
  return { path, outputBytes }
}

function insertSource(
  database: ReturnType<typeof openOriginDatabase>,
  value: {
    assetId: string
    frameType: 'light' | 'dark' | 'flat' | 'bias'
    availability?: 'availableLocally' | 'temporarilyUnavailable'
    exposureSeconds?: number
    filter?: string
    binning?: number
  },
) {
  const row = Schema.decodeUnknownSync(
    Schema.Struct({ detail: Schema.String }),
  )(
    database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get('asset-m27-006'),
  )
  const base = JSON.parse(row.detail) as Record<string, unknown>
  const capturedAt = '2026-08-09T01:00:00.000Z'
  const availability = value.availability ?? 'availableLocally'
  const detail = {
    ...base,
    assetId: value.assetId,
    availability,
    capturedAt,
    comparisonGroupId: `comparison-${value.assetId}`,
    captureSetId: `capture-${value.assetId}`,
    ...(value.frameType === 'light'
      ? { targetName: 'M27' }
      : { targetName: undefined }),
    equipment: { rigId: 'rig-main', cameraDeviceId: 'camera-main' },
    capture: {
      frameId: `frame-${value.assetId}`,
      exposureSeconds: value.exposureSeconds ?? 120,
      filter: value.filter ?? 'L',
      binning: value.binning ?? 1,
      frameType: value.frameType,
    },
  }
  database
    .prepare('INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(
      value.assetId,
      1,
      'original',
      'fits',
      availability,
      detail.comparisonGroupId,
      capturedAt,
      capturedAt,
      10,
      JSON.stringify(detail),
    )
}

function calibrationProject(
  database: ReturnType<typeof openOriginDatabase>,
  assetIds: ReadonlyArray<string>,
) {
  const created = execute(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 explicit Calibration',
    selection: { assetIds, captureSetIds: [] },
    idempotencyKey: 'create-calibration-project',
  })
  assert.equal(created.outcome, 'accepted')
  let project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const navigated = execute(database, {
    _tag: 'NavigateProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Calibration',
    idempotencyKey: 'navigate-calibration',
  })
  assert.equal(navigated.outcome, 'accepted')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  return project
}

test('Calibration freezes compatible and advisory support plus override undo and redo', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-calibration-match-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  seedLibrary(database)
  insertSource(database, { assetId: 'asset-cal-light-1', frameType: 'light' })
  insertSource(database, { assetId: 'asset-cal-dark-1', frameType: 'dark' })
  insertSource(database, {
    assetId: 'asset-cal-flat-mismatch',
    frameType: 'flat',
    filter: 'Ha',
  })
  let project = calibrationProject(database, [
    'asset-cal-light-1',
    'asset-cal-dark-1',
    'asset-cal-flat-mismatch',
  ])
  let calibration = project.stages.find(
    (stage) => stage.stage === 'Calibration',
  )
  assert.deepEqual(
    calibration?.calibrationRecommendations.map((item) => ({
      assetId: item.assetId,
      decision: item.decision,
      compatibility: item.compatibility,
    })),
    [
      {
        assetId: 'asset-cal-dark-1',
        decision: 'Include',
        compatibility: 'Compatible',
      },
      {
        assetId: 'asset-cal-flat-mismatch',
        decision: 'Review',
        compatibility: 'Advisory mismatch',
      },
    ],
  )
  const override = (useAnyway: boolean, key: string) => {
    const result = execute(database, {
      _tag: 'SetCalibrationUseAnyway',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-cal-flat-mismatch',
      useAnyway,
      idempotencyKey: key,
    })
    assert.equal(result.outcome, 'accepted')
    project = processSnapshot(database, owner).projects[0]!
  }
  override(true, 'use-flat-anyway')
  calibration = project.stages.find((stage) => stage.stage === 'Calibration')
  assert.equal(calibration?.draft.overrides.length, 1)
  assert.equal(
    execute(database, {
      _tag: 'UndoProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'undo-use-anyway',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(project.stages[0]?.draft.overrides.length, 0)
  assert.equal(
    execute(database, {
      _tag: 'RedoProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'redo-use-anyway',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(project.stages[0]?.draft.overrides.length, 1)
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'run-compatible-calibration',
    }).outcome,
    'accepted',
  )
  const queued = processSnapshot(database, owner).projects[0]!.stages[0]!
    .attempts[0]!
  assert.equal(queued.overrides.length, 1)
  assert.equal(queued.recommendations.length, 2)
  assert.equal(queued.toolIdentity, 'deterministic-calibration-adapter-v1')
  assert.equal(
    createProcessWorkWorker({ database, outputRoot: root }).pass().outcome,
    'completed',
  )
  const settled = processSnapshot(database, owner).projects[0]!.stages[0]!
  assert.equal(settled.attempts[0]?.stageOutcome, 'Succeeded')
  assert.equal(settled.attempts[0]?.outputs.length, 1)
  assert.equal(
    settled.attempts[0]?.outputs[0]?.format,
    'deterministicEvidenceJson',
  )
  const materialized = Schema.decodeUnknownSync(
    Schema.Struct({ path: Schema.String, checksum: Schema.String }),
  )(
    database
      .prepare(
        "SELECT path,checksum FROM processing_artifacts WHERE output_id LIKE 'calibration-output-%' LIMIT 1",
      )
      .get(),
  )
  const materializedBytes = readFileSync(materialized.path)
  assert.equal(
    materialized.checksum,
    `sha256:${createHash('sha256').update(materializedBytes).digest('hex')}`,
  )
  assert.equal(settled.attempts[0]?.outputs[0]?.checksum, materialized.checksum)
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'NavigateProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Sources',
      idempotencyKey: 'return-to-sources-after-calibration',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'AssignProcessingSourceRole',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-cal-flat-mismatch',
      role: 'Unassigned',
      idempotencyKey: 'remove-overridden-support-role',
    }).outcome,
    'accepted',
  )
  const recomputed = processSnapshot(database, owner).projects[0]!.stages[0]!
  assert.equal(recomputed.draft.overrides.length, 0)
  assert.equal(
    recomputed.calibrationRecommendations.some(
      (item) => item.assetId === 'asset-cal-flat-mismatch',
    ),
    false,
  )
  database.close()
})

test('including mismatched support changes the frozen Light outcome evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-calibration-override-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  insertSource(database, {
    assetId: 'asset-cal-light-only',
    frameType: 'light',
  })
  insertSource(database, {
    assetId: 'asset-cal-flat-only',
    frameType: 'flat',
    filter: 'Ha',
  })
  let project = calibrationProject(database, [
    'asset-cal-light-only',
    'asset-cal-flat-only',
  ])
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'run-without-override',
    }).outcome,
    'accepted',
  )
  let worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    project.stages[0]?.attempts[0]?.frameOutcomes[0]?.outcome,
    'Warning',
  )
  assert.equal(
    execute(database, {
      _tag: 'SetCalibrationUseAnyway',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-cal-flat-only',
      useAnyway: true,
      idempotencyKey: 'override-flat-only',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'rerun-with-override',
    }).outcome,
    'accepted',
  )
  const prewritten = prewriteExactCalibrationOutput(root, database)
  database.close()
  database = openOriginDatabase(path)
  worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'completed')
  assert.equal(readFileSync(prewritten.path, 'utf8'), prewritten.outputBytes)
  const attempt = processSnapshot(database, owner).projects[0]!.stages[0]!
    .attempts[1]!
  assert.equal(attempt.overrides[0]?.assetId, 'asset-cal-flat-only')
  assert.equal(attempt.frameOutcomes[0]?.outcome, 'Succeeded')
  assert.match(
    attempt.frameOutcomes[0]?.message ?? '',
    /explicitly included mismatched support/,
  )
  database.close()
})

test('removing mismatched support preserves target and prior Calibration evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-calibration-remove-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  seedLibrary(database)
  insertSource(database, { assetId: 'asset-remove-light', frameType: 'light' })
  insertSource(database, {
    assetId: 'asset-remove-flat',
    frameType: 'flat',
    filter: 'Ha',
  })
  let project = calibrationProject(database, [
    'asset-remove-light',
    'asset-remove-flat',
  ])
  assert.equal(
    execute(database, {
      _tag: 'SetCalibrationUseAnyway',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-remove-flat',
      useAnyway: true,
      idempotencyKey: 'include-remove-flat',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'run-before-remove-flat',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  const activeRevision = project.revision
  const activeSources = project.sources
  assert.deepEqual(
    execute(database, {
      _tag: 'RemoveProcessingProjectSource',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-remove-flat',
      idempotencyKey: 'remove-flat-during-active-attempt',
    }),
    { outcome: 'rejected', reason: 'StageAttemptActive' },
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(project.revision, activeRevision)
  assert.deepEqual(project.sources, activeSources)
  assert.equal(
    createProcessWorkWorker({ database, outputRoot: root }).pass().outcome,
    'completed',
  )
  project = processSnapshot(database, owner).projects[0]!
  const retainedAttempt = project.stages[0]!.attempts[0]!
  const remove = {
    _tag: 'RemoveProcessingProjectSource' as const,
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: 'asset-remove-flat',
    idempotencyKey: 'remove-mismatched-flat',
  }
  const removed = execute(database, remove)
  assert.equal(removed.outcome, 'accepted')
  assert.equal(removed.effect, 'projectSourceRemoved')
  const replayed = execute(database, remove)
  assert.equal(replayed.outcome, 'accepted')
  if (replayed.outcome === 'accepted') assert.equal(replayed.replayed, true)
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(project.targetName, 'M27')
  assert.deepEqual(
    project.sources.map((source) => source.assetId),
    ['asset-remove-light'],
  )
  assert.equal(project.stages[0]?.draft.overrides.length, 0)
  assert.equal(project.stages[0]?.calibrationRecommendations.length, 0)
  assert.equal(project.stages[0]?.attempts.length, 1)
  assert.equal(
    project.stages[0]?.attempts[0]?.attemptId,
    retainedAttempt.attemptId,
  )
  assert.equal(project.stages[0]?.attempts[0]?.basedOnEarlierUpstream, true)
  assert.equal(project.stages[0]?.selectedAttemptId, retainedAttempt.attemptId)

  assert.equal(
    execute(database, {
      _tag: 'AddProcessingProjectSources',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      selection: { assetIds: ['asset-remove-flat'], captureSetIds: [] },
      idempotencyKey: 'readd-mismatched-flat',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(project.targetName, 'M27')
  assert.equal(project.sources.length, 2)
  assert.equal(
    project.stages[0]?.calibrationRecommendations[0]?.compatibility,
    'Advisory mismatch',
  )
  assert.equal(project.stages[0]?.draft.overrides.length, 0)
  database.close()
})

test('Calibration retains partial success and the selected result through an exact failed rerun and restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-calibration-rerun-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  insertSource(database, { assetId: 'asset-cal-light-ok', frameType: 'light' })
  insertSource(database, {
    assetId: 'asset-cal-light-missing',
    frameType: 'light',
    availability: 'temporarilyUnavailable',
  })
  let project = calibrationProject(database, [
    'asset-cal-light-ok',
    'asset-cal-light-missing',
  ])
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'run-partial-calibration',
    }).outcome,
    'accepted',
  )
  const worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]!
  let stage = project.stages[0]!
  const selected = stage.selectedAttemptId
  assert.ok(selected)
  assert.equal(stage.attempts[0]?.stageOutcome, 'Warning')
  assert.deepEqual(
    stage.attempts[0]?.frameOutcomes
      .map((outcome) => outcome.outcome)
      .slice()
      .sort(),
    ['Unavailable', 'Warning'],
  )
  const frozenFirstInputs = stage.attempts[0]?.sourceRevisions
  assert.equal(
    execute(database, {
      _tag: 'UpdateProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      settings: [
        { key: 'operation', value: 'calibrate-and-debayer' },
        { key: 'allowUncalibrated', value: 'true' },
        { key: 'adapterMode', value: 'fail' },
      ],
      idempotencyKey: 'draft-failing-rerun',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'run-failing-rerun',
    }).outcome,
    'accepted',
  )
  stage = processSnapshot(database, owner).projects[0]!.stages[0]!
  assert.deepEqual(stage.attempts[0]?.sourceRevisions, frozenFirstInputs)
  assert.deepEqual(stage.attempts[1]?.sourceRevisions, frozenFirstInputs)
  assert.equal(stage.attempts[1]?.settings.at(-1)?.value, 'fail')
  const work = Schema.decodeUnknownSync(
    Schema.Struct({ work_id: Schema.String }),
  )(
    database
      .prepare(
        "SELECT work_id FROM processing_work WHERE kind='projectStage' AND state='pending' ORDER BY rowid DESC LIMIT 1",
      )
      .get(),
  )
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='retained-claim',attempts=attempts+1 WHERE work_id=?",
    )
    .run(work.work_id)
  database.close()
  database = openOriginDatabase(path)
  const restarted = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(restarted.pass().outcome, 'failed')
  assert.equal(restarted.pass().outcome, 'idle')
  stage = processSnapshot(database, owner).projects[0]!.stages[0]!
  assert.equal(stage.attempts.length, 2)
  assert.equal(stage.attempts[1]?.state, 'failed')
  assert.equal(stage.selectedAttemptId, selected)
  assert.equal(
    database
      .prepare('SELECT attempts FROM processing_work WHERE work_id=?')
      .get(work.work_id)?.attempts,
    1,
  )
  database.close()
})

test('3.5.3 normalizes a persisted 3.5.2 project shape on restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-calibration-migration-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  const project = calibrationProject(database, ['asset-m27-006'])
  const oldShape = JSON.parse(JSON.stringify(project)) as Record<
    string,
    unknown
  > & {
    stages: Array<Record<string, unknown>>
    sources: Array<Record<string, unknown>>
  }
  for (const source of oldShape.sources) {
    delete source.libraryRole
    delete source.libraryFormat
  }
  for (const stage of oldShape.stages) {
    delete stage.calibrationRecommendations
    const draft = stage.draft as Record<string, unknown>
    delete draft.overrides
    delete draft.registrationInclusions
    draft.undo = [[{ key: 'profile', value: 'old-default' }]]
    draft.redo = []
    for (const attempt of (stage.attempts ?? []) as Array<
      Record<string, unknown>
    >) {
      delete attempt.recommendations
      delete attempt.overrides
      delete attempt.frameOutcomes
      delete attempt.outputs
      delete attempt.registrationInclusions
      delete attempt.registrationTransforms
      delete attempt.viableAssetIds
      delete attempt.diagnostics
    }
  }
  database
    .prepare('UPDATE processing_projects SET project=? WHERE project_id=?')
    .run(JSON.stringify(oldShape), project.projectId)
  database.close()
  database = openOriginDatabase(path)
  const recovered = processSnapshot(database, owner).projects[0]
  assert.ok(recovered)
  assert.deepEqual(recovered.stages[0]?.draft.overrides, [])
  assert.deepEqual(recovered.stages[0]?.draft.undo[0], {
    settings: [{ key: 'profile', value: 'old-default' }],
    overrides: [],
    registrationInclusions: [],
  })
  assert.ok(recovered.stages[0]?.calibrationRecommendations)
  assert.equal(recovered.sources[0]?.libraryRole, 'original')
  assert.equal(recovered.sources[0]?.libraryFormat, 'cameraRaw')
  database.close()
})

test('derived Library inputs are technically unavailable and cannot be overridden', () => {
  const database = openOriginDatabase(':memory:')
  seedLibrary(database)
  let project = calibrationProject(database, ['asset-m27-006'])
  assert.equal(
    execute(database, {
      _tag: 'NavigateProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Sources',
      idempotencyKey: 'derived-return-sources',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'AddProcessingProjectSources',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      selection: { assetIds: ['asset-m27-005'], captureSetIds: [] },
      idempotencyKey: 'add-derived-diagnostic',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  assert.equal(
    execute(database, {
      _tag: 'AssignProcessingSourceRole',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-m27-005',
      role: 'Flats',
      idempotencyKey: 'assign-derived-flat',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]!
  const recommendation = project.stages[0]?.calibrationRecommendations[0]
  assert.equal(recommendation?.compatibility, 'Technically unavailable')
  assert.equal(recommendation?.decision, 'Exclude')
  assert.match(recommendation?.reasons[0] ?? '', /diagnostic \/ fits/)
  assert.deepEqual(
    execute(database, {
      _tag: 'SetCalibrationUseAnyway',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-m27-005',
      useAnyway: true,
      idempotencyKey: 'reject-derived-override',
    }),
    { outcome: 'rejected', reason: 'CalibrationOverrideUnavailable' },
  )
  database.close()
})

test('an old source with no exact Library row normalizes to unknown and is not usable', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-calibration-unknown-source-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  const project = calibrationProject(database, ['asset-m27-006'])
  const stored = JSON.parse(
    Schema.decodeUnknownSync(Schema.Struct({ project: Schema.String }))(
      database
        .prepare('SELECT project FROM processing_projects WHERE project_id=?')
        .get(project.projectId),
    ).project,
  ) as Record<string, unknown> & {
    sources: Array<Record<string, unknown>>
  }
  delete stored.sources[0]?.libraryRole
  delete stored.sources[0]?.libraryFormat
  database
    .prepare('UPDATE processing_projects SET project=? WHERE project_id=?')
    .run(JSON.stringify(stored), project.projectId)
  database
    .prepare('DELETE FROM library_assets WHERE asset_id=?')
    .run('asset-m27-006')
  database.close()
  database = openOriginDatabase(path)
  const recovered = processSnapshot(database, owner).projects[0]!
  assert.equal(recovered.sources[0]?.libraryRole, 'unknown')
  assert.equal(recovered.sources[0]?.libraryFormat, 'unknown')
  assert.deepEqual(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: recovered.projectId,
      expectedProjectRevision: recovered.revision,
      stage: 'Calibration',
      idempotencyKey: 'reject-unknown-light',
    }),
    { outcome: 'rejected', reason: 'CalibrationLightsUnavailable' },
  )
  database.close()
})

test('Calibration mismatch choice authority is projected and enforced by the service', () => {
  const database = openOriginDatabase(':memory:')
  seedLibrary(database)
  insertSource(database, { assetId: 'asset-auth-light', frameType: 'light' })
  insertSource(database, {
    assetId: 'asset-auth-flat',
    frameType: 'flat',
    filter: 'Ha',
  })
  const project = calibrationProject(database, [
    'asset-auth-light',
    'asset-auth-flat',
  ])
  const command = {
    commandId: 'viewer-calibration-override-command',
    command: {
      _tag: 'SetCalibrationUseAnyway',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-auth-flat',
      useAnyway: true,
      idempotencyKey: 'viewer-calibration-override',
    },
  }
  const viewer = { ...owner, role: 'viewer' as const }
  assert.deepEqual(executeProcessCommand(database, command, viewer), {
    outcome: 'rejected',
    reason: 'OwnerRequired',
  })
  assert.deepEqual(
    processSnapshot(database, viewer).projectActions[0]?.actions.find(
      (action) => action.action === 'SetCalibrationUseAnyway',
    ),
    {
      _tag: 'Ineligible',
      action: 'SetCalibrationUseAnyway',
      reason: 'ownerRequired',
    },
  )
  const readOnly = { ...owner, capability: 'readOnly' as const }
  assert.deepEqual(
    processSnapshot(database, readOnly).projectActions[0]?.actions.find(
      (action) => action.action === 'SetCalibrationUseAnyway',
    ),
    {
      _tag: 'Ineligible',
      action: 'SetCalibrationUseAnyway',
      reason: 'readOnlyClient',
    },
  )
  const removeCommand = {
    commandId: 'viewer-remove-project-source-command',
    command: {
      _tag: 'RemoveProcessingProjectSource',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-auth-flat',
      idempotencyKey: 'viewer-remove-project-source',
    },
  }
  assert.deepEqual(executeProcessCommand(database, removeCommand, viewer), {
    outcome: 'rejected',
    reason: 'OwnerRequired',
  })
  assert.deepEqual(
    processSnapshot(database, viewer).projectActions[0]?.actions.find(
      (action) => action.action === 'RemoveProcessingProjectSource',
    ),
    {
      _tag: 'Ineligible',
      action: 'RemoveProcessingProjectSource',
      reason: 'ownerRequired',
    },
  )
  database.close()
})
