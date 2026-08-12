import {
  ActionPanel,
  AttemptTrail,
  AttentionCard,
  DataList,
  DataListItem,
  EvidenceViewport,
  MetricOverlay,
  Panel,
  PanelBody,
  PanelHeader,
  StatusIndicator,
  StepRail,
  type ActionDescriptor,
  type AttemptItem,
  type StepItem,
  type Tone,
} from '@nightbook/ui'
import {
  IdempotencyKey,
  type ObserveWorkspaceProjection,
} from '@astro-console/protocol'
import { useEffect, useMemo, useState } from 'react'
import {
  ObserveCommandSubmission,
  type ObserveAction,
} from '../observe-command-client'
import type { PreflightRefreshSubmission } from '../preflight-refresh-client'
import type { ObserveView, Projection, StatusTone } from '../presentation'
import { nightbookHref } from '../route-href'
import { CommandBar, type ControlSubmit } from './shared-shell'
import '@nightbook/ui/styles.css'
import './workspace.css'

export type ObserveWorkspaceProps = {
  projection: Projection
  loading: boolean
  submit?: (
    action: ObserveAction,
    key: typeof IdempotencyKey.Type,
  ) => Promise<ObserveCommandSubmission>
  refreshPreflight?: () => Promise<PreflightRefreshSubmission>
  targetAcquisitionCommand?: () => Promise<void>
  acquireRecoveryCommand?: (
    action:
      | 'RetryPlateSolveWithParameters'
      | 'SkipAcquireTarget'
      | 'AbortAcquire',
  ) => Promise<void>
  approvePointingCorrection?: (proposalId: string) => Promise<void>
  submitControl?: ControlSubmit
}

const lifecycleStages = [
  { id: 'preflight', label: 'Preflight' },
  { id: 'session-acquire', label: 'Session acquire' },
  { id: 'target-acquire', label: 'Target acquire' },
  { id: 'capture', label: 'Capture' },
  { id: 'recover', label: 'Recover' },
  { id: 'complete', label: 'Complete' },
] as const

const tone = (value: StatusTone): Tone => {
  switch (value) {
    case 'safe':
      return 'positive'
    case 'attention':
      return 'warning'
    case 'danger':
      return 'danger'
    case 'neutral':
      return 'neutral'
  }
}

const titleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())

const lifecycle = (view: ObserveView) => {
  const phase = view.source?.phase
  const acquire = view.source?.acquire
  const targetAcquisition = acquire?.acquisitionMethod !== undefined
  const activeId =
    targetAcquisition &&
    (acquire.phase === 'paused' ||
      acquire.phase === 'skipped' ||
      acquire.phase === 'aborted')
      ? 'recover'
      : targetAcquisition &&
          (acquire.phase === 'solving' ||
            acquire.phase === 'correcting' ||
            acquire.phase === 'verifying' ||
            acquire.phase === 'awaitingApproval')
        ? 'target-acquire'
        : acquire?.mode === 'polar' && phase === 'acquire'
          ? 'session-acquire'
          : phase === 'preflight'
            ? 'preflight'
            : phase === 'acquire'
              ? 'target-acquire'
              : phase === 'capture'
                ? 'capture'
                : phase === 'paused' ||
                    phase === 'stopped' ||
                    phase === 'parkRequested'
                  ? 'recover'
                  : phase === 'verify'
                    ? 'capture'
                    : phase === 'completed'
                      ? 'complete'
                      : undefined
  const activeIndex = lifecycleStages.findIndex(({ id }) => id === activeId)
  const items: StepItem[] = lifecycleStages.map((stage, index) => ({
    ...stage,
    status:
      activeIndex < 0
        ? 'pending'
        : stage.id === 'recover' &&
            (phase === 'stopped' || phase === 'parkRequested')
          ? 'failed'
          : index < activeIndex
            ? 'complete'
            : index === activeIndex
              ? phase === 'completed'
                ? 'complete'
                : 'current'
              : 'pending',
  }))
  return { activeId, activeIndex, items }
}

const lifecycleLabel = (view: ObserveView) => {
  if (view.source?.phase === 'verify') return 'Verify'
  const state = lifecycle(view)
  return state.activeIndex < 0
    ? titleCase(view.phase)
    : (lifecycleStages[state.activeIndex]?.label ?? titleCase(view.phase))
}

const usePhoneProjection = () => {
  const query = '(max-width: 600px)'
  const [phone, setPhone] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(query).matches,
  )
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

const runProgress = (projection: Projection) => {
  const run = projection.shell.currentRun
  return run === undefined
    ? { value: 0, max: 100, label: 'No active run', pending: true }
    : {
        value: run.progressValue,
        max: run.progressMax,
        label: run.sequenceProgress,
        pending: false,
      }
}

