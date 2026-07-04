import { Effect } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

export const runStartPreview = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.update((current) => ({
      ...current,
      preview: {
        phase: 'error',
        source: 'none',
        active: false,
        lastError: 'No device connected',
      },
    }))
    yield* bus.publish('preview.failed', { error: 'No device connected' })
    return
  }

  yield* store.update((current) => ({
    ...current,
    preview: { phase: 'starting', source: 'none', active: false },
  }))

  yield* bus.publish('preview.started', {})

  yield* session.startPreview().pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        // Session replaced or cleared mid-preview; the new state owns the aggregate.
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          preview: {
            phase: 'error',
            source: 'none',
            active: false,
            lastError: message,
          },
        }))
        yield* bus.publish('preview.failed', { error: message })
        return yield* Effect.fail(error)
      }),
    ),
  )

  // Session replaced or cleared mid-preview; don't mark active.
  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  const refreshed = yield* session.refresh

  // Session replaced or cleared mid-refresh; the new state owns the aggregate.
  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  yield* store.update((current) => ({
    ...current,
    device: { ...current.device, ...refreshed.device },
    preview: refreshed.preview,
    capture: refreshed.capture,
  }))

  yield* bus.publish('preview.succeeded', {})
})

export const runStopPreview = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.update((current) => ({
      ...current,
      preview: { phase: 'none', source: 'none', active: false },
    }))
    yield* bus.publish('preview.stopped', {})
    return
  }

  yield* session.stopPreview().pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          preview: {
            phase: 'error',
            source: 'none',
            active: false,
            lastError: message,
          },
        }))
        yield* bus.publish('preview.failed', { error: message })
        return yield* Effect.fail(error)
      }),
    ),
  )

  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  const refreshed = yield* session.refresh

  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  yield* store.update((current) => ({
    ...current,
    device: { ...current.device, ...refreshed.device },
    preview: refreshed.preview,
    capture: refreshed.capture,
  }))

  yield* bus.publish('preview.stopped', {})
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
