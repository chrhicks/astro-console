import { Effect, Either, Exit } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator, type OperationLease } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import {
  FrameStorage,
} from '../storage/frame-storage'
import { stopExternalExposure, captureExternalFrame } from './external-exposure'
import type { DeviceSession } from '../device/device-plugin'
import type { RigCamera, RigOperationContext } from '../rig/rig-model'
import { isCaptureInFlight, isExternalSequenceRecoveryActive } from '../../../shared/lifecycle'

// Default exposure duration for the generic camera path when no user-configured
// value exists yet. Not a stacking frame count.
export const DEFAULT_EXPOSURE_DURATION_SEC = 1

// Upper bound for a single external exposure. Matches the renderer's
// camera-panel input max so the IPC schema and workflow validation share one
// explicit bound and unreasonable values do not reach the device.
export const MAX_EXPOSURE_DURATION_SEC = 3600

export const runSetExposureDuration = (durationSec: number) =>
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager

    const session = yield* sessions.getCurrent
    if (!session?.rig.camera) {
      return yield* Effect.fail(
        new Error('Connected rig does not expose a generic camera'),
      )
    }

    if (
      !Number.isFinite(durationSec) ||
      durationSec <= 0 ||
      durationSec > MAX_EXPOSURE_DURATION_SEC
    ) {
      return yield* Effect.fail(
        new Error(
          `Exposure duration must be a positive number of seconds up to ${MAX_EXPOSURE_DURATION_SEC}`,
        ),
      )
    }

    const updated = yield* store.updateIfSession(session, (current) => ({
      ...current,
      camera: { exposureSec: durationSec },
    }))
    if (!updated) return

    yield* bus.publish('camera.settings.updated', { exposureSec: durationSec })
  })