const observeProgress = (projection: Projection) => {
  if (projection.observe.source?.acquire?.acquisitionMethod === undefined)
    return runProgress(projection)
  const state = lifecycle(projection.observe)
  return state.activeIndex < 0
    ? runProgress(projection)
    : {
        value: state.activeIndex + 1,
        max: lifecycleStages.length,
        label: lifecycleLabel(projection.observe),
        pending: false,
      }
}

const progressPercent = (progress: ReturnType<typeof runProgress>) =>
  progress.pending || progress.max <= 0
    ? undefined
    : Math.round((progress.value / progress.max) * 100)

function Progress({
  progress,
  showValue = false,
}: {
  progress: ReturnType<typeof runProgress>
  showValue?: boolean
}) {
  const percent = progressPercent(progress)
  return (
    <div className="nightbook-progress">
      <div>
        <span>{progress.label}</span>
        {showValue && percent !== undefined ? <b>{percent}%</b> : null}
      </div>
      <progress
        aria-label={progress.label}
        max={progress.max}
        value={progress.pending ? undefined : progress.value}
      />
    </div>
  )
}

const evidenceStatusLabel = (view: ObserveView) => {
  switch (view.tone) {
    case 'danger':
      return 'Blocker'
    case 'attention':
      return 'Needs attention'
    case 'safe':
      return 'Verified'
    case 'neutral':
      return 'Current evidence'
  }
}

