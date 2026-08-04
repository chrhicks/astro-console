import { Schema } from 'effect'
import { ObservedAt, RunId, RunRevision } from './primitives.js'

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

export const PreflightSnapshot = Schema.Struct({
  observedAt: ObservedAt,
  verdict: PreflightCheckState,
  nextAction: Schema.NonEmptyString,
  checks: Schema.NonEmptyArray(PreflightCheck),
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