export const runStartCapture = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.updateIfSession(null, (current) => ({
      ...current,
      capture: { phase: 'failed', lastError: 'No device connected' },
    }))
    yield* bus.publish('capture.failed', { error: 'No device connected' })
    return
  }

  const lease = yield* coordinator.acquire(session, 'capture-start')
  if (!lease) return

  // For the external path, the lease is transferred to the daemon poller so
  // it remains current through polling/frame save. The outer bracket only
  // releases when the poller was not forked (failure before fork).
  let leaseTransferred = false

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const isExternal = !session.rig.capture && !!session.rig.camera
        // Claim 'starting' via commitIfLease so a preempted lease cannot
        // commit. The acquire loop already ensures no other op is running
        // and the aggregate is not busy, but the reentrancy check is kept
        // as a safety net.
        let claimed = false
        const claimedResult = yield* coordinator.commitIfLease(lease, (current) => {
          if (
            isCaptureInFlight(current.capture.phase)
          ) {
            return current
          }
          claimed = true
          return {
            ...current,
            capture: isExternal
              ? { phase: 'starting', mode: 'external' }
              : { phase: 'starting' },
          }
        })
        if (!claimedResult || !claimed) return

        const capture = session.rig.capture
        if (capture) {
          yield* bus.publish('capture.started', {})

          const ctx: RigOperationContext = { signal: lease.signal }

          yield* capture.start(ctx).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                if (lease.signal.aborted) return
                const message = toErrorMessage(error)
                const updated = yield* coordinator.commitIfLease(lease, (current) => ({
                  ...current,
                  capture: { phase: 'failed', lastError: message },
                }))
                if (updated) {
                  yield* bus.publish('capture.failed', { error: message })
                }
                return yield* Effect.fail(error)
              }),
            ),
          )

          if (lease.signal.aborted) return

          // A stop/park issued while capture.start() was awaiting moved
          // capture out of 'starting'. Don't commit refreshed state; the
          // stop path owns the aggregate now.
          const afterNativeStart = yield* store.get
          if (afterNativeStart.capture.phase !== 'starting') {
            return
          }

          const refreshed = yield* session.rig.refresh

          if (lease.signal.aborted) return

          const nativeCommitted = yield* coordinator.commitIfLease(lease, (current) => {
            if (current.capture.phase !== 'starting') return current
            return {
              ...current,
              device: { ...current.device, ...refreshed.device },
              preview: refreshed.preview,
              capture: refreshed.capture,
            }
          })
          if (!nativeCommitted || nativeCommitted.capture.phase !== refreshed.capture.phase) return

          yield* bus.publish('capture.succeeded', {})
          return
        }

        // Generic camera path: rigs like alpaca-rig expose start/stop exposure
        // but no native stacking workflow. Drive the camera directly and track
        // an exposure-oriented capture state without faking stack/frame progress.
        const camera = session.rig.camera
        if (!camera) {
          const failed = yield* coordinator.commitIfLease(lease, (current) => ({
            ...current,
            capture: {
              phase: 'failed',
              lastError: 'Connected rig does not support capture',
            },
          }))
          if (failed) {
            yield* bus.publish('capture.failed', {
              error: 'Connected rig does not support capture',
            })
          }
          return
        }

        const durationSec = resolveExposureDuration(
          (yield* store.get).camera?.exposureSec,
        )

        const storage = yield* FrameStorage
        yield* storage.preflightExternalFrameStorage().pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              if (lease.signal.aborted) return
              const message = `Storage preflight failed: ${toErrorMessage(error)}`
              const updated = yield* coordinator.commitIfLease(lease, (current) => ({
                ...current,
                capture: { phase: 'failed', mode: 'external', lastError: message },
              }))
              if (updated) {
                yield* bus.publish('capture.failed', { error: message })
              }
              return yield* Effect.fail(error)
            }),
          ),
        )

        yield* bus.publish('capture.started', {})

        // Atomically claim the capturing transition: only the fiber that
        // observes phase === 'starting' inside the commit commits 'capturing'.
        const startedAt = new Date().toISOString()
        const capturingCommitted = yield* coordinator.commitIfLease(lease, (current) => {
          if (current.capture.phase !== 'starting') return current
          return {
            ...current,
            capture: {
              phase: 'capturing',
              mode: 'external',
              startedAt,
            },
          }
        })
        if (!capturingCommitted || capturingCommitted.capture.phase !== 'capturing') return

        yield* bus.publish('capture.state.updated', {
          phase: 'capturing',
          mode: 'external',
          startedAt,
        })

        // Fork a daemon polling loop that transitions capture out of
        // 'capturing' when the device reports completion. The poller owns
        // the lease and releases it on success/failure/partial/timeout.
        // startedAt is passed as a correlation token so a stale loop exits
        // if a new exposure replaces this one before the loop notices.
        leaseTransferred = true
        yield* pollExternalExposure(session, camera, durationSec, startedAt, lease).pipe(
          Effect.forkDaemon,
        )
      }),
    (_none, exit) => {
      if (leaseTransferred && Exit.isSuccess(exit)) return Effect.void
      return coordinator.release(lease)
    },
  ).pipe(
    Effect.catchAll((error) =>
      lease.signal.aborted ? Effect.void : Effect.fail(error),
    ),
  )
})

export const runStopCapture = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator

  const session = yield* sessions.getCurrent
  if (!session) {
    yield* store.updateIfSession(null, (current) => ({
      ...current,
      capture: { phase: 'idle' },
    }))
    yield* bus.publish('capture.stopped', {})
    return
  }

  // Recovery: preempt any current ordinary operation and acquire
  // immediately. stop-capture supersedes pending/active capture-start and
  // the external poller (the poller observes the aborted signal and exits).
  const lease = yield* coordinator.acquireRecovery(session, 'stop-capture')
  if (!lease) return

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const capture = session.rig.captureStop
        if (capture) {
          const ctx: RigOperationContext = { signal: lease.signal }

          const stop =
            capture.mode === 'external'
              ? session.rig.camera
                ? stopExternalExposure(capture, session.rig.camera, ctx)
                : Effect.fail(new Error('Connected rig does not expose a generic camera'))
              : capture.stop(ctx)
          yield* stop.pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const message = toErrorMessage(error)
                const updated = yield* coordinator.commitIfLease(lease, (current) => ({
                  ...current,
                  capture: {
                    phase: 'failed',
                    mode: capture.mode === 'external' ? 'external' : undefined,
                    lastError: message,
                  },
                  sequence: isExternalSequenceRecoveryActive(current.sequence.phase)
                    ? { ...current.sequence, phase: 'failed', frameKind: undefined, currentIndex: undefined, lastError: message }
                    : current.sequence,
                }))
                if (updated) {
                  yield* bus.publish('capture.failed', { error: message })
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
            sequence: isExternalSequenceRecoveryActive(current.sequence.phase)
              ? { ...current.sequence, phase: 'stopped', frameKind: undefined, currentIndex: undefined }
              : current.sequence,
          }))
          if (!updated) return

          yield* bus.publish('capture.stopped', {})
          return
        }

        return yield* Effect.fail(
          new Error('Connected rig does not support capture'),
        )
      }),
    () => coordinator.release(lease),
  ).pipe(
    Effect.catchAll((error) =>
      lease.signal.aborted ? Effect.void : Effect.fail(error),
    ),
  )
})

