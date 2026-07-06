import { Effect, Context, Layer } from 'effect'
import { SessionAggregate } from './aggregate'
import {
  DesktopStatus,
  LiveSessionHealthState,
  TargetSummary,
  WorkspaceAction,
  WorkspaceCapabilities,
  WorkspaceProjection,
  WorkspaceState,
  WorkspaceSurface,
} from '../../../shared/api-v2'
import type { DeviceCapabilities } from '../device/device-plugin'
import { AggregateStore } from './aggregate-store'
import { SessionManager } from '../session/session-manager'

export interface StatusProjector {
  readonly snapshot: Effect.Effect<DesktopStatus>
}

export const StatusProjector =
  Context.GenericTag<StatusProjector>('StatusProjector')

function project(
  aggregate: SessionAggregate,
  capabilities: DeviceCapabilities | null,
  health: LiveSessionHealthState | null,
): DesktopStatus {
  return {
    session: { ...aggregate.session, health: health ?? undefined },
    capture: aggregate.capture,
    device: aggregate.device,
    library: aggregate.library,
    pointing: aggregate.pointing,
    preview: aggregate.preview,
    workspace: projectWorkspace(aggregate, capabilities),
    currentTarget: aggregate.currentTarget,
    lastUpdatedAt: aggregate.lastUpdatedAt,
    lastError: aggregate.session.lastError,
  }
}

function projectWorkspace(
  aggregate: SessionAggregate,
  capabilities: DeviceCapabilities | null,
): WorkspaceProjection {
  const state = projectState(aggregate)
  return {
    state,
    stateLabel: stateLabel(state),
    surface: projectSurface(aggregate.pointing.target ?? aggregate.currentTarget),
    capabilities: projectCapabilities(capabilities),
    actions: projectActions(state, capabilities),
  }
}

function projectCapabilities(
  capabilities: DeviceCapabilities | null,
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
    capture: capabilities.supportsStacking ? 'native' : 'unsupported',
    autofocus: capabilities.supportsAutofocus ? 'yes' : 'no',
    filterWheel: capabilities.supportsFilterWheel ? 'yes' : 'no',
    storage: capabilities.supportsStorageAccess ? 'yes' : 'no',
  }
}

function projectState(aggregate: SessionAggregate): WorkspaceState {
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
  if (aggregate.currentTarget) return 'on_target'
  if (aggregate.device.mountClosed) return 'parked'
  return 'idle_no_target'
}

function stateLabel(state: WorkspaceState): string {
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
    return [{ id: 'stop-capture', label: 'Stop capture', enabled: true }]
  }
  if (state === 'on_target') {
    const actions: WorkspaceAction[] = []
    if (capabilities?.supportsLivePreview) {
      actions.push({ id: 'preview', label: 'Preview', enabled: true })
    }
    if (capabilities?.supportsStacking) {
      actions.push({ id: 'capture', label: 'Capture', enabled: true })
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

    return {
      snapshot: Effect.gen(function* () {
        const aggregate = yield* store.get
        const session = yield* sessions.getCurrent
        return project(
          aggregate,
          session?.capabilities ?? null,
          session?.health ?? null,
        )
      }),
    }
  }),
)
