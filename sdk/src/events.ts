import { Result, Schema } from 'effect'
import type { SeestarLifecycleEvent, SeestarPushEvent } from './types.js'

const PushNumber = Schema.Union([Schema.Number, Schema.NumberFromString]).check(
  Schema.isFinite(),
)

const PushEventFields = Schema.Struct({
  Event: Schema.String,
  Timestamp: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  code: Schema.optional(PushNumber),
  route: Schema.optional(Schema.Array(Schema.String)),
  position: Schema.optional(PushNumber),
  percent: Schema.optional(PushNumber),
  lapse_ms: Schema.optional(PushNumber),
  lapseMs: Schema.optional(PushNumber),
  elapsed_ms: Schema.optional(PushNumber),
  elapsedMs: Schema.optional(PushNumber),
  stacked_frame: Schema.optional(PushNumber),
  stacked_frames: Schema.optional(PushNumber),
  dropped_frame: Schema.optional(PushNumber),
  dropped_frames: Schema.optional(PushNumber),
})

export function decodeSeestarPushEvent(
  input: unknown,
): SeestarPushEvent | undefined {
  const decoded = Schema.decodeUnknownResult(PushEventFields)(input)
  if (Result.isFailure(decoded)) return undefined
  return {
    ...decoded.success,
    route: decoded.success.route ? [...decoded.success.route] : undefined,
  }
}

export function toSeestarLifecycleEvent(
  event: SeestarPushEvent,
): SeestarLifecycleEvent | undefined {
  if (event.Event !== 'Stack') return undefined
  const state = event.state?.toLowerCase()
  if (state === 'fail' || state === 'cancel') {
    return {
      type: 'capture.failed',
      error: event.error ?? `Stack reported ${state}`,
    }
  }
  if (event.code !== undefined && event.code !== 0) {
    return {
      type: 'capture.failed',
      error: event.error ?? `Stack reported code ${event.code}`,
    }
  }
  return undefined
}
