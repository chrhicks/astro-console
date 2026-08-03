import type {
  BootstrapSnapshot,
  BootstrapSubsystemHealth,
} from '@astro-console/v2-contracts'
import {
  BootstrapClientState,
  type BootstrapClientState as ClientState,
} from './bootstrap-client'
import type {
  HealthFact,
  ObserveView,
  Projection,
  ShellView,
  StatusTone,
} from './presentation'

export function projectBootstrapState(state: ClientState): Projection {
  return BootstrapClientState.$match(state, {
    Current: ({ snapshot }) => projectSnapshot(snapshot, 'current'),
    Stale: ({ snapshot, reason }) => projectSnapshot(snapshot, 'stale', reason),
    Reconnecting: ({ snapshot, reason }) =>
      projectSnapshot(snapshot, 'reconnecting', reason),
    Unavailable: ({ reason }) => unavailableProjection(reason),
  })
}

function projectSnapshot(
  snapshot: BootstrapSnapshot,
  freshness: 'current' | 'stale' | 'reconnecting',
  reason?: string,
): Projection {
  const health = healthFacts(snapshot)
  const activeRun = snapshot.activeRun
  const run =
    activeRun._tag === 'Active'
      ? {
          activeRun: `${activeRun.run.target} / ${phaseLabel(activeRun.run.phase)}`,
          phase: phaseLabel(activeRun.run.phase),
          progress: `${Math.round(activeRun.run.progress)}% complete`,
          progressValue: activeRun.run.progress,
          sequenceProgress: `${activeRun.run.completedSequenceCount} completed sequences`,
          target: activeRun.run.target,
        }
      : {
          activeRun: 'No active run',
          phase: 'Idle',
          progress: 'No active run progress',
          progressValue: 0,
          sequenceProgress: 'No completed sequence information',
          target: 'No active run',
        }
  const fresh = freshness === 'current'
  const connection = fresh
    ? `Current bootstrap snapshot confirmed at ${snapshot.generatedAt}`
    : `${freshness === 'stale' ? 'Last-confirmed' : 'Reconnecting'} snapshot from ${snapshot.generatedAt}`
  const protection = fresh
    ? 'Read-only: detailed workspace and command projections are not available from bootstrap.'
    : `Protected: ${reason ?? 'current service truth is unavailable'} Commands cannot be sent or replayed.`
  const shell: ShellView = {
    service: health[0]?.detail ?? 'Service health unknown',
    environment: 'Authoritative projection',
    attention: fresh ? attention(health) : 'attention',
    readOnly: true,
    activeRun: run.activeRun,
    phase: fresh ? run.phase : `Last-confirmed ${run.phase}`,
    progress: fresh ? run.progress : `Last-confirmed ${run.progress}`,
    progressValue: run.progressValue,
    progressMax: 100,
    sequenceProgress: fresh
      ? run.sequenceProgress
      : `Last-confirmed ${run.sequenceProgress}`,
    freshness: connection,
    controller: controller(snapshot),
    membership: membership(snapshot),
    presence: 'Presence unavailable from bootstrap.',
    attentionOwner: 'Attention owner unavailable from bootstrap.',
    capability: capability(snapshot),
    protection,
    health,
  }
  return {
    shell,
    plan: {
      detailAvailable: false,
      title: 'Plan detail unavailable',
      readiness:
        'Bootstrap does not include Plan readiness or sequence detail.',
      detail: 'Plan draft and revision detail are unavailable from bootstrap.',
      sequences: [],
    },
    observe: observe(snapshot, freshness, reason, run.target),
    library: { assets: [] },
    process: {
      detailAvailable: false,
      sessionId: 'Unavailable',
      label: 'Processing detail unavailable',
      source: 'Bootstrap does not include processing session detail.',
      steps: [
        { label: 'Build', status: 'Unavailable from bootstrap' },
        { label: 'Develop', status: 'Unavailable from bootstrap' },
      ],
      preview: 'No processing preview is included in bootstrap.',
      checkpoint: 'No processing checkpoint is included in bootstrap.',
      diagnostics: 'Processing detail is unavailable from bootstrap.',
    },
  }
}

