import { Schema } from 'effect'
import {
  AcquireFreshness,
  AssetFreshness,
  AssetId,
  AttemptId,
  CheckpointId,
  ClientId,
  CommandId,
  DurableMutation,
  FindingId,
  LeaseFreshness,
  NonNegativeInt,
  PlanId,
  PlanRevision,
  PreviewId,
  ProcessingFreshness,
  ProcessingOutputId,
  ProcessingSessionId,
  ProposalId,
  RepresentationId,
  RunFreshness,
} from './primitives.js'

const RunAndLeaseFreshness = {
  ...RunFreshness,
  ...LeaseFreshness,
}

const AcquireCommandFreshness = {
  ...RunAndLeaseFreshness,
  ...AcquireFreshness,
}

const SourceSelection = {
  sourceAssetIds: Schema.NonEmptyArray(AssetId),
}

export const RunSequenceDefinition = Schema.Struct({
  sequenceId: Schema.NonEmptyString,
  targetName: Schema.NonEmptyString,
  acquisitionMode: Schema.Literals(['cameraOnly', 'deepSkyPlateSolve']),
  rightAscensionHours: Schema.Finite.check(
    Schema.isBetween({ minimum: 0, maximum: 24 }),
  ),
  declinationDegrees: Schema.Finite.check(
    Schema.isBetween({ minimum: -90, maximum: 90 }),
  ),
  exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  frameCount: Schema.Int.check(Schema.isGreaterThan(0)),
  gain: Schema.optionalKey(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  binning: Schema.Int.check(Schema.isGreaterThan(0)),
  filterName: Schema.optionalKey(Schema.NonEmptyString),
  earliestStart: Schema.optionalKey(Schema.NonEmptyString),
  latestEnd: Schema.optionalKey(Schema.NonEmptyString),
  minimumAltitudeDegrees: Schema.Finite.check(
    Schema.isBetween({ minimum: -90, maximum: 90 }),
  ),
  horizonClearanceDegrees: Schema.Finite.check(
    Schema.isGreaterThanOrEqualTo(0),
  ),
  recenterThresholdArcsec: Schema.Finite.check(Schema.isGreaterThan(0)),
  maxSolveAttempts: Schema.Int.check(Schema.isGreaterThan(0)),
  maxCaptureRetries: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  acquireFailure: Schema.Literals(['pause', 'skip', 'stop']),
  captureFailure: Schema.Literals(['retry', 'pause', 'skip', 'stop']),
  estimatedDurationSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  estimatedStorageBytes: Schema.Int.check(Schema.isGreaterThan(0)),
  priority: NonNegativeInt,
})

export interface RunSequenceDefinition extends Schema.Schema.Type<
  typeof RunSequenceDefinition
> {}

export const RunMutation = Schema.TaggedUnion({
  AppendFutureSequence: {
    sequence: RunSequenceDefinition,
  },
  ReorderFutureSequences: {
    sequenceIds: Schema.NonEmptyArray(Schema.NonEmptyString),
  },
  SwitchTargetNow: {
    sequenceId: Schema.NonEmptyString,
  },
  UpdateFutureSequence: {
    sequenceId: Schema.NonEmptyString,
    exposureSeconds: Schema.optionalKey(
      Schema.Finite.check(Schema.isGreaterThan(0)),
    ),
    frameCount: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
    priority: Schema.optionalKey(NonNegativeInt),
  },
})

export const SolveRecoveryParameters = Schema.Struct({
  exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
  binning: Schema.Int.check(Schema.isGreaterThan(0)),
  solverProfile: Schema.NonEmptyString,
})

export const CorrectionRevision = Schema.Struct({
  rightAscensionArcsec: Schema.Finite,
  declinationArcsec: Schema.Finite,
})

export const ProcessingParameterValue = Schema.TaggedUnion({
  NumberValue: { value: Schema.Finite },
  BooleanValue: { value: Schema.Boolean },
  TextValue: { value: Schema.String },
  ChoiceValue: { value: Schema.NonEmptyString },
})

export const ProcessingParameter = Schema.Struct({
  key: Schema.NonEmptyString,
  value: ProcessingParameterValue,
})

export const ProcessingDestination = Schema.TaggedUnion({
  SourceAssets: { assetIds: Schema.NonEmptyArray(AssetId) },
  ExistingSession: { sessionId: ProcessingSessionId },
  SavedAsset: { assetId: AssetId },
})

export const ProcessingArtifactSelection = Schema.Struct({
  outputId: ProcessingOutputId,
  format: Schema.Literals(['fits', 'tiff', 'png', 'jpeg']),
  role: Schema.Literals(['linearMaster', 'intermediate', 'final', 'preview']),
})

export const ProcessingSwitchDisposition = Schema.TaggedUnion({
  LeaveUnfinished: {},
  SaveAndSwitch: {
    artifacts: Schema.NonEmptyArray(ProcessingArtifactSelection),
  },
  DiscardAndSwitch: { confirmationId: Schema.NonEmptyString },
})

export const acceptedCommandTags = [
  'StartRunFromPlan',
  'PreviewRunMutation',
  'ApplyRunMutation',
  'ApproveDisruptiveRunMutation',
  'PauseRun',
  'ResumeRun',
  'StopRun',
  'RequestControl',
  'GrantControl',
  'DeclineControl',
  'ReleaseControl',
  'TakeControl',
  'RetryPlateSolveWithParameters',
  'SkipAcquireTarget',
  'AbortAcquire',
  'ApprovePointingCorrection',
  'RevisePointingCorrection',
  'CaptureTargetAcquisitionEvidence',
  'RecordLiveFrameEvidence',
  'StartManagedCapture',
  'PauseManagedCapture',
  'StopManagedCapture',
  'RecenterManagedCapture',
  'CapturePolarAlignmentMeasurement',
  'AcceptPolarAlignmentEvidence',
  'StartProcessingSession',
  'ResumeProcessingSession',
  'SyncProcessingPreview',
  'ApplyProcessingPreview',
  'UndoProcessingStep',
  'RedoProcessingStep',
  'PreviewAssistantSuggestion',
  'MarkAssistantFindingViewed',
  'RetryProcessingStep',
  'RetryProcessingBuild',
  'SwitchProcessingContext',
  'SaveProcessingArtifacts',
  'DiscardProcessingSession',
  'RequestAssetDownload',
  'RepublishAssetRepresentation',
  'OpenAssetInProcess',
] as const

export const CommandTag = Schema.Literals(acceptedCommandTags)

export const Command = Schema.TaggedUnion({
  StartRunFromPlan: {
    planId: PlanId,
    expectedPlanRevision: PlanRevision,
    ...LeaseFreshness,
    preconditionToken: Schema.NonEmptyString,
    acceptedPlanLimitationIds: Schema.Array(Schema.NonEmptyString),
    ...DurableMutation,
  },
  PreviewRunMutation: {
    ...RunFreshness,
    proposedChange: RunMutation,
  },
  ApplyRunMutation: {
    ...RunAndLeaseFreshness,
    previewId: PreviewId,
    ...DurableMutation,
  },
  ApproveDisruptiveRunMutation: {
    ...RunAndLeaseFreshness,
    previewId: PreviewId,
    approvalId: Schema.NonEmptyString,
    ...DurableMutation,
  },
  PauseRun: {
    ...RunAndLeaseFreshness,
    ...DurableMutation,
  },
  ResumeRun: {
    ...RunAndLeaseFreshness,
    ...DurableMutation,
  },
  StopRun: {
    ...RunAndLeaseFreshness,
    ...DurableMutation,
  },
  RequestControl: {
    ...LeaseFreshness,
    ...DurableMutation,
  },
  GrantControl: {
    ...LeaseFreshness,
    requestId: Schema.NonEmptyString,
    targetClientId: ClientId,
    ...DurableMutation,
  },
  DeclineControl: {
    ...LeaseFreshness,
    requestId: Schema.NonEmptyString,
    ...DurableMutation,
  },
  ReleaseControl: {
    ...LeaseFreshness,
    ...DurableMutation,
  },
  TakeControl: {
    ...LeaseFreshness,
    ...DurableMutation,
  },
  RetryPlateSolveWithParameters: {
    ...AcquireCommandFreshness,
    parameters: SolveRecoveryParameters,
    ...DurableMutation,
  },
  SkipAcquireTarget: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  AbortAcquire: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  ApprovePointingCorrection: {
    ...AcquireCommandFreshness,
    proposalId: ProposalId,
    ...DurableMutation,
  },
  RevisePointingCorrection: {
    ...AcquireCommandFreshness,
    proposalId: ProposalId,
    parameters: CorrectionRevision,
  },
  CaptureTargetAcquisitionEvidence: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  RecordLiveFrameEvidence: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  StartManagedCapture: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  PauseManagedCapture: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  StopManagedCapture: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  RecenterManagedCapture: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  CapturePolarAlignmentMeasurement: {
    ...AcquireCommandFreshness,
    ...DurableMutation,
  },
  AcceptPolarAlignmentEvidence: {
    ...AcquireCommandFreshness,
    attemptId: AttemptId,
    ...DurableMutation,
  },
  StartProcessingSession: {
    ...SourceSelection,
    selection: Schema.optionalKey(Schema.Literal('recommended')),
    ...DurableMutation,
  },
  ResumeProcessingSession: {
    ...ProcessingFreshness,
  },
  SyncProcessingPreview: {
    ...ProcessingFreshness,
    operation: Schema.NonEmptyString,
    toolId: Schema.NonEmptyString,
    parameters: Schema.Array(ProcessingParameter),
    baseHistoryPosition: NonNegativeInt,
    clientPreviewSequence: NonNegativeInt,
  },
  ApplyProcessingPreview: {
    ...ProcessingFreshness,
    previewId: PreviewId,
    ...DurableMutation,
  },
  UndoProcessingStep: {
    ...ProcessingFreshness,
    ...DurableMutation,
  },
  RedoProcessingStep: {
    ...ProcessingFreshness,
    ...DurableMutation,
  },
  PreviewAssistantSuggestion: {
    ...ProcessingFreshness,
    findingId: FindingId,
    findingVersion: NonNegativeInt,
  },
  MarkAssistantFindingViewed: {
    sessionId: ProcessingSessionId,
    findingId: FindingId,
    findingVersion: NonNegativeInt,
  },
  RetryProcessingStep: {
    ...ProcessingFreshness,
    failedAttemptId: AttemptId,
    checkpointId: CheckpointId,
    ...DurableMutation,
  },
  RetryProcessingBuild: {
    ...ProcessingFreshness,
    checkpoint: Schema.NonEmptyString,
    ...DurableMutation,
  },
  SwitchProcessingContext: {
    ...ProcessingFreshness,
    destination: ProcessingDestination,
    disposition: ProcessingSwitchDisposition,
    ...DurableMutation,
  },
  SaveProcessingArtifacts: {
    ...ProcessingFreshness,
    artifacts: Schema.NonEmptyArray(ProcessingArtifactSelection),
    ...DurableMutation,
  },
  DiscardProcessingSession: {
    ...ProcessingFreshness,
    confirmationId: Schema.NonEmptyString,
    ...DurableMutation,
  },
  RequestAssetDownload: {
    assetId: AssetId,
    representationId: Schema.optionalKey(RepresentationId),
    ...DurableMutation,
  },
  RepublishAssetRepresentation: {
    ...AssetFreshness,
    representationId: RepresentationId,
    sourceChecksum: Schema.NonEmptyString,
    ...DurableMutation,
  },
  OpenAssetInProcess: {
    assetId: AssetId,
    unfinishedSessionId: Schema.optionalKey(ProcessingSessionId),
  },
})

export type Command = typeof Command.Type

export const CommandEnvelope = Schema.Struct({
  commandId: CommandId,
  command: Command,
})

export interface CommandEnvelope extends Schema.Schema.Type<
  typeof CommandEnvelope
> {}

export const commandRequiresIdempotency = (command: Command) =>
  'idempotencyKey' in command

export const commandTags = Object.keys(Command.cases)
