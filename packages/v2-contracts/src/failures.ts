import { Schema } from "effect"
import { CommandId, OperationId, SnapshotVersion } from "./primitives.js"

const AuthenticationReason = Schema.Literals(["Unauthenticated", "MembershipRequired"])

const AuthorizationReason = Schema.Literals([
  "OwnerRequired",
  "ClientReadOnly",
  "AssetAccessDenied",
  "ControlLeaseRequired",
  "ControlLeaseConflict",
  "ControlLeaseLost",
  "AlreadyController",
  "ControlRequestAlreadyPending",
  "ControlRequestExpired",
  "ControlTargetUnavailable",
])

const FreshnessReason = Schema.Literals([
  "PlanRevisionConflict",
  "RunRevisionConflict",
  "AcquireRevisionConflict",
  "ProcessingSessionRevisionConflict",
  "AssetRevisionConflict",
  "ReconnectRequired",
  "ActiveRunConflict",
])

const InvalidInputReason = Schema.Literals([
  "ProposedChangeInvalid",
  "RecoveryParametersInvalid",
  "CorrectionParametersInvalid",
  "ToolParameterInvalid",
  "SourceSelectionInvalid",
  "SourceRoleUnsupported",
  "SaveSelectionInvalid",
  "DiscardConfirmationMismatch",
  "ApprovalMismatch",
])

const IneligibleReason = Schema.Literals([
  "PlanNotReady",
  "CriticalStateUnknown",
  "MutationRequiresApproval",
  "MutationIneligible",
  "AcquireNotPaused",
  "RecoveryBudgetUnavailable",
  "SkipIneligible",
  "NoFallbackWork",
  "CorrectionIneligible",
  "PolarMeasurementIneligible",
  "PolarToleranceNotMet",
  "ProcessingStepIneligible",
  "UndoUnavailable",
  "RedoUnavailable",
  "ProcessingStepNotFailed",
  "RetryInputChanged",
  "DispositionRequired",
  "RepresentationAlreadyPublished",
  "StorageRepresentationIneligible",
])

const ReferenceReason = Schema.Literals([
  "MutationPreviewExpired",
  "CorrectionProposalExpired",
  "CorrectionProposalMismatch",
  "MeasurementSuperseded",
  "PreviewUnavailable",
  "PreviewSuperseded",
  "PreviewInputSuperseded",
  "PreviewFailed",
  "AssistantFindingUnavailable",
  "AssistantFindingSuperseded",
  "CheckpointIneligible",
  "ProcessingSessionUnavailable",
  "SourceAssetUnavailable",
  "ProcessingOutputUnavailable",
  "DestinationUnavailable",
  "AssetNotFound",
  "AssetRepresentationUnavailable",
  "LocalOriginalUnavailable",
  "LocalSourceUnavailable",
])

const CapabilityReason = Schema.Literals([
  "CapabilityUnavailable",
  "RigStateUnsafe",
  "ToolUnavailable",
  "ProcessingServiceUnavailable",
  "PublisherUnavailable",
  "R2Unavailable",
])

const ResourceReason = Schema.Literals([
  "StorageReserveProtected",
  "DownloadConcurrencyLimited",
  "ProcessingTransitionBusy",
])

export const FailureDetail = Schema.TaggedUnion({
  RevisionDetail: { expected: Schema.Int, actual: Schema.Int },
  FieldDetail: { field: Schema.NonEmptyString, problem: Schema.NonEmptyString },
  ReferenceDetail: { referenceType: Schema.NonEmptyString, referenceId: Schema.NonEmptyString },
  ResourceDetail: { resource: Schema.NonEmptyString, measured: Schema.Finite, limit: Schema.Finite, unit: Schema.NonEmptyString },
  DiagnosticDetail: { diagnosticRef: Schema.NonEmptyString },
})

const CommonFailureFields = {
  commandId: CommandId,
  summary: Schema.NonEmptyString,
  retryable: Schema.Boolean,
  refreshFromSnapshot: Schema.Boolean,
  snapshotVersion: Schema.optionalKey(SnapshotVersion),
  safeAlternatives: Schema.Array(Schema.NonEmptyString),
  details: Schema.optionalKey(Schema.Array(FailureDetail)),
}

export const CommandFailure = Schema.TaggedUnion({
  AuthenticationFailure: { ...CommonFailureFields, reason: AuthenticationReason },
  AuthorizationFailure: { ...CommonFailureFields, reason: AuthorizationReason },
  FreshnessConflict: { ...CommonFailureFields, reason: FreshnessReason },
  InvalidInput: { ...CommonFailureFields, reason: InvalidInputReason },
  ActionIneligible: { ...CommonFailureFields, reason: IneligibleReason },
  ReferenceUnavailable: { ...CommonFailureFields, reason: ReferenceReason },
  CapabilityUnavailable: { ...CommonFailureFields, reason: CapabilityReason },
  ResourceProtected: { ...CommonFailureFields, reason: ResourceReason },
  IdempotencyConflict: { ...CommonFailureFields },
})

export type CommandFailure = typeof CommandFailure.Type

export const OperationFailure = Schema.Struct({
  operationId: OperationId,
  operation: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  summary: Schema.NonEmptyString,
  retryable: Schema.Boolean,
  retryScope: Schema.optionalKey(Schema.NonEmptyString),
  survivingEvidenceIds: Schema.Array(Schema.NonEmptyString),
  diagnosticRef: Schema.optionalKey(Schema.NonEmptyString),
})

export interface OperationFailure extends Schema.Schema.Type<typeof OperationFailure> {}

export const commandFailureFamilies = Object.keys(CommandFailure.cases)
