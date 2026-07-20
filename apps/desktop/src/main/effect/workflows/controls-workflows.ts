import { Effect } from 'effect'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator } from '../session/operation-coordinator'

export const runMoveFocuser = (position: number) =>
  runControl('focuser', position)

export const runSetFilterPosition = (position: number) =>
  runControl('filterWheel', position)

function runControl(kind: 'focuser' | 'filterWheel', position: number) {
  return Effect.gen(function* () {
    const sessions = yield* SessionManager
    const coordinator = yield* OperationCoordinator
    const session = yield* sessions.getCurrent
    if (!session) return yield* Effect.fail(new Error('No device connected'))
    const lease = yield* coordinator.acquire(session, 'controls')
    if (!lease) return
    yield* Effect.acquireUseRelease(
      Effect.void,
      () => Effect.gen(function* () {
        if (!Number.isFinite(position) || !Number.isInteger(position)) {
          return yield* Effect.fail(new Error('Control position must be a finite integer'))
        }
        if (kind === 'focuser') {
          const control = session.rig.focuser
          if (!control) return yield* Effect.fail(new Error('Connected rig does not support focuser'))
          if (position < 0 || position > control.state.maxStep) {
            return yield* Effect.fail(new Error(`Focuser position must be from 0 to ${control.state.maxStep}`))
          }
          yield* control.moveTo(position, { signal: lease.signal })
        } else {
          const control = session.rig.filterWheel
          if (!control) return yield* Effect.fail(new Error('Connected rig does not support filter wheel'))
          if (position < 0 || position >= control.state.names.length) {
            return yield* Effect.fail(new Error(`Filter position must be from 0 to ${control.state.names.length - 1}`))
          }
          yield* control.setPosition(position, { signal: lease.signal })
        }
        if (lease.signal.aborted) return
        const refreshed = yield* session.rig.refresh
        if (lease.signal.aborted) return
        yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          device: { ...current.device, ...refreshed.device },
          preview: refreshed.preview,
          capture: refreshed.capture,
          controls: session.rig.controls?.() ?? current.controls,
        }))
      }),
      () => coordinator.release(lease),
    ).pipe(Effect.catch((error) => lease.signal.aborted ? Effect.void : Effect.fail(error)))
  })
}
