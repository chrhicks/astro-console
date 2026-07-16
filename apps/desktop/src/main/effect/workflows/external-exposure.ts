import { Effect } from 'effect'
import { registerManagedAsset } from '../storage/asset-registry'
import { FrameStorage, type SavedFrame } from '../storage/frame-storage'
import type {
  RigCamera,
  RigCameraExposureState,
  RigCaptureStop,
  RigFrameResult,
  RigOperationContext,
} from '../rig/rig-model'
import type { LibraryAsset } from '../../../shared/api-v2'

const STOP_CONFIRM_TIMEOUT_MS = 10000
const STOP_CONFIRM_POLL_INTERVAL_MS = 250
const EXPOSURE_POLL_INTERVAL_MS = 500
const EXPOSURE_TIMEOUT_MARGIN_MS = 30000
const MAX_CONSECUTIVE_ERROR_POLLS = 3

export function captureExternalFrame(
  camera: RigCamera,
  captureStop: RigCaptureStop & { readonly mode: 'external' },
  input: {
    readonly durationSec: number
    readonly light?: boolean
    readonly frameKind?: 'light' | 'dark'
    readonly targetShort?: string
    readonly onState?: (state: RigCameraExposureState) => Effect.Effect<void>
  },
  context: RigOperationContext,
) {
  return Effect.gen(function* () {
    if (context.signal?.aborted) return yield* Effect.fail(new Error('External exposure was stopped'))
    if (input.frameKind === 'dark') {
      if (!camera.startDarkExposure) return yield* Effect.fail(new Error('Connected rig does not support dark exposures'))
      yield* camera.startDarkExposure({ durationSec: input.durationSec }, context)
    } else {
      yield* camera.startExposure({ durationSec: input.durationSec, light: input.light }, context)
    }

    return yield* Effect.gen(function* () {
      const deadline = Date.now() + input.durationSec * 1000 + EXPOSURE_TIMEOUT_MARGIN_MS
      let consecutiveErrorPolls = 0
      while (Date.now() < deadline) {
        if (context.signal?.aborted) return yield* Effect.fail(new Error('External exposure was stopped'))
        yield* Effect.sleep(EXPOSURE_POLL_INTERVAL_MS)
        const state = yield* camera.getExposureState(context)
        if (input.onState) yield* input.onState(state)
        if (state.state === 'ready') {
          const frame = yield* camera.getLatestFrame(context)
          const storage = yield* FrameStorage
          const saved = yield* storage.saveExternalFrame({
            capturedAt: frame.metadata?.capturedAt ?? new Date().toISOString(),
            durationSec: input.durationSec,
            data: frame.data,
            targetShort: input.targetShort,
            frameKind: input.frameKind,
            frame: {
              width: frame.width,
              height: frame.height,
              rank: frame.imageBytes?.rank ?? 0,
              planes: frame.imageBytes?.planes,
              elementType: frame.imageBytes?.transmissionElementType ?? 0,
            },
          })
          return { frame, saved, asset: createExternalLibraryAsset(frame, input.durationSec, saved, input.frameKind) }
        }
        if (state.state === 'idle') {
          return yield* Effect.fail(new Error('External exposure was stopped'))
        }
        if (state.state !== 'error') {
          consecutiveErrorPolls = 0
          continue
        }
        consecutiveErrorPolls++
        if (consecutiveErrorPolls < MAX_CONSECUTIVE_ERROR_POLLS) continue
        return yield* Effect.fail(new Error(state.lastError ?? 'Camera reported exposure error'))
      }

      return yield* Effect.fail(new Error('Exposure did not complete within expected time'))
    }).pipe(Effect.tapError((error) => stopAfterFailure(error, captureStop, camera, context)))
  })
}

export function stopExternalExposure(
  captureStop: RigCaptureStop & { readonly mode: 'external' },
  camera: RigCamera,
  context: RigOperationContext,
) {
  return Effect.gen(function* () {
    yield* captureStop.stop(context)

    const deadline = Date.now() + STOP_CONFIRM_TIMEOUT_MS
    while (true) {
      if (context.signal?.aborted) {
        return yield* Effect.fail(new Error('External exposure stop was aborted'))
      }

      const state = yield* camera.getExposureState(context)
      if (state.state === 'idle' || state.state === 'ready') return state
      if (Date.now() >= deadline) {
        return yield* Effect.fail(
          new Error('External exposure did not stop within expected time'),
        )
      }

      yield* Effect.sleep(STOP_CONFIRM_POLL_INTERVAL_MS)
    }
  })
}

function stopAfterFailure(
  error: unknown,
  captureStop: RigCaptureStop & { readonly mode: 'external' },
  camera: RigCamera,
  context: RigOperationContext,
) {
  if (error instanceof Error && error.message === 'External exposure was stopped') {
    return Effect.void
  }
  return stopExternalExposure(captureStop, camera, context).pipe(Effect.result, Effect.asVoid)
}

function createExternalLibraryAsset(
  frame: RigFrameResult,
  durationSec: number,
  saved: SavedFrame,
  frameKind: 'light' | 'dark' | undefined,
): LibraryAsset {
  const capturedAt = frame.metadata?.capturedAt ?? new Date().toISOString()
  const timePart = capturedAt.slice(11, 19).replace(/:/g, '')
  return {
    id: registerManagedAsset(saved.absolutePath),
    name: `${frameKind ?? 'exposure'}_${durationSec}s_${timePart}`,
    capturedAt,
    kind: 'exposure',
    frameKind,
    saved: true,
    savedFileSize: saved.fileSize,
    hasPreview: saved.previewFilePath != null,
    previewFileSize: saved.previewFileSize,
    previewError: saved.previewError,
    frameWidth: frame.width || undefined,
    frameHeight: frame.height || undefined,
    framePixelFormat: frame.pixelFormat === 'unknown' ? undefined : frame.pixelFormat,
  }
}
