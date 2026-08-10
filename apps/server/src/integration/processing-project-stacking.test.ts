import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
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
  personId: 'owner-stacking',
  clientId: 'desktop-stacking',
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

test('Stacking freezes Registration choices, versions FITS results, and saves one exact Master', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-stacking-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  execute(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 stacking',
    selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
    idempotencyKey: 'stack-create',
  })
  let project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'RunProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Calibration',
    idempotencyKey: 'stack-calibrate',
  })
  let worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'NavigateProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Registration',
    idempotencyKey: 'stack-open-registration',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'RunProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Registration',
    idempotencyKey: 'stack-register',
  })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const registration = project.stages.find(
    (stage) => stage.stage === 'Registration',
  )
  assert.ok(registration?.selectedAttemptId)
  execute(database, {
    _tag: 'SetRegistrationFrameIncluded',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: 'asset-m27-006',
    included: true,
    idempotencyKey: 'stack-registration-include',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'RunProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Registration',
    idempotencyKey: 'stack-register-rerun',
  })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'NavigateProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    idempotencyKey: 'stack-open',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  let stacking = project.stages.find((stage) => stage.stage === 'Stacking')
  assert.deepEqual(
    stacking?.stackingRecommendations.map((item) => item.decision),
    ['Include', 'Review'],
  )
  const review = stacking?.stackingRecommendations.find(
    (item) => item.decision === 'Review',
  )
  assert.ok(review)
  execute(database, {
    _tag: 'SetStackingFrameIncluded',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: review.assetId,
    included: true,
    idempotencyKey: 'stack-include-review',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'UndoProcessingStageDraft',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    idempotencyKey: 'stack-undo',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.equal(
    project?.stages.find((stage) => stage.stage === 'Stacking')?.draft
      .stackingFrameChoices.length,
    0,
  )
  assert.ok(project)
  execute(database, {
    _tag: 'RedoProcessingStageDraft',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    idempotencyKey: 'stack-redo',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const selectedRegistration = project.stages.find(
    (stage) => stage.stage === 'Registration',
  )?.selectedAttemptId
  execute(database, {
    _tag: 'RunProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    idempotencyKey: 'stack-run-1',
  })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  stacking = project.stages.find((stage) => stage.stage === 'Stacking')
  const first = stacking?.attempts[0]
  assert.ok(first?.stackingOutput)
  assert.equal(first.upstreamAttemptId, selectedRegistration)
  assert.deepEqual(first.stackingInputAssetIds, [
    'asset-m27-012',
    'asset-m27-006',
  ])
  const artifact = Schema.decodeUnknownSync(
    Schema.Struct({ path: Schema.String, checksum: Schema.String }),
  )(
    database
      .prepare(
        'SELECT path,checksum FROM processing_artifacts WHERE output_id=?',
      )
      .get(`stack-output-${first.attemptId}`),
  )
  assert.equal(readFileSync(artifact.path).subarray(0, 6).toString(), 'SIMPLE')
  assert.equal(artifact.checksum, first.stackingOutput.checksum)

  stacking = project.stages.find((stage) => stage.stage === 'Stacking')
  assert.ok(stacking)
  execute(database, {
    _tag: 'UpdateProcessingStageDraft',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    settings: stacking.draft.settings.map((setting) =>
      setting.key === 'weighting'
        ? { ...setting, value: 'signal-weighted' }
        : setting,
    ),
    idempotencyKey: 'stack-settings-2',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  execute(database, {
    _tag: 'RunProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    idempotencyKey: 'stack-run-2',
  })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  stacking = project.stages.find((stage) => stage.stage === 'Stacking')
  assert.equal(stacking?.attempts.length, 2)
  assert.notEqual(
    stacking?.attempts[0]?.stackingOutput?.checksum,
    stacking?.attempts[1]?.stackingOutput?.checksum,
  )
  execute(database, {
    _tag: 'SelectProcessingStageResult',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Stacking',
    attemptId: first.attemptId,
    idempotencyKey: 'stack-select-earlier',
  })
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const saveCommand = {
    _tag: 'SaveProcessingProjectMaster',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    idempotencyKey: 'stack-save',
  }
  assert.equal(execute(database, saveCommand).outcome, 'accepted')
  assert.equal(execute(database, saveCommand).outcome, 'accepted')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const saved = project.stages.find((stage) => stage.stage === 'Stacking')
    ?.attempts[0]?.savedMaster
  assert.ok(saved)
  const detailRow = Schema.decodeUnknownSync(
    Schema.Struct({ detail: Schema.String }),
  )(
    database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get(saved.assetId),
  )
  const detail = Schema.decodeUnknownSync(
    Schema.Struct({
      lineage: Schema.Struct({
        operationIds: Schema.Array(Schema.String),
        processingSessionId: Schema.String,
      }),
    }),
  )(JSON.parse(detailRow.detail))
  assert.deepEqual(detail.lineage.operationIds, [
    selectedRegistration,
    first.attemptId,
  ])
  assert.equal(detail.lineage.processingSessionId, project.projectId)
  assert.equal(
    database
      .prepare('SELECT saved FROM processing_artifacts WHERE output_id=?')
      .get(`stack-output-${first.attemptId}`)?.saved,
    1,
  )
  execute(database, {
    _tag: 'OpenProcessingProjectDevelop',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: saved.assetId,
    idempotencyKey: 'stack-open-develop',
  })
  database.close()
  database = openOriginDatabase(path)
  worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'idle')
  project = processSnapshot(database, owner).projects[0]
  assert.equal(project?.currentStage, 'Develop')
  assert.equal(project?.developMasterAssetId, saved.assetId)
  assert.equal(
    project?.stages.find((stage) => stage.stage === 'Stacking')?.attempts
      .length,
    2,
  )
  database.close()
})
