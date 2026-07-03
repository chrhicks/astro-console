import type { PointingProjection } from '../../../shared/api-v2'
import type { ProjectionState } from './projection-store'

const IDLE_POINTING: PointingProjection = { phase: 'idle', target: null }

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
  }
}

export function selectWorkAreaModel(state: ProjectionState) {
  const status = state.status
  return {
    pointing: status?.pointing ?? IDLE_POINTING,
    currentTarget: status?.currentTarget ?? null,
  }
}

export function selectBrowseContextKey(state: ProjectionState) {
  const status = state.status
  return {
    phase: status?.session.phase ?? 'disconnected',
    pluginKind: status?.device.pluginKind ?? null,
    deviceId: status?.device.deviceId ?? null,
    observerContext: status?.observerContext ?? null,
  }
}
