import { Effect } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

export const runPark = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.update((current) => ({
      ...current,
      session: {
        ...current.session,
        lastError: undefined,
      },
      pointing: { phase: 'idle', target: null },
      currentTarget: null,
    }))
    yield* bus.publish('park.succeeded', { reason: 'no-session' })
    return
  }

  yield* bus.publish('park.started', {})

  yield* store.update((current) => ({
    ...current,
    session: {
      ...current.session,
      lastError: undefined,
    },
  }))

  const current = yield* store.get

  if (current.capture.phase === 'capturing' || current.capture.phase === 'starting') {
    yield* session.stopCapture().pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          if ((yield* sessions.getCurrent) !== session) {
            return yield* Effect.fail(error)
          }
          const message = toErrorMessage(error)
          yield* store.update((cur) => ({
            ...cur,
            session: {
              ...cur.session,
              lastError: message,
            },
            capture: { phase: 'failed', lastError: message },
          }))
          yield* bus.publish('park.failed', { error: message, step: 'stop-capture' })
          return yield* Effect.fail(error)
        }),
      ),
    )

    if ((yield* sessions.getCurrent) !== session) return
  }

  if (current.preview.phase === 'active' || current.preview.phase === 'starting') {
    yield* session.stopPreview().pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          if ((yield* sessions.getCurrent) !== session) {
            return yield* Effect.fail(error)
          }
          const message = toErrorMessage(error)
          yield* store.update((cur) => ({
            ...cur,
            session: {
              ...cur.session,
              lastError: message,
            },
            preview: {
              phase: 'error',
              source: 'none',
              active: false,
              lastError: message,
            },
          }))
          yield* bus.publish('park.failed', { error: message, step: 'stop-preview' })
          return yield* Effect.fail(error)
        }),
      ),
    )

    if ((yield* sessions.getCurrent) !== session) return
  }

  yield* session.parkArm().pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((cur) => ({
          ...cur,
          session: {
            ...cur.session,
            lastError: message,
          },
        }))
        yield* bus.publish('park.failed', { error: message, step: 'park-arm' })
        return yield* Effect.fail(error)
      }),
    ),
  )

  if ((yield* sessions.getCurrent) !== session) return

  const refreshed = yield* session.refresh

  if ((yield* sessions.getCurrent) !== session) return

  yield* store.update((cur) => ({
    ...cur,
    session: {
      ...cur.session,
      lastError: undefined,
    },
    device: { ...cur.device, ...refreshed.device },
    preview: refreshed.preview,
    capture: refreshed.capture,
    pointing: { phase: 'idle', target: null },
    currentTarget: null,
  }))

  yield* bus.publish('park.succeeded', {})
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
