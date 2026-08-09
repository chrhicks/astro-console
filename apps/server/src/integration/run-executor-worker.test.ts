import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Effect, Schema } from 'effect'
import {
  PlanIntent,
  ObserveIntent,
  PlanWorkspaceProjection,
  PreflightSnapshot,
  RunExecutionContext,
  BootstrapHttpSuccessEnvelope,
  planSequencePresentation,
} from '@astro-console/v2-contracts'
import { createLocalWebService } from '../app/origin-service.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import {
  RunSqliteRepository,
  runSqliteRepositoryLayer,
} from '../persistence/run-sqlite-repository.ts'
import {
  StateSqliteRepository,
  stateSqliteRepositoryLayer,
} from '../persistence/state-sqlite-repository.ts'
import { reject } from '../http/origin-handlers.ts'
import {
  bootstrapPlanWorkspaceProjection,
  observeWorkspaceProjection,
} from '../services/workspace-projection-service.ts'
import {
  installM27Fixture,
  planWorkspaceProjection,
} from '../services/runtime-bootstrap.ts'
import { createRunExecutorWorker } from '../workers/run-executor-worker.ts'
import type { CameraProviderShape } from '../services/camera-command-service.ts'

const identity = {
  personId: 'owner-chicks',
  clientId: 'desktop-owner',
  role: 'owner' as const,
  capability: 'controlCapable' as const,
}
const context = RunExecutionContext.make({
  rigId: 'simulated-rig',
  cameraDeviceId: 'simulated-camera',
  completionBehavior: 'hold',
  unsafeBehavior: 'pauseAndPark',
})
const StateRow = Schema.Struct({ value: Schema.String })
const CountRow = Schema.Struct({ count: Schema.Int })
const WorkStateRow = Schema.Struct({ state: Schema.String })

function prepare(
  databasePath: string,
  provider: CameraProviderShape,
  options: {
    readonly acquisitionMode?: 'cameraOnly' | 'deepSkyPlateSolve'
    readonly exposureSeconds?: number
    readonly frameCount?: number
    readonly sequenceCount?: number
    readonly executionContext?: typeof RunExecutionContext.Type
  } = {},
) {
  const database = openOriginDatabase(databasePath)
  installM27Fixture(database, false)
  const plan = planWorkspaceProjection(database)
  const [firstSequence, ...remainingSequences] = plan.sequences
  const cameraOnlySequence = (sequence: typeof firstSequence) => ({
    ...sequence,
    definition: {
      ...sequence.definition,
      acquisitionMode: options.acquisitionMode ?? ('cameraOnly' as const),
      exposureSeconds: options.exposureSeconds ?? 15,
      frameCount: options.frameCount ?? 1,
    },
  })
  const firstCameraOnlySequence = cameraOnlySequence(firstSequence)
  const remainingCameraOnlySequences =
    remainingSequences.map(cameraOnlySequence)
  const sequences: [
    typeof firstCameraOnlySequence,
    ...(typeof firstCameraOnlySequence)[],
  ] = [
    firstCameraOnlySequence,
    ...remainingCameraOnlySequences.slice(0, (options.sequenceCount ?? 1) - 1),
  ]
  const cameraOnly = PlanWorkspaceProjection.make({
    ...plan,
    sequences,
  })
  database
    .prepare(
      'UPDATE observing_plans SET projection=?,run_eligible=0 WHERE plan_id=?',
    )
    .run(JSON.stringify(cameraOnly), plan.planId)
  database
    .prepare("UPDATE workspace_projections SET value=? WHERE name='plan'")
    .run(JSON.stringify(cameraOnly))
  const stateRepository = Effect.runSync(
    StateSqliteRepository.pipe(
      Effect.provide(
        stateSqliteRepositoryLayer(database, {
          plan: bootstrapPlanWorkspaceProjection,
          observe: observeWorkspaceProjection,
        }),
      ),
    ),
  )
  const runRepository = Effect.runSync(
    RunSqliteRepository.pipe(
      Effect.provide(
        runSqliteRepositoryLayer(database, stateRepository, reject, {
          executor: 'real',
          executionContext: options.executionContext ?? context,
        }),
      ),
    ),
  )
  const accept = Schema.decodeUnknownSync(PlanIntent.cases.AcceptRunDefinition)(
    {
      _tag: 'AcceptRunDefinition',
      planId: plan.planId,
      expectedPlanRevision: plan.revision,
      expectedLeaseRevision: 1,
      idempotencyKey: 'accept-real-run',
    },
  )
  assert.equal(runRepository.acceptRunDefinition(accept, identity).status, 202)
  const start = Schema.decodeUnknownSync(PlanIntent.cases.StartAcceptedRun)({
    _tag: 'StartAcceptedRun',
    planId: plan.planId,
    expectedPlanRevision: plan.revision,
    expectedLeaseRevision: 1,
    idempotencyKey: 'start-real-run',
  })
  assert.equal(runRepository.startAcceptedRun(start, identity).status, 202)
  const run = stateRepository.state().run
  assert.notEqual(run, null)
  if (run === null) throw new Error('Real run did not start.')
  stateRepository.persistPreflight(
    PreflightSnapshot.make({
      observedAt: '2026-08-08T18:00:00.000Z',
      verdict: 'unknown',
      nextAction: 'The configured camera is ready.',
      checks: [
        {
          key: 'camera-connected',
          state: 'ready',
          observedAt: '2026-08-08T18:00:00.000Z',
          reason: 'The simulated camera is connected.',
        },
      ],
    }),
  )
  return {
    database,
    stateRepository,
    worker: createRunExecutorWorker({
      database,
      stateRepository,
      cameraProvider: provider,
    }),
    runRepository,
    runId: run.id,
  }
}

