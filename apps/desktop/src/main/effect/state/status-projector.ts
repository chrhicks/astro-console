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
import { AggregateStore } from './aggregate-store'
import { GeoService } from '../geo/geo-service'
import { SessionManager } from '../session/session-manager'
import type { ConnectedRig } from '../rig/rig-model'
import { isCaptureInFlight } from '../../../shared/lifecycle'

export interface StatusProjector {
  readonly snapshot: Effect.Effect<DesktopStatus>
}

export const StatusProjector =
  Context.GenericTag<StatusProjector>('StatusProjector')

interface RigSupport {
  canPark: boolean
  canPoint: boolean
  preview: boolean
  capture: WorkspaceCapabilityTier
  darkExposure: boolean
  autofocus: boolean
  filterWheel: boolean
  storage: boolean
}

export function projectRigSupport(rig: ConnectedRig): RigSupport {
  return {
    canPark: rig.mount?.park !== undefined,
    canPoint: rig.pointing !== undefined,
    preview: rig.preview !== undefined,
    capture: rig.capture ? 'native' : rig.camera ? 'external' : 'unsupported',
    darkExposure: rig.camera?.startDarkExposure !== undefined,
    autofocus: rig.autofocus !== undefined,
    filterWheel: rig.filterWheel !== undefined,
    storage: rig.storage !== undefined,
  }
}

function project(
  aggregate: SessionAggregate,
  health: LiveSessionHealthState | null,
  effectiveLocation: { lat: number; lon: number } | null,
  locationSource: 'device' | 'geoip' | undefined,
  rigSupport: RigSupport | null,
  sessionActive: boolean,
): DesktopStatus {
  const device: DeviceProjection = effectiveLocation
    ? { ...aggregate.device, location: effectiveLocation, locationSource }
    : aggregate.device
  const projectedDevice: DeviceProjection = {
    ...device,
    canPark: rigSupport?.canPark,
    canPoint: rigSupport?.canPoint,
  }
  // When the aggregate's session identity does not match the current session,
  // override the phase to disconnected so the renderer never sees a stale
  // connected state for a session that has been replaced or closed. The
  // internal sessionId is deliberately omitted from the renderer projection.
  const phase = sessionActive ? aggregate.session.phase : 'disconnected'
  return {
    session: {
      phase,
      host: projectedDevice.host,
      productModel: projectedDevice.productModel,
      discovering: aggregate.session.discovering,
      health: sessionActive ? health ?? undefined : undefined,
    },
    capture: aggregate.capture,
    device: projectedDevice,
    library: aggregate.library,
    pointing: aggregate.pointing,
    preview: aggregate.preview,
    workspace: projectWorkspace(aggregate, rigSupport, sessionActive),
    camera: aggregate.camera ?? undefined,
    sequence: aggregate.sequence,
    currentTarget: aggregate.currentTarget,
    statusRevision: aggregate.statusRevision,
    lastUpdatedAt: aggregate.lastUpdatedAt,
    lastError: aggregate.session.lastError,
  }
}

function projectWorkspace(
  aggregate: SessionAggregate,
  rigSupport: RigSupport | null,
  sessionActive: boolean,
): WorkspaceProjection {
  const projectedCapabilities = projectCapabilities(rigSupport)
  const state = projectState(aggregate, projectedCapabilities, sessionActive)
  return {
    state,
    stateLabel: stateLabel(
      state,
      aggregate.capture.mode,
      aggregate.capture.deviceState,
    ),
    surface: projectSurface(aggregate.pointing.target ?? aggregate.currentTarget),
    capabilities: projectedCapabilities,
    actions: projectActions(state, rigSupport),
  }
}

function projectCapabilities(
  rigSupport: RigSupport | null,
): WorkspaceCapabilities {
  if (!rigSupport) {
    return {
      preview: 'unsupported',
      capture: 'unsupported',
      darkExposure: 'no',
      autofocus: 'no',
      filterWheel: 'no',
      storage: 'no',
    }
  }
  return {
    preview: rigSupport.preview ? 'native' : 'unsupported',
    capture: rigSupport.capture,
    darkExposure: rigSupport.darkExposure ? 'yes' : 'no',
    autofocus: rigSupport.autofocus ? 'yes' : 'no',
    filterWheel: rigSupport.filterWheel ? 'yes' : 'no',
    storage: rigSupport.storage ? 'yes' : 'no',
  }
}

function projectState(
  aggregate: SessionAggregate,
  capabilities: WorkspaceCapabilities,
  sessionActive: boolean,
): WorkspaceState {
  if (!sessionActive || aggregate.session.phase !== 'connected') return 'disconnected'
  if (isCaptureInFlight(aggregate.capture.phase)) {
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
    if (rigSupport?.preview) {
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
        // Correlate the aggregate's session identity with the current session
        // so the projector never reports connected for a stale or absent
        // session. The sessionId is set by the connect workflow when a session
        // is installed and cleared by the disconnect workflow.
        const sessionActive =
          session !== null && aggregate.session.sessionId === session.sessionId
        const resolvedLocation = yield* geo.resolveObserverLocation(
          sessionActive ? session?.rig.observerLocation : undefined,
        )
        return project(
          aggregate,
          sessionActive ? session?.health ?? null : null,
          resolvedLocation.location,
          resolvedLocation.source,
          sessionActive
            ? projectRigSupport(session!.rig)
            : null,
          sessionActive,
        )
      }),
    }
  }),
)
