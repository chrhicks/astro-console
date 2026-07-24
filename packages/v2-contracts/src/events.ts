import { Data, Schema } from "effect"
import {
  AssetId,
  AttemptId,
  CheckpointId,
  ClientId,
  CommandId,
  EventCursor,
  FindingId,
  GeneratedAt,
  NonNegativeInt,
  NonNegativeNumber,
  OperationId,
  PreviewId,
  ProcessingOutputId,
  ProcessingSessionId,
  ProposalId,
  RepresentationId,
  RunId,
  SnapshotVersion,
  ObservedAt,
} from "./primitives.js"
import {
  AssetSnapshot,
  ControlSnapshot,
  PlanSnapshot,
  ProcessingSessionSnapshot,
  RunSnapshot,
  SubsystemHealth,
} from "./snapshots.js"

export const DurableEventType = Schema.Literals([
  "RunStarted",
  "RunMutationApplied",
  "RunPaused",
  "RunResumed",
  "RunStopped",
  "ControlRequested",
  "ControlDeclined",
  "ControlGranted",
  "ControlReleased",
  "OwnerTookControl",
  "ControlLeaseExpired",
  "AcquireRecoveryStarted",
  "AcquireTargetSkipped",
  "SolveAttemptRecorded",
  "SolveRetryScheduled",
  "CorrectionApproved",
  "CorrectionStarted",
  "CorrectionVerified",
  "AcquirePaused",
  "PolarMeasurementRecorded",
  "PolarAlignmentCompleted",
  "ProcessingSessionStarted",
  "ProcessingHistoryMoved",
  "ProcessingStepApplyStarted",
  "ProcessingStepRetryStarted",
  "ProcessingStepCompleted",
  "ProcessingStepFailed",
  "AssistantFindingRecorded",
  "AssistantFindingViewed",
  "ProcessingArtifactsSaved",
  "ProcessingSessionDiscarded",
  "AssetCreated",
  "AssetDownloadRequested",
  "AssetPublicationStarted",
  "AssetRepublicationStarted",
  "AssetPublished",
  "AssetPublicationFailed",
  "AssetRepresentationExpired",
])

export const AggregateKind = Schema.Literals([
  "Observatory",
  "Membership",
  "ObservingPlan",
  "ActiveRun",
  "ControlLease",
  "ProcessingSession",
  "Asset",
])

const FailureFact = {
  reason: Schema.NonEmptyString,
  diagnosticRef: Schema.optionalKey(Schema.NonEmptyString),
}

