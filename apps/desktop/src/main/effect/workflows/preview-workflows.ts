import { Effect, Exit } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import type { RigOperationContext } from '../rig/rig-model'

export const runStartPreview = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.updateIfSession(null, (current) => ({
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

  const lease = yield* coordinator.acquire(session, 'preview-start')
  if (!lease) return

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const preview = session.rig.preview
        if (!preview) {
          return yield* Effect.fail(
            new Error('Connected rig does not support preview'),
          )
        }

        const committed = yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          preview: { phase: 'starting', source: 'none', active: false },
        }))
        if (!committed) return

        yield* bus.publish('preview.started', {})

        const ctx: RigOperationContext = { signal: lease.signal }

        yield* preview.start(ctx).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              if (lease.signal.aborted) return
              const message = toErrorMessage(error)
              const updated = yield* coordinator.commitIfLease(lease, (current) => ({
                ...current,
                preview: {
                  phase: 'error',
                  source: 'none',
                  active: false,
                  lastError: message,
                },
              }))
              if (updated) {
                yield* bus.publish('preview.failed', { error: message })
              }
              return yield* Effect.fail(error)
            }),
          ),
        )

        if (lease.signal.aborted) return

        const refreshed = yield* session.rig.refresh

        if (lease.signal.aborted) return

        const updated = yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          device: { ...current.device, ...refreshed.device },
          preview: refreshed.preview,
          capture: refreshed.capture,
        }))
        if (!updated) return

        yield* bus.publish('preview.succeeded', {})
      }),
    () => coordinator.release(lease),
  ).pipe(
    Effect.catch((error) =>
      lease.signal.aborted ? Effect.void : Effect.fail(error),
    ),
  )
})

export const runStopPreview = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.updateIfSession(null, (current) => ({
      ...current,
      preview: { phase: 'none', source: 'none', active: false },
    }))
    yield* bus.publish('preview.stopped', {})
    return
  }

  // Recovery: preempt any current ordinary operation and acquire
  // immediately. stop-preview supersedes pending/active preview start.
  const lease = yield* coordinator.acquireRecovery(session, 'stop-preview')
  if (!lease) return

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const preview = session.rig.preview
        if (!preview) {
          return yield* Effect.fail(
            new Error('Connected rig does not support preview'),
          )
        }

        const ctx: RigOperationContext = { signal: lease.signal }

        yield* preview.stop(ctx).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const message = toErrorMessage(error)
              const updated = yield* coordinator.commitIfLease(lease, (current) => ({
                ...current,
                preview: {
                  phase: 'error',
                  source: 'none',
                  active: false,
                  lastError: message,
                },
              }))
              if (updated) {
                yield* bus.publish('preview.failed', { error: message })
              }
              return yield* Effect.fail(error)
            }),
          ),
        )

        if (lease.signal.aborted) return

        const refreshed = yield* session.rig.refresh

        if (lease.signal.aborted) return

        const updated = yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          device: { ...current.device, ...refreshed.device },
          preview: refreshed.preview,
          capture: refreshed.capture,
        }))
        if (!updated) return

        yield* bus.publish('preview.stopped', {})
      }),
    () => coordinator.release(lease),
  ).pipe(
    Effect.catch((error) =>
      lease.signal.aborted ? Effect.void : Effect.fail(error),
    ),
  )
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
