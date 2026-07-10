import { Effect, Either } from 'effect'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'
import { FrameStorage, type SavedFrame } from '../storage/frame-storage'
import type { DeviceSession } from '../device/device-plugin'
import type { RigCamera, RigFrameResult } from '../rig/rig-model'
import type { LibraryAsset } from '../../../shared/api-v2'

// Default exposure duration for the generic camera path when no user-configured
// value exists yet. Not a stacking frame count.
export const DEFAULT_EXPOSURE_DURATION_SEC = 1

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

    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return yield* Effect.fail(
        new Error('Exposure duration must be a positive number of seconds'),
      )
    }

    yield* store.update((current) => ({
      ...current,
      camera: { exposureSec: durationSec },
    }))

    yield* bus.publish('camera.settings.updated', { exposureSec: durationSec })
  })

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
  if (capture) {
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
    return
  }

  // Generic camera path: rigs like alpaca-rig expose start/stop exposure but
  // no native stacking workflow. Drive the camera directly and track an
  // exposure-oriented capture state without faking stack/frame progress.
  const camera = session.rig.camera
  if (!camera) {
    return yield* Effect.fail(
      new Error('Connected rig does not support capture'),
    )
  }

  const durationSec = resolveExposureDuration(
    (yield* store.get).camera?.exposureSec,
  )

  yield* store.update((current) => ({
    ...current,
    capture: { phase: 'starting', mode: 'external' },
  }))

  yield* bus.publish('capture.started', {})

  yield* camera.startExposure({ durationSec }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          capture: { phase: 'failed', mode: 'external', lastError: message },
        }))
        yield* bus.publish('capture.failed', { error: message })
        return yield* Effect.fail(error)
      }),
    ),
  )

  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  // Skip rig.refresh here: the Alpaca refresh does not poll camera exposure
  // state and would reset capture to idle immediately. Stamp startedAt so the
  // UI can derive elapsed time locally without faking device-reported progress.
  const startedAt = new Date().toISOString()
  yield* store.update((current) => ({
    ...current,
    capture: {
      phase: 'capturing',
      mode: 'external',
      startedAt,
    },
  }))

  yield* bus.publish('capture.state.updated', {
    phase: 'capturing',
    mode: 'external',
    startedAt,
  })

  // Fork a daemon polling loop that transitions capture out of 'capturing'
  // when the device reports completion. The workflow returns immediately so
  // the IPC handler can respond with the current 'capturing' status; the
  // polling loop owns subsequent state transitions (ready/error/timeout).
  // `startedAt` is passed as a correlation token so a stale loop exits if a
  // new exposure replaces this one before the loop notices.
  yield* pollExternalExposure(session, camera, durationSec, startedAt).pipe(
    Effect.forkDaemon,
  )
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
  if (capture) {
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
    return
  }

  const camera = session.rig.camera
  if (!camera) {
    return yield* Effect.fail(
      new Error('Connected rig does not support capture'),
    )
  }

  yield* camera.stopExposure().pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          capture: { phase: 'failed', mode: 'external', lastError: message },
        }))
        yield* bus.publish('capture.failed', { error: message })
        return yield* Effect.fail(error)
      }),
    ),
  )

  if ((yield* sessions.getCurrent) !== session) {
    return
  }

  yield* store.update((current) => ({
    ...current,
    capture: { phase: 'idle', mode: 'external' },
  }))

  yield* bus.publish('capture.stopped', {})
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
// or when the exposure times out. Exits quietly on session replacement or
// external stop (runStopCapture sets phase to idle).
function pollExternalExposure(
  session: DeviceSession,
  camera: RigCamera,
  durationSec: number,
  startedAt: string,
): Effect.Effect<
  void,
  unknown,
  AggregateStore | EventBus | SessionManager | FrameStorage
