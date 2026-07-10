import { Effect, Either, Exit } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { OperationCoordinator, type OperationLease } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import {
  FrameStorage,
  type SavedFrame,
} from '../storage/frame-storage'
import { registerManagedAsset } from '../storage/asset-registry'
import type { DeviceSession } from '../device/device-plugin'
import type { RigCamera, RigFrameResult, RigOperationContext } from '../rig/rig-model'
import type { LibraryAsset } from '../../../shared/api-v2'

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
            current.capture.phase === 'starting' ||
            current.capture.phase === 'capturing'
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

        yield* bus.publish('capture.started', {})

        const ctx: RigOperationContext = { signal: lease.signal }

        yield* camera.startExposure({ durationSec }, ctx).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const message = toErrorMessage(error)
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

        if (lease.signal.aborted) return

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

          yield* capture.stop(ctx).pipe(
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

// Polling interval for external camera exposure state. Balances responsiveness
// (short exposures complete in ~1s) against HTTP overhead for long exposures.
const EXPOSURE_POLL_INTERVAL_MS = 500

// Safety margin beyond the configured duration before the polling loop gives
// up. Covers sensor readout and transport latency without hanging forever.
const EXPOSURE_TIMEOUT_MARGIN_MS = 30000

// Number of consecutive cameraError polls to tolerate before classifying an
// exposure as failed. The .63 Alpaca host can briefly report cameraError on
// the first exposure of a fresh connection before imageready becomes true; at
// a 500ms poll interval this gives a ~1.5s transient window. Persistent
// errors still fail honestly once the threshold is reached.
const MAX_CONSECUTIVE_ERROR_POLLS = 3

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

        const deadline =
          Date.now() + durationSec * 1000 + EXPOSURE_TIMEOUT_MARGIN_MS

        let consecutiveErrorPolls = 0

        while (Date.now() < deadline) {
          if (lease.signal.aborted) return
          if (!(yield* sessions.ownsSession(session))) return
          const current = yield* store.get
          if (current.capture.phase !== 'capturing') return
          if (current.capture.startedAt !== startedAt) return

          yield* Effect.sleep(EXPOSURE_POLL_INTERVAL_MS)

          if (lease.signal.aborted) return

          const ctx: RigOperationContext = { signal: lease.signal }
          const result = yield* camera.getExposureState(ctx).pipe(Effect.either)

          // Session replaced, capture stopped, or new exposure started while
          // polling; exit quietly.
          if (!(yield* sessions.ownsSession(session))) return
          const afterRead = yield* store.get
          if (afterRead.capture.phase !== 'capturing') return
          if (afterRead.capture.startedAt !== startedAt) return

          if (Either.isLeft(result)) {
            const message = toErrorMessage(result.left)
            const failed = yield* coordinator.commitIfLease(lease, (current) => ({
              ...current,
              capture: {
                phase: 'failed',
                mode: 'external',
                deviceState: 'error',
                lastError: message,
              },
            }))
            if (failed) {
              yield* bus.publish('capture.failed', { error: message })
            }
            return
          }

          const state = result.right

          const stateUpdated = yield* coordinator.commitIfLease(lease, (current) => ({
            ...current,
            capture: {
              ...current.capture,
              deviceState: state.state,
              lastError: state.lastError ?? current.capture.lastError,
            },
          }))
          if (!stateUpdated) return

          yield* bus.publish('capture.device-state.updated', {
            deviceState: state.state,
          })

          if (state.state === 'ready') {
            // Exposure completed; retrieve the finished frame, persist it to
            // disk via FrameStorage, and add a library asset so the filmstrip
            // shows a real entry. Retrieval and persistence failures are
            // logged honestly but do not invalidate the completed exposure.
            const frameCtx: RigOperationContext = { signal: lease.signal }
            const frameResult = yield* camera.getLatestFrame(frameCtx).pipe(Effect.either)

            if (lease.signal.aborted) return
            if (!(yield* sessions.ownsSession(session))) return
            const afterFrame = yield* store.get
            if (afterFrame.capture.phase !== 'capturing') return
            if (afterFrame.capture.startedAt !== startedAt) return

            if (Either.isLeft(frameResult)) {
              const message = toErrorMessage(frameResult.left)
              yield* bus.publish('capture.frame.retrieval.failed', {
                error: message,
              })
              // Atomically claim the partial transition only if this poller
              // still owns the session and the current exposure (capturing +
              // startedAt match). A stale poller or a newer exposure must not
              // overwrite the aggregate.
              const partial = yield* coordinator.commitIfLease(lease, (current) => {
                if (
                  current.capture.phase !== 'capturing' ||
                  current.capture.startedAt !== startedAt
                ) {
                  return current
                }
                return {
                  ...current,
                  capture: {
                    phase: 'partial',
                    mode: 'external',
                    deviceState: 'ready',
                    lastError: message,
                  },
                }
              })
              if (partial && partial.capture.phase === 'partial') {
                yield* bus.publish('capture.partial', {
                  error: message,
                  step: 'frame-retrieval',
                })
              }
              return
            }

            const frame = frameResult.right
            const storage = yield* FrameStorage
            const saveResult = yield* storage
              .saveExternalFrame({
                capturedAt: frame.metadata?.capturedAt ?? new Date().toISOString(),
                durationSec,
                data: frame.data,
                targetShort: afterFrame.currentTarget?.short,
                frame: {
                  width: frame.width,
                  height: frame.height,
                  rank: frame.imageBytes?.rank ?? 0,
                  planes: frame.imageBytes?.planes,
                  elementType: frame.imageBytes?.transmissionElementType ?? 0,
                },
              })
              .pipe(Effect.either)

            if (lease.signal.aborted) return
            if (!(yield* sessions.ownsSession(session))) return
            const afterSave = yield* store.get
            if (afterSave.capture.phase !== 'capturing') return
            if (afterSave.capture.startedAt !== startedAt) return

            if (Either.isLeft(saveResult)) {
              const message = toErrorMessage(saveResult.left)
              yield* bus.publish('capture.frame.persist.failed', {
                error: message,
              })
              // Atomically claim the partial transition only if this poller
              // still owns the session and the current exposure.
              const partial = yield* coordinator.commitIfLease(lease, (current) => {
                if (
                  current.capture.phase !== 'capturing' ||
                  current.capture.startedAt !== startedAt
                ) {
                  return current
                }
                return {
                  ...current,
                  capture: {
                    phase: 'partial',
                    mode: 'external',
                    deviceState: 'ready',
                    lastError: message,
                  },
                }
              })
              if (partial && partial.capture.phase === 'partial') {
                yield* bus.publish('capture.partial', {
                  error: message,
                  step: 'frame-persist',
                })
              }
              return
            }

            const asset = createExternalLibraryAsset(
              frame,
              durationSec,
              saveResult.right,
            )
            // Atomically commit the idle transition + library asset only if
            // this poller still owns the session and the current exposure. A
            // stale poller must not overwrite a newer capture state or
            // prepend a stale asset.
            const completed = yield* coordinator.commitIfLease(lease, (current) => {
              if (
                current.capture.phase !== 'capturing' ||
                current.capture.startedAt !== startedAt
              ) {
                return current
              }
              return {
                ...current,
                capture: {
                  phase: 'idle',
                  mode: 'external',
                  deviceState: 'ready',
                },
                library: {
                  ...current.library,
                  assets: [asset, ...current.library.assets],
                },
              }
            })
            if (completed && completed.capture.phase === 'idle') {
              yield* bus.publish('capture.succeeded', {})
            }
            return
          }

          if (state.state === 'error') {
            consecutiveErrorPolls++
            // The .63 Alpaca host can briefly report cameraError on the first
            // exposure of a fresh connection before imageready becomes true.
            // Tolerate a small number of consecutive error polls before
            // classifying the exposure as failed; the device may still move to
            // ready on a subsequent poll.
            if (consecutiveErrorPolls < MAX_CONSECUTIVE_ERROR_POLLS) continue
            const message = state.lastError ?? 'Camera reported exposure error'
            const failed = yield* coordinator.commitIfLease(lease, (current) => ({
              ...current,
              capture: {
                phase: 'failed',
                mode: 'external',
                deviceState: 'error',
                lastError: message,
              },
            }))
            if (failed) {
              yield* bus.publish('capture.failed', { error: message })
            }
            return
          }

          consecutiveErrorPolls = 0

          if (state.state === 'idle') {
            // Device returned to idle without reaching ready; treat as
            // stopped (e.g. stopExposure was called externally or the device
            // aborted).
            const stopped = yield* coordinator.commitIfLease(lease, (current) => ({
              ...current,
              capture: {
                phase: 'idle',
                mode: 'external',
                deviceState: 'idle',
              },
            }))
            if (stopped) {
              yield* bus.publish('capture.stopped', {})
            }
            return
          }
        }

        // Timeout: exposure did not complete within the expected window.
        if (lease.signal.aborted) return
        if (!(yield* sessions.ownsSession(session))) return
        const final = yield* store.get
        if (final.capture.phase !== 'capturing') return
        if (final.capture.startedAt !== startedAt) return

        const timedOut = yield* coordinator.commitIfLease(lease, (current) => ({
          ...current,
          capture: {
            phase: 'failed',
            mode: 'external',
            lastError: 'Exposure did not complete within expected time',
          },
        }))
        if (timedOut) {
          yield* bus.publish('capture.failed', {
            error: 'Exposure did not complete within expected time',
          })
        }
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

// Builds a library asset entry from a retrieved and persisted external frame.
// Only metadata (id/name/timestamp/kind + saved-file location and frame
// geometry) is surfaced to the renderer; the frame bytes stay on disk so
// DesktopStatus does not carry full image payloads.
function createExternalLibraryAsset(
  frame: RigFrameResult,
  durationSec: number,
  saved: SavedFrame,
): LibraryAsset {
  const capturedAt = frame.metadata?.capturedAt ?? new Date().toISOString()
  const timePart = capturedAt.slice(11, 19).replace(/:/g, '')
  return {
    id: registerManagedAsset(saved.absolutePath),
    name: `exposure_${durationSec}s_${timePart}`,
    capturedAt,
    kind: 'exposure',
    saved: true,
    savedFileSize: saved.fileSize,
    hasPreview: saved.previewFilePath != null,
    previewFileSize: saved.previewFileSize,
    frameWidth: frame.width || undefined,
    frameHeight: frame.height || undefined,
    framePixelFormat:
      frame.pixelFormat === 'unknown' ? undefined : frame.pixelFormat,
  }
}
