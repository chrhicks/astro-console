import type { ProjectionState } from "./projection-store"

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