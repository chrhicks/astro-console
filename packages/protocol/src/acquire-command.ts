import { Schema } from 'effect'
import { BootstrapSnapshot } from './bootstrap.js'
import {
  AcquireRevision,
  AttemptId,
  IdempotencyKey,
  LeaseRevision,
  RunRevision,
} from './primitives.js'

export const AcquireIntent = Schema.TaggedUnion({
  RetryPlateSolveWithParameters: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    parameters: Schema.Struct({
      exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
      binning: Schema.Int.check(Schema.isGreaterThan(0)),
      solverProfile: Schema.NonEmptyString,
    }),
    idempotencyKey: IdempotencyKey,
  },
  SkipAcquireTarget: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  AbortAcquire: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  CaptureTargetAcquisitionEvidence: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  RecordLiveFrameEvidence: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  StartManagedCapture: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  PauseManagedCapture: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  StopManagedCapture: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  RecenterManagedCapture: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  ApprovePointingCorrection: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    proposalId: Schema.NonEmptyString,
    idempotencyKey: IdempotencyKey,
  },
  RevisePointingCorrection: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    proposalId: Schema.NonEmptyString,
    correction: Schema.Struct({
      rightAscensionArcsec: Schema.Finite,
      declinationArcsec: Schema.Finite,
    }),
    idempotencyKey: IdempotencyKey,
  },
  CapturePolarAlignmentMeasurement: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    idempotencyKey: IdempotencyKey,
  },
  AcceptPolarAlignmentEvidence: {
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    expectedAcquireRevision: AcquireRevision,
    attemptId: AttemptId,
    idempotencyKey: IdempotencyKey,
  },
})
export const AcquireCommandRequest = Schema.Struct({ intent: AcquireIntent })
export const AcquireCommandResponse = Schema.TaggedUnion({
  Accepted: { snapshot: BootstrapSnapshot },
  Rejected: { summary: Schema.NonEmptyString, snapshot: BootstrapSnapshot },
  Unavailable: { summary: Schema.NonEmptyString },
})