function reopen(databasePath: string, provider: CameraProviderShape) {
  const database = openOriginDatabase(databasePath)
  const stateRepository = Effect.runSync(
    StateSqliteRepository.pipe(
      Effect.provide(
        stateSqliteRepositoryLayer(database, {
          plan: bootstrapPlanWorkspaceProjection,
          observe: observeWorkspaceProjection,
        }),
      ),
    ),
  )
  return {
    database,
    stateRepository,
    worker: createRunExecutorWorker({
      database,
      stateRepository,
      cameraProvider: provider,
    }),
  }
}

test('startup upgrades an existing Plan and accepted run definition before projection', () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-run-definition-migration-')),
    'state.sqlite',
  )
  const original = openOriginDatabase(databasePath)
  installM27Fixture(original, false)
  const plan = planWorkspaceProjection(original)
  const legacyPlan = {
    ...plan,
    sequences: plan.sequences.map((sequence) => {
      const { definition: _definition, ...legacySequence } = sequence
      return legacySequence
    }),
  }
  original
    .prepare('UPDATE observing_plans SET projection=? WHERE plan_id=?')
    .run(JSON.stringify(legacyPlan), plan.planId)
  original
    .prepare("UPDATE workspace_projections SET value=? WHERE name='plan'")
    .run(JSON.stringify(legacyPlan))
  original.prepare('INSERT INTO run_definitions VALUES (?,?,?,?,?)').run(
    'legacy-definition',
    plan.planId,
    plan.revision,
    JSON.stringify({
      id: 'legacy-definition',
      sourcePlanId: plan.planId,
      sourcePlanRevision: plan.revision,
      acceptedAt: '2026-08-01T00:00:00.000Z',
      executor: 'fake',
      plan: legacyPlan,
    }),
    '2026-08-01T00:00:00.000Z',
  )
  original.close()

  const migrated = openOriginDatabase(databasePath)
  const projectedPlan = planWorkspaceProjection(migrated)
  assert.equal(
    projectedPlan.sequences[0].definition.sequenceId,
    plan.sequences[0].sequenceId,
  )
  const stateRepository = Effect.runSync(
    StateSqliteRepository.pipe(
      Effect.provide(
        stateSqliteRepositoryLayer(migrated, {
          plan: bootstrapPlanWorkspaceProjection,
          observe: observeWorkspaceProjection,
        }),
      ),
    ),
  )
  const projected = bootstrapPlanWorkspaceProjection(
    migrated,
    identity,
    stateRepository.snapshot(identity),
  )
  assert.equal(projected.acceptedRunDefinition?.executor, 'fake')
  migrated.close()
})

