import type {
  ObserveWorkspaceProjection,
  PlanWorkspaceProjection,
  RunSequenceDefinition,
} from '@astro-console/protocol'

export const planSequencePresentation = (
  definition: typeof RunSequenceDefinition.Type,
) => ({
  target: definition.targetName,
  capture: `${definition.frameCount} × ${definition.exposureSeconds}s · ${definition.filterName ?? 'No filter'}`,
  acquisition:
    definition.acquisitionMode === 'cameraOnly'
      ? 'Camera only; no pointing acquisition.'
      : 'Solve, center, focus, then start capture.',
  stopCondition: `Stop after ${definition.frameCount} verified frame${definition.frameCount === 1 ? '' : 's'}.`,
  estimatedMinutes: Math.max(
    1,
    Math.ceil(definition.estimatedDurationSeconds / 60),
  ),
  storageForecastMb: Math.ceil(definition.estimatedStorageBytes / 1_000_000),
})

export const planSequenceWindow = (
  definition: typeof RunSequenceDefinition.Type,
  observed: {
    readonly startsAt: string
    readonly endsAt: string
    readonly usableMinutes: number
    readonly peakAltitudeDeg: number
    readonly horizonClearanceDeg: number
  },
) => {
  const startsAt = definition.earliestStart ?? observed.startsAt
  const endsAt = definition.latestEnd ?? observed.endsAt
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)
  return {
    ...observed,
    startsAt,
    endsAt,
    usableMinutes:
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Math.min(observed.usableMinutes, Math.floor((end - start) / 60_000))
        : observed.usableMinutes,
  }
}

export type Workspace = 'plan' | 'observe' | 'library' | 'process'
export type StatusTone = 'safe' | 'attention' | 'danger' | 'neutral'
export type HealthFact = {
  label: string
  state: string
  summary: string
  detail: string
  tone: StatusTone
}

export type ShellView = {
  service: string
  environment: string
  attention: StatusTone
  readOnly: boolean
  currentRun:
    | {
        target: string
        phase: string
        progress: string
        progressValue: number
        progressMax: number
        sequenceProgress: string
        estimatedCompletion: string
      }
    | undefined
  freshness: string
  controller: string
  membership: string
  remoteAvailability: string
  authority: string
  presence: string
  attentionOwner: string
  capability: string
  protection: string
  control: {
    revision: number
    state: string
    presence: string
    readOnly: boolean
    requests: readonly {
      requestId: string
      clientId: string
      label: string
    }[]
    actions: readonly (
      | { kind: 'request'; label: string }
      | { kind: 'release'; label: string }
      | { kind: 'take'; label: string }
      | {
          kind: 'grant' | 'decline'
          label: string
          requestId: string
          targetClientId?: string
        }
    )[]
  }
  health: readonly HealthFact[]
}
export type PlanSequenceView = {
  id: string
  target: string
  capture: string
  acquisition: string
  stopCondition: string
  windowStart: string
  windowEnd: string
  usableMinutes: number
  estimatedMinutes: number
  storageForecastMb: number
  peakAltitudeDeg: number
  horizonClearanceDeg: number
  horizon: 'clear' | 'limited' | 'blocked' | 'missing'
  storage: 'available' | 'limited' | 'blocked' | 'missing'
  viability: 'viable' | 'limited' | 'blocked'
}
export type PlanView = {
  detailAvailable: boolean
  title: string
  readiness: string
  tone: StatusTone
  detail: string
  sequences: readonly PlanSequenceView[]
  source?: PlanWorkspaceProjection
  actionReason?: string
  snapshotVersion?: number
  runRevision?: number
}
export type ObserveView = {
  detailAvailable: boolean
  target: string
  phase: string
  status: string
  tone: StatusTone
  evidence: string
  annotation: string
  heading: string
  trace: readonly string[]
  facts: readonly string[]
  lifecycle: readonly string[]
  recovery?: string
  source?: ObserveWorkspaceProjection
  leaseRevision?: number
  snapshotVersion?: number
}
export type Projection = {
  snapshotVersion: number
  libraryProcessMutation: { allowed: true } | { allowed: false; reason: string }
  shell: ShellView
  plan: PlanView
  observe: ObserveView
}
