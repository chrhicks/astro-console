import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Result, Schema } from "effect"
import {
  AcquireActiveWork,
  AcquireEvidence,
  AcquireSession,
  CorrectionAcknowledgementDecision,
  CorrectionCommandDecision,
  PolarDecision,
  PointingSolveResult,
  RecoverySeriesDecision,
  SolveCompletion,
  SolveCompletionDecision,
  acceptLatestPolarMeasurement,
  approveCorrectionProposal,
  openRecoverySeries,
  recordCorrectionAcknowledgement,
  recordPolarMeasurementEvidence,
  recordSolveCompletion,
  requestPolarMeasurement,
  reviseCorrectionProposal,
} from "./acquire.js"
import { AttemptId } from "./primitives.js"

const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, input: unknown): S["Type"] =>
  Schema.decodeUnknownSync(schema)(input)

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
  runId: "run-polar",
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

const solved = (rightAscensionArcsec: number, declinationArcsec: number) =>
  PointingSolveResult.cases.Solved.make({
    desiredCenter: { rightAscensionDegrees: 279.23, declinationDegrees: 38.78 },
    solvedCenter: { rightAscensionDegrees: 279.2, declinationDegrees: 38.75 },
    correction: { rightAscensionArcsec, declinationArcsec, convention: "mountRaDec" },
    uncertaintyArcsec: 2,
  })

const completion = (
  attemptId: string,
  result: typeof PointingSolveResult.Type,
  capturedAtEpochMs = 1_000,
) => decode(SolveCompletion, {
  attemptId,
  sourceFrameAssetId: `frame-${attemptId}`,
  capturedAtEpochMs,
  solverId: "astrometry.net",
  solverVersion: "0.97",
  result,
  nextAttemptId: `${attemptId}-retry`,
  correctionAttemptId: `${attemptId}-correction`,
  proposalId: `${attemptId}-proposal`,
  proposalExpiresAtEpochMs: capturedAtEpochMs + 60_000,
})

