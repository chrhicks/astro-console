import {
  type Action,
  type ObserveView,
  type Projection,
  type ShellView,
} from './presentation'
import { AssetId } from './routes'

export const fixtureScenarios = [
  'rejected',
  'disconnected',
  'observe-preflight',
  'observe-acquire',
  'observe-verify',
  'observe-complete',
  'observe-recovery',
  'stale',
  'process-failure',
  'delivery-ready',
  'fresh',
] as const

export type FixtureScenario = (typeof fixtureScenarios)[number]

type FixtureState = {
  shell: Omit<
    ShellView,
    | 'readOnly'
    | 'capability'
    | 'currentRun'
    | 'membership'
    | 'presence'
    | 'attentionOwner'
    | 'health'
  > & {
    activeRun: string
    phase: string
    progress: string
  }
  observe: Omit<
    ObserveView,
    | 'detailAvailable'
    | 'target'
    | 'action'
    | 'annotation'
    | 'heading'
    | 'lifecycle'
  >
}

const fixtureStates = {
  rejected: {
    shell: {
      service: 'Development fixture / simulated rejection',
      environment: 'Clear / 12 C',
      attention: 'attention',
      activeRun: 'M31 / capture remains unchanged',
      phase: 'Capture',
      progress: '24 / 108 frames / no fixture action accepted',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection:
        'Protected: the fixture rejected the action; no intent was submitted.',
    },
    observe: {
      phase: 'Capture',
      status: 'Simulated action rejection; the run remains unchanged.',
      tone: 'attention',
      evidence:
        'Fixture rejection only; no service intent or physical action occurred.',
      trace: [
        'Preflight fixture recorded',
        'Capture fixture remains at exposure 25',
      ],
      facts: [
        'Fixture rejection is explicit',
        'No command service is connected',
      ],
    },
  },
  disconnected: {
    shell: {
      service: 'Rig disconnected / current truth unavailable',
      environment: 'Environment current state unavailable',
      attention: 'danger',
      activeRun: 'Current run unavailable',
      phase: 'Unavailable',
      progress: 'Current progress unavailable',
      freshness: 'Disconnected / no current authoritative truth',
      controller: 'Controller and control truth unavailable',
      protection: 'Protected: no command can be sent without current truth.',
    },
    observe: {
      phase: 'Unavailable',
      status: 'Rig disconnected; current run truth is unavailable.',
      tone: 'danger',
      evidence:
        'No current observation evidence is available while disconnected.',
      trace: ['No current lifecycle trace is available.'],
      facts: [
        'Rig connection unavailable',
        'Current controller and recovery facts unavailable',
      ],
    },
  },
  'observe-preflight': {
    shell: {
      service: 'Development fixture / preflight simulation',
      environment: 'Fixture conditions / not provider-read',
      attention: 'attention',
      activeRun: 'M31 / preflight fixture',
      phase: 'Preflight',
      progress: 'Fixture checklist / capture not started',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Preflight',
      status: 'Fixture preflight checklist is awaiting a provider read.',
      tone: 'attention',
      evidence: 'Fixture checklist only; physical readiness is not proven.',
      trace: ['Preflight: fixture conditions recorded', 'Acquire: not started'],
      facts: [
        'Mount state is not provider-read',
        'Storage forecast is fixture data',
      ],
    },
  },
  'observe-acquire': {
    shell: {
      service: 'Development fixture / acquire simulation',
      environment: 'Fixture conditions / not provider-read',
      attention: 'attention',
      activeRun: 'M31 / acquire fixture',
      phase: 'Acquire',
      progress: 'Fixture alignment sample / verification pending',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Acquire',
      status: 'Fixture alignment sample awaits verification.',
      tone: 'attention',
      evidence:
        'Fixture sample only; no image verification or physical proof is claimed.',
      trace: [
        'Preflight fixture recorded',
        'Acquire: fixture alignment sample awaiting verification',
      ],
      facts: ['Image verification is pending', 'No device command was issued'],
    },
  },
  'observe-verify': {
    shell: {
      service: 'Development fixture / verify simulation',
      environment: 'Fixture conditions / not provider-read',
      attention: 'attention',
      activeRun: 'M31 / verify fixture',
      phase: 'Verify',
      progress: 'Fixture sample / acceptance undecided',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Verify',
      status: 'Fixture verification is reviewing the acquired sample.',
      tone: 'attention',
      evidence:
        'Fixture review data only; no accepted physical frame is proven.',
      trace: [
        'Preflight fixture recorded',
        'Acquire fixture sample recorded',
        'Verify: fixture review pending',
      ],
      facts: [
        'Acceptance is undecided',
        'No capture evidence is provider-confirmed',
      ],
    },
  },
  'observe-complete': {
    shell: {
      service: 'Development fixture / completion simulation',
      environment: 'Fixture conditions / not provider-read',
      attention: 'safe',
      activeRun: 'M31 / completed fixture lifecycle',
      phase: 'Complete',
      progress: 'Fixture lifecycle complete / 0 physical frames claimed',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Complete',
      status: 'Fixture lifecycle completion is recorded.',
      tone: 'safe',
      evidence:
        'Fixture completion record only; it does not prove physical capture.',
      trace: [
        'Preflight fixture completed',
        'Acquire fixture completed',
        'Verify fixture completed',
      ],
      facts: ['Completion is simulated', 'No physical evidence is attached'],
    },
  },
  'observe-recovery': {
    shell: {
      service: 'Development fixture / recovery simulation',
      environment: 'Fixture conditions / not provider-read',
      attention: 'danger',
      activeRun: 'M31 / recovery fixture held at checkpoint',
      phase: 'Recover',
      progress: 'Fixture checkpoint / retry not started',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Recover',
      status: 'Fixture alignment verification failed; recovery is held.',
      tone: 'danger',
      evidence:
        'Fixture checkpoint only; no alignment failure is physically proven.',
      trace: [
        'Acquire: fixture alignment verification failed',
        'Recover: fixture checkpoint retained',
      ],
      facts: ['Retry scope is simulated', 'No retry has run'],
      recovery:
        'Fixture retry would start a bounded new attempt from the checkpoint.',
    },
  },
  stale: {
    shell: {
      service: 'Snapshot stale / reconnecting',
      environment: 'Clear / 12 C',
      attention: 'attention',
      activeRun: 'M31 / last-confirmed 24 of 108 frames',
      phase: 'Last-confirmed Capture',
      progress: 'Last-confirmed 24 / 108 frames / current progress unavailable',
      freshness: 'Last confirmed 42s ago / reconnecting',
      controller: 'Maya reconnecting; control not available',
      protection:
        'Protected: last-confirmed evidence is not current and no command replay is possible.',
    },
    observe: {
      phase: 'Last-confirmed Capture',
      status:
        'Last-confirmed capture evidence; current accumulation is unknown.',
      tone: 'attention',
      evidence:
        'Last-confirmed fixture: 24 accepted / 2 rejected; current evidence unavailable.',
      trace: [
        'Preflight fixture recorded',
        'Acquire fixture recorded',
        'Last-confirmed capture; current accumulation unknown',
      ],
      facts: [
        'Current rig state unavailable',
        'No command replay after reconnect',
      ],
    },
  },
  'process-failure': {
    shell: {
      service: 'Development fixture / process failure simulation',
      environment: 'Clear / 12 C',
      attention: 'danger',
      activeRun: 'M31 / capture fixture',
      phase: 'Capture',
      progress: '24 / 108 fixture frames',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Capture',
      status: 'Fixture capture trace remains available.',
      tone: 'safe',
      evidence:
        'Fixture capture counts only; no physical capture proof is claimed.',
      trace: [
        'Preflight fixture recorded',
        'Acquire fixture recorded',
        'Capture fixture held at 24 frames',
      ],
      facts: [
        'Process failure is isolated to the fixture session',
        'No rig action is available',
      ],
    },
  },
  'delivery-ready': {
    shell: {
      service: 'Development fixture / delivery-ready simulation',
      environment: 'Clear / 12 C',
      attention: 'safe',
      activeRun: 'M31 / capture fixture',
      phase: 'Capture',
      progress: '24 / 108 fixture frames',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Capture',
      status: 'Fixture capture trace remains available.',
      tone: 'safe',
      evidence:
        'Fixture capture counts only; no physical capture proof is claimed.',
      trace: [
        'Preflight fixture recorded',
        'Acquire fixture recorded',
        'Capture fixture held at 24 frames',
      ],
      facts: [
        'Delivery readiness applies to a fixture representation',
        'No rig action is available',
      ],
    },
  },
  fresh: {
    shell: {
      service: 'Development fixture / current simulation',
      environment: 'Clear / 12 C',
      attention: 'safe',
      activeRun: 'M31 / 24 of 108 fixture frames',
      phase: 'Capture',
      progress: '24 / 108 frames / fixture estimate 2h 18m remaining',
      freshness: 'Fixture snapshot / confirmed 2s ago',
      controller: 'Maya is the recorded controller',
      protection: 'Unavailable: simulation has no command service.',
    },
    observe: {
      phase: 'Capture',
      status: 'Fixture evidence is accumulating in the simulated trace.',
      tone: 'safe',
      evidence:
        'Fixture: 24 accepted / 2 rejected / latest HFR 2.12; not physical proof.',
      trace: [
        'Preflight fixture recorded',
        'Acquire fixture recorded',
        'Capture fixture exposure 25 accumulating',
      ],
      facts: ['Mount fact is fixture data', 'Storage forecast is fixture data'],
    },
  },
} satisfies Record<FixtureScenario, FixtureState>