test('real camera-only execution persists work before one provider write and observes completion into Verify', async () => {
  let starts = 0
  let state: 'exposing' | 'idle' = 'exposing'
  const provider: CameraProviderShape = {
    startExposure: () => {
      starts += 1
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:15.000Z',
        cameraState: state,
      }),
  }
  const fixture = prepare(':memory:', provider)
  assert.equal(await fixture.worker.pass(), 'captureReady')
  assert.equal(starts, 0)
  assert.equal(await fixture.worker.pass(), 'observing')
  assert.equal(starts, 1)
  state = 'idle'
  assert.equal(await fixture.worker.pass(), 'verified')
  assert.equal(starts, 1)
  assert.equal(fixture.stateRepository.state().run?.phase, 'verify')
  assert.equal(
    JSON.parse(
      Schema.decodeUnknownSync(StateRow)(
        fixture.database
          .prepare("SELECT value FROM state WHERE key='run'")
          .get(),
      ).value,
    ).phase,
    'verify',
  )
  const projected = observeWorkspaceProjection(
    fixture.database,
    identity,
    fixture.stateRepository.snapshot(identity),
  )
  assert.deepEqual(projected?.actions.pause, {
    _tag: 'Ineligible',
    reason: 'policyUnavailable',
  })
  assert.deepEqual(projected?.actions.stop, { _tag: 'Eligible' })
  const run = fixture.stateRepository.state().run
  if (run === null) throw new Error('Verified run is unavailable.')
  assert.equal(
    fixture.runRepository.pause(
      Schema.decodeUnknownSync(ObserveIntent.cases.PauseRun)({
        _tag: 'PauseRun',
        expectedLeaseRevision: 1,
        expectedRunRevision: run.revision,
        idempotencyKey: 'pause-verified-real-run',
      }),
      identity,
    ).status,
    409,
  )
  assert.equal(
    fixture.runRepository.stop(
      Schema.decodeUnknownSync(ObserveIntent.cases.StopRun)({
        _tag: 'StopRun',
        expectedLeaseRevision: 1,
        expectedRunRevision: run.revision,
        idempotencyKey: 'stop-verified-real-run',
      }),
      identity,
    ).status,
    202,
  )
  fixture.database.close()
})

test('an active exposure publishes its observing transition only once', async () => {
  const published: Array<{ type: string; cursor: number }> = []
  const provider: CameraProviderShape = {
    startExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:15.000Z',
        cameraState: 'exposing',
      }),
  }
  const fixture = prepare(':memory:', provider)
  const worker = createRunExecutorWorker({
    database: fixture.database,
    stateRepository: fixture.stateRepository,
    cameraProvider: provider,
    publish: (type, cursor) => published.push({ type, cursor }),
  })

  assert.equal(await worker.pass(), 'captureReady')
  assert.equal(await worker.pass(), 'observing')
  const current = fixture.stateRepository.state()
  assert.deepEqual(
    published.map(({ type }) => type),
    ['RunCaptureReady', 'RunExposureObserved'],
  )

  assert.equal(await worker.pass(), 'observing')
  assert.equal(await worker.pass(), 'observing')
  assert.equal(
    fixture.stateRepository.state().snapshotVersion,
    current.snapshotVersion,
  )
  assert.equal(fixture.stateRepository.state().eventCursor, current.eventCursor)
  assert.equal(published.length, 2)
  fixture.database.close()
})

