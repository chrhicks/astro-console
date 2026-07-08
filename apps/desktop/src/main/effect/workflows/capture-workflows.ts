import { Effect } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

export const runStartCapture = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.update((current) => ({
      ...current,
      capture: { phase: 'failed', lastError: 'No device connected' },
    }))
    yield* bus.publish('capture.failed', { error: 'No device connected' })
    return
  }

  const capture = session.rig.capture
  if (!capture) {
    return yield* Effect.fail(
      new Error('Connected rig does not support capture'),
    )
  }

  yield* store.update((current) => ({
    ...current,
    capture: { phase: 'starting' },
  }))

  yield* bus.publish('capture.started', {})

  yield* capture.start().pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        // Session replaced or cleared mid-capture; the new state owns the aggregate.
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          capture: { phase: 'failed', lastError: message },
        }))
        yield* bus.publish('capture.failed', { error: message })
        return yield* Effect.fail(error)
      }),
    ),
  )

  // Session replaced or cleared mid-capture; don't mark capturing.
  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  const refreshed = yield* session.rig.refresh

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

  yield* bus.publish('capture.succeeded', {})
})

export const runStopCapture = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.update((current) => ({
      ...current,
      capture: { phase: 'idle' },
    }))
    yield* bus.publish('capture.stopped', {})
    return
  }

  const capture = session.rig.capture
  if (!capture) {
    return yield* Effect.fail(
      new Error('Connected rig does not support capture'),
    )
  }

  yield* capture.stop().pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          capture: { phase: 'failed', lastError: message },
        }))
        yield* bus.publish('capture.failed', { error: message })
        return yield* Effect.fail(error)
      }),
    ),
  )

  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  const refreshed = yield* session.rig.refresh

  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  yield* store.update((current) => ({
    ...current,
    device: { ...current.device, ...refreshed.device },
    preview: refreshed.preview,
    capture: refreshed.capture,
  }))

  yield* bus.publish('capture.stopped', {})
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
