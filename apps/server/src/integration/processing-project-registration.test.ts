import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
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
  personId: 'owner-registration',
  clientId: 'desktop-registration',
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

test('Registration freezes one Calibration result and reruns a chosen viable subset after restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-registration-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  execute(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 registration',
    selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
    idempotencyKey: 'registration-create',
  })
  let project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'AddProcessingProjectSources',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      selection: { assetIds: ['asset-m27-005'], captureSetIds: [] },
      idempotencyKey: 'registration-add-unavailable',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'AssignProcessingSourceRole',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      assetId: 'asset-m27-005',
      role: 'Lights',
      idempotencyKey: 'registration-assign-unavailable',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Calibration',
      idempotencyKey: 'registration-calibration',
    }).outcome,
    'accepted',
  )
  let worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'NavigateProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-open',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const registrationStage = project.stages.find(
    (stage) => stage.stage === 'Registration',
  )
  assert.ok(registrationStage)
  assert.equal(
    execute(database, {
      _tag: 'UpdateProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      settings: registrationStage.draft.settings.map((setting) =>
        setting.key === 'referenceAssetId'
          ? { ...setting, value: 'asset-not-calibrated' }
          : setting,
      ),
      idempotencyKey: 'registration-invalid-reference',
    }).outcome,
    'accepted',
  )
  let projection = processSnapshot(database, owner)
  project = projection.projects[0]
  assert.ok(project)
  assert.deepEqual(
    projection.projectActions[0]?.actions.find(
      (action) => action.action === 'RunProcessingProjectStage',
    ),
    {
      _tag: 'Ineligible',
      action: 'RunProcessingProjectStage',
      reason: 'registrationReferenceUnavailable',
    },
  )
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-invalid-reference-run',
    }).outcome,
    'rejected',
  )
  assert.equal(
    processSnapshot(database, owner).projects[0]?.revision,
    project.revision,
  )
  assert.equal(
    execute(database, {
      _tag: 'UndoProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-reference-undo',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const calibration = project.stages.find(
    (stage) => stage.stage === 'Calibration',
  )?.attempts[0]
  assert.ok(calibration)
  assert.equal(calibration.outputs.length, 2)

  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-run-1',
    }).outcome,
    'accepted',
  )
  const work = Schema.decodeUnknownSync(
    Schema.Struct({ work_id: Schema.String }),
  )(
    database
      .prepare(
        "SELECT work_id FROM processing_work WHERE kind='projectStage' AND stage='Registration' ORDER BY rowid DESC",
      )
      .get(),
  )
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='registration-restart',claimed_at=?,attempts=1 WHERE work_id=?",
    )
    .run('2026-08-10T00:00:00.000Z', work.work_id)
  database.close()

  database = openOriginDatabase(path)
  worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.deepEqual(worker.pass(), {
    outcome: 'completed',
    kind: 'projectStage',
  })
  assert.equal(worker.pass().outcome, 'idle')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  let registration = project.stages.find(
    (stage) => stage.stage === 'Registration',
  )
  const first = registration?.attempts[0]
  assert.ok(first)
  assert.equal(first.upstreamAttemptId, calibration.attemptId)
  assert.deepEqual(
    first.sourceRevisions.map((source) => source.assetId),
    calibration.frameOutcomes.map((outcome) => outcome.assetId),
  )
  assert.deepEqual(
    first.frameOutcomes.map((outcome) => outcome.outcome),
    ['Succeeded', 'Warning', 'Unavailable'],
  )
  assert.equal(first.registrationTransforms.length, 2)
  assert.deepEqual(first.viableAssetIds, ['asset-m27-012'])

  const includeCommand = {
    _tag: 'SetRegistrationFrameIncluded',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    assetId: 'asset-m27-006',
    included: true,
    idempotencyKey: 'registration-include-warning',
  }
  const include = execute(database, includeCommand)
  assert.equal(include.outcome, 'accepted')
  const replay = execute(database, includeCommand)
  assert.equal(replay.outcome, 'accepted')
  if (replay.outcome === 'accepted') assert.equal(replay.replayed, true)
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'UndoProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-undo',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    project.stages.find((stage) => stage.stage === 'Registration')?.draft
      .registrationInclusions.length,
    0,
  )
  assert.equal(
    execute(database, {
      _tag: 'RedoProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-redo',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-run-2',
    }).outcome,
    'accepted',
  )
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  registration = project.stages.find((stage) => stage.stage === 'Registration')
  assert.equal(registration?.attempts.length, 2)
  assert.deepEqual(registration?.attempts[0]?.viableAssetIds, ['asset-m27-012'])
  assert.deepEqual(registration?.attempts[1]?.viableAssetIds, [
    'asset-m27-012',
    'asset-m27-006',
  ])
  assert.equal(
    registration?.attempts[1]?.registrationInclusions[0]?.assetId,
    'asset-m27-006',
  )
  assert.equal(
    database
      .prepare(
        "SELECT count(*) AS count FROM processing_artifacts WHERE work_id=? AND artifact_id LIKE '%:registration:%'",
      )
      .get(`project-stage-${registration?.attempts[1]?.attemptId ?? ''}`)
      ?.count,
    2,
  )

  projection = processSnapshot(database, {
    ...owner,
    role: 'viewer',
  })
  assert.deepEqual(
    projection.projectActions[0]?.actions.find(
      (action) => action.action === 'SetRegistrationFrameIncluded',
    ),
    {
      _tag: 'Ineligible',
      action: 'SetRegistrationFrameIncluded',
      reason: 'ownerRequired',
    },
  )

  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const stage = project.stages.find(
    (candidate) => candidate.stage === 'Registration',
  )
  assert.ok(stage)
  assert.equal(
    execute(database, {
      _tag: 'UpdateProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      settings: stage.draft.settings.map((setting) =>
        setting.key === 'referenceAssetId'
          ? { ...setting, value: 'asset-m27-006' }
          : setting,
      ),
      idempotencyKey: 'registration-reference-change',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-run-reference-change',
    }).outcome,
    'accepted',
  )
  assert.equal(worker.pass().outcome, 'completed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  registration = project.stages.find(
    (candidate) => candidate.stage === 'Registration',
  )
  assert.equal(registration?.attempts.length, 3)
  assert.ok(
    registration?.attempts[2]?.registrationTransforms.every(
      (transform) => transform.referenceAssetId === 'asset-m27-006',
    ),
  )
  const selectedBeforeFailure = registration?.selectedAttemptId

  const currentStage = registration
  assert.ok(currentStage)
  assert.equal(
    execute(database, {
      _tag: 'UpdateProcessingStageDraft',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      settings: [
        ...currentStage.draft.settings,
        { key: 'adapterMode', value: 'fail' },
      ],
      idempotencyKey: 'registration-failed-rerun-draft',
    }).outcome,
    'accepted',
  )
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  assert.equal(
    execute(database, {
      _tag: 'RunProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Registration',
      idempotencyKey: 'registration-failed-rerun',
    }).outcome,
    'accepted',
  )
  assert.equal(worker.pass().outcome, 'failed')
  project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  registration = project.stages.find(
    (candidate) => candidate.stage === 'Registration',
  )
  assert.equal(registration?.attempts.length, 4)
  assert.equal(registration?.attempts[3]?.state, 'failed')
  assert.equal(registration?.selectedAttemptId, selectedBeforeFailure)
  database.close()
})
