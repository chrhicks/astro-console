import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Schema } from "effect"
import {
  AcquireActiveWork,
  AcquireEvidence,
  AcquireSession,
  PointingSolveResult,
  SolveCompletion,
} from "./acquire.js"
import { AcquireServerSimulation, AcquireWork, makeAcquireServerSimulation } from "./acquire-server-simulation.js"
import { ActorContext } from "./gate.js"
import {
  AcquireRevision,
  AttemptId,
  ClientId,
  EventCursor,
  LeaseRevision,
  PersonId,
  RunRevision,
  SnapshotVersion,
} from "./primitives.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

const actor = ActorContext.cases.Member.make({
  personId: PersonId.make("owner-1"),
  clientId: ClientId.make("owner-desktop"),
  role: "owner",
  capability: "controlCapable",
})

const policy = {
  centeringToleranceArcsec: 30,
  automaticCorrectionLimitArcsec: 300,
  hardCorrectionLimitArcsec: 1800,
  maxSolveAttemptsPerSeries: 3,
  maxCorrectionAttempts: 2,
  maxRecoverySeries: 1,
  polarToleranceArcsec: 120,
}

const parameters = {
  exposureSeconds: 5,
  binning: 1,
  solverProfile: "default",
}

const pointingSession = () => decode(AcquireSession, {
  runId: "run-1",
  revision: 0,
  mode: "pointing",
  phase: "solving",
  policy,
  solveSeries: [{
    seriesId: "series-initial",
    purpose: "initial",
    parameters,
    maxAttempts: 3,
    verificationOfCorrectionAttemptId: null,
    completedAttemptIds: [],
  }],
  evidence: [],
  activeWork: {
    _tag: "SolveRequested",
    attemptId: "solve-1",
    seriesId: "series-initial",
    attemptNumber: 1,
    purpose: "initial",
    verificationOfCorrectionAttemptId: null,
  },
  pendingCorrectionProposal: null,
  latestPolarMeasurementAttemptId: null,
  acceptedPolarMeasurementAttemptId: null,
})

const polarSession = () => decode(AcquireSession, {
  runId: "run-1",
  revision: 0,
  mode: "polar",
  phase: "polarGuidance",
  policy,
  solveSeries: [],
  evidence: [],
  activeWork: null,
  pendingCorrectionProposal: null,
  latestPolarMeasurementAttemptId: null,
  acceptedPolarMeasurementAttemptId: null,
})

const makeState = (session: AcquireSession) => ({
  session,
  runRevision: RunRevision.make(12),
  leaseRevision: LeaseRevision.make(4),
  leaseHolderClientId: actor.clientId,
  nextSequenceId: "sequence-next",
  snapshotVersion: SnapshotVersion.make(20),
  eventCursor: EventCursor.make(40),
  receipts: [],
  results: [],
  events: [],
  outbox: [],
})

const solved = (rightAscensionArcsec: number, declinationArcsec: number) => ({
  _tag: "Solved",
  desiredCenter: { rightAscensionDegrees: 279.23, declinationDegrees: 38.78 },
  solvedCenter: { rightAscensionDegrees: 279.2, declinationDegrees: 38.75 },
  correction: { rightAscensionArcsec, declinationArcsec, convention: "mountRaDec" },
  uncertaintyArcsec: 2,
})

const noSolution = (diagnosticRef: string) => ({
  _tag: "NoSolution",
  category: "starsNotFound",
  retryable: true,
  diagnosticRef,
})

const completion = (
  attemptId: string,
  result: unknown,
  nextAttemptId = `${attemptId}-retry`,
  capturedAtEpochMs = 1_000,
) => ({
  attemptId,
  sourceFrameAssetId: `frame-${attemptId}`,
  capturedAtEpochMs,
  solverId: "astrometry.net",
  solverVersion: "0.97",
  result,
  nextAttemptId,
  correctionAttemptId: `${attemptId}-correction`,
  proposalId: `${attemptId}-proposal`,
  proposalExpiresAtEpochMs: capturedAtEpochMs + 60_000,
})

const command = (
  commandId: string,
  commandTag: string,
  revision: number,
  fields: Record<string, unknown>,
) => ({
  commandId,
  command: {
    _tag: commandTag,
    runId: "run-1",
    expectedRunRevision: 12,
    expectedLeaseRevision: 4,
    expectedAcquireRevision: revision,
    ...fields,
  },
})