describe("Acquire evidence model", () => {
  it("rejects an impossible phase/work combination at the schema boundary", () => {
    const current = pointingSession()
    const result = Schema.decodeUnknownResult(AcquireSession)({
      ...current,
      phase: "completed",
    })

    assert.equal(Result.isFailure(result), true)
  })

  it("appends no-solution evidence and schedules a correlated bounded retry without movement", () => {
    const noSolution = PointingSolveResult.cases.NoSolution.make({
      category: "starsNotFound",
      retryable: true,
      diagnosticRef: "diagnostic-1",
    })
    const decision = recordSolveCompletion(pointingSession(), completion("solve-1", noSolution))

    assert.equal(SolveCompletionDecision.$is("RetryScheduled")(decision), true)
    if (!SolveCompletionDecision.$is("RetryScheduled")(decision)) return
    assert.equal(decision.session.evidence.length, 1)
    assert.equal(decision.session.solveSeries[0]?.completedAttemptIds.length, 1)
    assert.equal(AcquireActiveWork.guards.SolveRequested(decision.session.activeWork), true)
    assert.equal(AcquireActiveWork.guards.CorrectionRequested(decision.session.activeWork), false)
    if (AcquireActiveWork.guards.SolveRequested(decision.session.activeWork)) {
      assert.equal(decision.session.activeWork.attemptNumber, 2)
      assert.equal(decision.session.activeWork.seriesId, "series-initial")
    }
    const evidence = decision.session.evidence[0]
    assert.ok(evidence !== undefined && AcquireEvidence.guards.SolveAttempt(evidence))
    if (evidence !== undefined && AcquireEvidence.guards.SolveAttempt(evidence)) {
      assert.equal(PointingSolveResult.guards.NoSolution(evidence.result), true)
      assert.equal("correction" in evidence.result, false)
    }
  })

  it("starts only one separately bounded recovery series with materially changed parameters", () => {
    const paused = decode(AcquireSession, {
      ...pointingSession(),
      phase: "paused",
      activeWork: null,
    })
    const unchanged = openRecoverySeries(paused, {
      seriesId: decode(Schema.NonEmptyString.pipe(Schema.brand("RecoverySeriesId")), "recovery-1"),
      attemptId: AttemptId.make("recovery-solve-1"),
      parameters,
    })
    assert.equal(RecoverySeriesDecision.$is("Rejected")(unchanged), true)

    const started = openRecoverySeries(paused, {
      seriesId: decode(Schema.NonEmptyString.pipe(Schema.brand("RecoverySeriesId")), "recovery-1"),
      attemptId: AttemptId.make("recovery-solve-1"),
      parameters: { ...parameters, exposureSeconds: 15 },
    })
    assert.equal(RecoverySeriesDecision.$is("Started")(started), true)
    if (!RecoverySeriesDecision.$is("Started")(started)) return
    assert.equal(started.session.solveSeries.length, 2)
    assert.equal(started.session.solveSeries[0]?.purpose, "initial")
    assert.equal(started.session.solveSeries[1]?.purpose, "operatorRecovery")

    const exhausted = openRecoverySeries(
      decode(AcquireSession, { ...started.session, phase: "paused", activeWork: null }),
      {
        seriesId: decode(Schema.NonEmptyString.pipe(Schema.brand("RecoverySeriesId")), "recovery-2"),
        attemptId: AttemptId.make("recovery-solve-2"),
        parameters: { ...parameters, exposureSeconds: 30 },
      },
    )
    assert.equal(RecoverySeriesDecision.$is("Rejected")(exhausted), true)
    if (RecoverySeriesDecision.$is("Rejected")(exhausted)) {
      assert.equal(exhausted.reason, "RecoveryBudgetExhausted")
    }
  })

  it("carries an exact automatic correction through acknowledgement into image verification", () => {
    const correction = recordSolveCompletion(pointingSession(), completion("solve-1", solved(120, -40)))
    assert.equal(SolveCompletionDecision.$is("AutomaticCorrectionStarted")(correction), true)
    if (!SolveCompletionDecision.$is("AutomaticCorrectionStarted")(correction)) return
    assert.deepEqual(correction.correction, {
      rightAscensionArcsec: 120,
      declinationArcsec: -40,
      convention: "mountRaDec",
    })
    assert.equal(correction.session.phase, "correcting")

    const acknowledged = recordCorrectionAcknowledgement(correction.session, {
      correctionAttemptId: AttemptId.make("solve-1-correction"),
      accepted: true,
      occurredAtEpochMs: 1_100,
      acknowledgementRef: "driver-ack-1",
      verificationSeriesId: decode(Schema.NonEmptyString.pipe(Schema.brand("RecoverySeriesId")), "verify-1"),
      verificationAttemptId: AttemptId.make("verify-solve-1"),
    })
    assert.equal(CorrectionAcknowledgementDecision.$is("VerificationScheduled")(acknowledged), true)
    if (!CorrectionAcknowledgementDecision.$is("VerificationScheduled")(acknowledged)) return
    assert.equal(acknowledged.session.phase, "verifying")
    assert.equal(acknowledged.session.evidence.some(AcquireEvidence.guards.CorrectionAccepted), true)
    if (AcquireActiveWork.guards.SolveRequested(acknowledged.session.activeWork)) {
      assert.equal(acknowledged.session.activeWork.verificationOfCorrectionAttemptId, "solve-1-correction")
    } else {
      assert.fail("verification solve work was not scheduled")
    }

    const verified = recordSolveCompletion(
      acknowledged.session,
      completion("verify-solve-1", solved(10, -5), 2_000),
    )
    assert.equal(SolveCompletionDecision.$is("Centered")(verified), true)
    if (!SolveCompletionDecision.$is("Centered")(verified)) return
    assert.equal(verified.session.phase, "completed")
    const verification = verified.session.evidence.at(-1)
    assert.ok(verification !== undefined && AcquireEvidence.guards.SolveAttempt(verification))
    if (verification !== undefined && AcquireEvidence.guards.SolveAttempt(verification)) {
      assert.equal(verification.verificationOfCorrectionAttemptId, "solve-1-correction")
      assert.equal(verification.sourceFrameAssetId, "frame-verify-solve-1")
    }
  })

  it("keeps an outside-automatic-bound proposal inert until current, unexpired approval", () => {
    const proposed = recordSolveCompletion(pointingSession(), completion("solve-1", solved(900, 100)))
    assert.equal(SolveCompletionDecision.$is("CorrectionApprovalRequired")(proposed), true)
    if (!SolveCompletionDecision.$is("CorrectionApprovalRequired")(proposed)) return
    assert.equal(proposed.session.activeWork, null)

    const expired = approveCorrectionProposal(proposed.session, {
      proposalId: "solve-1-proposal",
      correctionAttemptId: AttemptId.make("approved-correction"),
      nowEpochMs: 61_001,
    })
    assert.equal(CorrectionCommandDecision.$is("Rejected")(expired), true)
    if (CorrectionCommandDecision.$is("Rejected")(expired)) assert.equal(expired.reason, "ProposalExpired")

    const revised = reviseCorrectionProposal(proposed.session, {
      currentProposalId: "solve-1-proposal",
      nextProposalId: "proposal-revised",
      correction: { rightAscensionArcsec: 700, declinationArcsec: 50, convention: "mountRaDec" },
      nowEpochMs: 2_000,
      expiresAtEpochMs: 62_000,
    })
    assert.equal(CorrectionCommandDecision.$is("Revised")(revised), true)
    if (!CorrectionCommandDecision.$is("Revised")(revised)) return
    assert.equal(revised.session.activeWork, null)
    assert.equal(revised.session.evidence.length, 1)
    assert.equal(revised.session.pendingCorrectionProposal?.proposalId, "proposal-revised")
  })

  it("stores the latest polar evidence, derives tolerance, and rejects superseded acceptance", () => {
    const firstRequest = requestPolarMeasurement(polarSession(), AttemptId.make("polar-1"))
    assert.equal(PolarDecision.$is("MeasurementScheduled")(firstRequest), true)
    if (!PolarDecision.$is("MeasurementScheduled")(firstRequest)) return
    const first = recordPolarMeasurementEvidence(firstRequest.session, {
      attemptId: AttemptId.make("polar-1"),
      sourceFrameAssetId: decode(Schema.NonEmptyString.pipe(Schema.brand("AssetId")), "polar-frame-1"),
      measuredAtEpochMs: 1_000,
      desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
      measuredMountAxis: { rightAscensionDegrees: 0.01, declinationDegrees: 89.98 },
      altitudeErrorArcsec: 80,
      azimuthErrorArcsec: 90,
      uncertaintyArcsec: 5,
    })
    assert.equal(PolarDecision.$is("GuidanceUpdated")(first), true)
    if (!PolarDecision.$is("GuidanceUpdated")(first)) return
    assert.equal(first.measurement.withinTolerance, false)
    assert.equal(first.session.latestPolarMeasurementAttemptId, "polar-1")

    const secondRequest = requestPolarMeasurement(first.session, AttemptId.make("polar-2"))
    assert.equal(PolarDecision.$is("MeasurementScheduled")(secondRequest), true)
    if (!PolarDecision.$is("MeasurementScheduled")(secondRequest)) return
    const second = recordPolarMeasurementEvidence(secondRequest.session, {
      attemptId: AttemptId.make("polar-2"),
      sourceFrameAssetId: decode(Schema.NonEmptyString.pipe(Schema.brand("AssetId")), "polar-frame-2"),
      measuredAtEpochMs: 2_000,
      desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
      measuredMountAxis: { rightAscensionDegrees: 0, declinationDegrees: 89.999 },
      altitudeErrorArcsec: 20,
      azimuthErrorArcsec: 10,
      uncertaintyArcsec: 3,
    })
    assert.equal(PolarDecision.$is("GuidanceUpdated")(second), true)
    if (!PolarDecision.$is("GuidanceUpdated")(second)) return
    assert.equal(second.measurement.withinTolerance, true)

    const stale = acceptLatestPolarMeasurement(second.session, AttemptId.make("polar-1"))
    assert.equal(PolarDecision.$is("Rejected")(stale), true)
    if (PolarDecision.$is("Rejected")(stale)) assert.equal(stale.reason, "MeasurementSuperseded")

    const accepted = acceptLatestPolarMeasurement(second.session, AttemptId.make("polar-2"))
    assert.equal(PolarDecision.$is("Accepted")(accepted), true)
    if (!PolarDecision.$is("Accepted")(accepted)) return
    assert.equal(accepted.session.phase, "completed")
    assert.equal(accepted.session.acceptedPolarMeasurementAttemptId, "polar-2")
  })
})
