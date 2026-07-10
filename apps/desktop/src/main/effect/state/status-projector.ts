import { Effect, Context, Layer } from 'effect'
import { SessionAggregate } from './aggregate'
import {
  CaptureDeviceState,
  CaptureMode,
  DesktopStatus,
  DeviceProjection,
  LiveSessionHealthState,
  TargetSummary,
  WorkspaceAction,
  WorkspaceCapabilities,
  WorkspaceCapabilityTier,
  WorkspaceProjection,
  WorkspaceState,
  WorkspaceSurface,
} from '../../../shared/api-v2'
import type { DeviceCapabilities } from '../device/device-plugin'
import { AggregateStore } from './aggregate-store'
import { GeoService } from '../geo/geo-service'
import { SessionManager } from '../session/session-manager'

export interface StatusProjector {
  readonly snapshot: Effect.Effect<DesktopStatus>
}

export const StatusProjector =
  Context.GenericTag<StatusProjector>('StatusProjector')

interface RigSupport {
  canPark: boolean
  canPoint: boolean
  capture: WorkspaceCapabilityTier
}

function project(
  aggregate: SessionAggregate,
  capabilities: DeviceCapabilities | null,
  health: LiveSessionHealthState | null,
  effectiveLocation: { lat: number; lon: number } | null,
  locationSource: 'device' | 'geoip' | undefined,
  rigSupport: RigSupport | null,
): DesktopStatus {
  const device: DeviceProjection = effectiveLocation
    ? { ...aggregate.device, location: effectiveLocation, locationSource }
    : aggregate.device
  const projectedDevice: DeviceProjection = {
    ...device,
    canPark: rigSupport?.canPark,
    canPoint: rigSupport?.canPoint,
  }
  return {
    session: {
      ...aggregate.session,
      host: projectedDevice.host,
      productModel: projectedDevice.productModel,
      health: health ?? undefined,
    },
    capture: aggregate.capture,
    device: projectedDevice,
    library: aggregate.library,
    pointing: aggregate.pointing,
    preview: aggregate.preview,
    workspace: projectWorkspace(aggregate, capabilities, rigSupport),
    camera: aggregate.camera ?? undefined,
    currentTarget: aggregate.currentTarget,
    lastUpdatedAt: aggregate.lastUpdatedAt,
    lastError: aggregate.session.lastError,
  }
}

function projectWorkspace(
  aggregate: SessionAggregate,
  capabilities: DeviceCapabilities | null,
  rigSupport: RigSupport | null,
): WorkspaceProjection {
  const projectedCapabilities = projectCapabilities(capabilities, rigSupport)
  const state = projectState(aggregate, projectedCapabilities)
  return {
    state,
    stateLabel: stateLabel(
      state,
      aggregate.capture.mode,
      aggregate.capture.deviceState,
    ),
    surface: projectSurface(aggregate.pointing.target ?? aggregate.currentTarget),
    capabilities: projectedCapabilities,
    actions: projectActions(state, capabilities, rigSupport),
  }
}

function projectCapabilities(
  capabilities: DeviceCapabilities | null,
  rigSupport: RigSupport | null,
): WorkspaceCapabilities {
  if (!capabilities) {
    return {
      preview: 'unsupported',
      capture: 'unsupported',
      autofocus: 'no',
      filterWheel: 'no',
      storage: 'no',
    }
  }
  return {
    preview: capabilities.supportsLivePreview ? 'native' : 'unsupported',
    // Rig presence is the source of truth for the capture tier: native when
    // the rig exposes RigCaptureWorkflow, external when it only exposes
    // RigCamera, unsupported otherwise. Falls back to the legacy stacking
    // flag only when rig support is unknown (no session).
    capture: rigSupport?.capture ?? (capabilities.supportsStacking ? 'native' : 'unsupported'),
    autofocus: capabilities.supportsAutofocus ? 'yes' : 'no',
    filterWheel: capabilities.supportsFilterWheel ? 'yes' : 'no',
    storage: capabilities.supportsStorageAccess ? 'yes' : 'no',
  }
}

