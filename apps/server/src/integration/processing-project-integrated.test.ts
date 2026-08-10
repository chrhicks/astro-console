import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Effect, Schema } from 'effect'
import type { LocalIdentity } from '../auth/identity.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import {
  seedLibrary,
  sqliteLibraryServiceLayer,
} from '../persistence/library-sqlite-repository.ts'
import { LibraryService } from '../services/library-service.ts'
import {
  executeProcessCommand,
  processSnapshot,
} from '../services/process-workspace.ts'
import { createProcessWorkWorker } from '../workers/process-work-worker.ts'

const owner: LocalIdentity = {
  personId: 'owner-integrated-process',
  clientId: 'desktop-integrated-process',
  role: 'owner',
  capability: 'controlCapable',
}

const LibraryDetail = Schema.Struct({
  assetId: Schema.String,
  revision: Schema.Int,
  checksum: Schema.String,
  role: Schema.String,
  format: Schema.String,
  lineage: Schema.Struct({
    sourceAssetIds: Schema.Array(Schema.String),
    processingSessionId: Schema.String,
    processingOutputId: Schema.String,
    operationIds: Schema.Array(Schema.String),
  }),
})

const execute = (
  database: ReturnType<typeof openOriginDatabase>,
  command: object,
) =>
  executeProcessCommand(
    database,
    { commandId: crypto.randomUUID(), command },
    owner,
  )

const project = (database: ReturnType<typeof openOriginDatabase>) => {
  const current = processSnapshot(database, owner).projects[0]
  assert.ok(current)
  return current
}

const command = (
  database: ReturnType<typeof openOriginDatabase>,
  value: Record<string, unknown>,
  key: string,
) => {
  const current = project(database)
  const result = execute(database, {
    ...value,
    projectId: current.projectId,
    expectedProjectRevision: current.revision,
    idempotencyKey: key,
  })
  assert.equal(result.outcome, 'accepted')
  return project(database)
}

const libraryDetail = (
  database: ReturnType<typeof openOriginDatabase>,
  assetId: string,
) => {
  const row = Schema.decodeUnknownSync(
    Schema.Struct({ detail: Schema.String }),
  )(
    database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get(assetId),
  )
  return Schema.decodeUnknownSync(LibraryDetail)(JSON.parse(row.detail))
}

const publicLibraryDetail = (
  database: ReturnType<typeof openOriginDatabase>,
  assetId: string,
) =>
  Effect.runSync(
    LibraryService.pipe(
      Effect.flatMap((library) => library.detail(assetId)),
      Effect.provide(sqliteLibraryServiceLayer(database, () => 1)),
    ),
  )

const retainedSummary = (database: ReturnType<typeof openOriginDatabase>) => {
  const current = project(database)
  const stages = current.stages.map((stage) => ({
    stage: stage.stage,
    selectedAttemptId: stage.selectedAttemptId,
    attempts: stage.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      state: attempt.state,
      upstreamAttemptId: attempt.upstreamAttemptId,
      resultId: attempt.resultId,
      outputChecksum: attempt.outputChecksum,
      stackingChecksum: attempt.stackingOutput?.checksum,
      savedMasterChecksum: attempt.savedMaster?.checksum,
    })),
  }))
  return {
    projectId: current.projectId,
    revision: current.revision,
    currentStage: current.currentStage,
    sources: current.sources.map((source) => ({
      assetId: source.assetId,
      assetRevision: source.assetRevision,
      role: source.role,
      captureSetId: source.captureSetId,
      checksum: source.checksum,
    })),
    stages,
    develop: current.develop && {
      base: current.develop.base,
      preview: current.develop.preview,
      attempts: current.develop.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        state: attempt.state,
        inputChecksum: attempt.inputChecksum,
        outputs: attempt.outputs.map((output) => ({
          outputId: output.outputId,
          checksum: output.checksum,
        })),
      })),
      history: current.develop.history,
      historyCursor: current.develop.historyCursor,
      savedResults: current.develop.savedResults,
    },
    work: database
      .prepare(
        'SELECT work_id,kind,stage,state,checkpoint,attempts FROM processing_work ORDER BY rowid',
      )
      .all(),
    savedEvents: database
      .prepare(
        "SELECT asset_id,event_type,checksum FROM process_asset_events WHERE event_type='ProcessSaved' ORDER BY rowid",
      )
      .all(),
  }
}

