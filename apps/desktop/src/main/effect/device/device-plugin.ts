import { Context, Effect } from 'effect'
import type {
  CaptureProjection,
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DevicePluginKind,
  DeviceProjection,
  LibraryProjection,
  PreviewProjection,
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
  device: Pick<DeviceProjection, 'viewMode' | 'viewStage' | 'viewState' | 'tracking'>
  preview: PreviewProjection
  capture: CaptureProjection
}

export interface LiveDeviceSession extends ConnectedDeviceSession {
  disconnect: Effect.Effect<void>
  pointToCoordinates: (input: {
    raHours: number
    decDeg: number
  }) => Effect.Effect<void, unknown>
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
