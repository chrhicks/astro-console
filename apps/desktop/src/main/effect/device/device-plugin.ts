import { Context, Effect } from 'effect'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DevicePluginKind,
  DeviceProjection,
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
}

export interface LiveDeviceSession extends ConnectedDeviceSession {
  disconnect: Effect.Effect<void>
  pointToCoordinates: (input: {
    raHours: number
    decDeg: number
  }) => Effect.Effect<void, unknown>
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
