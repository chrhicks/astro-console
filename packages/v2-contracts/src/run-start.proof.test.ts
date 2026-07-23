import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Ref } from "effect"
import { ActorContext } from "./gate.js"
import {
  ClientId,
  EventCursor,
  LeaseRevision,
  PersonId,
  PlanId,
  PlanRevision,
  SnapshotVersion,
} from "./primitives.js"
import { RunWork, RunStartReadiness, ValidatedObservingPlan } from "./run.js"
import { makeRunStartServerSimulation } from "./server-simulation.js"

const actor = ActorContext.cases.Member.make({
  personId: PersonId.make("person-owner"),
  clientId: ClientId.make("client-owner-desktop"),
  role: "owner",
  capability: "controlCapable",
})

const initialState = {
  plan: ValidatedObservingPlan.make({
    planId: PlanId.make("plan-m27"),
    revision: PlanRevision.make(7),
    validation: "ready",
    limitations: [],
    executionContext: {
      rigId: "rig-main", mountDeviceId: "mount-asi", cameraDeviceId: "camera-sony",
      latitudeDegrees: 39.95, longitudeDegrees: -75.16, elevationMeters: 30,
      completionBehavior: "park", unsafeBehavior: "pauseAndPark",
    },
    sequences: [
      {
        sequenceId: "m27-wide", targetName: "M27", rightAscensionHours: 19.9934, declinationDegrees: 22.7212,
        exposureSeconds: 180, frameCount: 24, binning: 1, minimumAltitudeDegrees: 25,
        horizonClearanceDegrees: 5, recenterThresholdArcsec: 30, maxSolveAttempts: 3,
        maxCaptureRetries: 2, acquireFailure: "pause", captureFailure: "retry",
        estimatedDurationSeconds: 4320, estimatedStorageBytes: 960000000, priority: 0,
      },
      {
        sequenceId: "m31-wide", targetName: "M31", rightAscensionHours: 0.712, declinationDegrees: 41.269,
        exposureSeconds: 180, frameCount: 24, binning: 1, minimumAltitudeDegrees: 25,
        horizonClearanceDegrees: 5, recenterThresholdArcsec: 30, maxSolveAttempts: 3,
        maxCaptureRetries: 2, acquireFailure: "pause", captureFailure: "retry",
        estimatedDurationSeconds: 4320, estimatedStorageBytes: 960000000, priority: 0,
      },
    ],
  }),
  readiness: RunStartReadiness.cases.Ready.make({ preconditionToken: "ready-plan-7" }),
  leaseRevision: LeaseRevision.make(4),
  leaseHolderClientId: actor.clientId,
  snapshotVersion: SnapshotVersion.make(20),
  eventCursor: EventCursor.make(40),
  receipts: [],
  results: [],
  events: [],
  outbox: [],
}

const command = (commandId: string, idempotencyKey: string, acceptedPlanLimitationIds: ReadonlyArray<string> = []) => ({
  commandId,
  command: {
    _tag: "StartRunFromPlan",
    planId: "plan-m27",
    expectedPlanRevision: 7,
    expectedLeaseRevision: 4,
    preconditionToken: "ready-plan-7",
    acceptedPlanLimitationIds,
    idempotencyKey,
  },
})

const makeServer = () => makeRunStartServerSimulation({
  initialState,
  acceptedAt: "2026-07-23T01:00:00Z",
})

