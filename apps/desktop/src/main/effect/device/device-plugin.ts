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
}

export interface LiveDeviceSession extends ConnectedDeviceSession {
  disconnect: Effect.Effect<void>
}

export interface DevicePlugin {
  readonly kind: DevicePluginKind
  readonly discover: Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly connect: (
    input: ConnectRequestV2,
  ) => Effect.Effect<LiveDeviceSession, unknown, EventBus>
}

export const DevicePlugin = Context.GenericTag<DevicePlugin>('DevicePlugin')
