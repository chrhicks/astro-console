import { Context, Effect } from 'effect'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DevicePluginKind,
} from '../../../shared/api-v2'

export interface ConnectedDeviceSession {
  sessionId: string
  pluginKind: DevicePluginKind
  deviceId: string
  host?: string
  productModel?: string
  openedAt: string
}

export interface LiveDeviceSession extends ConnectedDeviceSession {
  disconnect: Effect.Effect<void>
}

export interface DevicePlugin {
  readonly kind: DevicePluginKind
  readonly discover: Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly connect: (
    input: ConnectRequestV2,
  ) => Effect.Effect<LiveDeviceSession, unknown>
}

export const DevicePlugin = Context.GenericTag<DevicePlugin>('DevicePlugin')