// Daemon-fiber polling loop for external camera exposure completion. Reads
// `RigCamera.getExposureState()` at a fixed interval and transitions the
// capture projection out of 'capturing' when the device reports ready/error,
// or when the exposure times out. Exits quietly on session replacement,
// external stop (runStopCapture sets phase to idle), or lease preemption
// (signal aborted). The poller owns the operation lease and releases it on
// success/failure/partial/timeout via the acquireUseRelease bracket.
function pollExternalExposure(
  session: DeviceSession,
  camera: RigCamera,
  durationSec: number,
  startedAt: string,
  lease: OperationLease,
): Effect.Effect<
  void,
  unknown,
  AggregateStore | EventBus | SessionManager | OperationCoordinator | FrameStorage
> {
  return Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const store = yield* AggregateStore
        const bus = yield* EventBus
        const sessions = yield* SessionManager
        const coordinator = yield* OperationCoordinator

        const current = yield* store.get
        const captureStop = session.rig.captureStop
        if (captureStop?.mode !== 'external') return
        const result = yield* captureExternalFrame(camera, captureStop, {
          durationSec,
          targetShort: current.currentTarget?.short,
          onState: (state) => coordinator.commitIfLease(lease, (aggregate) => ({
            ...aggregate,
            capture: { ...aggregate.capture, deviceState: state.state },
          })).pipe(Effect.asVoid),
        }, { signal: lease.signal }).pipe(Effect.either)
        if (lease.signal.aborted || !(yield* sessions.ownsSession(session))) return
        const afterCapture = yield* store.get
        if (afterCapture.capture.phase !== 'capturing' || afterCapture.capture.startedAt !== startedAt) return
        if (Either.isLeft(result)) {
          const message = toErrorMessage(result.left)
          const failed = yield* coordinator.commitIfLease(lease, (aggregate) => ({
            ...aggregate,
            capture: { phase: 'failed', mode: 'external', lastError: message },
          }))
          if (failed) yield* bus.publish('capture.failed', { error: message })
          return
        }
        const completed = yield* coordinator.commitIfLease(lease, (aggregate) => ({
          ...aggregate,
          capture: {
            phase: result.right.saved.previewError ? 'partial' : 'idle',
            mode: 'external',
            deviceState: 'ready',
            lastError: result.right.saved.previewError,
          },
          library: { ...aggregate.library, assets: [result.right.asset, ...aggregate.library.assets] },
        }))
        if (completed?.capture.phase === 'partial') {
          yield* bus.publish('capture.partial', { error: result.right.saved.previewError, step: 'preview-persist' })
          return
        }
        if (completed) yield* bus.publish('capture.succeeded', {})
        return

      }),
    () =>
      Effect.gen(function* () {
        const coordinator = yield* OperationCoordinator
        yield* coordinator.release(lease)
      }),
  )
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function resolveExposureDuration(configured: number | undefined): number {
  if (configured != null && configured > 0 && Number.isFinite(configured)) {
    return configured
  }
  return DEFAULT_EXPOSURE_DURATION_SEC
}
