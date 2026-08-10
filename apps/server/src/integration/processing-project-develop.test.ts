import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Schema } from 'effect'
import type { LocalIdentity } from '../auth/identity.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import { seedLibrary } from '../persistence/library-sqlite-repository.ts'
import {
  executeProcessCommand,
  processSnapshot,
} from '../services/process-workspace.ts'
import { createProcessWorkWorker } from '../workers/process-work-worker.ts'

const owner: LocalIdentity = {
  personId: 'owner-develop',
  clientId: 'desktop-develop',
  role: 'owner' as const,
  capability: 'controlCapable' as const,
}
const viewer: LocalIdentity = {
  ...owner,
  personId: 'viewer-develop',
  role: 'viewer' as const,
}
const execute = (
  database: ReturnType<typeof openOriginDatabase>,
  command: object,
  identity = owner,
) =>
  executeProcessCommand(
    database,
    { commandId: crypto.randomUUID(), command },
    identity,
  )

function project(database: ReturnType<typeof openOriginDatabase>) {
  const value = processSnapshot(database, owner).projects.at(-1)
  assert.ok(value)
  return value
}

function command(
  database: ReturnType<typeof openOriginDatabase>,
  value: Record<string, unknown>,
) {
  const current = project(database)
  return execute(database, {
    ...value,
    projectId: current.projectId,
    expectedProjectRevision: current.revision,
    idempotencyKey: crypto.randomUUID(),
  })
}

function prepareSavedMaster(
  database: ReturnType<typeof openOriginDatabase>,
  outputRoot: string,
) {
  execute(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 Develop',
    selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
    idempotencyKey: 'develop-create',
  })
  const worker = createProcessWorkWorker({ database, outputRoot })
  command(database, { _tag: 'RunProcessingProjectStage', stage: 'Calibration' })
  assert.equal(worker.pass().outcome, 'completed')
  command(database, {
    _tag: 'NavigateProcessingProjectStage',
    stage: 'Registration',
  })
  command(database, {
    _tag: 'RunProcessingProjectStage',
    stage: 'Registration',
  })
  assert.equal(worker.pass().outcome, 'completed')
  command(database, {
    _tag: 'SetRegistrationFrameIncluded',
    assetId: 'asset-m27-006',
    included: true,
  })
  command(database, {
    _tag: 'RunProcessingProjectStage',
    stage: 'Registration',
  })
  assert.equal(worker.pass().outcome, 'completed')
  command(database, {
    _tag: 'NavigateProcessingProjectStage',
    stage: 'Stacking',
  })
  command(database, {
    _tag: 'SetStackingFrameIncluded',
    assetId: 'asset-m27-006',
    included: true,
  })
  command(database, { _tag: 'RunProcessingProjectStage', stage: 'Stacking' })
  assert.equal(worker.pass().outcome, 'completed')
  command(database, { _tag: 'SaveProcessingProjectMaster' })
  const saved = project(database)
    .stages.find((stage) => stage.stage === 'Stacking')
    ?.attempts.at(-1)?.savedMaster
  assert.ok(saved)
  command(database, {
    _tag: 'OpenProcessingProjectDevelop',
    assetId: saved.assetId,
  })
  return { worker, saved }
}

function updateAndPreview(
  database: ReturnType<typeof openOriginDatabase>,
  operation: object,
) {
  command(database, { _tag: 'UpdateProcessingDevelopDraft', operation })
  const current = project(database)
  assert.ok(current.develop)
  command(database, {
    _tag: 'SyncProcessingDevelopPreview',
    expectedDevelopDraftRevision: current.develop.draft.revision,
  })
  const synchronized = project(database)
  assert.ok(synchronized.develop?.preview)
  return synchronized.develop.preview
}

function applyPreview(
  database: ReturnType<typeof openOriginDatabase>,
  worker: ReturnType<typeof createProcessWorkWorker>,
) {
  const preview = project(database).develop?.preview
  assert.ok(preview)
  command(database, {
    _tag: 'ApplyProcessingDevelopPreview',
    previewId: preview.previewId,
  })
  return worker.pass()
}

