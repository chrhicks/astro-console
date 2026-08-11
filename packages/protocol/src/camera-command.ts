import { Schema } from 'effect'
import { IdempotencyKey, LeaseRevision, RunRevision } from './primitives.js'

const CameraAction = {
  expectedLeaseRevision: LeaseRevision,
  expectedRunRevision: RunRevision,
  idempotencyKey: IdempotencyKey,
}

export const CameraCommandIntent = Schema.TaggedUnion({
  StartCameraExposure: {
    ...CameraAction,
    durationSeconds: Schema.Finite.check(
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(60),
    ),
  },
  AbortCameraExposure: CameraAction,
  CompleteCameraExposure: {
    ...CameraAction,
    frameId: Schema.NonEmptyString,
    capturedAt: Schema.NonEmptyString,
    exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
    filter: Schema.NonEmptyString,
    binning: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
  },
})
export const CameraCommandRequest = Schema.Struct({
  intent: CameraCommandIntent,
})
export const CameraExposureObservation = Schema.Struct({
  observedAt: Schema.NonEmptyString,
  cameraState: Schema.Literals([
    'idle',
    'waiting',
    'exposing',
    'reading',
    'download',
    'error',
    'unknown',
  ]),
})
export const CameraCommandResponse = Schema.TaggedUnion({
  Accepted: { observation: CameraExposureObservation },
  Completed: { assetId: Schema.NonEmptyString },
  Rejected: { summary: Schema.NonEmptyString },
  Unavailable: { summary: Schema.NonEmptyString },
})