const exhaustOrdinarySolveBudget = Effect.fn("AcquireProof.exhaustBudget")(function* (
  server: AcquireServerSimulation,
) {
  yield* server.completeSolve(completion("solve-1", noSolution("diag-1"), "solve-2"))
  yield* server.completeSolve(completion("solve-2", noSolution("diag-2"), "solve-3"))
  yield* server.completeSolve(completion("solve-3", noSolution("diag-3"), "unused"))
  return yield* server.readState()
})

describe("Acquire server proofs", () => {
  it("ACQ-01 and ACQ-05 preserve the exact correction through acknowledgement and fresh image verification", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(pointingSession()))

      yield* server.completeSolve(completion("solve-1", solved(120, -40)))
      const correctionStarted = yield* server.readState()
      assert.equal(correctionStarted.session.phase, "correcting")
      assert.equal(correctionStarted.outbox.length, 1)
      const move = correctionStarted.outbox[0]
      assert.ok(move !== undefined && AcquireWork.guards.MovePointingCorrection(move))
      if (move === undefined || !AcquireWork.guards.MovePointingCorrection(move)) return
      assert.deepEqual(move.correction, {
        rightAscensionArcsec: 120,
        declinationArcsec: -40,
        convention: "mountRaDec",
      })

      const duplicate = yield* server.completeSolve(completion("solve-1", solved(120, -40))).pipe(
        Effect.as("accepted" as const),
        Effect.catchTag("AcquireServer.WorkerResultRejected", () => Effect.succeed("rejected" as const)),
      )
      assert.equal(duplicate, "rejected")
      assert.deepEqual(yield* server.readState(), correctionStarted)

      yield* server.acknowledgeCorrection({
        correctionAttemptId: move.correctionAttemptId,
        accepted: true,
        occurredAtEpochMs: 1_100,
        acknowledgementRef: "driver-ack-1",
      })
      const acknowledged = yield* server.readState()
      assert.equal(acknowledged.session.phase, "verifying")
      assert.equal(acknowledged.session.evidence.some(AcquireEvidence.guards.CorrectionAccepted), true)
      const active = acknowledged.session.activeWork
      assert.ok(AcquireActiveWork.guards.SolveRequested(active))
      if (!AcquireActiveWork.guards.SolveRequested(active)) return
      assert.equal(active.verificationOfCorrectionAttemptId, move.correctionAttemptId)

      yield* server.completeSolve(completion(active.attemptId, solved(10, -5), "unused", 2_000))
      const verified = yield* server.readState()
      assert.equal(verified.session.phase, "completed")
      const verification = verified.session.evidence.at(-1)
      assert.ok(verification !== undefined && AcquireEvidence.guards.SolveAttempt(verification))
      if (verification !== undefined && AcquireEvidence.guards.SolveAttempt(verification)) {
        assert.equal(verification.verificationOfCorrectionAttemptId, move.correctionAttemptId)
        assert.equal(verification.sourceFrameAssetId, `frame-${active.attemptId}`)
      }
      assert.equal(verified.outbox.some(AcquireWork.guards.ContinueToCapture), true)
    }))
  })

  it("ACQ-02 records every failed frame, stops exactly at the ordinary bound, and never moves", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(pointingSession()))
      const paused = yield* exhaustOrdinarySolveBudget(server)

      assert.equal(paused.session.phase, "paused")
      assert.equal(paused.session.evidence.filter(AcquireEvidence.guards.SolveAttempt).length, 3)
      assert.deepEqual(paused.session.solveSeries[0]?.completedAttemptIds, ["solve-1", "solve-2", "solve-3"])
      assert.equal(paused.outbox.filter(AcquireWork.guards.CaptureAndSolve).length, 2)
      assert.equal(paused.outbox.some(AcquireWork.guards.MovePointingCorrection), false)
      assert.equal(paused.events.at(-1)?.kind, "AcquirePaused")
    }))
  })

  it("ACQ-03 atomically opens one changed-parameter recovery series and replays a duplicate without new work", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(pointingSession()))
      const paused = yield* exhaustOrdinarySolveBudget(server)
      const request = command("command-recovery", "RetryPlateSolveWithParameters", paused.session.revision, {
        parameters: { ...parameters, exposureSeconds: 15 },
        idempotencyKey: "recovery-key",
      })

      const accepted = yield* server.submit(request, actor, 5_000)
      const replayed = yield* server.submit(request, actor, 5_000)
      const state = yield* server.readState()

      assert.equal(accepted.replayed, false)
      assert.equal(replayed.replayed, true)
      assert.equal(state.session.solveSeries.length, 2)
      assert.equal(state.session.solveSeries[1]?.purpose, "operatorRecovery")
      assert.equal(state.session.solveSeries[1]?.parameters.exposureSeconds, 15)
      assert.equal(state.receipts.length, 1)
      assert.equal(state.results.length, 1)
      assert.equal(state.events.filter(({ kind }) => kind === "RecoveryStarted").length, 1)
      assert.equal(state.outbox.filter(AcquireWork.guards.CaptureAndSolve).length, 3)
    }))
  })

  it("ACQ-03 serializes competing recovery choices and leaves the rejected command side-effect free", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(pointingSession()))
      const paused = yield* exhaustOrdinarySolveBudget(server)
      const submit = (suffix: string, exposureSeconds: number) => server.submit(
        command(`command-${suffix}`, "RetryPlateSolveWithParameters", paused.session.revision, {
          parameters: { ...parameters, exposureSeconds },
          idempotencyKey: `key-${suffix}`,
        }),
        actor,
        5_000,
      ).pipe(
        Effect.as("accepted" as const),
        Effect.catchTag("AcquireServer.CommandRejected", () => Effect.succeed("rejected" as const)),
      )

      const outcomes = yield* Effect.all([submit("a", 15), submit("b", 20)], { concurrency: "unbounded" })
      const state = yield* server.readState()
      assert.deepEqual([...outcomes].sort(), ["accepted", "rejected"])
      assert.equal(state.session.solveSeries.length, 2)
      assert.equal(state.receipts.length, 1)
      assert.equal(state.events.filter(({ kind }) => kind === "RecoveryStarted").length, 1)
      assert.equal(state.outbox.filter(AcquireWork.guards.CaptureAndSolve).length, 3)
    }))
  })

  it("ACQ-03 supports the explicit skip path only while paused with fallback work", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(pointingSession()))
      const paused = yield* exhaustOrdinarySolveBudget(server)
      yield* server.submit(command("command-skip", "SkipAcquireTarget", paused.session.revision, {
        idempotencyKey: "skip-key",
      }), actor, 5_000)
      const state = yield* server.readState()

      assert.equal(state.session.phase, "skipped")
      assert.equal(state.events.at(-1)?.kind, "AcquireTargetSkipped")
      const work = state.outbox.at(-1)
      assert.ok(work !== undefined && AcquireWork.guards.AdvanceAfterSkippedTarget(work))
      if (work !== undefined && AcquireWork.guards.AdvanceAfterSkippedTarget(work)) {
        assert.equal(work.nextSequenceId, "sequence-next")
      }
    }))
  })

  it("ACQ-04 keeps proposal revision inert, binds approval to the current proposal, and queues only the revised vector", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(pointingSession()))
      yield* server.completeSolve(completion("solve-1", solved(900, 100)))
      const proposed = yield* server.readState()
      const original = proposed.session.pendingCorrectionProposal
      assert.ok(original !== null)
      if (original === null) return
      const beforeRevisionOutbox = proposed.outbox.length

      yield* server.submit(command("command-revise", "RevisePointingCorrection", proposed.session.revision, {
        proposalId: original.proposalId,
        parameters: { rightAscensionArcsec: 700, declinationArcsec: 50 },
      }), actor, 2_000)
      const revised = yield* server.readState()
      assert.equal(revised.outbox.length, beforeRevisionOutbox)
      assert.equal(revised.session.pendingCorrectionProposal?.basis, "operatorRevision")

      const staleOutcome = yield* server.submit(command("command-stale-approval", "ApprovePointingCorrection", proposed.session.revision, {
        proposalId: original.proposalId,
        idempotencyKey: "stale-approval-key",
      }), actor, 2_100).pipe(
        Effect.as("accepted" as const),
        Effect.catchTag("AcquireServer.CommandRejected", () => Effect.succeed("rejected" as const)),
      )
      assert.equal(staleOutcome, "rejected")
      assert.deepEqual(yield* server.readState(), revised)

      const current = revised.session.pendingCorrectionProposal
      assert.ok(current !== null)
      if (current === null) return
      yield* server.submit(command("command-approve", "ApprovePointingCorrection", revised.session.revision, {
        proposalId: current.proposalId,
        idempotencyKey: "approve-key",
      }), actor, 2_200)
      const approved = yield* server.readState()
      const move = approved.outbox.at(-1)
      assert.ok(move !== undefined && AcquireWork.guards.MovePointingCorrection(move))
      if (move !== undefined && AcquireWork.guards.MovePointingCorrection(move)) {
        assert.deepEqual(move.correction, current.correction)
      }
    }))
  })

  it("ACQ-06 and ACQ-07 store authoritative polar evidence and require explicit acceptance of the latest in-tolerance measurement", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(polarSession()))
      yield* server.submit(command("command-polar-1", "CapturePolarAlignmentMeasurement", 0, {
        idempotencyKey: "polar-key-1",
      }), actor, 1_000)
      let state = yield* server.readState()
      const firstWork = state.outbox.at(-1)
      assert.ok(firstWork !== undefined && AcquireWork.guards.CapturePolarMeasurement(firstWork))
      if (firstWork === undefined || !AcquireWork.guards.CapturePolarMeasurement(firstWork)) return
      yield* server.completePolarMeasurement({
        attemptId: firstWork.attemptId,
        sourceFrameAssetId: "polar-frame-1",
        measuredAtEpochMs: 1_100,
        desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
        measuredMountAxis: { rightAscensionDegrees: 0.01, declinationDegrees: 89.98 },
        altitudeErrorArcsec: 100,
        azimuthErrorArcsec: 90,
        uncertaintyArcsec: 5,
      })
      state = yield* server.readState()
      const firstMeasurementId = state.session.latestPolarMeasurementAttemptId
      assert.equal(state.session.phase, "polarGuidance")

      yield* server.submit(command("command-polar-2", "CapturePolarAlignmentMeasurement", state.session.revision, {
        idempotencyKey: "polar-key-2",
      }), actor, 2_000)
      state = yield* server.readState()
      const secondWork = state.outbox.at(-1)
      assert.ok(secondWork !== undefined && AcquireWork.guards.CapturePolarMeasurement(secondWork))
      if (secondWork === undefined || !AcquireWork.guards.CapturePolarMeasurement(secondWork)) return
      yield* server.completePolarMeasurement({
        attemptId: secondWork.attemptId,
        sourceFrameAssetId: "polar-frame-2",
        measuredAtEpochMs: 2_100,
        desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
        measuredMountAxis: { rightAscensionDegrees: 0, declinationDegrees: 89.999 },
        altitudeErrorArcsec: 20,
        azimuthErrorArcsec: 10,
        uncertaintyArcsec: 3,
      })
      state = yield* server.readState()
      const beforeStale = state

      const stale = yield* server.submit(command("command-accept-stale", "AcceptPolarAlignmentEvidence", state.session.revision, {
        attemptId: firstMeasurementId,
        idempotencyKey: "accept-stale-key",
      }), actor, 2_200).pipe(
        Effect.as("accepted" as const),
        Effect.catchTag("AcquireServer.DecisionRejected", () => Effect.succeed("rejected" as const)),
      )
      assert.equal(stale, "rejected")
      assert.deepEqual(yield* server.readState(), beforeStale)

      const latest = state.session.latestPolarMeasurementAttemptId
      assert.ok(latest !== null)
      if (latest === null) return
      const request = command("command-accept-current", "AcceptPolarAlignmentEvidence", state.session.revision, {
        attemptId: latest,
        idempotencyKey: "accept-current-key",
      })
      yield* server.submit(request, actor, 2_300)
      const replay = yield* server.submit(request, actor, 2_300)
      state = yield* server.readState()
      assert.equal(replay.replayed, true)
      assert.equal(state.session.phase, "completed")
      assert.equal(state.session.acceptedPolarMeasurementAttemptId, latest)
      assert.equal(state.outbox.some(AcquireWork.guards.ContinueToCapture), true)
    }))
  })

  it("rejects malformed and stale commands without aggregate, event, receipt, or outbox changes", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const server = yield* makeAcquireServerSimulation(makeState(polarSession()))
      const before = yield* server.readState()

      const malformed = yield* server.submit({ commandId: "bad", command: { _tag: "CapturePolarAlignmentMeasurement" } }, actor, 1_000).pipe(
        Effect.as("accepted" as const),
        Effect.catchTag("SchemaError", () => Effect.succeed("rejected" as const)),
      )
      assert.equal(malformed, "rejected")
      assert.deepEqual(yield* server.readState(), before)

      const stale = yield* server.submit(command("command-stale", "CapturePolarAlignmentMeasurement", 99, {
        idempotencyKey: "stale-key",
      }), actor, 1_000).pipe(
        Effect.as("accepted" as const),
        Effect.catchTag("AcquireServer.CommandRejected", () => Effect.succeed("rejected" as const)),
      )
      assert.equal(stale, "rejected")
      assert.deepEqual(yield* server.readState(), before)
    }))
  })
})