describe("run start server proof", () => {
  it("atomically commits the run, event, result, receipt, and outbox before adapter execution", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const adapterExecutions = yield* Ref.make(0)

      const response = yield* server.startRun(command("command-start-1", "start-run-1"), actor)
      const committed = yield* server.readState()

      assert.equal(response.replayed, false)
      assert.equal(committed.activeRun?.state.runId, response.runId)
      assert.equal(committed.activeRun?.definition.sourcePlanRevision, PlanRevision.make(7))
      assert.equal(committed.activeRun?.definition.executionContext.cameraDeviceId, "camera-sony")
      assert.equal(committed.activeRun?.definition.executionContext.mountDeviceId, "mount-asi")
      assert.equal(committed.activeRun?.definition.executionContext.unsafeBehavior, "pauseAndPark")
      assert.deepEqual(
        committed.activeRun?.definition.sequences.map((sequence) => sequence.sequenceId),
        ["m27-wide", "m31-wide"],
      )
      assert.equal(committed.activeRun?.definition.sequences[0].exposureSeconds, 180)
      assert.equal(committed.activeRun?.definition.sequences[0].frameCount, 24)
      assert.equal(committed.activeRun?.definition.sequences[0].captureFailure, "retry")
      assert.deepEqual(committed.activeRun?.state.acceptedMutations, [])
      assert.equal(committed.receipts.length, 1)
      assert.equal(committed.results.length, 1)
      assert.equal(committed.events.length, 1)
      assert.equal(committed.outbox.length, 1)
      assert.equal(committed.snapshotVersion, SnapshotVersion.make(21))
      assert.equal(committed.eventCursor, EventCursor.make(41))
      assert.deepEqual(response.projection.activeRun, committed.activeRun)
      assert.equal(response.projection.snapshotVersion, committed.snapshotVersion)
      assert.equal(response.projection.eventCursor, committed.eventCursor)
      assert.equal(yield* Ref.get(adapterExecutions), 0)

      yield* server.dispatchOutbox((work) => RunWork.match(work, {
        BeginRun: ({ runId }) => Ref.update(adapterExecutions, (count) => {
          assert.equal(runId, response.runId)
          return count + 1
        }),
        RefreshFutureSchedule: () => Effect.die(new Error("unexpected future schedule work")),
        StopActiveExposure: () => Effect.die(new Error("unexpected exposure stop work")),
        SlewAndAcquire: () => Effect.die(new Error("unexpected slew work")),
        PauseRun: () => Effect.die(new Error("unexpected pause work")),
        ResumeRun: () => Effect.die(new Error("unexpected resume work")),
        StopRun: () => Effect.die(new Error("unexpected stop work")),
      }))

      assert.equal(yield* Ref.get(adapterExecutions), 1)
    }))
  })

  it("replays the recorded result without creating another run or work item", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()

      const accepted = yield* server.startRun(command("command-start-original", "start-run-replay"), actor)
      const replayed = yield* server.startRun(command("command-start-retry", "start-run-replay"), actor)
      const state = yield* server.readState()

      assert.equal(replayed.replayed, true)
      assert.equal(replayed.resultRef, accepted.resultRef)
      assert.equal(replayed.runId, accepted.runId)
      assert.equal(state.receipts.length, 1)
      assert.equal(state.results.length, 1)
      assert.equal(state.events.length, 1)
      assert.equal(state.outbox.length, 1)
      assert.equal(state.snapshotVersion, SnapshotVersion.make(21))
      assert.equal(state.eventCursor, EventCursor.make(41))
    }))
  })

  it("serializes conflicting concurrent starts so exactly one commits", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const start = (commandId: string, idempotencyKey: string) => server.startRun(command(commandId, idempotencyKey), actor).pipe(
        Effect.as("started" as const),
        Effect.catchTag("ServerSimulation.RunStartRejected", ({ reason }) => Effect.succeed(reason)),
      )

      const outcomes = yield* Effect.all([
        start("command-concurrent-a", "start-concurrent-a"),
        start("command-concurrent-b", "start-concurrent-b"),
      ], { concurrency: "unbounded" })
      const state = yield* server.readState()

      assert.deepEqual([...outcomes].sort(), ["ActiveRunConflict", "started"])
      assert.equal(state.receipts.length, 1)
      assert.equal(state.results.length, 1)
      assert.equal(state.events.length, 1)
      assert.equal(state.outbox.length, 1)
      assert.equal(state.snapshotVersion, SnapshotVersion.make(21))
      assert.equal(state.eventCursor, EventCursor.make(41))
    }))
  })

  it("leaves every authoritative surface unchanged when authority rejects the command", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeServer()
      const staleLeaseRequest = {
        ...command("command-stale-lease", "start-stale-lease"),
        command: {
          ...command("command-stale-lease", "start-stale-lease").command,
          expectedLeaseRevision: 3,
        },
      }

      const outcome = yield* server.startRun(staleLeaseRequest, actor).pipe(
        Effect.as("started" as const),
        Effect.catchTag("ServerSimulation.CommandRejected", () => Effect.succeed("rejected" as const)),
      )
      const state = yield* server.readState()

      assert.equal(outcome, "rejected")
      assert.deepEqual(state, initialState)
    }))
  })

  it("requires explicit acceptance of the exact validated plan limitations and freezes them into the run", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const inventedAcceptanceServer = yield* makeServer()
      const inventedAcceptance = yield* inventedAcceptanceServer.startRun(
        command("command-invented-limitation", "invented-limitation", ["not-in-plan"]),
        actor,
      ).pipe(
        Effect.as("started" as const),
        Effect.catchTag("ServerSimulation.RunStartRejected", ({ reason }) => Effect.succeed(reason)),
      )
      assert.equal(inventedAcceptance, "PlanLimitationsNotAccepted")
      assert.deepEqual(yield* inventedAcceptanceServer.readState(), initialState)

      const limitedState = {
        ...initialState,
        plan: ValidatedObservingPlan.make({
          ...initialState.plan,
          validation: "readyWithLimitations",
          limitations: [{ limitationId: "short-window", summary: "Only 42 minutes remain above the local horizon" }],
        }),
      }
      const rejectingServer = yield* makeRunStartServerSimulation({
        initialState: limitedState,
        acceptedAt: "2026-07-23T01:00:00Z",
      })
      const missingAcceptance = yield* rejectingServer.startRun(command("command-limited-missing", "limited-missing"), actor).pipe(
        Effect.as("started" as const),
        Effect.catchTag("ServerSimulation.RunStartRejected", ({ reason }) => Effect.succeed(reason)),
      )
      assert.equal(missingAcceptance, "PlanLimitationsNotAccepted")
      assert.deepEqual(yield* rejectingServer.readState(), limitedState)

      const acceptingServer = yield* makeRunStartServerSimulation({
        initialState: limitedState,
        acceptedAt: "2026-07-23T01:00:00Z",
      })
      yield* acceptingServer.startRun(command("command-limited-accepted", "limited-accepted", ["short-window"]), actor)
      const accepted = yield* acceptingServer.readState()
      assert.deepEqual(accepted.activeRun?.definition.acceptedLimitations, limitedState.plan.limitations)
    }))
  })
})