test('restart after an uncertain provider write performs GET-only reconciliation and never replays start', async () => {
  const databasePath = join(
    mkdtempSync(join(tmpdir(), 'astro-run-executor-restart-')),
    'state.sqlite',
  )
  let starts = 0
  const uncertain: CameraProviderShape = {
    startExposure: () => {
      starts += 1
      return Effect.fail(new Error('provider response lost'))
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () => Effect.fail(new Error('state unavailable')),
  }
  const first = prepare(databasePath, uncertain)
  assert.equal(await first.worker.pass(), 'captureReady')
  assert.equal(await first.worker.pass(), 'reconciling')
  assert.equal(starts, 1)
  first.database.close()

  let recoveredState: 'exposing' | 'idle' = 'exposing'
  const reconciled: CameraProviderShape = {
    startExposure: () => {
      starts += 1
      return Effect.die('start must not replay')
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:15.000Z',
        cameraState: recoveredState,
      }),
  }
  const second = reopen(databasePath, reconciled)
  assert.equal(await second.worker.pass(), 'observing')
  recoveredState = 'idle'
  assert.equal(await second.worker.pass(), 'verified')
  assert.equal(starts, 1)
  assert.equal(second.stateRepository.state().run?.phase, 'verify')
  second.database.close()
})

test('explicit provider rejection is distinct from an unavailable post-ack observation', async () => {
  const rejected = prepare(':memory:', {
    startExposure: () =>
      Effect.succeed({
        _tag: 'Rejected' as const,
        summary: 'Simulator rejected this exposure.',
      }),
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () => Effect.die('rejected commands are not reconciled'),
  })
  assert.equal(await rejected.worker.pass(), 'captureReady')
  assert.equal(await rejected.worker.pass(), 'rejected')
  assert.equal(rejected.stateRepository.state().run?.phase, 'recover')
  rejected.database.close()

  const unavailable = prepare(':memory:', {
    startExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () => Effect.fail(new Error('reconciliation unavailable')),
  })
  assert.equal(await unavailable.worker.pass(), 'captureReady')
  assert.equal(await unavailable.worker.pass(), 'reconciling')
  assert.equal(unavailable.stateRepository.state().run?.phase, 'recover')
  unavailable.database.close()
})

test('acknowledgement followed by immediate idle remains ambiguous and never becomes Verify', async () => {
  let starts = 0
  const fixture = prepare(':memory:', {
    startExposure: () => {
      starts += 1
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:00.000Z',
        cameraState: 'idle',
      }),
  })
  assert.equal(await fixture.worker.pass(), 'captureReady')
  assert.equal(await fixture.worker.pass(), 'reconciling')
  assert.equal(await fixture.worker.pass(), 'reconciling')
  assert.equal(starts, 1)
  assert.equal(fixture.stateRepository.state().run?.phase, 'recover')
  fixture.database.close()
})

test('abort intent is durable before one provider write and settles only after idle observation', async () => {
  let aborts = 0
  let state: 'exposing' | 'idle' = 'exposing'
  const fixture = prepare(':memory:', {
    startExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    abortExposure: () => {
      aborts += 1
      state = 'idle'
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:15.000Z',
        cameraState: state,
      }),
  })
  assert.equal(await fixture.worker.pass(), 'captureReady')
  assert.equal(await fixture.worker.pass(), 'observing')
  fixture.worker.enqueueAbort(fixture.runId)
  assert.equal(aborts, 0)
  assert.equal(await fixture.worker.pass(), 'aborted')
  assert.equal(aborts, 1)
  assert.equal(await fixture.worker.pass(), 'none')
  assert.equal(aborts, 1)
  fixture.database.close()
})

