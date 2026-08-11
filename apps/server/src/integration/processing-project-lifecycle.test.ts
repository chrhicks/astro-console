import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Schema } from 'effect'
import {
  CaptureSetId,
  IntentId,
  ProcessingProjectIntent,
} from '@astro-console/v2-contracts'
import { openOriginDatabase } from '../persistence/database.ts'
import { seedLibrary } from '../persistence/library-sqlite-repository.ts'
import { createProcessingProjectLifecycle } from '../services/processing-project-service.ts'
import { createProcessWorkWorker } from '../workers/process-work-worker.ts'

const owner = {
  personId: 'owner-lifecycle',
  clientId: 'desktop-lifecycle',
  role: 'owner' as const,
  capability: 'controlCapable' as const,
}
const TableColumn = Schema.Struct({ name: Schema.String })

test('startup drops retired Process data and installs only the Project schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-retired-process-'))
  const path = join(root, 'state.sqlite')
  const retired = new DatabaseSync(path)
  retired.exec(
    "CREATE TABLE processing_projects (project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,project TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE processing_project_receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE processing_work (work_id TEXT PRIMARY KEY,session_id TEXT NOT NULL); CREATE TABLE processing_artifacts (artifact_id TEXT PRIMARY KEY,session_id TEXT NOT NULL); CREATE TABLE processing_workspace (id TEXT); CREATE TABLE process_save_receipts (id TEXT); CREATE TABLE process_save_orphans (id TEXT); INSERT INTO processing_projects VALUES ('retired',1,'{}','2026-08-10T00:00:00.000Z')",
  )
  retired.close()

  const database = openOriginDatabase(path)
  const columns = (table: string) =>
    Schema.decodeUnknownSync(Schema.Array(TableColumn))(
      database.prepare(`PRAGMA table_info(${table})`).all(),
    ).map((row) => row.name)
  assert.ok(columns('processing_project_receipts').includes('semantic_key'))
  assert.ok(columns('processing_work').includes('project_id'))
  assert.ok(columns('processing_artifacts').includes('project_id'))
  assert.deepEqual(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('processing_workspace','process_save_receipts','process_save_orphans')",
      )
      .all(),
    [],
  )
  assert.deepEqual(
    database.prepare('SELECT project_id FROM processing_projects').all(),
    [],
  )
  database.close()
})