> {
  return Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager

    const deadline =
      Date.now() + durationSec * 1000 + EXPOSURE_TIMEOUT_MARGIN_MS

    let consecutiveErrorPolls = 0

    while (Date.now() < deadline) {
      if ((yield* sessions.getCurrent) !== session) return
      const current = yield* store.get
      if (current.capture.phase !== 'capturing') return
      if (current.capture.startedAt !== startedAt) return

      yield* Effect.sleep(EXPOSURE_POLL_INTERVAL_MS)

      const result = yield* camera.getExposureState().pipe(Effect.either)

      // Session replaced, capture stopped, or new exposure started while
      // polling; exit quietly.
      if ((yield* sessions.getCurrent) !== session) return
      const afterRead = yield* store.get
      if (afterRead.capture.phase !== 'capturing') return
      if (afterRead.capture.startedAt !== startedAt) return

      if (Either.isLeft(result)) {
        const message = toErrorMessage(result.left)
        yield* store.update((current) => ({
          ...current,
          capture: {
            phase: 'failed',
            mode: 'external',
            deviceState: 'error',
            lastError: message,
          },
        }))
        yield* bus.publish('capture.failed', { error: message })
        return
      }

      const state = result.right

      yield* store.update((current) => ({
        ...current,
        capture: {
          ...current.capture,
          deviceState: state.state,
          lastError: state.lastError ?? current.capture.lastError,
        },
      }))

      yield* bus.publish('capture.device-state.updated', {
        deviceState: state.state,
      })

      if (state.state === 'ready') {
        // Exposure completed; retrieve the finished frame, persist it to disk
        // via FrameStorage, and add a library asset so the filmstrip shows a
        // real entry. Retrieval and persistence failures are logged honestly
        // but do not invalidate the completed exposure.
        const frameResult = yield* camera.getLatestFrame().pipe(Effect.either)

        if ((yield* sessions.getCurrent) !== session) return
        const afterFrame = yield* store.get
        if (afterFrame.capture.phase !== 'capturing') return
        if (afterFrame.capture.startedAt !== startedAt) return

        if (Either.isLeft(frameResult)) {
          const message = toErrorMessage(frameResult.left)
          yield* bus.publish('capture.frame.retrieval.failed', {
            error: message,
          })
          yield* store.update((current) => ({
            ...current,
            capture: {
              phase: 'idle',
              mode: 'external',
              deviceState: 'ready',
              lastError: message,
            },
          }))
          yield* bus.publish('capture.succeeded', {})
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

        if ((yield* sessions.getCurrent) !== session) return
        const afterSave = yield* store.get
        if (afterSave.capture.phase !== 'capturing') return
        if (afterSave.capture.startedAt !== startedAt) return

        if (Either.isLeft(saveResult)) {
          const message = toErrorMessage(saveResult.left)
          yield* bus.publish('capture.frame.persist.failed', {
            error: message,
          })
          yield* store.update((current) => ({
            ...current,
            capture: {
              phase: 'idle',
              mode: 'external',
              deviceState: 'ready',
              lastError: message,
            },
          }))
          yield* bus.publish('capture.succeeded', {})
          return
        }

        const asset = createExternalLibraryAsset(
          frame,
          durationSec,
          saveResult.right,
        )
        yield* store.update((current) => ({
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
        }))
        yield* bus.publish('capture.succeeded', {})
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
        yield* store.update((current) => ({
          ...current,
          capture: {
            phase: 'failed',
            mode: 'external',
            deviceState: 'error',
            lastError: message,
          },
        }))
        yield* bus.publish('capture.failed', { error: message })
        return
      }

      consecutiveErrorPolls = 0

      if (state.state === 'idle') {
        // Device returned to idle without reaching ready; treat as stopped
        // (e.g. stopExposure was called externally or the device aborted).
        yield* store.update((current) => ({
          ...current,
          capture: {
            phase: 'idle',
            mode: 'external',
            deviceState: 'idle',
          },
        }))
        yield* bus.publish('capture.stopped', {})
        return
      }
    }

    // Timeout: exposure did not complete within the expected window.
    if ((yield* sessions.getCurrent) !== session) return
    const final = yield* store.get
    if (final.capture.phase !== 'capturing') return
    if (final.capture.startedAt !== startedAt) return

    yield* store.update((current) => ({
      ...current,
      capture: {
        phase: 'failed',
        mode: 'external',
        lastError: 'Exposure did not complete within expected time',
      },
    }))
    yield* bus.publish('capture.failed', {
      error: 'Exposure did not complete within expected time',
    })
  })
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
    id: `ext-${capturedAt}-${Math.random().toString(36).slice(2, 8)}`,
    name: `exposure_${durationSec}s_${timePart}`,
    capturedAt,
    kind: 'exposure',
    savedFilePath: saved.absolutePath,
    savedFileSize: saved.fileSize,
    previewFilePath: saved.previewFilePath,
    previewFileSize: saved.previewFileSize,
    frameWidth: frame.width || undefined,
    frameHeight: frame.height || undefined,
    framePixelFormat:
      frame.pixelFormat === 'unknown' ? undefined : frame.pixelFormat,
  }
}