export const DomainEvent = Schema.TaggedUnion({
  RunStarted: { runId: RunId, sourcePlanId: Schema.NonEmptyString },
  RunMutationApplied: {
    previewId: PreviewId,
    impact: Schema.Literals(["nonDisruptive", "notice", "disruptive"]),
    consequences: Schema.NonEmptyArray(Schema.NonEmptyString),
    approvalId: Schema.optionalKey(Schema.NonEmptyString),
  },
  RunPaused: { runId: RunId, previousPhase: Schema.NonEmptyString },
  RunResumed: { runId: RunId, resumedPhase: Schema.NonEmptyString },
  RunStopped: { runId: RunId, previousPhase: Schema.NonEmptyString },
  ControlRequested: { requestId: Schema.NonEmptyString, requesterClientId: ClientId },
  ControlDeclined: { requestId: Schema.NonEmptyString },
  ControlGranted: { requestId: Schema.NonEmptyString, holderClientId: ClientId },
  ControlReleased: { previousHolderClientId: ClientId },
  OwnerTookControl: { holderClientId: ClientId },
  ControlLeaseExpired: { previousHolderClientId: ClientId },
  AcquireRecoveryStarted: { recoverySeries: NonNegativeInt, exposureSeconds: Schema.Finite },
  AcquireTargetSkipped: { sequenceId: Schema.NonEmptyString },
  SolveAttemptRecorded: { attemptId: AttemptId, outcome: Schema.Literals(["solved", "noSolution"]), offsetArcsec: Schema.optionalKey(NonNegativeNumber) },
  SolveRetryScheduled: { nextAttempt: NonNegativeInt },
  CorrectionApproved: { proposalId: ProposalId },
  CorrectionStarted: { proposalId: ProposalId, rightAscensionArcsec: Schema.Finite, declinationArcsec: Schema.Finite },
  CorrectionVerified: { attemptId: AttemptId, offsetArcsec: NonNegativeNumber },
  AcquirePaused: { reason: Schema.NonEmptyString },
  PolarMeasurementRecorded: { attemptId: AttemptId, altitudeErrorArcsec: Schema.Finite, azimuthErrorArcsec: Schema.Finite, withinTolerance: Schema.Boolean },
  PolarAlignmentCompleted: { attemptId: AttemptId },
  ProcessingSessionStarted: { sessionId: ProcessingSessionId, sourceAssetIds: Schema.NonEmptyArray(AssetId), phase: Schema.Literals(["build", "develop"]) },
  ProcessingHistoryMoved: { sessionId: ProcessingSessionId, historyPosition: NonNegativeInt },
  ProcessingStepApplyStarted: { sessionId: ProcessingSessionId, previewId: PreviewId, operationId: OperationId },
  ProcessingStepRetryStarted: { sessionId: ProcessingSessionId, failedAttemptId: AttemptId, checkpointId: CheckpointId, operationId: OperationId },
  ProcessingStepCompleted: { sessionId: ProcessingSessionId, operationId: OperationId, outputId: ProcessingOutputId },
  ProcessingStepFailed: { sessionId: ProcessingSessionId, operationId: OperationId, ...FailureFact },
  AssistantFindingRecorded: { sessionId: ProcessingSessionId, findingId: FindingId, findingVersion: NonNegativeInt },
  AssistantFindingViewed: { sessionId: ProcessingSessionId, findingId: FindingId, findingVersion: NonNegativeInt },
  ProcessingArtifactsSaved: { sessionId: ProcessingSessionId, assetIds: Schema.NonEmptyArray(AssetId) },
  ProcessingSessionDiscarded: { sessionId: ProcessingSessionId, cleanupState: Schema.Literals(["queued", "complete"]) },
  AssetCreated: { assetId: AssetId, role: Schema.Literals(["original", "linearMaster", "intermediate", "final", "preview", "diagnostic"]) },
  AssetDownloadRequested: { assetId: AssetId, route: Schema.Literals(["lanStream", "remoteGrantEligible", "remoteStage"]) },
  AssetPublicationStarted: { assetId: AssetId, representationId: RepresentationId },
  AssetRepublicationStarted: { assetId: AssetId, representationId: RepresentationId },
  AssetPublished: { assetId: AssetId, representationId: RepresentationId, expiresAt: Schema.NonEmptyString },
  AssetPublicationFailed: { assetId: AssetId, representationId: Schema.optionalKey(RepresentationId), ...FailureFact },
  AssetRepresentationExpired: { assetId: AssetId, representationId: RepresentationId },
})

export type DomainEvent = typeof DomainEvent.Type

export const DomainEventEnvelope = Schema.Struct({
  eventId: Schema.NonEmptyString,
  aggregateKind: AggregateKind,
  aggregateId: Schema.NonEmptyString,
  aggregateRevision: NonNegativeInt,
  occurredAt: Schema.NonEmptyString,
  commandId: Schema.optionalKey(CommandId),
  operationId: Schema.optionalKey(OperationId),
  event: DomainEvent,
  schemaVersion: NonNegativeInt,
}).check(Schema.makeFilter((envelope) => {
  const expected = expectedAggregate(envelope.event)
  if (envelope.aggregateKind !== expected.kind) {
    return { path: ["aggregateKind"], issue: `event belongs to ${expected.kind}` }
  }
  if (expected.id !== undefined && envelope.aggregateId !== expected.id) {
    return { path: ["aggregateId"], issue: "event identity must match its envelope aggregate" }
  }
}))

export interface DomainEventEnvelope extends Schema.Schema.Type<typeof DomainEventEnvelope> {}

interface ExpectedAggregate {
  readonly kind: typeof AggregateKind.Type
  readonly id?: string
}

