import type { ObserveWorkspaceProjection } from '@astro-console/v2-contracts'

export type ObserveOperation = {
  readonly id: number
  readonly runId: string
  readonly revision: number
}

export function beginObserveOperation(
  active: ObserveOperation | undefined,
  source: ObserveWorkspaceProjection | undefined,
  id: number,
) {
  if (active !== undefined || source === undefined) return undefined
  return { id, runId: source.runId, revision: source.revision }
}

export function isCurrentObserveOperation(
  active: ObserveOperation | undefined,
  source: ObserveWorkspaceProjection | undefined,
  operation: ObserveOperation,
) {
  return (
    active?.id === operation.id &&
    source?.runId === operation.runId &&
    source.revision === operation.revision
  )
}