const Evidence = ({ view }: { view: ObserveView }) => (
  <figure className="nightbook-evidence" aria-label="Current Observe evidence">
    <div className="nightbook-evidence-canvas">
      <div
        className="nightbook-evidence-copy"
        role="group"
        aria-label="Evidence facts"
      >
        <StatusIndicator
          label={view.status}
          tone={tone(view.tone)}
          detail={view.phase}
        />
        <p>{view.evidence}</p>
        {view.trace.length > 0 ? (
          <ol className="nightbook-trace" aria-label="Current evidence trace">
            {view.trace.slice(0, 3).map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
    <figcaption>{view.annotation}</figcaption>
  </figure>
)

const EvidenceFacts = ({ view }: { view: ObserveView }) => {
  const checks = view.source?.preflight?.checks ?? []
  return (
    <DataList aria-label="Observe evidence details">
      {checks.length > 0
        ? checks.map((check) => (
            <DataListItem
              key={check.key}
              label={titleCase(check.key)}
              value={titleCase(check.state)}
              detail={check.reason}
            />
          ))
        : view.facts.map((fact, index) => (
            <DataListItem
              key={`${index}-${fact}`}
              label={`Fact ${index + 1}`}
              value={fact}
            />
          ))}
    </DataList>
  )
}

type AcquireView = NonNullable<NonNullable<ObserveView['source']>['acquire']>
type AcquireAction = AcquireView['actions'][number]['action']

const acquireActionAvailable = (acquire: AcquireView, action: AcquireAction) =>
  acquire.actions.some(
    (candidate) =>
      candidate._tag === 'Available' && candidate.action === action,
  )

const acquireTone = (acquire: AcquireView): Tone => {
  switch (acquire.phase) {
    case 'completed':
      return 'positive'
    case 'paused':
    case 'awaitingApproval':
    case 'verifying':
      return 'warning'
    case 'aborted':
      return 'danger'
    case 'skipped':
      return 'neutral'
    default:
      return 'info'
  }
}

const attemptItems = (acquire: AcquireView): AttemptItem[] => {
  const items: AttemptItem[] = []
  const evidence = acquire.latestEvidence
  if (evidence !== undefined) {
    const failed = evidence._tag === 'NoSolution'
    const detail =
      evidence._tag === 'NoSolution'
        ? `${titleCase(evidence.category)} · ${evidence.diagnosticRef}`
        : evidence._tag === 'PolarMeasurement'
          ? `${evidence.sourceFrameAssetId} · ${evidence.totalErrorArcsec.toFixed(1)}″ polar error`
          : `${evidence.sourceFrameAssetId} · ${evidence.magnitudeArcsec.toFixed(1)}″ error`
    items.push({
      id: evidence.attemptId,
      label: `Attempt ${Math.max(1, acquire.attemptCount)}`,
      detail,
      meta: titleCase(evidence._tag),
      state: failed ? 'failed' : 'complete',
    })
  }
  if (
    acquire.activeAttemptId !== undefined &&
    acquire.activeAttemptId !== evidence?.attemptId
  )
    items.push({
      id: acquire.activeAttemptId,
      label: `Attempt ${acquire.attemptCount + 1}`,
      detail: acquire.activeAttemptId,
      meta: titleCase(acquire.phase),
      state: 'current',
    })
  return items
}

const acquisitionMethod = (acquire: AcquireView) =>
  acquire.acquisitionMethod === 'lunarDiskLimb'
    ? 'Lunar disk and limb'
    : 'Deep-sky plate solve'

const evidenceSummary = (acquire: AcquireView) => {
  const evidence = acquire.latestEvidence
  if (evidence === undefined)
    return acquire.phase === 'solving'
      ? 'Capture fresh target evidence for the current bounded attempt.'
      : 'No target evidence is available in the current projection.'
  switch (evidence._tag) {
    case 'Solved':
      return `Solved frame ${evidence.sourceFrameAssetId}; center error ${evidence.magnitudeArcsec.toFixed(1)} arcsec with ${evidence.uncertaintyArcsec.toFixed(1)} arcsec uncertainty.`
    case 'NoSolution':
      return `No solution for ${evidence.sourceFrameAssetId}. ${titleCase(evidence.category)}; diagnostic ${evidence.diagnosticRef}.`
    case 'LunarDiskLimbMeasurement':
      return `Lunar measurement ${evidence.sourceFrameAssetId}; center error ${evidence.magnitudeArcsec.toFixed(1)} arcsec with ${evidence.uncertaintyArcsec.toFixed(1)} arcsec uncertainty.`
    case 'PolarMeasurement':
      return 'Polar evidence is outside this target-acquisition view.'
  }
}

const evidenceMetrics = (acquire: AcquireView) => {
  const evidence = acquire.latestEvidence
  if (
    evidence?._tag !== 'Solved' &&
    evidence?._tag !== 'LunarDiskLimbMeasurement'
  )
    return []
  return [
    {
      id: 'error',
      label: 'Error',
      value: `${evidence.magnitudeArcsec.toFixed(1)}″`,
    },
    {
      id: 'uncertainty',
      label: 'Uncertainty',
      value: `${evidence.uncertaintyArcsec.toFixed(1)}″`,
    },
    {
      id: 'ra',
      label: 'RA',
      value: `${evidence.correction.rightAscensionArcsec.toFixed(1)}″`,
    },
    {
      id: 'dec',
      label: 'Dec',
      value: `${evidence.correction.declinationArcsec.toFixed(1)}″`,
    },
  ]
}

function TargetEvidenceViewport({ acquire }: { acquire: AcquireView }) {
  const metrics = evidenceMetrics(acquire)
  return (
    <EvidenceViewport
      className="nightbook-target-evidence"
      label="Current target-acquisition evidence"
      fit="fill"
      fallback={
        <div className="nightbook-target-evidence-copy">
          <StatusIndicator
            label={titleCase(acquire.phase)}
            tone={acquireTone(acquire)}
            detail={acquisitionMethod(acquire)}
          />
          <h2>{acquisitionMethod(acquire)}</h2>
          <p>{evidenceSummary(acquire)}</p>
        </div>
      }
      overlays={
        metrics.length > 0 ? (
          <MetricOverlay label="Acquisition metrics" items={metrics} />
        ) : undefined
      }
      caption={
        acquire.attention ??
        'Evidence is service-owned. A provider acknowledgement is not image verification.'
      }
    />
  )
}

function TargetContext({
  view,
  acquire,
}: {
  view: ObserveView
  acquire: AcquireView
}) {
  const attempts = attemptItems(acquire)
  return (
    <Panel className="nightbook-target-context" as="aside">
      <PanelHeader
        title="Target acquire"
        meta={`Acquire rev ${acquire.revision}`}
      />
      <PanelBody>
        <DataList aria-label="Target-acquisition context">
          <DataListItem label="Target" value={view.target} />
          <DataListItem label="Method" value={acquisitionMethod(acquire)} />
          <DataListItem label="Phase" value={titleCase(acquire.phase)} />
          <DataListItem label="Attempts" value={String(acquire.attemptCount)} />
          <DataListItem
            label="Recovery series"
            value={String(acquire.recoverySeries)}
          />
          {acquire.correctionAttemptsRemaining !== undefined ? (
            <DataListItem
              label="Corrections left"
              value={String(acquire.correctionAttemptsRemaining)}
            />
          ) : null}
        </DataList>
        {attempts.length > 0 ? (
          <AttemptTrail label="Acquisition attempts" items={attempts} />
        ) : (
          <p className="nightbook-target-empty-trail">
            No attempt evidence has been recorded.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}

function TargetDecision({
  projection,
  acquire,
  pending,
  result,
  run,
  targetAcquisitionCommand,
  acquireRecoveryCommand,
  approvePointingCorrection,
}: {
  projection: Projection
  acquire: AcquireView
  pending: string | undefined
  result: string | undefined
  run: (id: string, action: (() => Promise<void>) | undefined) => void
  targetAcquisitionCommand: ObserveWorkspaceProps['targetAcquisitionCommand']
  acquireRecoveryCommand: ObserveWorkspaceProps['acquireRecoveryCommand']
  approvePointingCorrection: ObserveWorkspaceProps['approvePointingCorrection']
}) {
  const descriptor = (
    id: string,
    label: string,
    action: (() => Promise<void>) | undefined,
    description: string,
    tone: ActionDescriptor['tone'] = 'primary',
  ): ActionDescriptor => ({
    id,
    label: pending === id ? 'Working…' : label,
    tone,
    disabled: pending !== undefined || action === undefined,
    description:
      action === undefined
        ? 'Current desktop control and a fresh projection are required.'
        : description,
    onSelect: () => run(id, action),
  })

  const captureAvailable = acquireActionAvailable(
    acquire,
    'CaptureTargetAcquisitionEvidence',
  )
  const approveAvailable = acquireActionAvailable(
    acquire,
    'ApprovePointingCorrection',
  )
  const retryAvailable = acquireActionAvailable(
    acquire,
    'RetryPlateSolveWithParameters',
  )
  const skipAvailable = acquireActionAvailable(acquire, 'SkipAcquireTarget')
  const abortAvailable = acquireActionAvailable(acquire, 'AbortAcquire')
  const proposal = acquire.pendingProposal
  const primary = captureAvailable
    ? descriptor(
        'capture-target',
        acquire.phase === 'verifying'
          ? 'Capture fresh verification frame'
          : acquire.acquisitionMethod === 'lunarDiskLimb'
            ? 'Capture lunar measurement'
            : 'Capture and plate solve',
        targetAcquisitionCommand,
        acquire.phase === 'verifying'
          ? 'Verify the provisional acknowledgement from fresh image evidence.'
          : 'Capture one bounded target-acquisition evidence frame.',
      )
    : approveAvailable && proposal !== undefined
      ? descriptor(
          'approve-correction',
          'Approve pointing correction',
          approvePointingCorrection === undefined
            ? undefined
            : () => approvePointingCorrection(proposal.proposalId),
          `Approve the exact RA ${proposal.correction.rightAscensionArcsec.toFixed(1)}″, Dec ${proposal.correction.declinationArcsec.toFixed(1)}″ correction.`,
        )
      : retryAvailable
        ? descriptor(
            'retry-solve',
            'Retry at 15 s exposure',
            acquireRecoveryCommand === undefined
              ? undefined
              : () => acquireRecoveryCommand('RetryPlateSolveWithParameters'),
            'Start the one changed recovery series with the defined parameters.',
          )
        : undefined
  const secondary: ActionDescriptor[] = [
    ...(skipAvailable
      ? [
          descriptor(
            'skip-target',
            'Skip target',
            acquireRecoveryCommand === undefined
              ? undefined
              : () => acquireRecoveryCommand('SkipAcquireTarget'),
            'Advance without accepting unverified target evidence.',
            'secondary',
          ),
        ]
      : []),
    ...(abortAvailable
      ? [
          descriptor(
            'abort-acquire',
            'Abort acquisition',
            acquireRecoveryCommand === undefined
              ? undefined
              : () => acquireRecoveryCommand('AbortAcquire'),
            'End this acquisition; no unverified result is accepted.',
            'danger',
          ),
        ]
      : []),
  ]
  const title =
    acquire.phase === 'paused'
      ? 'Choose bounded recovery'
      : acquire.phase === 'awaitingApproval'
        ? 'Review exact correction'
        : acquire.phase === 'verifying'
          ? 'Verify pointing from a fresh frame'
          : acquire.phase === 'completed'
            ? 'Target acquisition complete'
            : acquire.phase === 'skipped'
              ? 'Target skipped'
              : acquire.phase === 'aborted'
                ? 'Acquisition aborted'
                : 'Acquire the target'
  return (
    <ActionPanel
      className="nightbook-decision-rail"
      eyebrow={
        projection.shell.readOnly
          ? 'Decision now · viewer'
          : 'Decision now · controller'
      }
      title={title}
      description={acquire.attention ?? evidenceSummary(acquire)}
      primary={primary}
      secondary={secondary}
      footer={
        pending !== undefined
          ? 'Submitting the exact advertised action…'
          : (result ??
            (projection.shell.readOnly
              ? projection.shell.protection
              : 'Only actions advertised by the current Acquire projection are available.'))
      }
    />
  )
}

function TargetStage({
  projection,
  targetAcquisitionCommand,
  acquireRecoveryCommand,
  approvePointingCorrection,
}: Pick<
  ObserveWorkspaceProps,
  | 'projection'
  | 'targetAcquisitionCommand'
  | 'acquireRecoveryCommand'
  | 'approvePointingCorrection'
>) {
  const view = projection.observe
  const acquire = view.source?.acquire
  const [pending, setPending] = useState<string>()
  const [result, setResult] = useState<string>()
  useEffect(() => {
    setResult(undefined)
  }, [acquire?.revision])
  if (acquire?.acquisitionMethod === undefined) return null
  const recovery = acquire.phase === 'paused'
  const run = (id: string, action: (() => Promise<void>) | undefined) => {
    if (action === undefined || pending !== undefined) return
    setPending(id)
    setResult(undefined)
    void action()
      .then(
        () =>
          setResult(
            'Action accepted. Waiting for the refreshed service projection.',
          ),
        () =>
          setResult(
            'The action was not accepted. Current service evidence remains visible.',
          ),
      )
      .finally(() => setPending(undefined))
  }
  const decision = (
    <TargetDecision
      projection={projection}
      acquire={acquire}
      pending={pending}
      result={result}
      run={run}
      targetAcquisitionCommand={targetAcquisitionCommand}
      acquireRecoveryCommand={acquireRecoveryCommand}
      approvePointingCorrection={approvePointingCorrection}
    />
  )
  if (recovery)
    return (
      <section
        className="nightbook-target-stage"
        data-mode="recover"
        aria-live="polite"
      >
        <Panel className="nightbook-target-recovery-evidence">
          <PanelHeader
            title="Recovery evidence"
            meta={`${acquire.attemptCount} attempts retained`}
          />
          <PanelBody>
            <TargetEvidenceViewport acquire={acquire} />
            {attemptItems(acquire).length > 0 ? (
              <AttemptTrail
                label="Recovery attempts"
                items={attemptItems(acquire)}
              />
            ) : null}
            {acquire.recovery ? (
              <AttentionCard
                tone="warning"
                statusLabel="Acquire paused"
                title="Bounded recovery is ready"
                description={`${acquire.recovery.remainingAttempts} identical attempts and ${acquire.recovery.remainingRecoverySeries} changed recovery series remain.`}
                evidence={acquire.recovery.reconciliation}
              />
            ) : null}
          </PanelBody>
        </Panel>
        {decision}
      </section>
    )
  return (
    <section
      className="nightbook-target-stage"
      data-mode="acquire"
      aria-live="polite"
    >
      <TargetContext view={view} acquire={acquire} />
      <Panel className="nightbook-target-evidence-panel">
        <PanelHeader title="Current evidence" meta="Image truth first" />
        <PanelBody>
          <TargetEvidenceViewport acquire={acquire} />
        </PanelBody>
      </Panel>
      {decision}
    </section>
  )
}

function StatusStrip({ projection }: { projection: Projection }) {
  const rig = projection.shell.health.find((fact) => fact.label === 'Rig')
  const storage = projection.shell.health.find(
    (fact) => fact.label === 'Storage',
  )
  const current = projection.shell.freshness.startsWith('Current ')
  const phase =
    projection.observe.source?.acquire?.acquisitionMethod === undefined
      ? projection.observe.phase
      : lifecycleLabel(projection.observe)
  return (
    <footer
      className="nightbook-operational-status"
      aria-label="Operational status"
    >
      <span>
        <i data-tone={tone(projection.observe.tone)} aria-hidden="true" />
        <b>{phase}</b> ·{' '}
        {current ? 'snapshot current' : projection.shell.freshness}
      </span>
      <span>
        Observe ·{' '}
        {current ? 'service-owned truth' : 'service truth unavailable'} ·
        revision {projection.shell.control.revision}
      </span>
      <span>
        {rig?.summary ?? projection.shell.freshness} ·{' '}
        {storage?.summary ?? projection.shell.controller}
      </span>
    </footer>
  )
}

export function ObservePhone({
  projection,
  loading,
}: Pick<ObserveWorkspaceProps, 'projection' | 'loading'>) {
  const progress = observeProgress(projection)
  const view = projection.observe
  const acquire = view.source?.acquire
  const targetAcquisition =
    acquire?.acquisitionMethod !== undefined &&
    (acquire.phase !== 'completed' || view.source?.phase === 'acquire')
  const attempts = targetAcquisition ? attemptItems(acquire) : []
  return (
    <section
      id="nightbook-workspace"
      className="nightbook-phone-workspace"
      aria-label="Read-only phone projection"
      data-testid="nightbook-phone"
    >
      <header className="nightbook-phone-header">
        <div>
          <p>Live run</p>
          <h1>{loading ? 'Loading current state' : view.target}</h1>
        </div>
        <StatusIndicator
          label={
            loading
              ? 'Loading'
              : view.source === undefined
                ? 'Unavailable'
                : 'Current'
          }
          tone={loading ? 'info' : tone(view.tone)}
        />
      </header>
      <AttentionCard
        tone="warning"
        statusLabel="Read-only on phone"
        title={lifecycleLabel(view)}
        description="Desktop workflow controls are intentionally unavailable."
      />
      <Panel as="section" className="nightbook-phone-progress-panel">
        <PanelHeader
          title="Run progress"
          meta={progress.pending ? '—' : lifecycleLabel(view)}
        />
        <PanelBody>
          <Progress progress={progress} showValue />
        </PanelBody>
      </Panel>
      {targetAcquisition ? (
        <Panel as="section" className="nightbook-phone-target-evidence">
          <PanelHeader
            title="Target evidence"
            meta={titleCase(acquire.phase)}
          />
          <PanelBody>
            <TargetEvidenceViewport acquire={acquire} />
            {attempts.length > 0 ? (
              <AttemptTrail label="Acquisition attempts" items={attempts} />
            ) : null}
          </PanelBody>
        </Panel>
      ) : (
        <Evidence view={view} />
      )}
      {view.source?.latestCapturedAssetId !== undefined ? (
        <a
          className="nightbook-phone-library-link"
          href={nightbookHref(
            `/library/assets/${encodeURIComponent(view.source.latestCapturedAssetId)}`,
          )}
        >
          Review captured frame in Library
        </a>
      ) : null}
      <Panel as="section">
        <PanelBody>
          <DataList aria-label="Phone operational facts">
            <DataListItem label="Run" value={view.status} />
            {targetAcquisition ? (
              <DataListItem
                label="Acquire revision"
                value={String(acquire.revision)}
              />
            ) : null}
            <DataListItem
              label="Authority"
              value={projection.shell.authority}
            />
            <DataListItem
              label="Freshness"
              value={projection.shell.freshness}
            />
            <DataListItem
              label="Controller"
              value={projection.shell.controller}
            />
          </DataList>
        </PanelBody>
      </Panel>
    </section>
  )
}

type ObserveEligibility = ObserveWorkspaceProjection['actions']['pause']
type ObserveActionKey = 'pause' | 'resume' | 'stop' | 'skip' | 'retry' | 'park'

const observeActionEntries = (
  source: ObserveWorkspaceProjection,
): readonly (readonly [ObserveActionKey, ObserveEligibility])[] => [
  ['pause', source.actions.pause],
  ['resume', source.actions.resume],
  ['stop', source.actions.stop],
  ['skip', source.actions.skip],
  ['retry', source.actions.retry],
  ['park', source.actions.park],
]

const observeCommand = (key: ObserveActionKey): ObserveAction =>
  key === 'pause'
    ? 'PauseRun'
    : key === 'resume'
      ? 'ResumeRun'
      : key === 'stop'
        ? 'StopRun'
        : key === 'skip'
          ? 'SkipSequence'
          : key === 'retry'
            ? 'RetryPhase'
            : 'RequestPark'

const eligibilityDescription = (
  eligibility: ObserveEligibility | undefined,
) => {
  if (eligibility === undefined)
    return 'The service did not project this action.'
  if (eligibility._tag === 'Eligible')
    return 'Available from the current service projection.'
  const reasons: Record<
    Extract<ObserveEligibility, { _tag: 'Ineligible' }>['reason'],
    string
  > = {
    readOnlyClient: 'This client is read-only.',
    controlRequired: 'Current desktop control is required.',
    activeRunRequired: 'A non-terminal active run is required.',
    pausedRunRequired: 'The run must be paused.',
    terminalRun: 'The run is terminal.',
    retryUsed: 'The bounded retry was already used.',
    policyUnavailable:
      'This action is not supported for the current executor and phase.',
  }
  return reasons[eligibility.reason]
}

const executorAttemptItems = (
  source: ObserveWorkspaceProjection,
): AttemptItem[] =>
  (source.executorWork ?? []).map((work) => ({
    id: work.workId,
    label: titleCase(work.kind),
    detail:
      work.lastError ??
      (work.state === 'pending'
        ? 'Persisted before any provider command.'
        : work.state === 'commandAttempted'
          ? 'Provider write attempted; replay is held for observation.'
          : work.state === 'observing'
            ? 'A later active camera state was observed.'
            : work.state === 'reconciling'
              ? 'Read-only reconciliation is active; the command is not replayed.'
              : work.state === 'cancelled'
                ? 'An intervention settled this work before provider dispatch.'
                : 'Durable work settled from service evidence.'),
    meta: titleCase(work.state),
    state:
      work.state === 'completed'
        ? 'complete'
        : work.state === 'rejected' || work.state === 'cancelled'
          ? 'failed'
          : 'current',
  }))

function ObserveDesktop({
  projection,
  loading,
  submit,
  refreshPreflight,
  targetAcquisitionCommand,
  acquireRecoveryCommand,
  approvePointingCorrection,
}: ObserveWorkspaceProps) {
  const [result, setResult] = useState<string>()
  const [refreshing, setRefreshing] = useState(false)
  const [pendingAction, setPendingAction] = useState<ObserveAction>()
  const view = projection.observe
  const source = view.source
  const progress = observeProgress(projection)
  const lifecycleState = useMemo(() => lifecycle(view), [view])
  const currentStage =
    source?.phase === 'verify'
      ? 'Verify'
      : lifecycleState.activeIndex < 0
        ? loading
          ? 'Loading'
          : 'Observe unavailable'
        : (lifecycleStages[lifecycleState.activeIndex]?.label ??
          titleCase(view.phase))

  const refreshEligibility = source?.actions.refreshPreflight
  const refreshAction: ActionDescriptor | undefined =
    source?.phase === 'preflight' && refreshEligibility !== undefined
      ? refreshPreflight !== undefined &&
        refreshEligibility._tag === 'Eligible' &&
        !projection.shell.readOnly
        ? {
            id: 'refresh-preflight',
            label: refreshing ? 'Refreshing…' : 'Refresh preflight',
            tone: 'primary',
            disabled: refreshing,
            description: 'Read-only provider refresh; no device command.',
            onSelect: () => {
              setRefreshing(true)
              setResult(undefined)
              void refreshPreflight()
                .then(
                  (submission) => setResult(submission.message),
                  () => setResult('Preflight refresh is unavailable.'),
                )
                .finally(() => setRefreshing(false))
            },
          }
        : {
            id: 'refresh-preflight-unavailable',
            label: 'Refresh preflight',
            disabled: true,
            description: projection.shell.readOnly
              ? 'Current control is required.'
              : eligibilityDescription(refreshEligibility),
          }
      : undefined

  const runActions = source
    ? observeActionEntries(source).map(([key, eligibility]) => {
        const action = observeCommand(key)
        const enabled =
          eligibility._tag === 'Eligible' &&
          submit !== undefined &&
          !projection.shell.readOnly
        return {
          id: `observe-${key}`,
          label:
            pendingAction === action ? `${titleCase(key)}…` : titleCase(key),
          tone: key === 'stop' ? ('danger' as const) : ('secondary' as const),
          disabled: !enabled || pendingAction !== undefined,
          description: eligibilityDescription(eligibility),
          ...(enabled
            ? {
                onSelect: () => {
                  setPendingAction(action)
                  setResult(undefined)
                  void submit(action, IdempotencyKey.make(crypto.randomUUID()))
                    .then((submission) =>
                      ObserveCommandSubmission.$match(submission, {
                        Accepted: ({ message }) => setResult(message),
                        Rejected: ({ reason, safeNextAction }) =>
                          setResult(`${reason} ${safeNextAction}`),
                        Unavailable: ({ reason, safeNextAction }) =>
                          setResult(`${reason} ${safeNextAction}`),
                      }),
                    )
                    .finally(() => setPendingAction(undefined))
                },
              }
            : {}),
        } satisfies ActionDescriptor
      })
    : []
  const primaryAction =
    refreshAction ??
    runActions.find((action) => !action.disabled) ??
    runActions[0]
  const secondaryActions = runActions.filter(
    (action) => action.id !== primaryAction?.id,
  )

  return (
    <main id="nightbook-workspace" className="nightbook-desktop-workspace">
      <header className="nightbook-titlebar">
        <div>
          <p>Observe / Authoritative lifecycle</p>
          <h1>{currentStage}</h1>
        </div>
        <div className="nightbook-title-progress">
          <span>
            {lifecycleState.activeIndex < 0
              ? '— of 6'
              : `${lifecycleState.activeIndex + 1} of 6`}
          </span>
          <progress
            aria-label={progress.label}
            max={progress.max}
            value={progress.pending ? undefined : progress.value}
          />
        </div>
      </header>

      <StepRail
        className="nightbook-lifecycle"
        items={lifecycleState.items}
        activeId={lifecycleState.activeId}
        label="Observe lifecycle"
        orientation="horizontal"
      />

      {source?.acquire?.acquisitionMethod !== undefined &&
      (source.acquire.phase !== 'completed' || source.phase === 'acquire') ? (
        <TargetStage
          projection={projection}
          {...(targetAcquisitionCommand === undefined
            ? {}
            : { targetAcquisitionCommand })}
          {...(acquireRecoveryCommand === undefined
            ? {}
            : { acquireRecoveryCommand })}
          {...(approvePointingCorrection === undefined
            ? {}
            : { approvePointingCorrection })}
        />
      ) : (
        <section className="nightbook-observe-stage" aria-live="polite">
          <Panel className="nightbook-context-rail" as="aside">
            <PanelHeader
              title={`Run plan · rev ${source?.revision ?? '—'}`}
              meta="Read-only here"
            />
            <PanelBody>
              <DataList aria-label="Run plan details">
                <DataListItem label="Target" value={view.target} />
                <DataListItem label="Phase" value={view.phase} />
                <DataListItem
                  label="Sequence"
                  value={
                    source === undefined
                      ? 'Unavailable'
                      : `${source.completedSequences} / ${source.totalSequences}`
                  }
                />
                <DataListItem
                  label="Executor"
                  value={source?.executor ?? 'Unavailable'}
                />
              </DataList>
              <div className="nightbook-run-summary">
                <b>
                  {projection.shell.currentRun?.sequenceProgress ?? view.status}
                </b>
                <small>{view.annotation}</small>
              </div>
            </PanelBody>
          </Panel>

          <Panel
            className="nightbook-evidence-panel"
            as="section"
            aria-busy={loading}
          >
            <PanelHeader
              title="Current evidence"
              meta="Verdict first · facts behind"
            />
            <PanelBody>
              <div className="nightbook-evidence-stack">
                <AttentionCard
                  tone={tone(view.tone)}
                  statusLabel={
                    loading ? 'Loading projection' : evidenceStatusLabel(view)
                  }
                  title={view.heading}
                  description={view.evidence}
                  evidence={view.recovery ?? view.annotation}
                />
                {source?.executorWork !== undefined &&
                source.executorWork.length > 0 ? (
                  <AttemptTrail
                    label="Durable executor work"
                    items={executorAttemptItems(source)}
                  />
                ) : null}
                {source?.latestCapturedAssetId !== undefined ? (
                  <a
                    className="nightbook-simulation-library-link"
                    href={nightbookHref(
                      `/library/assets/${encodeURIComponent(source.latestCapturedAssetId)}`,
                    )}
                  >
                    Review captured frame in Library
                  </a>
                ) : null}
                <EvidenceFacts view={view} />
                {source !== undefined ? (
                  <DataList aria-label="Observe action availability">
                    {Object.entries(source.actions).map(([key, eligibility]) =>
                      eligibility === undefined ? null : (
                        <DataListItem
                          key={key}
                          label={titleCase(key)}
                          value={
                            eligibility._tag === 'Eligible'
                              ? 'Available'
                              : 'Unavailable'
                          }
                          detail={eligibilityDescription(eligibility)}
                        />
                      ),
                    )}
                  </DataList>
                ) : null}
              </div>
            </PanelBody>
          </Panel>

          <ActionPanel
            className="nightbook-decision-rail"
            eyebrow={
              projection.shell.readOnly
                ? 'Decision now · viewer'
                : 'Decision now · controller'
            }
            title={view.heading}
            description={view.recovery ?? view.evidence}
            primary={primaryAction}
            secondary={secondaryActions}
            footer={
              result ??
              (projection.shell.readOnly
                ? projection.shell.protection
                : 'Only proven command paths are enabled.')
            }
          />
        </section>
      )}
    </main>
  )
}

export function ObserveWorkspace(props: ObserveWorkspaceProps) {
  const phone = usePhoneProjection()
  return (
    <div
      className="nightbook-app nb-theme"
      data-nb-theme="nightbook"
      data-nb-density="compact"
    >
      <a className="nightbook-skip-link" href="#nightbook-workspace">
        Skip to Observe evidence
      </a>
      <CommandBar
        projection={props.projection}
        loading={props.loading}
        submitControl={props.submitControl}
        allowControlAction={!phone}
        runPresentation={{
          label:
            props.projection.observe.source?.acquire?.acquisitionMethod ===
            undefined
              ? (props.projection.shell.currentRun?.phase ??
                (props.loading ? 'Loading' : 'No run'))
              : lifecycleLabel(props.projection.observe),
          percent: progressPercent(observeProgress(props.projection)),
        }}
      />
      {phone ? <ObservePhone {...props} /> : <ObserveDesktop {...props} />}
      <StatusStrip projection={props.projection} />
    </div>
  )
}

export default ObserveWorkspace