test('real executor fails closed without provider writes outside the single camera-only frame milestone', async () => {
  let starts = 0
  const provider: CameraProviderShape = {
    startExposure: () => {
      starts += 1
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:00.000Z',
        cameraState: 'idle',
      }),
  }
  const deepSky = prepare(':memory:', provider, {
    acquisitionMode: 'deepSkyPlateSolve',
    executionContext: RunExecutionContext.make({
      rigId: 'simulated-rig',
      mountDeviceId: 'simulated-mount',
      cameraDeviceId: 'simulated-camera',
      latitudeDegrees: 39.95,
      longitudeDegrees: -75.16,
      elevationMeters: 30,
      completionBehavior: 'hold',
      unsafeBehavior: 'pauseAndPark',
    }),
  })
  assert.equal(await deepSky.worker.pass(), 'rejected')
  assert.equal(await deepSky.worker.pass(), 'none')
  assert.equal(starts, 0)
  deepSky.database.close()

  const tooLong = prepare(':memory:', provider, { exposureSeconds: 120 })
  assert.equal(await tooLong.worker.pass(), 'rejected')
  assert.equal(await tooLong.worker.pass(), 'none')
  assert.equal(starts, 0)
  tooLong.database.close()

  const multipleFrames = prepare(':memory:', provider, { frameCount: 2 })
  assert.equal(await multipleFrames.worker.pass(), 'rejected')
  assert.equal(await multipleFrames.worker.pass(), 'none')
  assert.equal(starts, 0)
  multipleFrames.database.close()

  const multipleSequences = prepare(':memory:', provider, { sequenceCount: 2 })
  assert.equal(await multipleSequences.worker.pass(), 'rejected')
  assert.equal(await multipleSequences.worker.pass(), 'none')
  assert.equal(starts, 0)
  multipleSequences.database.close()
})

test('real pause and stop each enqueue one durable exposure abort', async () => {
  for (const action of ['PauseRun', 'StopRun'] as const) {
    let aborts = 0
    let cameraState: 'exposing' | 'idle' = 'exposing'
    const fixture = prepare(':memory:', {
      startExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
      abortExposure: () => {
        aborts += 1
        cameraState = 'idle'
        return Effect.succeed({ _tag: 'Acknowledged' as const })
      },
      readState: () =>
        Effect.succeed({
          observedAt: '2026-08-08T18:00:15.000Z',
          cameraState,
        }),
    })
    assert.equal(await fixture.worker.pass(), 'captureReady')
    assert.equal(await fixture.worker.pass(), 'observing')
    const run = fixture.stateRepository.state().run
    if (run === null) throw new Error('Real run is unavailable.')
    const result =
      action === 'PauseRun'
        ? fixture.runRepository.pause(
            Schema.decodeUnknownSync(ObserveIntent.cases.PauseRun)({
              _tag: 'PauseRun',
              expectedLeaseRevision: 1,
              expectedRunRevision: run.revision,
              idempotencyKey: 'PauseRun-real-exposure',
            }),
            identity,
          )
        : fixture.runRepository.stop(
            Schema.decodeUnknownSync(ObserveIntent.cases.StopRun)({
              _tag: 'StopRun',
              expectedLeaseRevision: 1,
              expectedRunRevision: run.revision,
              idempotencyKey: 'StopRun-real-exposure',
            }),
            identity,
          )
    assert.equal(result.status, 202)
    assert.equal(
      Schema.decodeUnknownSync(CountRow)(
        fixture.database
          .prepare(
            "SELECT count(*) AS count FROM run_executor_work WHERE run_id=? AND kind='AbortExposure'",
          )
          .get(fixture.runId),
      ).count,
      1,
    )
    assert.equal(await fixture.worker.pass(), 'aborted')
    assert.equal(aborts, 1)
    assert.equal(
      fixture.stateRepository.state().run?.phase,
      action === 'PauseRun' ? 'paused' : 'stopped',
    )
    assert.equal(await fixture.worker.pass(), 'none')
    fixture.database.close()
  }
})

