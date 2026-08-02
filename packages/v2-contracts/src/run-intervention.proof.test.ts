import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from 'effect'
import { ActorContext } from './gate.js'
import {
  ClientId,
  EventCursor,
  LeaseRevision,
  PersonId,
  PlanId,
  PlanRevision,
  RunId,
  RunRevision,
  SnapshotVersion,
} from './primitives.js'
import { ActiveRunState, RunDefinition, RunSequenceDefinition } from './run.js'
import { makeRunInterventionServerSimulation } from './run-intervention-server-simulation.js'

const controller = ActorContext.cases.Member.make({
  personId: PersonId.make('owner'),
  clientId: ClientId.make('owner-desktop'),
  role: 'owner',
  capability: 'controlCapable',
})

const m27 = RunSequenceDefinition.make({
  sequenceId: 'm27',
  targetName: 'M27',
  rightAscensionHours: 19.9934,
  declinationDegrees: 22.7212,
  exposureSeconds: 180,
  frameCount: 24,
  binning: 1,
  minimumAltitudeDegrees: 25,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 30,
  maxSolveAttempts: 3,
  maxCaptureRetries: 2,
  acquireFailure: 'pause',
  captureFailure: 'retry',
  estimatedDurationSeconds: 4320,
  estimatedStorageBytes: 960000000,
  priority: 0,
})

const initialState = () => ({
  definition: RunDefinition.make({
    runId: RunId.make('run-1'),
    sourcePlanId: PlanId.make('plan-1'),
    sourcePlanRevision: PlanRevision.make(7),
    acceptedAt: '2026-07-23T00:00:00Z',
    acceptedLimitations: [],
    executionContext: {
      rigId: 'rig-main',
      mountDeviceId: 'mount-asi',
      cameraDeviceId: 'camera-sony',
      latitudeDegrees: 39.95,
      longitudeDegrees: -75.16,
      elevationMeters: 30,
      completionBehavior: 'park',
      unsafeBehavior: 'pauseAndPark',
    },
    sequences: [m27],
  }),
  run: ActiveRunState.make({
    runId: RunId.make('run-1'),
    revision: RunRevision.make(12),
    phase: 'capture',
    activeSequenceId: 'm27',
    futureSequenceIds: [],
    acceptedMutations: [],
    activeExposure: {
      startedAtEpochMs: 0,
      exposureSeconds: 180,
      provisionalEvidenceId: 'frame-15',
    },
  }),
  leaseRevision: LeaseRevision.make(4),
  leaseHolderClientId: controller.clientId,
  snapshotVersion: SnapshotVersion.make(20),
  eventCursor: EventCursor.make(40),
  receipts: [],
  results: [],
  events: [],
  outbox: [],
})

const command = (
  tag: 'PauseRun' | 'ResumeRun' | 'StopRun',
  commandId: string,
  expectedRunRevision: number,
  idempotencyKey: string,
) => ({
  commandId,
  command: {
    _tag: tag,
    runId: 'run-1',
    expectedRunRevision,
    expectedLeaseRevision: 4,
    idempotencyKey,
  },
})

describe('run intervention server proofs', () => {
  it('pauses, resumes the prior phase, and stops through named durable intents', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunInterventionServerSimulation(
          initialState(),
          '2026-07-23T01:00:00Z',
        )

        const paused = yield* server.pause(
          command('PauseRun', 'pause-1', 12, 'pause-key'),
          controller,
        )
        assert.equal(paused.projection.run.phase, 'paused')
        assert.equal(paused.projection.run.pausedFromPhase, 'capture')
        assert.equal(paused.projection.run.revision, RunRevision.make(13))

        const resumed = yield* server.resume(
          command('ResumeRun', 'resume-1', 13, 'resume-key'),
          controller,
        )
        assert.equal(resumed.projection.run.phase, 'capture')
        assert.equal(resumed.projection.run.pausedFromPhase, undefined)
        assert.equal(resumed.projection.run.revision, RunRevision.make(14))

        const stopped = yield* server.stop(
          command('StopRun', 'stop-1', 14, 'stop-key'),
          controller,
        )
        assert.equal(stopped.projection.run.phase, 'stopped')
        assert.equal(stopped.projection.run.activeExposure, undefined)
        assert.equal(stopped.projection.run.revision, RunRevision.make(15))

        const replayedStop = yield* server.stop(
          command('StopRun', 'stop-retry', 14, 'stop-key'),
          controller,
        )
        const state = yield* server.readState()
        assert.equal(replayedStop.replayed, true)
        assert.equal(replayedStop.resultRef, stopped.resultRef)
        assert.deepEqual(
          state.events.map((event) => event.event._tag),
          ['RunPaused', 'RunResumed', 'RunStopped'],
        )
        assert.deepEqual(
          state.outbox.map((work) => work._tag),
          ['PauseRun', 'ResumeRun', 'StopRun'],
        )
        assert.equal(state.receipts.length, 3)
        assert.equal(state.snapshotVersion, SnapshotVersion.make(23))
        assert.equal(state.eventCursor, EventCursor.make(43))
      }),
    )
  })

  it('rejects repeated terminal and stale interventions without changing any authoritative surface', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunInterventionServerSimulation(
          initialState(),
          '2026-07-23T01:00:00Z',
        )
        yield* server.stop(
          command('StopRun', 'stop-first', 12, 'stop-first-key'),
          controller,
        )
        const terminal = yield* server.readState()

        const repeated = yield* server
          .stop(
            command('StopRun', 'stop-again', 13, 'stop-again-key'),
            controller,
          )
          .pipe(
            Effect.as('stopped' as const),
            Effect.catchTag(
              'RunSimulation.InterventionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(repeated, 'AlreadyTerminal')
        assert.deepEqual(yield* server.readState(), terminal)

        const stale = yield* server
          .pause(
            command('PauseRun', 'pause-stale', 12, 'pause-stale-key'),
            controller,
          )
          .pipe(
            Effect.as('paused' as const),
            Effect.catchTag('RunSimulation.CommandRejected', () =>
              Effect.succeed('rejected' as const),
            ),
          )
        assert.equal(stale, 'rejected')
        assert.deepEqual(yield* server.readState(), terminal)
      }),
    )
  })

  it('serializes concurrent pause and stop so the losing revision creates no event, receipt, or work', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeRunInterventionServerSimulation(
          initialState(),
          '2026-07-23T01:00:00Z',
        )

        const outcomes = yield* Effect.all(
          [
            server
              .pause(
                command('PauseRun', 'pause-race', 12, 'pause-race-key'),
                controller,
              )
              .pipe(
                Effect.as('accepted' as const),
                Effect.catchTag('RunSimulation.CommandRejected', () =>
                  Effect.succeed('rejected' as const),
                ),
              ),
            server
              .stop(
                command('StopRun', 'stop-race', 12, 'stop-race-key'),
                controller,
              )
              .pipe(
                Effect.as('accepted' as const),
                Effect.catchTag('RunSimulation.CommandRejected', () =>
                  Effect.succeed('rejected' as const),
                ),
              ),
          ],
          { concurrency: 'unbounded' },
        )
        const state = yield* server.readState()

        assert.deepEqual([...outcomes].sort(), ['accepted', 'rejected'])
        assert.equal(state.run.revision, RunRevision.make(13))
        assert.equal(state.events.length, 1)
        assert.equal(state.receipts.length, 1)
        assert.equal(state.results.length, 1)
        assert.equal(state.outbox.length, 1)
      }),
    )
  })
})