test('Processing Project callers use one interface while work ownership and settlement stay hidden', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-lifecycle-'))
  const database = openOriginDatabase(':memory:')
  seedLibrary(database)
  const lifecycle = createProcessingProjectLifecycle(database)
  const notices = lifecycle.changes(owner)[Symbol.asyncIterator]()
  const createdNotice = notices.next()

  const created = lifecycle.create(owner, {
    name: 'M27 lifecycle',
    selection: {
      assetIds: [],
      captureSetIds: [CaptureSetId.make('m27-stack-1')],
    },
    intentId: IntentId.make('lifecycle-create'),
  })
  assert.equal('outcome' in created && created.outcome, 'Accepted')
  if (!('outcome' in created)) return
  const projectId = created.project.projectId
  assert.deepEqual((await createdNotice).value, {
    projectId,
    revision: created.project.revision,
  })
  const replayed = lifecycle.create(owner, {
    name: 'M27 lifecycle',
    selection: {
      assetIds: [],
      captureSetIds: [CaptureSetId.make('m27-stack-1')],
    },
    intentId: IntentId.make('lifecycle-create'),
  })
  assert.equal('outcome' in replayed && replayed.replayed, true)
  assert.deepEqual(
    lifecycle.create(owner, {
      name: 'Different payload',
      selection: {
        assetIds: [],
        captureSetIds: [CaptureSetId.make('m27-stack-1')],
      },
      intentId: IntentId.make('lifecycle-create'),
    }),
    { _tag: 'IntentConflict', intentId: 'lifecycle-create' },
  )

  assert.deepEqual(
    lifecycle.list(owner).map((project) => ({
      projectId: project.projectId,
      state: project.state,
      sourceCount: project.sourceCount,
    })),
    [{ projectId, state: 'Ready', sourceCount: 2 }],
  )
  const opened = lifecycle.open(owner, projectId)
  assert.ok(opened)
  assert.equal(opened.sources.length, 2)
  assert.equal(opened.stages[0]?.currentResult, undefined)

  const changedNotice = notices.next()
  const queued = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: opened.revision,
    intentId: IntentId.make('lifecycle-run-calibration'),
    intent: ProcessingProjectIntent.cases.RunStage.make({
      stage: 'Calibration',
      from: ProcessingProjectIntent.cases.RunStage.fields.from.cases.CurrentDraft.make(
        {},
      ),
    }),
  })
  assert.ok('outcome' in queued, JSON.stringify(queued))
  assert.equal(queued.outcome, 'Accepted')
  assert.deepEqual((await changedNotice).value, {
    projectId,
    revision: queued.project.revision,
  })
  assert.deepEqual(
    lifecycle.change(owner, {
      projectId,
      expectedProjectRevision: queued.project.revision,
      intentId: IntentId.make('lifecycle-active-change'),
      intent: ProcessingProjectIntent.cases.UndoDraft.make({
        stage: 'Calibration',
      }),
    }),
    {
      _tag: 'ActiveAttemptConflict',
      attemptId: queued.project.activeAttempt?.attemptId,
      stage: 'Calibration',
    },
  )
  assert.equal(lifecycle.list(owner)[0]?.state, 'Working')
  assert.equal(
    lifecycle.evidence(owner, { projectId })?.attempts[0]?.state,
    'queued',
  )

  const worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.deepEqual(worker.pass(), {
    outcome: 'completed',
    kind: 'projectStage',
  })
  const settled = lifecycle.evidence(owner, { projectId })
  assert.equal(settled?.attempts[0]?.state, 'succeeded')
  assert.equal(settled?.attempts[0]?.outputs[0]?.relation, 'WorkingResult')
  assert.deepEqual(
    lifecycle.change(owner, {
      projectId,
      expectedProjectRevision: opened.revision,
      intentId: IntentId.make('lifecycle-stale-change'),
      intent: ProcessingProjectIntent.cases.UndoDraft.make({
        stage: 'Calibration',
      }),
    }),
    {
      _tag: 'ProjectRevisionConflict',
      projectId,
      currentRevision: lifecycle.open(owner, projectId)?.revision,
    },
  )
  assert.equal(
    lifecycle.open(owner, projectId)?.stages[0]?.currentResult?.lineage,
    'Current',
  )
  assert.deepEqual(worker.pass(), { outcome: 'idle' })

  for (const stage of ['Registration', 'Stacking'] as const) {
    const current = lifecycle.open(owner, projectId)
    assert.ok(current)
    const accepted = lifecycle.change(owner, {
      projectId,
      expectedProjectRevision: current.revision,
      intentId: IntentId.make(`lifecycle-run-${stage.toLowerCase()}`),
      intent: ProcessingProjectIntent.cases.RunStage.make({
        stage,
        from: ProcessingProjectIntent.cases.RunStage.fields.from.cases.CurrentDraft.make(
          {},
        ),
      }),
    })
    assert.ok('outcome' in accepted, JSON.stringify(accepted))
    assert.equal(worker.pass().outcome, 'completed')
  }

  let current = lifecycle.open(owner, projectId)
  assert.ok(current)
  const saved = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: current.revision,
    intentId: IntentId.make('lifecycle-save-master'),
    intent: ProcessingProjectIntent.cases.SaveCurrentResult.make({
      stage: 'Stacking',
    }),
  })
  assert.ok('outcome' in saved, JSON.stringify(saved))
  if (!('outcome' in saved)) return
  const masterAssetId = saved.project.savedAssetIds[0]
  assert.ok(masterAssetId)

  current = lifecycle.open(owner, projectId)
  assert.ok(current)
  const openedDevelop = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: current.revision,
    intentId: IntentId.make('lifecycle-open-develop'),
    intent: ProcessingProjectIntent.cases.OpenDevelop.make({
      assetId: masterAssetId,
    }),
  })
  assert.ok('outcome' in openedDevelop, JSON.stringify(openedDevelop))
  if (!('outcome' in openedDevelop)) return
  assert.equal(openedDevelop.project.developBase?.assetId, masterAssetId)

  current = lifecycle.open(owner, projectId)
  assert.ok(current)
  const develop = current.stages.find((stage) => stage.stage === 'Develop')
  assert.ok(develop)
  const previewed = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: current.revision,
    intentId: IntentId.make('lifecycle-preview-develop'),
    intent: ProcessingProjectIntent.cases.SyncDevelopPreview.make({
      expectedDraftRevision: develop.draft.revision,
    }),
  })
  assert.ok('outcome' in previewed, JSON.stringify(previewed))

  current = lifecycle.open(owner, projectId)
  assert.ok(current)
  const applied = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: current.revision,
    intentId: IntentId.make('lifecycle-run-develop'),
    intent: ProcessingProjectIntent.cases.RunStage.make({
      stage: 'Develop',
      from: ProcessingProjectIntent.cases.RunStage.fields.from.cases.CurrentDraft.make(
        {},
      ),
    }),
  })
  assert.ok('outcome' in applied, JSON.stringify(applied))
  assert.equal(worker.pass().outcome, 'completed')
  const developResult = lifecycle
    .open(owner, projectId)
    ?.stages.find((stage) => stage.stage === 'Develop')?.currentResult
  assert.equal(developResult?.lineage, 'Current')

  current = lifecycle.open(owner, projectId)
  assert.ok(current)
  const undone = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: current.revision,
    intentId: IntentId.make('lifecycle-undo-calibration-result'),
    intent: ProcessingProjectIntent.cases.UndoCurrentResult.make({
      stage: 'Calibration',
    }),
  })
  assert.ok('outcome' in undone, JSON.stringify(undone))
  if (!('outcome' in undone)) return
  assert.equal(undone.project.stages[1]?.currentResult, undefined)
  assert.equal(undone.project.stages[2]?.currentResult, undefined)
  assert.equal(undone.project.stages[3]?.currentResult?.lineage, 'Current')

  const redone = lifecycle.change(owner, {
    projectId,
    expectedProjectRevision: undone.project.revision,
    intentId: IntentId.make('lifecycle-redo-calibration-result'),
    intent: ProcessingProjectIntent.cases.RedoCurrentResult.make({
      stage: 'Calibration',
    }),
  })
  assert.ok('outcome' in redone, JSON.stringify(redone))
  if (!('outcome' in redone)) return
  assert.equal(redone.project.stages[2]?.currentResult?.lineage, 'Current')

  const viewer = {
    ...owner,
    personId: 'viewer-lifecycle',
    role: 'viewer' as const,
  }
  current = lifecycle.open(owner, projectId)
  assert.ok(current)
  const denied = lifecycle.change(viewer, {
    projectId,
    expectedProjectRevision: current.revision,
    intentId: IntentId.make('viewer-change'),
    intent: ProcessingProjectIntent.cases.UndoDraft.make({
      stage: 'Calibration',
    }),
  })
  assert.deepEqual(denied, {
    _tag: 'ProcessAuthorityDenied',
    reason: 'OwnerRequired',
  })
  await notices.return?.()
  database.close()
})