test('pause and stop cancel an unclaimed exposure and issue no provider command', async () => {
  for (const action of ['PauseRun', 'StopRun'] as const) {
    let starts = 0
    const fixture = prepare(':memory:', {
      startExposure: () => {
        starts += 1
        return Effect.succeed({ _tag: 'Acknowledged' as const })
      },
      abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
      readState: () =>
        Effect.succeed({
          observedAt: '2026-08-08T18:00:15.000Z',
          cameraState: 'idle',
        }),
    })
    assert.equal(await fixture.worker.pass(), 'captureReady')
    const run = fixture.stateRepository.state().run
    if (run === null) throw new Error('Real run is unavailable.')
    const result =
      action === 'PauseRun'
        ? fixture.runRepository.pause(
            Schema.decodeUnknownSync(ObserveIntent.cases.PauseRun)({
              _tag: 'PauseRun',
              expectedLeaseRevision: 1,
              expectedRunRevision: run.revision,
              idempotencyKey: `pending-${action}`,
            }),
            identity,
          )
        : fixture.runRepository.stop(
            Schema.decodeUnknownSync(ObserveIntent.cases.StopRun)({
              _tag: 'StopRun',
              expectedLeaseRevision: 1,
              expectedRunRevision: run.revision,
              idempotencyKey: `pending-${action}`,
            }),
            identity,
          )
    assert.equal(result.status, 202)
    assert.equal(await fixture.worker.pass(), 'none')
    assert.equal(starts, 0)
    assert.equal(
      Schema.decodeUnknownSync(WorkStateRow)(
        fixture.database
          .prepare(
            "SELECT state FROM run_executor_work WHERE run_id=? AND kind='StartExposure'",
          )
          .get(fixture.runId),
      ).state,
      'cancelled',
    )
    fixture.database.close()
  }
})

test('intervention cancels pending BeginRun before execution', async () => {
  let starts = 0
  const fixture = prepare(':memory:', {
    startExposure: () => {
      starts += 1
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () => Effect.die('no camera read is expected'),
  })
  const run = fixture.stateRepository.state().run
  if (run === null) throw new Error('Real run is unavailable.')
  assert.equal(
    fixture.runRepository.pause(
      Schema.decodeUnknownSync(ObserveIntent.cases.PauseRun)({
        _tag: 'PauseRun',
        expectedLeaseRevision: 1,
        expectedRunRevision: run.revision,
        idempotencyKey: 'pause-before-begin',
      }),
      identity,
    ).status,
    202,
  )
  assert.equal(await fixture.worker.pass(), 'none')
  assert.equal(starts, 0)
  assert.equal(
    Schema.decodeUnknownSync(WorkStateRow)(
      fixture.database
        .prepare(
          "SELECT state FROM run_executor_work WHERE run_id=? AND kind='BeginRun'",
        )
        .get(fixture.runId),
    ).state,
    'cancelled',
  )
  fixture.database.close()
})

test('worker cancels a stale pending exposure when persisted run phase is no longer Capture', async () => {
  let starts = 0
  const fixture = prepare(':memory:', {
    startExposure: () => {
      starts += 1
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () => Effect.die('no camera read is expected'),
  })
  assert.equal(await fixture.worker.pass(), 'captureReady')
  const current = fixture.stateRepository.state()
  if (current.run === null) throw new Error('Real run is unavailable.')
  fixture.stateRepository.commit({
    run: {
      ...current.run,
      revision: current.run.revision + 1,
      phase: 'paused',
      resumablePhase: 'capture',
    },
  })
  assert.equal(await fixture.worker.pass(), 'none')
  assert.equal(starts, 0)
  assert.equal(
    Schema.decodeUnknownSync(WorkStateRow)(
      fixture.database
        .prepare(
          "SELECT state FROM run_executor_work WHERE run_id=? AND kind='StartExposure'",
        )
        .get(fixture.runId),
    ).state,
    'cancelled',
  )
  fixture.database.close()
})

test('a claimed exposure reconciles after pause without overwriting the paused run', async () => {
  let releaseStart!: () => void
  let commandStarted!: () => void
  const started = new Promise<void>((resolve) => {
    commandStarted = resolve
  })
  const release = new Promise<void>((resolve) => {
    releaseStart = resolve
  })
  let cameraState: 'exposing' | 'idle' = 'exposing'
  const fixture = prepare(':memory:', {
    startExposure: () =>
      Effect.promise(async () => {
        commandStarted()
        await release
        return { _tag: 'Acknowledged' as const }
      }),
    abortExposure: () => {
      cameraState = 'idle'
      return Effect.succeed({ _tag: 'Acknowledged' as const })
    },
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:15.000Z',
        cameraState,
      }),
  })
  assert.equal(await fixture.worker.pass(), 'captureReady')
  const inFlight = fixture.worker.pass()
  await started
  const run = fixture.stateRepository.state().run
  if (run === null) throw new Error('Real run is unavailable.')
  assert.equal(
    fixture.runRepository.pause(
      Schema.decodeUnknownSync(ObserveIntent.cases.PauseRun)({
        _tag: 'PauseRun',
        expectedLeaseRevision: 1,
        expectedRunRevision: run.revision,
        idempotencyKey: 'pause-claimed-exposure',
      }),
      identity,
    ).status,
    202,
  )
  releaseStart()
  assert.equal(await inFlight, 'observing')
  assert.equal(fixture.stateRepository.state().run?.phase, 'paused')
  assert.equal(await fixture.worker.pass(), 'aborted')
  assert.equal(fixture.stateRepository.state().run?.phase, 'paused')
  fixture.database.close()
})

