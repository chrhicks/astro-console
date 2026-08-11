import { Schema } from 'effect'
import {
  ClientId,
  CommandId,
  IdempotencyKey,
  LeaseRevision,
  NonNegativeInt,
} from './primitives.js'

const LeaseFreshness = { expectedLeaseRevision: LeaseRevision }

const DurableMutation = { idempotencyKey: IdempotencyKey }

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

const acceptedCommandTags = [
  'RequestControl',
  'GrantControl',
  'DeclineControl',
  'ReleaseControl',
  'TakeControl',
] as const

export const CommandTag = Schema.Literals(acceptedCommandTags)

export const Command = Schema.TaggedUnion({
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
})

export type Command = typeof Command.Type

export const CommandEnvelope = Schema.Struct({
  commandId: CommandId,
  command: Command,
})

export interface CommandEnvelope extends Schema.Schema.Type<
  typeof CommandEnvelope
> {}
