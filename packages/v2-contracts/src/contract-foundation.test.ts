import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Result, Schema } from "effect"
import {
  AppSnapshot,
  Command,
  CommandEnvelope,
  DomainEvent,
  DomainEventEnvelope,
  EventCursorDecision,
  IncrementalProjectionEvent,
  ProjectionNoticeEnvelope,
  acceptedCommandTags,
  commandFailureFamilies,
  commandTags,
  decideEventCursor,
} from "./index.js"

const runFreshness = {
  runId: "run-1",
  expectedRunRevision: 4,
  expectedLeaseRevision: 2,
}

const acquireFreshness = {
  ...runFreshness,
  expectedAcquireRevision: 3,
}

const processingFreshness = {
  sessionId: "process-1",
  expectedProcessingRevision: 5,
}

const assetFreshness = {
  assetId: "asset-1",
  expectedAssetRevision: 6,
}

const m31Sequence = {
  sequenceId: "sequence-2", targetName: "M31", rightAscensionHours: 0.712, declinationDegrees: 41.269,
  exposureSeconds: 180, frameCount: 24, binning: 1, minimumAltitudeDegrees: 25,
  horizonClearanceDegrees: 5, recenterThresholdArcsec: 30, maxSolveAttempts: 3,
  maxCaptureRetries: 2, acquireFailure: "pause", captureFailure: "retry",
  estimatedDurationSeconds: 4320, estimatedStorageBytes: 960000000, priority: 0,
}

const commandFixtures: ReadonlyArray<unknown> = [
  { _tag: "StartRunFromPlan", planId: "plan-1", expectedPlanRevision: 2, expectedLeaseRevision: 1, preconditionToken: "ready-1", acceptedPlanLimitationIds: [], idempotencyKey: "i-1" },
  { _tag: "PreviewRunMutation", runId: "run-1", expectedRunRevision: 4, proposedChange: { _tag: "AppendFutureSequence", sequence: m31Sequence } },
  { _tag: "ApplyRunMutation", ...runFreshness, previewId: "preview-1", idempotencyKey: "i-9" },
  { _tag: "ApproveDisruptiveRunMutation", ...runFreshness, previewId: "preview-1", approvalId: "approval-1", idempotencyKey: "i-10" },
  { _tag: "PauseRun", ...runFreshness, idempotencyKey: "i-run-pause" },
  { _tag: "ResumeRun", ...runFreshness, idempotencyKey: "i-run-resume" },
  { _tag: "StopRun", ...runFreshness, idempotencyKey: "i-run-stop" },
  { _tag: "RequestControl", expectedLeaseRevision: 2, idempotencyKey: "i-2" },
  { _tag: "GrantControl", expectedLeaseRevision: 2, requestId: "request-1", targetClientId: "client-2", idempotencyKey: "i-3" },
  { _tag: "DeclineControl", expectedLeaseRevision: 2, requestId: "request-1", idempotencyKey: "i-4" },
  { _tag: "ReleaseControl", expectedLeaseRevision: 2, idempotencyKey: "i-5" },
  { _tag: "TakeControl", expectedLeaseRevision: 2, idempotencyKey: "i-6" },
  { _tag: "RetryPlateSolveWithParameters", ...acquireFreshness, parameters: { exposureSeconds: 8, binning: 2, solverProfile: "wide-field" }, idempotencyKey: "i-11" },
  { _tag: "SkipAcquireTarget", ...acquireFreshness, idempotencyKey: "i-12" },
  { _tag: "ApprovePointingCorrection", ...acquireFreshness, proposalId: "proposal-1", idempotencyKey: "i-13" },
  { _tag: "RevisePointingCorrection", ...acquireFreshness, proposalId: "proposal-1", parameters: { rightAscensionArcsec: 120, declinationArcsec: -40 } },
  { _tag: "CapturePolarAlignmentMeasurement", ...acquireFreshness, idempotencyKey: "i-14" },
  { _tag: "AcceptPolarAlignmentEvidence", ...acquireFreshness, attemptId: "attempt-1", idempotencyKey: "i-15" },
  { _tag: "StartProcessingSession", sourceAssetIds: ["asset-1"], idempotencyKey: "i-7" },
  { _tag: "ResumeProcessingSession", sessionId: "process-1", expectedProcessingRevision: 5 },
  { _tag: "SyncProcessingPreview", sessionId: "process-1", expectedProcessingRevision: 5, operation: "stretch", toolId: "siril", parameters: [{ key: "amount", value: { _tag: "NumberValue", value: 0.6 } }], baseHistoryPosition: 2, clientPreviewSequence: 9 },
  { _tag: "ApplyProcessingPreview", ...processingFreshness, previewId: "preview-2", idempotencyKey: "i-16" },
  { _tag: "UndoProcessingStep", ...processingFreshness, idempotencyKey: "i-17" },
  { _tag: "RedoProcessingStep", ...processingFreshness, idempotencyKey: "i-18" },
  { _tag: "PreviewAssistantSuggestion", sessionId: "process-1", expectedProcessingRevision: 5, findingId: "finding-1", findingVersion: 1 },
  { _tag: "MarkAssistantFindingViewed", sessionId: "process-1", findingId: "finding-1", findingVersion: 1 },
  { _tag: "RetryProcessingStep", ...processingFreshness, failedAttemptId: "attempt-2", checkpointId: "checkpoint-1", idempotencyKey: "i-19" },
  { _tag: "SwitchProcessingContext", ...processingFreshness, destination: { _tag: "SavedAsset", assetId: "asset-2" }, disposition: { _tag: "LeaveUnfinished" }, idempotencyKey: "i-20" },
  { _tag: "SaveProcessingArtifacts", ...processingFreshness, artifacts: [{ outputId: "output-1", format: "fits", role: "final" }, { outputId: "output-1", format: "png", role: "preview" }], idempotencyKey: "i-21" },
  { _tag: "DiscardProcessingSession", ...processingFreshness, confirmationId: "discard-1", idempotencyKey: "i-22" },
  { _tag: "RequestAssetDownload", assetId: "asset-1", idempotencyKey: "i-8" },
  { _tag: "RepublishAssetRepresentation", ...assetFreshness, representationId: "representation-1", sourceChecksum: "sha256:abc", idempotencyKey: "i-23" },
  { _tag: "OpenAssetInProcess", assetId: "asset-1" },
]

