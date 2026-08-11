import { Schema } from 'effect'
import { ObservedAt, RunId, RunRevision } from './primitives.js'
import { CameraExposureObservation } from './camera-command.js'

export const PreflightCheckState = Schema.Literals([
  'ready',
  'blocked',
  'unavailable',
  'unknown',
])

export const PreflightCheck = Schema.Struct({
  key: Schema.NonEmptyString,
  state: PreflightCheckState,
  observedAt: ObservedAt,
  reason: Schema.NonEmptyString,
})
export interface PreflightCheck extends Schema.Schema.Type<
  typeof PreflightCheck
> {}

export const RigDeviceKind = Schema.Literals([
  'camera',
  'telescope',
  'focuser',
  'filterWheel',
])

export const RigDeviceObservation = Schema.Struct({
  kind: RigDeviceKind,
  state: PreflightCheckState,
  observedAt: ObservedAt,
  name: Schema.optionalKey(Schema.NonEmptyString),
  uniqueId: Schema.optionalKey(Schema.NonEmptyString),
  capabilities: Schema.Array(Schema.NonEmptyString),
  safety: Schema.Array(PreflightCheck),
})
export interface RigDeviceObservation extends Schema.Schema.Type<
  typeof RigDeviceObservation
> {}

export const RigInventory = Schema.Struct({
  rigId: Schema.NonEmptyString,
  observedAt: ObservedAt,
  devices: Schema.NonEmptyArray(RigDeviceObservation),
})
export interface RigInventory extends Schema.Schema.Type<typeof RigInventory> {}

export const PreflightSnapshot = Schema.Struct({
  observedAt: ObservedAt,
  verdict: PreflightCheckState,
  nextAction: Schema.NonEmptyString,
  checks: Schema.NonEmptyArray(PreflightCheck),
  rig: Schema.optionalKey(RigInventory),
  camera: Schema.optionalKey(CameraExposureObservation),
})
export interface PreflightSnapshot extends Schema.Schema.Type<
  typeof PreflightSnapshot
> {}

export const RefreshPreflightRequest = Schema.Struct({
  runId: RunId,
  expectedRunRevision: RunRevision,
})
export interface RefreshPreflightRequest extends Schema.Schema.Type<
  typeof RefreshPreflightRequest
> {}

export const RefreshPreflightResponse = Schema.TaggedUnion({
  Refreshed: { snapshot: PreflightSnapshot },
  Rejected: { summary: Schema.NonEmptyString },
  Unavailable: { summary: Schema.NonEmptyString },
})
export type RefreshPreflightResponse = typeof RefreshPreflightResponse.Type
