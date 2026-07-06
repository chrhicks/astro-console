import type {
  CaptureProjection,
  LibraryProjection,
  PointingProjection,
  PreviewProjection,
  WorkspaceProjection,
} from '../../../shared/api-v2'
import type { ProjectionState } from './projection-store'

const IDLE_POINTING: PointingProjection = { phase: 'idle', target: null }

const NO_PREVIEW: PreviewProjection = {
  phase: 'none',
  source: 'none',
  active: false,
}

const NO_CAPTURE: CaptureProjection = { phase: 'idle' }

const NO_LIBRARY: LibraryProjection = {
  scope: 'current_target',
  assets: [],
  polling: false,
}

const DEFAULT_WORKSPACE: WorkspaceProjection = {
  state: 'disconnected',
  stateLabel: 'Disconnected',
  surface: { kind: 'idle', label: 'Idle' },
  capabilities: {
    preview: 'unsupported',
    capture: 'unsupported',
    autofocus: 'no',
    filterWheel: 'no',
    storage: 'no',
  },
  actions: [],
}

export function selectProjectionBoot(state: ProjectionState) {
  return {
    hydrated: state.hydrated,
    error: state.error,
    hasStatus: state.status !== null,
  }
}

export function selectSessionBarModel(state: ProjectionState) {
  const status = state.status

  return {
    phase: status?.session.phase ?? 'disconnected',
    host: status?.device.host,
    productModel: status?.device.productModel,
    reconnect: status?.session.reconnect,
    lastError: status?.lastError ?? null,
    discovering: status?.session.discovering ?? false,
    deviceId: status?.device.deviceId,
    pluginKind: status?.device.pluginKind,
    serialNumber: status?.device.serialNumber,
    firmwareVersion: status?.device.firmwareVersion,
    batteryPercent: status?.device.batteryPercent,
    tracking: status?.device.tracking,
    mountClosed: status?.device.mountClosed,
    location: status?.device.location,
    locationSource: status?.device.locationSource,
    deviceTimeLooksStale: status?.device.deviceTimeLooksStale,
    warnings: status?.device.warnings,
  }
}

export function selectCurrentTargetId(state: ProjectionState) {
  return state.status?.currentTarget?.id ?? null
}

export function selectInspectorModel(state: ProjectionState) {
  const status = state.status
  return {
    isConnected: status?.session.phase === 'connected',
    pointing: status?.pointing ?? IDLE_POINTING,
    currentTarget: status?.currentTarget ?? null,
    capture: status?.capture ?? NO_CAPTURE,
    preview: status?.preview ?? NO_PREVIEW,
    device: status?.device ?? {},
  }
}

export function selectWorkAreaModel(state: ProjectionState) {
  const status = state.status
  return {
    pointing: status?.pointing ?? IDLE_POINTING,
    currentTarget: status?.currentTarget ?? null,
    workspace: status?.workspace ?? DEFAULT_WORKSPACE,
    preview: status?.preview ?? NO_PREVIEW,
    capture: status?.capture ?? NO_CAPTURE,
    device: status?.device ?? {},
  }
}

export function selectLibraryModel(state: ProjectionState) {
  const status = state.status
  return {
    library: status?.library ?? NO_LIBRARY,
    currentTarget: status?.currentTarget ?? null,
  }
}

export function selectBrowseContextKey(state: ProjectionState) {
  const status = state.status
  return {
    phase: status?.session.phase ?? 'disconnected',
    pluginKind: status?.device.pluginKind ?? null,
    deviceId: status?.device.deviceId ?? null,
    location: status?.device.location ?? null,
  }
}