test('work settlement and run transition roll back together when persistence fails', async () => {
  let cameraState: 'exposing' | 'idle' = 'exposing'
  const fixture = prepare(':memory:', {
    startExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:15.000Z',
        cameraState,
      }),
  })
  assert.equal(await fixture.worker.pass(), 'captureReady')
  assert.equal(await fixture.worker.pass(), 'observing')
  cameraState = 'idle'
  const failingRepository = {
    ...fixture.stateRepository,
    commit: (values: Record<string, unknown>) => {
      fixture.stateRepository.commit(values)
      throw new Error('simulated persistence interruption')
    },
  }
  const worker = createRunExecutorWorker({
    database: fixture.database,
    stateRepository: failingRepository,
    cameraProvider: {
      startExposure: () => Effect.die('start must not replay'),
      abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
      readState: () =>
        Effect.succeed({
          observedAt: '2026-08-08T18:00:16.000Z',
          cameraState,
        }),
    },
  })
  await assert.rejects(worker.pass(), /simulated persistence interruption/)
  assert.equal(fixture.stateRepository.state().run?.phase, 'capture')
  assert.equal(
    Schema.decodeUnknownSync(WorkStateRow)(
      fixture.database
        .prepare(
          "SELECT state FROM run_executor_work WHERE run_id=? AND kind='StartExposure'",
        )
        .get(fixture.runId),
    ).state,
    'observing',
  )
  fixture.database.close()
})

test('camera-only execution remains eligible when an optional focuser is unavailable', async () => {
  const fixture = prepare(':memory:', {
    startExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
    readState: () =>
      Effect.succeed({
        observedAt: '2026-08-08T18:00:00.000Z',
        cameraState: 'exposing',
      }),
  })
  fixture.stateRepository.persistPreflight(
    PreflightSnapshot.make({
      observedAt: '2026-08-08T18:00:00.000Z',
      verdict: 'unknown',
      nextAction: 'The configured camera is ready without a focuser.',
      checks: [
        {
          key: 'camera-connected',
          state: 'ready',
          observedAt: '2026-08-08T18:00:00.000Z',
          reason: 'The simulated camera is connected.',
        },
        {
          key: 'focuser-available',
          state: 'unavailable',
          observedAt: '2026-08-08T18:00:00.000Z',
          reason: 'This camera-only sequence does not require the focuser.',
        },
      ],
    }),
  )
  assert.equal(await fixture.worker.pass(), 'captureReady')
  fixture.database.close()
})

