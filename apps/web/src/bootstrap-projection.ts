import type {
  BootstrapSnapshot,
  BootstrapSubsystemHealth,
  PlanWorkspaceProjection,
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
  const currentRun =
    activeRun._tag === 'Active'
      ? {
          target: activeRun.run.target,
          phase: phaseLabel(activeRun.run.phase),
          progress: `${Math.round(activeRun.run.progress)}% complete`,
          progressValue: activeRun.run.progress,
          progressMax: 100,
          sequenceProgress: `${activeRun.run.completedSequenceCount} completed sequences`,
          estimatedCompletion:
            'Estimated completion unavailable from bootstrap.',
        }
      : undefined
  const fresh = freshness === 'current'
  const hasEligibleAction = eligibleActionProjected(snapshot)
  const connection = fresh
    ? `Current bootstrap snapshot confirmed at ${snapshot.generatedAt}`
    : `${freshness === 'stale' ? 'Last-confirmed' : 'Reconnecting'} snapshot from ${snapshot.generatedAt}`
  const protection =
    fresh && hasEligibleAction
      ? 'Controls are service-projected and current-revision guarded.'
      : fresh
        ? 'Read-only: no eligible action is projected for this client.'
        : `Protected: ${reason ?? 'current service truth is unavailable'} Commands cannot be sent or replayed.`
  const shell: ShellView = {
    service: health[0]?.detail ?? 'Service health unknown',
    environment: 'Authoritative projection',
    attention: fresh ? attention(health) : 'attention',
    readOnly: !fresh || !hasEligibleAction,
    currentRun: currentRun && {
      ...currentRun,
      phase: fresh ? currentRun.phase : `Last-confirmed ${currentRun.phase}`,
      progress: fresh
        ? currentRun.progress
        : `Last-confirmed ${currentRun.progress}`,
      sequenceProgress: fresh
        ? currentRun.sequenceProgress
        : `Last-confirmed ${currentRun.sequenceProgress}`,
      estimatedCompletion: fresh
        ? currentRun.estimatedCompletion
        : `Last-confirmed ${currentRun.estimatedCompletion}`,
    },
    freshness: connection,
    controller: controller(snapshot),
    membership: membership(snapshot),
    presence: 'Presence unavailable from bootstrap.',
    attentionOwner: 'Attention owner unavailable from bootstrap.',
    capability: capability(snapshot, fresh, hasEligibleAction),
    protection,
    health,
  }
  return {
    shell,
    plan: plan(snapshot, freshness, reason),
    observe: observe(
      snapshot,
      freshness,
      reason,
      currentRun?.target ?? 'No active run',
    ),
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

function plan(
  snapshot: BootstrapSnapshot,
  freshness: 'current' | 'stale' | 'reconnecting',
  staleReason: string | undefined,
): Projection['plan'] {
  if (snapshot.plan === undefined)
    return {
      detailAvailable: false,
      title: 'Plan detail unavailable',
      readiness: 'Plan readiness is unavailable from the service snapshot.',
      detail:
        'Plan draft and revision detail are unavailable from this snapshot.',
      sequences: [],
    }
  const current = freshness === 'current'
  return {
    detailAvailable: true,
    title: 'Observing plan',
    readiness: current
      ? readiness(snapshot.plan.readiness)
      : `Last-confirmed ${readiness(snapshot.plan.readiness)}`,
    detail: current
      ? snapshot.plan.readinessSummary
      : `Current plan truth is unavailable. ${snapshot.plan.readinessSummary}`,
    sequences: snapshot.plan.sequences.map((sequence) => ({
      id: sequence.sequenceId,
      target: sequence.target,
      window: `${sequence.window.startsAt} – ${sequence.window.endsAt}`,
      capture: sequence.capture,
      readiness: sequence.viability,
    })),
    source: snapshot.plan,
    snapshotVersion: snapshot.snapshotVersion,
    ...(snapshot.activeRun._tag === 'Active'
      ? { runRevision: snapshot.activeRun.run.revision }
      : {}),
    ...(current && snapshot.membership.capability === 'controlCapable'
      ? {}
      : {
          actionReason: current
            ? 'This client is read-only.'
            : (staleReason ?? 'Current plan truth is unavailable.'),
        }),
  }
}

function readiness(value: PlanWorkspaceProjection['readiness']) {
  return value === 'ready'
    ? 'Ready'
    : value === 'readyWithLimitations'
      ? 'Ready with limitations'
      : 'Blocked'
}

function unavailableProjection(reason: string): Projection {
  return {
    shell: {
      service: 'Service unavailable',
      environment: 'Authoritative projection',
      attention: 'danger',
      readOnly: true,
      currentRun: undefined,
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
  const source = snapshot.observe
  if (fresh && source !== undefined) {
    const terminal = source.terminalOutcome
    const eligible = Object.values(source.actions).some(
      (action) => action._tag === 'Eligible',
    )
    const controlRequired = Object.values(source.actions).every(
      (action) =>
        action._tag === 'Ineligible' && action.reason === 'controlRequired',
    )
    return {
      detailAvailable: true,
      target: source.target,
      phase: phaseLabel(source.phase),
      status:
        terminal === undefined
          ? `Fake/fixture ${phaseLabel(source.phase).toLowerCase()} lifecycle is current.`
          : `Fake/fixture run ${terminal}; no physical capture is claimed.`,
      tone:
        terminal === 'completed'
          ? 'safe'
          : terminal === undefined
            ? 'attention'
            : 'neutral',
      evidence: `Sequence ${source.currentSequence + 1} of ${source.totalSequences}; ${source.completedSequences} completed.`,
      annotation: 'All attempt evidence is fake/fixture only.',
      heading:
        terminal === undefined
          ? eligible
            ? 'Manage the current fake/fixture run'
            : 'Monitor the current fake/fixture run'
          : 'Terminal fake/fixture outcome',
      trace: source.lifecycleFacts,
      facts: source.attemptFacts,
      lifecycle,
      ...(terminal !== undefined
        ? { recovery: 'Return to Plan to review the next accepted run.' }
        : controlRequired
          ? {
              recovery:
                'Another client holds control. This client is protected; monitor current service evidence.',
            }
          : !eligible
            ? {
                recovery:
                  'No action is currently eligible. Monitor current service evidence.',
              }
            : source.phase === 'paused' && source.resumablePhase !== undefined
              ? {
                  recovery: `Resume returns to ${phaseLabel(source.resumablePhase)}. Stop ends this fake/fixture run; park is policy only.`,
                }
              : source.phase === 'parkRequested'
                ? {
                    recovery:
                      'Park is policy only; no mount moved. Return to Plan when ready.',
                  }
                : {
                    recovery:
                      'Stop, skip, retry once, or request park only when currently eligible.',
                  }),
      source,
    }
  }
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

function eligibleActionProjected(snapshot: BootstrapSnapshot): boolean {
  return (
    Object.values(snapshot.plan?.actions ?? {}).some(
      (action) => action._tag === 'Eligible',
    ) ||
    Object.values(snapshot.observe?.actions ?? {}).some(
      (action) => action._tag === 'Eligible',
    )
  )
}

function capability(
  snapshot: BootstrapSnapshot,
  fresh: boolean,
  hasEligibleAction: boolean,
): string {
  if (snapshot.membership.capability === 'readOnly')
    return 'Read-only client / no eligible action'
  if (!fresh) return 'Control-capable client / controls protected until current'
  return hasEligibleAction
    ? 'Control-capable client / service-projected controls'
    : 'Control-capable client / no eligible action'
}

function phaseLabel(phase: string): string {
  return phase === 'parkRequested'
    ? 'Park requested'
    : `${phase[0]?.toUpperCase() ?? ''}${phase.slice(1)}`
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}