test('retains the complete multi-night Library-to-Develop journey across restart without replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-integrated-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)

  assert.equal(
    execute(database, {
      _tag: 'CreateProcessingProject',
      name: 'M27 integrated retained proof',
      selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
      idempotencyKey: 'integrated-create-first-night',
    }).outcome,
    'accepted',
  )
  let current = command(
    database,
    {
      _tag: 'AddProcessingProjectSources',
      selection: { assetIds: [], captureSetIds: ['m27-stack-2'] },
    },
    'integrated-add-second-night',
  )
  assert.equal(current.targetName, 'M27')
  assert.deepEqual(current.sources.map((source) => source.assetId).sort(), [
    'asset-m27-006',
    'asset-m27-012',
    'asset-m27-018',
    'asset-m27-024',
  ])
  assert.deepEqual(
    new Set(current.sources.map((source) => source.captureSetId)),
    new Set(['m27-stack-1', 'm27-stack-2']),
  )
  assert.ok(
    current.sources.every(
      (source) =>
        source.assetRevision === 1 &&
        source.role === 'Lights' &&
        source.libraryRole === 'original' &&
        source.libraryFormat === 'cameraRaw' &&
        source.warnings.length === 0,
    ),
  )
  assert.equal(
    database.prepare('SELECT count(*) AS count FROM processing_work').get()
      ?.count,
    0,
  )

  let worker = createProcessWorkWorker({ database, outputRoot: root })
  command(
    database,
    { _tag: 'RunProcessingProjectStage', stage: 'Calibration' },
    'integrated-calibration-first',
  )
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  const firstCalibration = current.stages.find(
    (stage) => stage.stage === 'Calibration',
  )?.attempts[0]
  assert.ok(firstCalibration)
  assert.equal(firstCalibration.stageOutcome, 'Warning')
  assert.deepEqual(
    firstCalibration.sourceRevisions.map((source) => source.assetId).sort(),
    current.sources.map((source) => source.assetId).sort(),
  )

  command(
    database,
    { _tag: 'RunProcessingProjectStage', stage: 'Calibration' },
    'integrated-calibration-rerun',
  )
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  const calibrationStage = current.stages.find(
    (stage) => stage.stage === 'Calibration',
  )
  assert.equal(calibrationStage?.attempts.length, 2)
  assert.notEqual(
    calibrationStage?.attempts[0]?.outputChecksum,
    calibrationStage?.attempts[1]?.outputChecksum,
  )
  current = command(
    database,
    {
      _tag: 'SelectProcessingStageResult',
      stage: 'Calibration',
      attemptId: firstCalibration.attemptId,
    },
    'integrated-select-earlier-calibration',
  )
  assert.equal(
    current.stages.find((stage) => stage.stage === 'Calibration')
      ?.selectedAttemptId,
    firstCalibration.attemptId,
  )

  command(
    database,
    { _tag: 'NavigateProcessingProjectStage', stage: 'Registration' },
    'integrated-open-registration',
  )
  command(
    database,
    { _tag: 'RunProcessingProjectStage', stage: 'Registration' },
    'integrated-registration-first',
  )
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  const firstRegistration = current.stages.find(
    (stage) => stage.stage === 'Registration',
  )?.attempts[0]
  assert.ok(firstRegistration)
  assert.equal(firstRegistration.upstreamAttemptId, firstCalibration.attemptId)
  const alignmentWarning = firstRegistration.frameOutcomes.find(
    (outcome) => outcome.outcome === 'Warning',
  )
  assert.ok(alignmentWarning)
  assert.match(alignmentWarning.message, /stays out of the next Stack input/)

  command(
    database,
    {
      _tag: 'SetRegistrationFrameIncluded',
      assetId: alignmentWarning.assetId,
      included: true,
    },
    'integrated-include-warning-light',
  )
  command(
    database,
    { _tag: 'RunProcessingProjectStage', stage: 'Registration' },
    'integrated-registration-rerun',
  )
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  const registrationStage = current.stages.find(
    (stage) => stage.stage === 'Registration',
  )
  assert.equal(registrationStage?.attempts.length, 2)
  const selectedRegistration = registrationStage?.attempts.at(-1)
  assert.ok(selectedRegistration)
  assert.ok(
    selectedRegistration.viableAssetIds.includes(alignmentWarning.assetId),
  )
  assert.equal(
    selectedRegistration.registrationInclusions[0]?.decision,
    'Include warning frame',
  )

  command(
    database,
    { _tag: 'NavigateProcessingProjectStage', stage: 'Stacking' },
    'integrated-open-stacking',
  )
  current = project(database)
  const stackingReview = current.stages
    .find((stage) => stage.stage === 'Stacking')
    ?.stackingRecommendations.find(
      (recommendation) =>
        recommendation.decision === 'Review' &&
        recommendation.technicallyUsable,
    )
  assert.ok(stackingReview)
  command(
    database,
    {
      _tag: 'SetStackingFrameIncluded',
      assetId: stackingReview.assetId,
      included: true,
    },
    'integrated-include-reviewed-stack-light',
  )
  command(
    database,
    { _tag: 'RunProcessingProjectStage', stage: 'Stacking' },
    'integrated-stack',
  )
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  const selectedStack = current.stages
    .find((stage) => stage.stage === 'Stacking')
    ?.attempts.at(-1)
  assert.ok(selectedStack?.stackingOutput)
  assert.equal(selectedStack.upstreamAttemptId, selectedRegistration.attemptId)
  assert.ok(
    selectedStack.stackingInputAssetIds.includes(stackingReview.assetId),
  )

  command(
    database,
    { _tag: 'SaveProcessingProjectMaster' },
    'integrated-save-master',
  )
  current = project(database)
  const savedMaster = current.stages
    .find((stage) => stage.stage === 'Stacking')
    ?.attempts.at(-1)?.savedMaster
  assert.ok(savedMaster)
  const masterDetail = libraryDetail(database, savedMaster.assetId)
  assert.equal(
    publicLibraryDetail(database, savedMaster.assetId).assetId,
    savedMaster.assetId,
  )
  assert.equal(masterDetail.checksum, selectedStack.stackingOutput.checksum)
  assert.deepEqual(
    masterDetail.lineage.sourceAssetIds,
    selectedStack.stackingInputAssetIds,
  )
  assert.deepEqual(masterDetail.lineage.operationIds, [
    selectedRegistration.attemptId,
    selectedStack.attemptId,
  ])

  command(
    database,
    { _tag: 'OpenProcessingProjectDevelop', assetId: savedMaster.assetId },
    'integrated-open-develop',
  )
  command(
    database,
    {
      _tag: 'UpdateProcessingDevelopDraft',
      operation: { _tag: 'BackgroundExtraction', sampleDensity: 'balanced' },
    },
    'integrated-develop-operation',
  )
  current = project(database)
  assert.ok(current.develop)
  command(
    database,
    {
      _tag: 'SyncProcessingDevelopPreview',
      expectedDevelopDraftRevision: current.develop.draft.revision,
    },
    'integrated-develop-preview',
  )
  current = project(database)
  assert.ok(current.develop?.preview)
  command(
    database,
    {
      _tag: 'ApplyProcessingDevelopPreview',
      previewId: current.develop.preview.previewId,
    },
    'integrated-develop-apply',
  )
  assert.equal(worker.pass().outcome, 'completed')
  current = project(database)
  const developAttempt = current.develop?.attempts.at(-1)
  assert.equal(developAttempt?.state, 'succeeded')
  assert.equal(developAttempt?.outputs[0]?.format, 'fits')
  command(
    database,
    { _tag: 'SaveProcessingDevelopResult' },
    'integrated-save-develop',
  )
  current = project(database)
  const savedDevelop = current.develop?.savedResults.at(-1)
  assert.ok(savedDevelop)
  const finalDetail = libraryDetail(database, savedDevelop.assetId)
  assert.equal(
    publicLibraryDetail(database, savedDevelop.assetId).assetId,
    savedDevelop.assetId,
  )
  assert.equal(finalDetail.role, 'final')
  assert.equal(finalDetail.format, 'fits')
  assert.equal(finalDetail.checksum, savedDevelop.checksum)
  assert.deepEqual(finalDetail.lineage.sourceAssetIds, [savedMaster.assetId])
  assert.deepEqual(finalDetail.lineage.operationIds, [
    firstCalibration.attemptId,
    selectedRegistration.attemptId,
    selectedStack.attemptId,
    developAttempt.attemptId,
  ])

  const beforeRestart = retainedSummary(database)
  database.close()
  database = openOriginDatabase(path)
  worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'idle')
  assert.deepEqual(retainedSummary(database), beforeRestart)
  assert.deepEqual(libraryDetail(database, savedMaster.assetId), masterDetail)
  assert.deepEqual(libraryDetail(database, savedDevelop.assetId), finalDetail)
  database.close()
})