function projectState(
  aggregate: SessionAggregate,
  capabilities: WorkspaceCapabilities,
): WorkspaceState {
  if (aggregate.session.phase !== 'connected') return 'disconnected'
  if (aggregate.capture.phase === 'capturing' || aggregate.capture.phase === 'starting') {
    return 'capturing'
  }
  if (aggregate.preview.phase === 'starting') return 'preview_starting'
  if (aggregate.preview.phase === 'active') return 'preview_active'
  if (aggregate.preview.phase === 'error') return 'preview_error'
  if (aggregate.pointing.phase === 'slewing') return 'slewing'
  if (aggregate.pointing.phase === 'failed' && aggregate.pointing.target) {
    return 'ready_to_slew'
  }
  // Parked takes priority over a cached currentTarget: the mount is closed
  // even if the target summary has not been cleared yet.
  if (aggregate.device.mountClosed) return 'parked'
  if (aggregate.currentTarget) return 'on_target'
  // A connected rig that can preview or capture is actionable without a target;
  // do not force a Seestar-style slew before surfacing preview/capture.
  if (capabilities.preview !== 'unsupported' || capabilities.capture !== 'unsupported') {
    return 'primed'
  }
  return 'idle_no_target'
}

function stateLabel(
  state: WorkspaceState,
  captureMode?: CaptureMode,
  deviceState?: CaptureDeviceState,
): string {
  switch (state) {
    case 'disconnected':
      return 'Disconnected'
    case 'idle_no_target':
      return 'Idle'
    case 'primed':
      return 'Primed'
    case 'ready_to_slew':
      return 'Ready to slew'
    case 'slewing':
      return 'Slewing'
    case 'on_target':
      return 'On target'
    case 'preview_starting':
      return 'Starting preview'
    case 'preview_active':
      return 'Previewing'
    case 'preview_error':
      return 'Preview error'
    case 'capturing':
      if (captureMode === 'external') {
        if (deviceState === 'reading') return 'Reading'
        return 'Exposing'
      }
      return 'Capturing'
    case 'parked':
      return 'Parked'
  }
}

function projectSurface(target: TargetSummary | null): WorkspaceSurface {
  if (!target) return { kind: 'idle', label: 'Idle' }
  if (target.type === 'dso') return { kind: 'deepsky', label: 'Deep sky' }
  return { kind: 'solar', label: 'Solar system' }
}

function projectActions(
  state: WorkspaceState,
  capabilities: DeviceCapabilities | null,
  rigSupport: RigSupport | null,
): WorkspaceAction[] {
  if (state === 'disconnected') {
    return [{ id: 'connect', label: 'Connect device', enabled: true }]
  }
  if (state === 'idle_no_target') {
    return [{ id: 'select-target', label: 'Select target', enabled: true }]
  }
  if (state === 'ready_to_slew') {
    return [{ id: 'retry-slew', label: 'Retry slew', enabled: true }]
  }
  if (state === 'preview_error') {
    return [{ id: 'retry-preview', label: 'Retry preview', enabled: true }]
  }
  if (state === 'preview_active') {
    return [{ id: 'stop-preview', label: 'Stop preview', enabled: true }]
  }
  if (state === 'capturing') {
    const label = rigSupport?.capture === 'external' ? 'Stop exposure' : 'Stop capture'
    return [{ id: 'stop-capture', label, enabled: true }]
  }
  if (state === 'on_target' || state === 'primed') {
    const actions: WorkspaceAction[] = []
    if (capabilities?.supportsLivePreview) {
      actions.push({ id: 'preview', label: 'Preview', enabled: true })
    }
    const captureTier = rigSupport?.capture
    if (captureTier === 'native') {
      actions.push({ id: 'capture', label: 'Capture', enabled: true })
    } else if (captureTier === 'external') {
      actions.push({ id: 'capture', label: 'Expose', enabled: true })
    }
    return actions
  }
  return []
}

export const StatusProjectorLive = Layer.effect(
  StatusProjector,
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const sessions = yield* SessionManager
    const geo = yield* GeoService

    return {
      snapshot: Effect.gen(function* () {
        const aggregate = yield* store.get
        const session = yield* sessions.getCurrent
        const deviceLocation = aggregate.device.location ?? null
        const geoLocation = deviceLocation ? null : yield* geo.lookup
        const effectiveLocation = deviceLocation ?? geoLocation
        const locationSource: 'device' | 'geoip' | undefined = deviceLocation
          ? 'device'
          : geoLocation
            ? 'geoip'
            : undefined
        return project(
          aggregate,
          session?.rig.capabilities ?? null,
          session?.health ?? null,
          effectiveLocation,
          locationSource,
          session
            ? {
                canPark: session.rig.mount !== undefined,
                canPoint: session.rig.pointing !== undefined,
                capture: session.rig.capture
                  ? 'native'
                  : session.rig.camera
                    ? 'external'
                    : 'unsupported',
              }
            : null,
        )
      }),
    }
  }),
)
