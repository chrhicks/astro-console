import { Effect, Layer, Schema } from 'effect'
import { EventBus } from './event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

// Boot-time listener that turns native Seestar stack-failure events into
// aggregate capture.failed state. The Seestar plugin publishes
// 'seestar.capture.stack.failed' when the device pushes a Stack event whose
// state/code matches the SDK's failureFromPushEvent semantics. This listener
// only acts when the current session is still the matching Seestar session and
// capture is in the 'capturing' phase, so it does not fire spuriously when no
// native capture is active or after the session has been replaced.
export const NativeCaptureMonitorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager

    const unsubscribe = yield* bus.listen((event) => {
      if (event.name !== 'seestar.capture.stack.failed') return Effect.void
      return Effect.gen(function* () {
        const session = yield* sessions.getCurrent
        if (!session) return
        if (session.pluginKind !== 'seestar') return
        if (session.sessionId !== event.sessionId) return

        const current = yield* store.get
        if (current.capture.phase !== 'capturing') return

        const message = readFailureMessage(event.payload)
        yield* store.update((current) => ({
          ...current,
          capture: { phase: 'failed', lastError: message },
        }))
        yield* bus.publish('capture.failed', { error: message })
      })
    })

    void unsubscribe
  }),
)

const StackFailurePayload = Schema.Struct({
  error: Schema.optional(Schema.String),
})

function readFailureMessage(payload: unknown): string {
  const decoded = Schema.decodeUnknownEither(StackFailurePayload)(payload)
  if (decoded._tag === 'Left') return 'Native stacking failed'
  const error = decoded.right.error
  return error !== undefined && error.length > 0
    ? error
    : 'Native stacking failed'
}