test('Develop freezes one saved Master, applies typed operations, retries, and saves exact lineage', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-develop-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  const prepared = prepareSavedMaster(database, root)
  let worker = prepared.worker
  const saved = prepared.saved
  let current = project(database)
  assert.equal(current.currentStage, 'Develop')
  assert.equal(current.develop?.base.assetId, saved.assetId)
  assert.equal(current.develop?.base.assetRevision, saved.assetRevision)
  assert.equal(current.develop?.base.checksum, saved.checksum)

  const originalRevision = current.revision
  const stale = execute(database, {
    _tag: 'SyncProcessingDevelopPreview',
    projectId: current.projectId,
    expectedProjectRevision: current.revision,
    expectedDevelopDraftRevision: 99,
    idempotencyKey: 'develop-stale-preview',
  })
  assert.deepEqual(stale, {
    outcome: 'rejected',
    reason: 'DevelopDraftRevisionConflict',
  })
  assert.equal(project(database).revision, originalRevision)

  updateAndPreview(database, {
    _tag: 'Stretch',
    method: 'asinh',
    amount: 0.55,
  })
  command(database, { _tag: 'UndoProcessingDevelopDraft' })
  command(database, { _tag: 'RedoProcessingDevelopDraft' })
  current = project(database)
  assert.equal(current.develop?.draft.operation._tag, 'Stretch')
  assert.equal(current.develop?.preview, undefined)
  command(database, {
    _tag: 'SyncProcessingDevelopPreview',
    expectedDevelopDraftRevision: current.develop?.draft.revision,
  })
  assert.equal(applyPreview(database, worker).outcome, 'completed')
  current = project(database)
  assert.equal(current.develop?.historyCursor, 1)
  assert.equal(current.develop?.history.length, 1)
  const first = current.develop?.history[0]
  assert.ok(first)
  const firstArtifact = Schema.decodeUnknownSync(
    Schema.Struct({ path: Schema.String, checksum: Schema.String }),
  )(
    database
      .prepare(
        'SELECT path,checksum FROM processing_artifacts WHERE output_id=?',
      )
      .get(first.outputId),
  )
  assert.equal(
    readFileSync(firstArtifact.path).subarray(0, 6).toString(),
    'SIMPLE',
  )
  assert.equal(firstArtifact.checksum, first.checksum)

  command(database, { _tag: 'UndoProcessingDevelopStep' })
  assert.equal(project(database).develop?.historyCursor, 0)
  command(database, { _tag: 'RedoProcessingDevelopStep' })
  assert.equal(project(database).develop?.historyCursor, 1)

  updateAndPreview(database, { _tag: 'RemoveStars', mode: 'balanced' })
  assert.equal(applyPreview(database, worker).outcome, 'completed')
  current = project(database)
  const removeStars = current.develop?.attempts.at(-1)
  assert.deepEqual(
    removeStars?.outputs.map((output) => output.relation),
    ['starless', 'starCompanion'],
  )
  const pair = removeStars?.outputs.map((output) => output.outputId)
  assert.equal(pair?.length, 2)

  updateAndPreview(database, { _tag: 'AddStars' })
  assert.equal(applyPreview(database, worker).outcome, 'completed')
  current = project(database)
  const addStars = current.develop?.attempts.at(-1)
  assert.deepEqual(addStars?.relatedInputOutputIds, pair)
  assert.equal(addStars?.outputs[0]?.relation, 'developed')

  updateAndPreview(database, { _tag: 'GreenNoiseReduction', strength: 0.4 })
  const checkpoint = current.develop?.history.at(-1)
  assert.ok(checkpoint)
  const input = Schema.decodeUnknownSync(
    Schema.Struct({ path: Schema.String }),
  )(
    database
      .prepare('SELECT path FROM processing_artifacts WHERE output_id=?')
      .get(checkpoint.outputId),
  )
  const unavailablePath = `${input.path}.unavailable`
  renameSync(input.path, unavailablePath)
  assert.equal(applyPreview(database, worker).outcome, 'failed')
  current = project(database)
  const failed = current.develop?.attempts.at(-1)
  assert.equal(failed?.state, 'failed')
  assert.equal(current.develop?.historyCursor, 3)
  renameSync(unavailablePath, input.path)
  assert.ok(failed)
  command(database, {
    _tag: 'RetryProcessingDevelopApply',
    failedAttemptId: failed.attemptId,
  })
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  assert.equal(current.develop?.historyCursor, 4)
  assert.equal(
    current.develop?.attempts.at(-1)?.retryOfAttemptId,
    failed.attemptId,
  )

  const saveCommand = {
    _tag: 'SaveProcessingDevelopResult',
    projectId: current.projectId,
    expectedProjectRevision: current.revision,
    idempotencyKey: 'develop-save-result',
  }
  assert.equal(execute(database, saveCommand).outcome, 'accepted')
  assert.equal(execute(database, saveCommand).outcome, 'accepted')
  current = project(database)
  const savedResult = current.develop?.savedResults[0]
  assert.ok(savedResult)
  const library = Schema.decodeUnknownSync(
    Schema.Struct({
      role: Schema.String,
      format: Schema.String,
      detail: Schema.String,
    }),
  )(
    database
      .prepare('SELECT role,format,detail FROM library_assets WHERE asset_id=?')
      .get(savedResult.assetId),
  )
  assert.equal(library.role, 'final')
  assert.equal(library.format, 'fits')
  const detail = Schema.decodeUnknownSync(
    Schema.Struct({
      lineage: Schema.Struct({
        sourceAssetIds: Schema.Array(Schema.String),
        operationIds: Schema.Array(Schema.String),
      }),
    }),
  )(JSON.parse(library.detail))
  assert.deepEqual(detail.lineage.sourceAssetIds, [saved.assetId])
  const selectedRegistration = current.stages
    .find((stage) => stage.stage === 'Registration')
    ?.attempts.find(
      (attempt) => attempt.attemptId === saved.registrationAttemptId,
    )
  assert.deepEqual(detail.lineage.operationIds.slice(0, 3), [
    selectedRegistration?.upstreamAttemptId,
    saved.registrationAttemptId,
    saved.stackingAttemptId,
  ])
  assert.equal(detail.lineage.operationIds.at(-1), savedResult.attemptId)

  const denied = execute(
    database,
    {
      _tag: 'UpdateProcessingDevelopDraft',
      projectId: current.projectId,
      expectedProjectRevision: current.revision,
      operation: { _tag: 'Stretch', method: 'asinh', amount: 0.2 },
      idempotencyKey: 'viewer-develop-denied',
    },
    viewer,
  )
  assert.deepEqual(denied, { outcome: 'rejected', reason: 'OwnerRequired' })

  database.close()
  database = openOriginDatabase(path)
  worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'idle')
  current = project(database)
  assert.equal(current.develop?.attempts.length, 5)
  assert.equal(current.develop?.historyCursor, 4)
  assert.equal(current.develop?.savedResults[0]?.assetId, savedResult.assetId)
  database.close()
})