describe("Gate 5 contract foundation", () => {
  it("keeps the accepted command vocabulary closed", () => {
    assert.equal(commandTags.length, 33)
    assert.deepEqual(commandTags, acceptedCommandTags)
    assert.deepEqual(commandTags, commandFixtures.map((fixture) => Schema.decodeUnknownSync(Command)(fixture)._tag))
  })

  it("decodes one fixture for every accepted command", () => {
    const decode = Schema.decodeUnknownResult(Command)
    commandFixtures.forEach((fixture) => assert.equal(Result.isSuccess(decode(fixture)), true))
  })

  it("rejects an unknown command and a non-integer aggregate revision", () => {
    const decode = Schema.decodeUnknownResult(Command)
    assert.equal(Result.isFailure(decode({ _tag: "ReplayDisconnectedCommands" })), true)
    assert.equal(Result.isFailure(decode({
      _tag: "PreviewRunMutation",
      runId: "run-1",
      expectedRunRevision: "4",
      proposedChange: {},
    })), true)
    assert.equal(Result.isFailure(decode({
      _tag: "ResumeProcessingSession",
      sessionId: "process-1",
      expectedProcessingRevision: -1,
    })), true)
  })

  it("decodes the shared command envelope without caller authority", () => {
    const decoded = Schema.decodeUnknownSync(CommandEnvelope)({
      commandId: "command-1",
      command: commandFixtures[0],
    })
    assert.equal(decoded.command._tag, "StartRunFromPlan")
    assert.equal("actorId" in decoded, false)
  })

  it("keeps failures to the nine accepted families", () => {
    assert.deepEqual(commandFailureFamilies, [
      "AuthenticationFailure",
      "AuthorizationFailure",
      "FreshnessConflict",
      "InvalidInput",
      "ActionIneligible",
      "ReferenceUnavailable",
      "CapabilityUnavailable",
      "ResourceProtected",
      "IdempotencyConflict",
    ])
  })

  it("installs one complete snapshot with separate subsystem health", () => {
    const snapshot = Schema.decodeUnknownSync(AppSnapshot)({
      observatoryId: "observatory-1",
      snapshotVersion: 10,
      eventCursor: 40,
      generatedAt: "2026-07-22T20:00:00Z",
      membership: { personId: "person-1", role: "owner", clientId: "client-1", capability: "controlCapable" },
      control: { leaseId: "lease-1", revision: 2, state: "held", holderClientId: "client-1", pendingRequestCount: 0, actions: [] },
      run: { runId: "run-1", revision: 4, sourcePlanId: "plan-1", phase: "capture", actions: [] },
      processingSessions: [],
      assets: [],
      health: [
        { subsystem: "service", state: "healthy", observedAt: "2026-07-22T20:00:00Z" },
        { subsystem: "tunnel", state: "unavailable", observedAt: "2026-07-22T19:59:58Z", reason: "cloudflared disconnected" },
      ],
    })
    assert.equal(snapshot.run?.phase, "capture")
    assert.equal(snapshot.health[1]?.subsystem, "tunnel")
  })

  it("applies only the next event cursor and refreshes on a gap", () => {
    assert.equal(EventCursorDecision.$is("IgnoreAlreadyApplied")(decideEventCursor(40, 40)), true)
    assert.equal(EventCursorDecision.$is("Apply")(decideEventCursor(40, 41)), true)
    const gap = decideEventCursor(40, 43)
    assert.equal(EventCursorDecision.$is("RefreshSnapshot")(gap), true)
    assert.deepEqual(gap, EventCursorDecision.RefreshSnapshot({ expectedNextCursor: 41, receivedCursor: 43 }))
  })

  it("rejects malformed projection events before client state advances", () => {
    const decoded = Schema.decodeUnknownResult(IncrementalProjectionEvent)({
      _tag: "RunProjected",
      eventCursor: 41,
      snapshotVersion: 10,
      generatedAt: "2026-07-22T20:00:01Z",
      run: { runId: "run-1", phase: "capture" },
    })
    assert.equal(Result.isFailure(decoded), true)
  })

  it("keeps progress notices explicitly outside authoritative cursor state", () => {
    const notice = Schema.decodeUnknownSync(ProjectionNoticeEnvelope)({
      observedAt: "2026-07-22T20:00:01Z",
      notice: { _tag: "OperationProgressed", operationId: "operation-1", state: "running", progress: 0.4 },
    })
    assert.equal(notice.notice._tag, "OperationProgressed")
    assert.equal("eventCursor" in notice, false)
    assert.equal("snapshotVersion" in notice, false)
  })

  it("keeps durable events closed and their payloads typed", () => {
    assert.equal(Object.keys(DomainEvent.cases).length, 38)
    const event = Schema.decodeUnknownSync(DomainEventEnvelope)({
      eventId: "event-1",
      aggregateKind: "ProcessingSession",
      aggregateId: "process-1",
      aggregateRevision: 6,
      occurredAt: "2026-07-22T20:01:00Z",
      commandId: "command-1",
      event: {
        _tag: "ProcessingStepFailed",
        sessionId: "process-1",
        operationId: "operation-1",
        reason: "tool exited 1",
        diagnosticRef: "diagnostic-1",
      },
      schemaVersion: 1,
    })
    assert.equal(event.event._tag, "ProcessingStepFailed")
    assert.throws(() => Schema.decodeUnknownSync(DomainEventEnvelope)({
      ...event,
      event: { _tag: "ProcessingStepFailed", payload: { arbitrary: true } },
    }))
    assert.equal(Result.isFailure(Schema.decodeUnknownResult(DomainEventEnvelope)({
      ...event,
      aggregateKind: "Asset",
    })), true)
  })
})
