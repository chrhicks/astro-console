import { Context, Effect } from 'effect'
import type {
  CaptureProjection,
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DevicePluginKind,
  DeviceProjection,
  LibraryProjection,
  LiveSessionHealthState,
  PreviewProjection,
  SeestarViewMode,
} from '../../../shared/api-v2'
import { EventBus } from '../event/event-bus'

export interface ConnectedDeviceSession {
  sessionId: string
  pluginKind: DevicePluginKind
  deviceId: string
  host?: string
  productModel?: string
  openedAt: string
  device: DeviceProjection
  capabilities: DeviceCapabilities
  preview: PreviewProjection
  capture: CaptureProjection
  library: LibraryProjection
}

// Volatile device/preview/capture fields that change after preview/capture
// commands. Workflows merge `device` into the existing aggregate device
// projection; `preview` and `capture` replace the aggregate outright.
export interface DeviceSessionRefresh {
  device: Pick<
    DeviceProjection,
    'viewMode' | 'viewStage' | 'viewState' | 'tracking' | 'mountClosed'
  >
  preview: PreviewProjection
  capture: CaptureProjection
}

export interface PointToCoordinatesInput {
  mode: SeestarViewMode
  targetName?: string
  raHours: number
  decDeg: number
}

export interface PrepareForPointingInput {
  lat: number
  lon: number
}

// Authoritative background-liveness state for a live session. The keepalive
// loop updates this; the plugin's command wrappers read it to fail fast on a
// failed session, and the status projector surfaces it to state consumers.
export interface LiveDeviceSession extends ConnectedDeviceSession {
  health: LiveSessionHealthState
  disconnect: Effect.Effect<void>
  prepareForPointing: (
    input: PrepareForPointingInput,
  ) => Effect.Effect<void, unknown>
  openArm: () => Effect.Effect<void, unknown>
  parkArm: () => Effect.Effect<void, unknown>
  pointToCoordinates: (
    input: PointToCoordinatesInput,
  ) => Effect.Effect<void, unknown>
  startPreview: () => Effect.Effect<void, unknown>
  stopPreview: () => Effect.Effect<void, unknown>
  startCapture: () => Effect.Effect<void, unknown>
  stopCapture: () => Effect.Effect<void, unknown>
  refresh: Effect.Effect<DeviceSessionRefresh, unknown>
}

export interface DevicePlugin {
  readonly kind: DevicePluginKind
  readonly discover: Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly connect: (
    input: ConnectRequestV2,
  ) => Effect.Effect<LiveDeviceSession, unknown, EventBus>
}

export const DevicePlugin = Context.GenericTag<DevicePlugin>('DevicePlugin')

export interface DeviceCapabilities {
  readonly supportsStacking: boolean      // Seestar: true, Alpaca mount: false
  readonly supportsLivePreview: boolean   // Seestar: true, Alpaca mount: false
  readonly supportsFilterWheel: boolean    // Seestar S30: true (3-position), others: varies
  readonly supportsAutofocus: boolean      // Seestar: true, Alpaca mount: depends
  readonly supportsStorageAccess: boolean   // Seestar: true, Alpaca mount: false
}