export function parseFixtureScenario(value: string | null): FixtureScenario {
  switch (value) {
    case 'rejected':
    case 'disconnected':
    case 'observe-preflight':
    case 'observe-acquire':
    case 'observe-verify':
    case 'observe-complete':
    case 'observe-recovery':
    case 'stale':
    case 'process-failure':
    case 'delivery-ready':
    case 'fresh':
      return value
    default:
      return 'fresh'
  }
}

function action(
  label: string,
  scenario: FixtureScenario,
  state: FixtureState,
): Action {
  const protectedFixture =
    scenario === 'stale' ||
    scenario === 'disconnected' ||
    scenario === 'rejected'
  return {
    label,
    availability: protectedFixture ? 'protected' : 'unavailable',
    consequence: 'Simulation only; no service intent was submitted.',
    reason:
      scenario === 'rejected'
        ? 'Simulated rejection prevented the requested action.'
        : scenario === 'disconnected'
          ? 'Current truth is unavailable while the rig is disconnected.'
          : scenario === 'stale'
            ? 'Freshness is lost while accepted service work continues.'
            : 'Development fixture has no command service.',
    freshness: state.shell.freshness,
    controller: state.shell.controller,
    capability: 'Read-only fixture capability',
    protection: state.shell.protection,
  }
}