function unavailableProjection(reason: string): Projection {
  return {
    shell: {
      service: 'Service unavailable',
      environment: 'Authoritative projection',
      attention: 'danger',
      readOnly: true,
      activeRun: 'Active run unknown',
      phase: 'Unavailable',
      progress: 'No authoritative progress evidence',
      progressValue: 0,
      progressMax: 100,
      sequenceProgress: 'Sequence progress unavailable',
      freshness: 'No authoritative snapshot',
      controller: 'Controller unknown',
      membership: 'Membership unknown',
      presence: 'Presence unknown',
      attentionOwner: 'Attention owner unknown',
      capability: 'Capability unknown / mutations unavailable',
      protection: `Protected: ${reason} Commands cannot be sent or replayed.`,
      health: [
        {
          label: 'Service',
          state: 'unavailable',
          summary: 'Service: unavailable',
          detail: 'Service availability unknown without a snapshot.',
          tone: 'danger',
        },
      ],
    },
    plan: {
      detailAvailable: false,
      title: 'Plan unavailable',
      readiness: 'Readiness unavailable without a service snapshot.',
      detail:
        'Plan draft and revision detail are unavailable without a snapshot.',
      sequences: [],
    },
    observe: {
      detailAvailable: false,
      target: 'Observe unavailable',
      phase: 'Unavailable',
      status: 'No authoritative run evidence',
      tone: 'danger',
      evidence: 'Reconnect to load a complete service snapshot.',
      annotation: 'No image-derived evidence is available.',
      heading: 'Current run truth is unavailable',
      trace: ['No service lifecycle trace is available.'],
      facts: ['Rig, control, and recovery facts are unavailable.'],
      lifecycle: lifecycle,
    },
    library: { assets: [] },
    process: {
      detailAvailable: false,
      sessionId: 'Unavailable',
      label: 'No processing session',
      source: 'No source asset',
      steps: [
        { label: 'Build', status: 'Unavailable' },
        { label: 'Develop', status: 'Unavailable' },
      ],
      preview: 'Preview unavailable',
      checkpoint: 'No checkpoint',
      diagnostics: 'No diagnostics',
    },
  }
}

const lifecycle = [
  'Preflight',
  'Acquire',
  'Capture',
  'Verify',
  'Recover',
  'Complete',
]

function observe(
  snapshot: BootstrapSnapshot,
  freshness: 'current' | 'stale' | 'reconnecting',
  reason: string | undefined,
  target: string,
): ObserveView {
  const fresh = freshness === 'current'
  return {
    detailAvailable: false,
    target,
    phase:
      snapshot.activeRun._tag === 'Active'
        ? fresh
          ? phaseLabel(snapshot.activeRun.run.phase)
          : `Last-confirmed ${phaseLabel(snapshot.activeRun.run.phase)}`
        : 'Idle',
    status: fresh
      ? 'Bootstrap supplies active-run summary only.'
      : `Last-confirmed run summary only. ${reason ?? 'Current run truth is unavailable.'}`,
    tone: fresh ? attention(healthFacts(snapshot)) : 'attention',
    evidence: fresh
      ? 'Detailed Observe evidence is unavailable from bootstrap.'
      : 'Current Observe evidence is unavailable while freshness is lost.',
    annotation: 'No image-derived evidence is included in bootstrap.',
    heading: fresh
      ? 'Detailed Observe projection unavailable'
      : 'Current Observe projection unavailable',
    trace: [
      fresh
        ? 'Bootstrap supplies the service-owned run summary.'
        : 'Accepted service work may continue; current evidence is unavailable.',
    ],
    facts: [
      `Rig: ${healthFacts(snapshot)[1]?.detail ?? 'unknown'}`,
      `Controller: ${controller(snapshot)}`,
    ],
    lifecycle,
  }
}

function healthFacts(snapshot: BootstrapSnapshot): readonly HealthFact[] {
  const facts: readonly [string, BootstrapSubsystemHealth][] = [
    ['Service', snapshot.health.service],
    ['Rig', snapshot.health.rig],
    ['Tunnel', snapshot.health.tunnel],
    ['Processing', snapshot.health.processing],
    ['Publication', snapshot.health.publication],
    ['Storage', snapshot.health.storage],
  ]
  return facts.map(([label, health]) => ({
    label,
    state: health.state,
    summary: `${label}: ${health.state}`,
    detail: `${label} ${health.state}${health.reason ? `: ${health.reason}` : ''}`,
    tone: healthTone(health),
  }))
}

function healthTone(health: BootstrapSubsystemHealth): StatusTone {
  switch (health.state) {
    case 'healthy':
      return 'safe'
    case 'degraded':
    case 'stale':
      return 'attention'
    case 'unavailable':
      return 'danger'
    case 'unknown':
      return 'neutral'
  }
}

function attention(health: readonly HealthFact[]): StatusTone {
  if (health.some((fact) => fact.tone === 'danger')) return 'danger'
  if (health.some((fact) => fact.tone === 'attention')) return 'attention'
  if (health.some((fact) => fact.tone === 'safe')) return 'safe'
  return 'neutral'
}

function controller(snapshot: BootstrapSnapshot): string {
  const control = snapshot.control
  if (control.state === 'unheld') return 'No active controller'
  const holder = control.holderClientId === snapshot.membership.clientId
  if (control.state === 'reconnecting')
    return holder
      ? 'This controller is reconnecting'
      : 'Controller is reconnecting'
  return holder ? 'This client holds control' : 'Another client holds control'
}

function membership(snapshot: BootstrapSnapshot): string {
  return `${capitalize(snapshot.membership.role)} member`
}

function capability(snapshot: BootstrapSnapshot): string {
  return snapshot.membership.capability === 'controlCapable'
    ? 'Control-capable client / commands unavailable from bootstrap'
    : 'Read-only client'
}

function phaseLabel(phase: string): string {
  return phase === 'parkRequested'
    ? 'Park requested'
    : `${phase[0]?.toUpperCase() ?? ''}${phase.slice(1)}`
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}
