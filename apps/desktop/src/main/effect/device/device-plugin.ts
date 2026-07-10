import { Context, Effect } from 'effect'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DevicePluginKind,
  LiveSessionHealthState,
  TargetType,
} from '../../../shared/api-v2'
import type { ConnectedRig, RigSessionRefresh } from '../rig/rig-model'
import { EventBus } from '../event/event-bus'

// Re-exported for compatibility. The canonical definition lives in the rig
// model; plugin adapters and workflows should migrate to RigSessionRefresh.
export type DeviceSessionRefresh = RigSessionRefresh

// Seestar-specific view mode. Kept local to the device plugin layer so the
// public catalog schema stays rig-neutral; Seestar adapters map the rig's
// TargetType to this union via toSeestarViewMode.
export type SeestarViewMode = 'star' | 'moon' | 'sun' | 'planet' | 'scenery'

export interface PointToCoordinatesInput {
  mode: SeestarViewMode
  targetName?: string
  raHours: number
  decDeg: number
}

// Maps the rig-neutral TargetType to the Seestar device's view mode. Uranus
// and Neptune are small and faint, so the Seestar treats them as star-like
// point sources for stacking rather than using planet mode.
export function toSeestarViewMode(
  targetType: TargetType,
  targetName?: string,
): SeestarViewMode {
  if (targetType === 'dso') return 'star'
  if (targetType === 'sun') return 'sun'
  if (targetType === 'moon') return 'moon'
  if (targetName === 'Uranus' || targetName === 'Neptune') return 'star'
  return 'planet'
}

export interface PrepareForPointingInput {
  lat: number
  lon: number
}

// Slim public session surface used by SessionManager and app workflows.
// App-level code depends on identifying metadata, health, disconnect, and
// the rig surface only. Plugin adapters build rigs from local closures and
// return this slim session; connect-time projections and capabilities live
// on the rig.
export interface DeviceSession {
  sessionId: string
  pluginKind: DevicePluginKind
  deviceId: string
  health: LiveSessionHealthState
  disconnect: Effect.Effect<void>
  rig: ConnectedRig
}

export interface DevicePlugin {
  readonly kind: DevicePluginKind
  readonly discover: Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly connect: (
    input: ConnectRequestV2,
  ) => Effect.Effect<DeviceSession, unknown, EventBus>
}

export const DevicePlugin = Context.GenericTag<DevicePlugin>('DevicePlugin')
