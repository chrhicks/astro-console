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
    host: status?.session.host,
    productModel: status?.session.productModel,
    reconnect: status?.session.reconnect,
    lastError: status?.lastError ?? null,
    discovering: status?.session.discovering ?? false,
  }
}