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
import { settleProcessingProjectStage } from '../services/processing-project-service.ts'
import { createProcessWorkWorker } from '../workers/process-work-worker.ts'

const owner = {
  personId: 'owner-stage',
  clientId: 'desktop-stage',
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

test('project stages accept before work, settle exact evidence atomically, and resume a claim without replay', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-stages-'))
  const path = join(root, 'state.sqlite')
  let database = openOriginDatabase(path)
  seedLibrary(database)
  assert.equal(
    execute(database, {
      _tag: 'CreateProcessingProject',
      name: 'M27 explicit stages',
      selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
      idempotencyKey: 'stage-create',
    }).outcome,
    'accepted',
  )
  let project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  for (let index = 0; index < 12; index += 1) {
    assert.equal(
      execute(database, {
        _tag: 'UpdateProcessingStageDraft',
        projectId: project.projectId,
        expectedProjectRevision: project.revision,
        stage: 'Calibration',
        settings: [{ key: 'profile', value: `draft-${index}` }],
        idempotencyKey: `draft-${index}`,
      }).outcome,
      'accepted',
    )
    project = processSnapshot(database, owner).projects[0]
    assert.ok(project)
  }
  assert.equal(project.stages[0]?.draft.undo.length, 10)
  const accepted = execute(database, {
    _tag: 'RunProcessingProjectStage',
    projectId: project.projectId,
    expectedProjectRevision: project.revision,
    stage: 'Calibration',
    idempotencyKey: 'run-calibration-1',
  })
  assert.equal(accepted.outcome, 'accepted')
  project = processSnapshot(database, owner).projects[0]
  assert.equal(project?.stages[0]?.attempts[0]?.state, 'queued')
  const work = Schema.decodeUnknownSync(
    Schema.Struct({ work_id: Schema.String }),
  )(
    database
      .prepare("SELECT work_id FROM processing_work WHERE kind='projectStage'")
      .get(),
  )
  database
    .prepare(
      "UPDATE processing_work SET state='claimed',claim_token='restart-claim',claimed_at=?,attempts=1 WHERE work_id=?",
    )
    .run('2026-08-09T00:00:00.000Z', work.work_id)
  database.close()

  database = openOriginDatabase(path)
  const worker = createProcessWorkWorker({ database, outputRoot: root })
  assert.deepEqual(worker.pass(), {
    outcome: 'completed',
    kind: 'projectStage',
  })
  assert.equal(worker.pass().outcome, 'idle')
  project = processSnapshot(database, owner).projects[0]
  const attempt = project?.stages[0]?.attempts[0]
  assert.equal(attempt?.state, 'succeeded')
  assert.equal(attempt?.toolIdentity, 'deterministic-calibration-adapter-v1')
  assert.equal(attempt?.sourceRevisions.length, project?.sources.length)
  assert.equal(
    database
      .prepare(
        'SELECT count(*) AS count FROM processing_artifacts WHERE work_id=?',
      )
      .get(work.work_id)?.count,
    1 + (attempt?.outputs.length ?? 0),
  )
  assert.deepEqual(
    settleProcessingProjectStage(
      database,
      work.work_id,
      'obsolete-claim',
      'sha256:stale',
      join(root, 'stale.json'),
    ),
    { outcome: 'stale' },
  )
  database.close()
})

test('upstream rerun keeps older downstream attempts and marks the complete lineage stale', () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-project-lineage-'))
  const database = openOriginDatabase(join(root, 'state.sqlite'))
  seedLibrary(database)
  execute(database, {
    _tag: 'CreateProcessingProject',
    name: 'M27 lineage',
    selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
    idempotencyKey: 'lineage-create',
  })
  const worker = createProcessWorkWorker({ database, outputRoot: root })
  const run = (
    stage: 'Calibration' | 'Registration' | 'Stacking',
    key: string,
  ) => {
    let project = processSnapshot(database, owner).projects[0]
    assert.ok(project)
    if (project.currentStage !== stage) {
      assert.equal(
        execute(database, {
          _tag: 'NavigateProcessingProjectStage',
          projectId: project.projectId,
          expectedProjectRevision: project.revision,
          stage,
          idempotencyKey: `navigate-${key}`,
        }).outcome,
        'accepted',
      )
      project = processSnapshot(database, owner).projects[0]
      assert.ok(project)
    }
    assert.equal(
      execute(database, {
        _tag: 'RunProcessingProjectStage',
        projectId: project.projectId,
        expectedProjectRevision: project.revision,
        stage,
        idempotencyKey: key,
      }).outcome,
      'accepted',
    )
    assert.equal(worker.pass().outcome, 'completed')
  }
  run('Calibration', 'cal-1')
  run('Registration', 'reg-1')
  run('Stacking', 'stack-1')
  run('Calibration', 'cal-2')

  const project = processSnapshot(database, owner).projects[0]
  assert.ok(project)
  const registration = project.stages.find(
    (stage) => stage.stage === 'Registration',
  )
  const stacking = project.stages.find((stage) => stage.stage === 'Stacking')
  assert.equal(registration?.attempts.length, 1)
  assert.equal(registration?.attempts[0]?.basedOnEarlierUpstream, true)
  assert.equal(stacking?.attempts.length, 1)
  assert.equal(stacking?.attempts[0]?.basedOnEarlierUpstream, true)
  assert.equal(
    execute(database, {
      _tag: 'NavigateProcessingProjectStage',
      projectId: project.projectId,
      expectedProjectRevision: project.revision,
      stage: 'Stacking',
      idempotencyKey: 'navigate-stale-stacking',
    }).outcome,
    'accepted',
  )
  const atStacking = processSnapshot(database, owner)
  const action = atStacking.projectActions[0]?.actions.find(
    (candidate) => candidate.action === 'RunProcessingProjectStage',
  )
  assert.deepEqual(action, {
    _tag: 'Ineligible',
    action: 'RunProcessingProjectStage',
    reason: 'upstreamResultRequired',
  })
  let current = atStacking.projects[0]
  assert.ok(current)
  assert.equal(
    execute(database, {
      _tag: 'NavigateProcessingProjectStage',
      projectId: current.projectId,
      expectedProjectRevision: current.revision,
      stage: 'Sources',
      idempotencyKey: 'navigate-source-change',
    }).outcome,
    'accepted',
  )
  current = processSnapshot(database, owner).projects[0]
  assert.ok(current)
  const source = current.sources[0]
  assert.ok(source)
  assert.equal(
    execute(database, {
      _tag: 'AssignProcessingSourceRole',
      projectId: current.projectId,
      expectedProjectRevision: current.revision,
      assetId: source.assetId,
      role: 'Unassigned',
      idempotencyKey: 'change-source-role',
    }).outcome,
    'accepted',
  )
  current = processSnapshot(database, owner).projects[0]
  assert.ok(current)
  assert.ok(
    current.stages
      .find((stage) => stage.stage === 'Calibration')
      ?.attempts.every((attempt) => attempt.basedOnEarlierUpstream),
  )
  database.close()
})