export function projectFixture(scenario: FixtureScenario): Projection {
  const state = fixtureStates[scenario]
  const scenarioAction = (label: string) => action(label, scenario, state)
  const failed = scenario === 'process-failure'
  const deliveryReady = scenario === 'delivery-ready'

  return {
    shell: {
      ...state.shell,
      readOnly: true,
      currentRun:
        scenario === 'disconnected'
          ? undefined
          : {
              target: state.shell.activeRun,
              phase: state.shell.phase,
              progress: state.shell.progress,
              progressValue: 24,
              progressMax: 108,
              sequenceProgress: 'Sequence 1 / 3',
              estimatedCompletion:
                scenario === 'fresh'
                  ? 'Fixture estimate: 2h 18m remaining.'
                  : 'Estimated completion unavailable in fixture.',
            },
      capability: 'Read-only fixture capability',
      membership: 'Fixture member',
      presence: 'Fixture presence',
      attentionOwner: 'Fixture attention owner',
      health: [
        {
          label: 'Fixture',
          state: 'simulated',
          summary: 'Fixture: simulated',
          detail: 'Development fixture / not service health',
          tone: 'neutral',
        },
      ],
    },
    plan: {
      detailAvailable: true,
      title: 'Three targets until dawn',
      readiness: 'Ready with limitation: NGC 7000 has a short usable window.',
      detail: 'Development fixture plan detail is read-only.',
      sequences: [
        {
          id: 'SQ-M31-L-01',
          target: 'M31 / Andromeda',
          window: '21:42–00:16',
          capture: 'Luminance / 108 frames',
          readiness: 'Ready',
        },
        {
          id: 'SQ-NGC7000-HA-01',
          target: 'NGC 7000',
          window: '00:24–02:38',
          capture: 'Hydrogen alpha',
          readiness: 'Limited',
        },
        {
          id: 'SQ-M45-RGB-01',
          target: 'M45 / Pleiades',
          window: '02:51–04:08',
          capture: 'RGB',
          readiness: 'Ready',
        },
      ],
      action: scenarioAction('Run plan'),
    },
    observe: {
      detailAvailable: true,
      target: 'M31 / Andromeda',
      annotation: state.observe.evidence,
      heading: state.observe.status,
      lifecycle: [
        'Preflight',
        'Acquire',
        'Capture',
        'Verify',
        'Recover',
        'Complete',
      ],
      ...state.observe,
      action: scenarioAction('Recenter after exposure'),
    },
    library: {
      assets: [
        {
          id: AssetId.make('asset-frame-m31-l-186'),
          name: 'M31_L_0186.fits',
          review: 'Accepted',
          lineage: 'R-25JUL-01 → SQ-M31-L-01 → ES-M31-L-01',
          representation: 'Local original retained',
          download: deliveryReady
            ? 'Fixture representation ready to download'
            : 'Download representation unavailable in fixture',
        },
        {
          id: AssetId.make('asset-frame-m31-l-188'),
          name: 'M31_L_0188.fits',
          review: 'Rejected',
          lineage: 'R-25JUL-01 → SQ-M31-L-01 → ES-M31-L-01',
          representation: 'Local original retained',
          download: 'Authorization facts unavailable in fixture',
        },
      ],
      action: scenarioAction('Open in Process'),
    },
    process: {
      detailAvailable: true,
      sessionId: 'session-m31-v3',
      label: 'M31 linear master v3',
      source: 'asset-frame-m31-l-186 / stable raw identity',
      steps: [
        { label: 'Build', status: 'Aligned 24 frames' },
        { label: 'Develop', status: 'Gradient removal' },
        { label: 'History', status: 'Current position 3' },
        { label: 'Inspector', status: 'Measured evidence' },
      ],
      preview: failed
        ? 'Fixture preview did not apply; prior valid image remains visible.'
        : 'Preview is separate from applied history.',
      checkpoint: failed
        ? 'CP-M31-STRETCH-03 / fixture last valid linear image'
        : 'CP-M31-DEVELOP-02 / fixture current valid image',
      diagnostics: failed
        ? 'Fixture Stretch / attempt 2 / owner-safe output available'
        : 'Tool, version, inputs, and parameters require a service session.',
      ...(failed
        ? {
            failure:
              'Fixture Stretch failed after preview; Build and the last valid image are preserved.',
          }
        : {}),
      action: scenarioAction(
        failed ? 'Retry Stretch from checkpoint' : 'Preview',
      ),
    },
  }
}

export const fixtureProjection = projectFixture(
  parseFixtureScenario(
    new URLSearchParams(globalThis.location?.search).get('fixture'),
  ),
)
