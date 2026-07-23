import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Schema } from "effect"
import {
  Command,
  PlanId,
  PlanRevision,
  RunId,
  RunStartReadiness,
  StartRunDecision,
  ValidatedObservingPlan,
  decideStartRun,
} from "./index.js"

const command = Schema.decodeUnknownSync(Command.cases.StartRunFromPlan)({
  _tag: "StartRunFromPlan",
  planId: "plan-1",
  expectedPlanRevision: 3,
  expectedLeaseRevision: 4,
  preconditionToken: "ready-3",
  acceptedPlanLimitationIds: [],
  idempotencyKey: "start-1",
})

const plan = Schema.decodeUnknownSync(ValidatedObservingPlan)({
  planId: "plan-1",
  revision: 3,
  validation: "ready",
  limitations: [],
  executionContext: {
    rigId: "rig-main", mountDeviceId: "mount-asi", cameraDeviceId: "camera-sony",
    latitudeDegrees: 39.95, longitudeDegrees: -75.16, elevationMeters: 30,
    completionBehavior: "park", unsafeBehavior: "pauseAndPark",
  },
  sequences: [
    {
      sequenceId: "m27", targetName: "M27", rightAscensionHours: 19.9934, declinationDegrees: 22.7212,
      exposureSeconds: 180, frameCount: 24, binning: 1, minimumAltitudeDegrees: 25,
      horizonClearanceDegrees: 5, recenterThresholdArcsec: 30, maxSolveAttempts: 3,
      maxCaptureRetries: 2, acquireFailure: "pause", captureFailure: "retry",
      estimatedDurationSeconds: 4320, estimatedStorageBytes: 960000000, priority: 0,
    },
    {
      sequenceId: "m31", targetName: "M31", rightAscensionHours: 0.712, declinationDegrees: 41.269,
      exposureSeconds: 180, frameCount: 24, binning: 1, minimumAltitudeDegrees: 25,
      horizonClearanceDegrees: 5, recenterThresholdArcsec: 30, maxSolveAttempts: 3,
      maxCaptureRetries: 2, acquireFailure: "pause", captureFailure: "retry",
      estimatedDurationSeconds: 4320, estimatedStorageBytes: 960000000, priority: 0,
    },
  ],
})

const input = {
  command,
  plan,
  readiness: RunStartReadiness.cases.Ready.make({ preconditionToken: "ready-3" }),
  assignedRunId: RunId.make("run-1"),
  acceptedAt: "2026-07-22T23:30:00Z",
}

describe("start-run decision", () => {
  it("freezes accepted plan content and emits work without touching hardware", () => {
    const decision = decideStartRun(input)
    assert.equal(StartRunDecision.$is("Started")(decision), true)
    StartRunDecision.$match(decision, {
      Started: ({ definition, state, work }) => {
        assert.equal(definition.sourcePlanId, PlanId.make("plan-1"))
        assert.equal(definition.sourcePlanRevision, PlanRevision.make(3))
        assert.deepEqual(definition.sequences.map((sequence) => sequence.sequenceId), ["m27", "m31"])
        assert.equal(state.activeSequenceId, "m27")
        assert.deepEqual(state.futureSequenceIds, ["m31"])
        assert.equal(work._tag, "BeginRun")
      },
      Rejected: ({ reason }) => assert.fail(`unexpected rejection: ${reason}`),
    })
  })

  it("rejects a concurrent active run", () => {
    const decision = decideStartRun({ ...input, activeRunId: RunId.make("run-existing") })
    StartRunDecision.$match(decision, {
      Started: () => assert.fail("run must not start"),
      Rejected: ({ reason }) => assert.equal(reason, "ActiveRunConflict"),
    })
  })

  it("rejects an expired readiness token", () => {
    const decision = decideStartRun({
      ...input,
      readiness: RunStartReadiness.cases.Ready.make({ preconditionToken: "ready-new" }),
    })
    StartRunDecision.$match(decision, {
      Started: () => assert.fail("run must not start"),
      Rejected: ({ reason }) => assert.equal(reason, "PreconditionExpired"),
    })
  })

  it("rejects unknown critical observatory state", () => {
    const decision = decideStartRun({
      ...input,
      readiness: RunStartReadiness.cases.Blocked.make({ reasons: ["mount state is stale"] }),
    })
    StartRunDecision.$match(decision, {
      Started: () => assert.fail("run must not start"),
      Rejected: ({ reason, explanations }) => {
        assert.equal(reason, "CriticalStateUnknown")
        assert.deepEqual(explanations, ["mount state is stale"])
      },
    })
  })
})
