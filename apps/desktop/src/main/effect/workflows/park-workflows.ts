import { Effect } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import type { RigOperationContext } from '../rig/rig-model'

export const runPark = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.updateIfSession(null, (current) => ({
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

  // Recovery: preempt any current ordinary operation (point/preview/capture)
  // and acquire immediately. Park supersedes all ordinary ops, stops active
  // preview/capture via the correct Rig surface, and blocks new starts until
  // parking finishes (the lease is held for the duration of park).
  const lease = yield* coordinator.acquireRecovery(session, 'park')
  if (!lease) return

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        yield* bus.publish('park.started', {})

        yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          session: {
            ...current.session,
            lastError: undefined,
          },
        }))

        const current = yield* store.get

        if (current.capture.phase === 'capturing' || current.capture.phase === 'starting') {
          // Atomically move capture out of the active phase before calling
          // stop so a pending runStartCapture cannot later commit 'capturing'
          // or fork its poller. Stop/park recovery supersedes ordinary
          // operations.
          const stopClaimedResult = yield* coordinator.commitIfLease(lease, (cur) => {
            if (cur.capture.phase !== 'capturing' && cur.capture.phase !== 'starting') {
              return cur
            }
            return { ...cur, capture: { ...cur.capture, phase: 'stopped' } }
          })
          if (stopClaimedResult && stopClaimedResult.capture.phase === 'stopped') {
            const captureStop = session.rig.captureStop
            const ctx: RigOperationContext = { signal: lease.signal }
            if (captureStop) {
              yield* captureStop.stop(ctx).pipe(
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    const message = toErrorMessage(error)
                    const updated = yield* coordinator.commitIfLease(lease, (cur) => ({
                      ...cur,
                      session: {
                        ...cur.session,
                        lastError: message,
                      },
                      capture: {
                        phase: 'failed',
                        mode: captureStop.mode === 'external' ? 'external' : undefined,
                        lastError: message,
                      },
                    }))
                    if (updated) {
                      yield* bus.publish('park.failed', { error: message, step: 'stop-capture' })
                    }
                    return yield* Effect.fail(error)
                  }),
                ),
              )
            } else {
              return yield* Effect.fail(
                new Error('Connected rig does not support capture'),
              )
            }

            if (lease.signal.aborted) return
          }
        }

        if (current.preview.phase === 'active' || current.preview.phase === 'starting') {
          const preview = session.rig.preview
          if (!preview) {
            return yield* Effect.fail(
              new Error('Connected rig does not support preview'),
            )
          }
          const ctx: RigOperationContext = { signal: lease.signal }
          yield* preview.stop(ctx).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const message = toErrorMessage(error)
                const updated = yield* coordinator.commitIfLease(lease, (cur) => ({
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
                if (updated) {
                  yield* bus.publish('park.failed', { error: message, step: 'stop-preview' })
                }
                return yield* Effect.fail(error)
              }),
            ),
          )

          if (lease.signal.aborted) return
        }

        const mount = session.rig.mount
        if (!mount?.park) {
          return yield* Effect.fail(
            new Error('Connected rig does not support mount park'),
          )
        }

        const ctx: RigOperationContext = { signal: lease.signal }
        yield* mount.park(ctx).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const message = toErrorMessage(error)
              const updated = yield* coordinator.commitIfLease(lease, (cur) => ({
                ...cur,
                session: {
                  ...cur.session,
                  lastError: message,
                },
              }))
              if (updated) {
                yield* bus.publish('park.failed', { error: message, step: 'park-arm' })
              }
              return yield* Effect.fail(error)
            }),
          ),
        )

        if (lease.signal.aborted) return

        const refreshed = yield* session.rig.refresh

        if (lease.signal.aborted) return

        const parked = yield* coordinator.commitIfLease(lease, (cur) => ({
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
        if (!parked) return

        yield* bus.publish('park.succeeded', {})
      }),
    () => coordinator.release(lease),
  )
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