function expectedAggregate(event: DomainEvent): ExpectedAggregate {
  return DomainEvent.match(event, {
    RunStarted: ({ runId }) => aggregate("ActiveRun", runId),
    RunMutationApplied: () => aggregate("ActiveRun"),
    RunPaused: ({ runId }) => aggregate("ActiveRun", runId),
    RunResumed: ({ runId }) => aggregate("ActiveRun", runId),
    RunStopped: ({ runId }) => aggregate("ActiveRun", runId),
    ControlRequested: () => aggregate("ControlLease"),
    ControlDeclined: () => aggregate("ControlLease"),
    ControlGranted: () => aggregate("ControlLease"),
    ControlReleased: () => aggregate("ControlLease"),
    OwnerTookControl: () => aggregate("ControlLease"),
    ControlLeaseExpired: () => aggregate("ControlLease"),
    AcquireRecoveryStarted: () => aggregate("ActiveRun"),
    AcquireTargetSkipped: () => aggregate("ActiveRun"),
    SolveAttemptRecorded: () => aggregate("ActiveRun"),
    SolveRetryScheduled: () => aggregate("ActiveRun"),
    CorrectionApproved: () => aggregate("ActiveRun"),
    CorrectionStarted: () => aggregate("ActiveRun"),
    CorrectionVerified: () => aggregate("ActiveRun"),
    AcquirePaused: () => aggregate("ActiveRun"),
    PolarMeasurementRecorded: () => aggregate("ActiveRun"),
    PolarAlignmentCompleted: () => aggregate("ActiveRun"),
    ProcessingSessionStarted: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingHistoryMoved: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingStepApplyStarted: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingStepRetryStarted: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingStepCompleted: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingStepFailed: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    AssistantFindingRecorded: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    AssistantFindingViewed: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingArtifactsSaved: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    ProcessingSessionDiscarded: ({ sessionId }) => aggregate("ProcessingSession", sessionId),
    AssetCreated: ({ assetId }) => aggregate("Asset", assetId),
    AssetDownloadRequested: ({ assetId }) => aggregate("Asset", assetId),
    AssetPublicationStarted: ({ assetId }) => aggregate("Asset", assetId),
    AssetRepublicationStarted: ({ assetId }) => aggregate("Asset", assetId),
    AssetPublished: ({ assetId }) => aggregate("Asset", assetId),
    AssetPublicationFailed: ({ assetId }) => aggregate("Asset", assetId),
    AssetRepresentationExpired: ({ assetId }) => aggregate("Asset", assetId),
  })
}

function aggregate(kind: typeof AggregateKind.Type, id?: string): ExpectedAggregate {
  return id === undefined ? { kind } : { kind, id }
}

export const ProjectionChange = Schema.TaggedUnion({
  ProcessingSessions: { processingSessions: Schema.Array(ProcessingSessionSnapshot) },
  SelectedAssets: { selectedAssets: Schema.Array(AssetSnapshot) },
  Health: { health: Schema.Array(SubsystemHealth) },
})

export const IncrementalProjectionEvent = Schema.TaggedUnion({
  ControlProjected: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    control: ControlSnapshot,
  },
  PlanProjected: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    plan: Schema.NullOr(PlanSnapshot),
  },
  RunProjected: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    run: Schema.NullOr(RunSnapshot),
  },
  ProcessingProjected: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    processingSessions: Schema.Array(ProcessingSessionSnapshot),
  },
  AssetsProjected: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    selectedAssets: Schema.Array(AssetSnapshot),
  },
  HealthProjected: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    health: Schema.Array(SubsystemHealth),
  },
  ProjectionBatch: {
    eventCursor: EventCursor,
    snapshotVersion: SnapshotVersion,
    generatedAt: GeneratedAt,
    changes: Schema.NonEmptyArray(ProjectionChange),
  },
})

export type IncrementalProjectionEvent = typeof IncrementalProjectionEvent.Type

// These notices may improve presentation but never advance AppSnapshot,
// SnapshotVersion, or EventCursor. Clients may discard them at any time.
export const ProjectionNotice = Schema.TaggedUnion({
  OperationProgressed: {
    operationId: OperationId,
    state: Schema.Literals(["queued", "running", "throttled", "paused", "retrying"]),
    progress: Schema.optionalKey(Schema.Number),
  },
  ConnectionFreshnessChanged: {
    state: Schema.Literals(["current", "stale", "reconnecting"]),
  },
})

export const ProjectionNoticeEnvelope = Schema.Struct({
  observedAt: ObservedAt,
  notice: ProjectionNotice,
})

export interface ProjectionNoticeEnvelope extends Schema.Schema.Type<typeof ProjectionNoticeEnvelope> {}

export type EventCursorDecision = Data.TaggedEnum<{
  Apply: {}
  IgnoreAlreadyApplied: {}
  RefreshSnapshot: { readonly expectedNextCursor: number; readonly receivedCursor: number }
}>

export const EventCursorDecision = Data.taggedEnum<EventCursorDecision>()

export const decideEventCursor = (currentCursor: number, receivedCursor: number): EventCursorDecision => {
  if (receivedCursor <= currentCursor) return EventCursorDecision.IgnoreAlreadyApplied()
  if (receivedCursor === currentCursor + 1) return EventCursorDecision.Apply()
  return EventCursorDecision.RefreshSnapshot({
    expectedNextCursor: currentCursor + 1,
    receivedCursor,
  })
}
