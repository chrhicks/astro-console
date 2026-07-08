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
import type { ConnectedRig, DeviceCapabilities, RigSessionRefresh } from '../rig/rig-model'
import { EventBus } from '../event/event-bus'

// Re-exported for compatibility. The canonical definition lives in the rig
// model; plugin adapters and workflows should migrate to RigSessionRefresh.
export type DeviceSessionRefresh = RigSessionRefresh

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
  rig: ConnectedRig
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

// Slim public session surface used by SessionManager and app workflows.
// App-level code only needs metadata, projections, health, disconnect, and
// the rig surface. Seestar-shaped command methods live on PluginSession
// below and are only used inside plugin adapters.
export interface DeviceSession extends ConnectedDeviceSession {
  health: LiveSessionHealthState
  disconnect: Effect.Effect<void>
}

// Plugin-internal session carrier: extends the slim public session with the
// old Seestar-shaped command methods that plugin adapters still use to
// compose rig workflow implementations. Not referenced by app workflows.
export interface PluginSession extends DeviceSession {
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

// Deprecated alias for PluginSession. Kept for compatibility; new code
// should use DeviceSession (public) or PluginSession (plugin-internal).
export type LiveDeviceSession = PluginSession

// Re-exported for compatibility. The canonical definition lives in the rig
// model; app surfaces should migrate to rig.capabilities.
export type { DeviceCapabilities }

export interface DevicePlugin {
  readonly kind: DevicePluginKind
  readonly discover: Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly connect: (
    input: ConnectRequestV2,
  ) => Effect.Effect<DeviceSession, unknown, EventBus>
}

export const DevicePlugin = Context.GenericTag<DevicePlugin>('DevicePlugin')
