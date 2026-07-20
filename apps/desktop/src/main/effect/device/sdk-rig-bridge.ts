import { Effect } from 'effect'
import type {
  RigError,
  RigOperationContext,
  RigPointingInput,
  RigPointingPrepareInput,
  RigSession,
  RigSnapshot,
} from 'seestar-sdk'
import type {
  CaptureProjection,
  DevicePluginKind,
  DeviceProjection,
  LibraryProjection,
  PreviewProjection,
} from '../../../shared/api-v2'
import type { ConnectedRig, RigSessionRefresh } from '../rig/rig-model'

export function toDesktopRig(
  session: RigSession,
  pluginKind: DevicePluginKind,
  device: DeviceProjection,
): ConnectedRig {
  const nativeCapture = session.nativeCapture
  const camera = session.camera
  const base = {
    identity: {
      rigId: session.identity.rigId,
      pluginKind,
      displayName: session.identity.displayName,
      host: session.identity.host,
      port: session.identity.port,
    },
    observerLocation: session.observerLocation,
    controls: () => ({
      focuser: session.focuser
        ? { position: session.focuser.state.position, maxStep: session.focuser.state.maxStep, moving: session.focuser.state.moving }
        : undefined,
      filterWheel: session.filterWheel
        ? { names: [...session.filterWheel.state.names], focusOffsets: [...session.filterWheel.state.focusOffsets], position: session.filterWheel.state.position }
        : undefined,
    }),
    connect: {
      device,
      preview: toPreview(session.snapshot),
      capture: toCapture(session.snapshot),
      library: emptyLibrary(),
    },
    refresh: session.refresh.pipe(Effect.map(toRefresh)),
    mount: session.mount,
    pointing: session.pointing
      ? {
          prepare: (
            input: RigPointingPrepareInput,
            context?: RigOperationContext,
          ) => bridgeEffect(session.pointing?.prepare(input, context)),
          pointToCoordinates: (
            input: RigPointingInput,
            context?: RigOperationContext,
          ) => bridgeEffect(session.pointing?.pointToCoordinates(input, context)),
        }
      : undefined,
    preview: session.preview,
    autofocus: session.autofocus,
    focuser: session.focuser,
    filterWheel: session.filterWheel,
    storage: session.storage,
  }
  if (nativeCapture) {
    return {
      ...base,
      capture: { start: nativeCapture.start },
      captureStop: { mode: 'native', stop: nativeCapture.stop },
    }
  }
  if (camera) {
    return {
      ...base,
      camera,
      captureStop: { mode: 'external', stop: camera.stopExposure },
    }
  }
  return base
}

function toPreview(snapshot: {
  readonly preview: { readonly active: boolean; readonly source: 'native' | 'none' }
}): PreviewProjection {
  return snapshot.preview.active
    ? { phase: 'active', source: snapshot.preview.source, active: true }
    : { phase: 'none', source: 'none', active: false }
}

function toCapture(snapshot: {
  readonly capture: {
    readonly active: boolean
    readonly mode?: 'native' | 'external'
  }
}): CaptureProjection {
  return snapshot.capture.active
    ? { phase: 'capturing', mode: snapshot.capture.mode }
    : { phase: 'idle', mode: snapshot.capture.mode }
}

function toRefresh(snapshot: RigSnapshot): RigSessionRefresh {
  return {
    device: {
      tracking: snapshot.mount.tracking,
      mountClosed: snapshot.mount.parked,
      ...snapshot.telemetry,
      warnings: [...snapshot.warnings],
    },
    preview: toPreview(snapshot),
    capture: toCapture(snapshot),
  }
}

function bridgeEffect<A>(
  effect: Effect.Effect<A, RigError> | undefined,
): Effect.Effect<A, Error> {
  if (!effect) return Effect.die('Missing SDK procedure')
  return effect.pipe(Effect.mapError((error) => new Error(rigErrorMessage(error))))
}

function rigErrorMessage(error: RigError): string {
  if ('message' in error && typeof error.message === 'string') return error.message
  if ('cause' in error) return causeMessage(error.cause)
  return error._tag
}

function causeMessage(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'cause' in cause) return causeMessage(cause.cause)
  if (cause instanceof Error) return cause.message
  return String(cause)
}

function emptyLibrary(): LibraryProjection {
  return { scope: 'current_target', assets: [], polling: false }
}
