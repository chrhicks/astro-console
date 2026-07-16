import { Effect } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator, type OperationLease } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import type { RigOperationContext } from '../rig/rig-model'
import { stopExternalExposure } from './external-exposure'
import { isCaptureInFlight, isExternalSequenceRecoveryActive } from '../../../shared/lifecycle'

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

        if (isCaptureInFlight(current.capture.phase)) {
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
              const stop =
                captureStop.mode === 'external'
                  ? session.rig.camera
                    ? stopExternalExposure(captureStop, session.rig.camera, ctx)
                    : Effect.fail(new Error('Connected rig does not expose a generic camera'))
                  : captureStop.stop(ctx)
              yield* stop.pipe(
                Effect.catch((error) =>
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
                      sequence: isExternalSequenceRecoveryActive(cur.sequence.phase)
                        ? { ...cur.sequence, phase: 'failed', frameKind: undefined, currentIndex: undefined, lastError: message }
                        : cur.sequence,
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
            Effect.catch((error) =>
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
          Effect.catch((error) =>
            Effect.gen(function* () {
              const message = toErrorMessage(error)
              const updated = yield* coordinator.commitIfLease(lease, (cur) => ({
                ...cur,
                session: {
                  ...cur.session,
                  lastError: message,
                },
                device: {
                  ...cur.device,
                  mountClosed: undefined,
                  warnings: [...(cur.device.warnings ?? []), 'Park state is unconfirmed'],
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

        if (refreshed.device.mountClosed !== true) {
          const error = new Error('Park command completed but mount closure was not confirmed')
          const updated = yield* coordinator.commitIfLease(lease, (cur) => ({
            ...cur,
            session: {
              ...cur.session,
              lastError: error.message,
            },
            device: {
              ...cur.device,
              mountClosed: undefined,
              warnings: [...(cur.device.warnings ?? []), 'Park state is unconfirmed'],
            },
          }))
          if (updated) {
            yield* bus.publish('park.failed', { error: error.message, step: 'park-arm' })
          }
          return yield* Effect.fail(error)
        }

        const parked = yield* coordinator.commitIfLease(lease, (cur) => ({
          ...cur,
          session: {
            ...cur.session,
            lastError: undefined,
          },
          device: { ...cur.device, ...refreshed.device },
          preview: refreshed.preview,
          capture: refreshed.capture,
          sequence: isExternalSequenceRecoveryActive(cur.sequence.phase)
            ? { ...cur.sequence, phase: 'stopped', frameKind: undefined, currentIndex: undefined }
            : cur.sequence,
          pointing: { phase: 'idle', target: null },
          currentTarget: null,
        }))
        if (!parked) return

        yield* bus.publish('park.succeeded', {})
      }),
    () => coordinator.release(lease),
  )
})

export const runUnpark = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator

  const session = yield* sessions.getCurrent
  if (!session) {
    return yield* Effect.fail(new Error('No device connected'))
  }

  const lease = yield* coordinator.acquire(session, 'unpark')
  if (!lease) return

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const current = yield* store.get
        if (current.device.mountClosed !== true) {
          return yield* failUnpark(
            lease,
            new Error('Mount is not parked'),
            bus,
            coordinator,
          )
        }

        const unpark = session.rig.mount?.unpark
        if (!unpark) {
          return yield* failUnpark(
            lease,
            new Error('Connected rig does not support mount unpark'),
            bus,
            coordinator,
          )
        }

        yield* bus.publish('unpark.started', {})

        const ctx: RigOperationContext = { signal: lease.signal }
        yield* unpark(ctx).pipe(
          Effect.catch((error) => failUnpark(lease, error, bus, coordinator)),
        )

        if (lease.signal.aborted) return

        const refreshed = yield* session.rig.refresh.pipe(
          Effect.catch((error) => failUnpark(lease, error, bus, coordinator)),
        )

        if (lease.signal.aborted) return

        if (refreshed.device.mountClosed !== false) {
          return yield* failUnpark(
            lease,
            new Error('Unpark command completed but mount opening was not confirmed'),
            bus,
            coordinator,
          )
        }

        const updated = yield* coordinator.commitIfLease(lease, (aggregate) => ({
          ...aggregate,
          session: { ...aggregate.session, lastError: undefined },
          device: { ...aggregate.device, ...refreshed.device },
          preview: refreshed.preview,
          capture: refreshed.capture,
        }))
        if (!updated) return

        yield* bus.publish('unpark.succeeded', {})
      }),
    () => coordinator.release(lease),
  ).pipe(
    Effect.catch((error) =>
      lease.signal.aborted ? Effect.void : Effect.fail(error),
    ),
  )
})

function failUnpark(
  lease: OperationLease,
  error: unknown,
  bus: EventBus,
  coordinator: OperationCoordinator,
) {
  return Effect.gen(function* () {
    const message = toErrorMessage(error)
    const updated = yield* coordinator.commitIfLease(lease, (current) => ({
      ...current,
      session: { ...current.session, lastError: message },
    }))
    if (updated) {
      yield* bus.publish('unpark.failed', { error: message })
    }
    return yield* Effect.fail(error)
  })
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