test('origin owns the scheduled executor pass and stops it with the service lifecycle', async (t) => {
  let starts = 0
  let observed!: () => void
  const observation = new Promise<void>((resolve) => {
    observed = resolve
  })
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      fixture: 'plan-draft',
      simulation: {
        origin: 'http://127.0.0.1:32324',
        launchScenario: 'exposure-success',
      },
      runExecutorProviderOrigin: 'http://127.0.0.1:32324',
      runExecutionContext: context,
      preflightProvider: {
        observe: () =>
          Effect.succeed({
            observedAt: '2026-08-08T18:00:00.000Z',
            verdict: 'ready',
            nextAction: 'The configured camera is ready.',
            checks: [
              {
                key: 'camera-connected',
                state: 'ready',
                observedAt: '2026-08-08T18:00:00.000Z',
                reason: 'The simulated camera is connected.',
              },
            ],
          }),
      },
      cameraProvider: {
        startExposure: () => {
          starts += 1
          return Effect.succeed({ _tag: 'Acknowledged' as const })
        },
        abortExposure: () => Effect.succeed({ _tag: 'Acknowledged' as const }),
        readState: () => {
          observed()
          return Effect.succeed({
            observedAt: '2026-08-08T18:00:15.000Z',
            cameraState: 'exposing',
          })
        },
      },
    },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const snapshot = async () => {
    const response = await fetch(`${base}/api/snapshot`)
    return Schema.decodeUnknownSync(BootstrapHttpSuccessEnvelope)(
      await response.json(),
    ).data
  }
  const initial = await snapshot()
  if (initial.plan === undefined) throw new Error('Plan is unavailable.')
  const save = await fetch(`${base}/api/plan/commands`, {
    method: 'POST',
    body: JSON.stringify({
      intent: {
        _tag: 'SaveDraft',
        planId: initial.plan.planId,
        expectedPlanRevision: initial.plan.revision,
        idempotencyKey: 'auto-real-save',
        sequences: initial.plan.sequences
          .slice(0, 1)
          .map(({ viability: _viability, ...sequence }) => {
            const definition = {
              ...sequence.definition,
              acquisitionMode: 'cameraOnly',
              exposureSeconds: 15,
              frameCount: 1,
              estimatedDurationSeconds: 15,
            } as const
            return {
              ...sequence,
              ...planSequencePresentation(definition),
              definition,
            }
          }),
      },
    }),
  })
  assert.equal(save.status, 202)
  const drafted = await snapshot()
  if (drafted.plan === undefined) throw new Error('Draft is unavailable.')
  assert.equal(
    (
      await fetch(`${base}/api/plan/commands`, {
        method: 'POST',
        body: JSON.stringify({
          intent: {
            _tag: 'AcceptRunDefinition',
            planId: drafted.plan.planId,
            expectedPlanRevision: drafted.plan.revision,
            expectedLeaseRevision: drafted.control.revision,
            idempotencyKey: 'auto-real-accept',
          },
        }),
      })
    ).status,
    202,
  )
  const accepted = await snapshot()
  if (accepted.plan === undefined)
    throw new Error('Accepted Plan is unavailable after a fresh snapshot.')
  assert.equal(accepted.plan.acceptedRunDefinition?.executor, 'real')
  assert.deepEqual(accepted.plan.actions?.startAcceptedRun, {
    _tag: 'Eligible',
  })
  assert.equal(
    (
      await fetch(`${base}/api/plan/commands`, {
        method: 'POST',
        body: JSON.stringify({
          intent: {
            _tag: 'StartAcceptedRun',
            planId: accepted.plan.planId,
            expectedPlanRevision: accepted.plan.revision,
            expectedLeaseRevision: accepted.control.revision,
            idempotencyKey: 'auto-real-start',
          },
        }),
      })
    ).status,
    202,
  )
  const started = await snapshot()
  if (started.activeRun._tag !== 'Active')
    throw new Error('Real run is unavailable.')
  assert.equal(
    (
      await fetch(`${base}/api/observe/preflight`, {
        method: 'POST',
        body: JSON.stringify({
          runId: started.activeRun.run.runId,
          expectedRunRevision: started.activeRun.run.revision,
        }),
      })
    ).status,
    200,
  )
  await Promise.race([
    observation,
    new Promise<never>((_, rejectWait) =>
      setTimeout(
        () => rejectWait(new Error('Scheduled executor did not run.')),
        2_000,
      ),
    ),
  ])
  assert.equal(starts, 1)
  assert.equal((await snapshot()).activeRun._tag, 'Active')
  await listener.close()
  service.close()
  assert.equal(starts, 1)
})
