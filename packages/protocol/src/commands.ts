import { Schema } from 'effect'
import {
  AcquireRevision,
  AssetId,
  AssetRevision,
  AttemptId,
  ClientId,
  CommandId,
  IdempotencyKey,
  LeaseRevision,
  NonNegativeInt,
  PlanId,
  PlanRevision,
  PreviewId,
  ProposalId,
  RepresentationId,
  RunId,
  RunRevision,
} from './primitives.js'
import {
  CreateProcessingProjectRequest,
  ProcessingProjectChangeRequest,
} from './processing-project-domain.js'

const RunFreshness = {
  runId: RunId,
  expectedRunRevision: RunRevision,
}

const LeaseFreshness = { expectedLeaseRevision: LeaseRevision }

const AcquireFreshness = { expectedAcquireRevision: AcquireRevision }

const AssetFreshness = {
  assetId: AssetId,
  expectedAssetRevision: AssetRevision,
}

const DurableMutation = { idempotencyKey: IdempotencyKey }

const RunAndLeaseFreshness = {
  ...RunFreshness,
  ...LeaseFreshness,
}

const AcquireCommandFreshness = {
  ...RunAndLeaseFreshness,
  ...AcquireFreshness,
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

const acceptedCommandTags = [
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
  'CreateProcessingProject',
  'ChangeProcessingProject',
  'RequestAssetDownload',
  'RepublishAssetRepresentation',
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
  CreateProcessingProject: {
    ...CreateProcessingProjectRequest.fields,
  },
  ChangeProcessingProject: {
    ...ProcessingProjectChangeRequest.fields,
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
})

export type Command = typeof Command.Type

export const CommandEnvelope = Schema.Struct({
  commandId: CommandId,
  command: Command,
})

export interface CommandEnvelope extends Schema.Schema.Type<
  typeof CommandEnvelope
> {}
