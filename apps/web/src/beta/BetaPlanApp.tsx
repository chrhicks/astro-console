import {
  AttentionCard,
  Button,
  Checkbox,
  Cluster,
  DataList,
  DataListItem,
  Dialog,
  Field,
  NumberField,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Select,
  Stack,
  StatusIndicator,
  Tabs,
  TextField,
  type Tone,
} from '@nightbook/ui'
import {
  IdempotencyKey,
  PlanCommandResult,
  planSequencePresentation,
  planSequenceWindow,
  type RunSequenceDefinition,
  type PlanWorkspaceProjection,
} from '@astro-console/v2-contracts'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { PlanCommandSubmission, type PlanAction } from '../plan-command-client'
import type { Projection, StatusTone } from '../presentation'
import { BetaCommandBar, type BetaControlSubmit } from './BetaObserveApp'
import '@nightbook/ui/styles.css'
import './beta-observe.css'
import './beta-plan.css'

type PlanSequence = PlanWorkspaceProjection['sequences'][number]
type PlanEligibility = NonNullable<
  PlanWorkspaceProjection['actions']
>[keyof NonNullable<PlanWorkspaceProjection['actions']>]
type PlanIneligibilityReason = Extract<
  PlanEligibility,
  { _tag: 'Ineligible' }
>['reason']
type PlanTab = 'editor' | 'review'
type ConfirmAction =
  | { kind: 'accept' }
  | { kind: 'start' }
  | { kind: 'apply-preview' }

export type BetaPlanAppProps = {
  projection: Projection
  loading: boolean
  submit?: (
    action: PlanAction,
    key: typeof IdempotencyKey.Type,
  ) => Promise<PlanCommandSubmission>
  submitControl?: BetaControlSubmit
}

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

const planTone = (view: Projection['plan']): StatusTone => {
  switch (view.source?.readiness) {
    case 'ready':
      return 'safe'
    case 'readyWithLimitations':
      return 'attention'
    case 'blocked':
      return 'danger'
    default:
      return 'neutral'
  }
}

const titleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())

const time = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
        hour12: false,
      })
}

const dateTimeLocal = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 16)
}

const dateTimeUtc = (value: string) =>
  value.length === 0 ? value : new Date(`${value}:00.000Z`).toISOString()

const sequencePresentation = (sequence: PlanSequence) =>
  planSequencePresentation(sequence.definition)

const eligibilityReason = (eligibility: PlanEligibility | undefined) => {
  if (eligibility === undefined) return 'Plan action availability is unknown.'
  if (eligibility._tag === 'Eligible') return undefined
  const reasons: Record<PlanIneligibilityReason, string> = {
    ownerRequired: 'The desktop owner is required.',
    readOnlyClient: 'This client is read-only.',
    controlRequired: 'Current desktop control is required.',
    planNotReady: 'Resolve the blocking plan facts first.',
    acceptedDefinitionRequired: 'Accept this plan revision first.',
    activeRunRequired: 'An active run is required.',
    activeRunPresent: 'The accepted run is already active.',
    definitionAlreadyAccepted: 'This plan revision is already accepted.',
    terminalRun: 'The current run is terminal.',
    pausedRun: 'Resume or stop the paused run in Observe.',
    runAdvanced: 'This run has advanced beyond the editable boundary.',
    previewRequired: 'Request and review a current preview first.',
  }
  return reasons[eligibility.reason]
}

const changedSequenceCount = (
  accepted: readonly PlanSequence[] | undefined,
  draft: readonly PlanSequence[],
) => {
  if (accepted === undefined) return 0
  return draft.reduce(
    (count, sequence, index) =>
      count +
      (JSON.stringify(sequence) === JSON.stringify(accepted[index]) ? 0 : 1),
    0,
  )
}

type TimelineItem = {
  sequence: PlanSequence
  sourceIndex: number
  lane: number
  left: number
  width: number
}

const allocatePlanTimeline = (
  sequences: readonly PlanSequence[],
): { items: readonly TimelineItem[]; laneCount: number } => {
  const intervals = sequences
    .map((sequence, sourceIndex) => {
      const parsedStart = Date.parse(sequence.window.startsAt)
      const parsedEnd = Date.parse(sequence.window.endsAt)
      const start = Number.isFinite(parsedStart) ? parsedStart : sourceIndex
      const end =
        Number.isFinite(parsedEnd) && parsedEnd > start ? parsedEnd : start + 1
      return { sequence, sourceIndex, start, end }
    })
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.sourceIndex - right.sourceIndex ||
        left.sequence.sequenceId.localeCompare(right.sequence.sequenceId),
    )

  if (intervals.length === 0) return { items: [], laneCount: 0 }

  const timelineStart = Math.min(...intervals.map((item) => item.start))
  const timelineEnd = Math.max(...intervals.map((item) => item.end))
  const duration = Math.max(1, timelineEnd - timelineStart)
  const laneEnds: number[] = []
  const items = intervals.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    return {
      sequence: item.sequence,
      sourceIndex: item.sourceIndex,
      lane,
      left: ((item.start - timelineStart) / duration) * 100,
      width: ((item.end - item.start) / duration) * 100,
    }
  })

  return { items, laneCount: laneEnds.length }
}

const resultLabel = (result: typeof PlanCommandResult.Type) =>
  PlanCommandResult.match(result, {
    DraftSaved: () => 'Draft saved.',
    RunDefinitionAccepted: () => 'Run definition accepted.',
    RunStarted: () => 'Run started.',
    RunMutationPreviewed: () => 'Mutation preview is ready.',
    RunMutationApplied: () => 'Run mutation applied.',
  })

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

function PlanFieldGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <fieldset className="beta-plan-field-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  )
}

function PlanEditor({
  sequence,
  disabled,
  onChange,
}: {
  sequence: PlanSequence
  disabled: boolean
  onChange: (next: PlanSequence) => void
}) {
  const definition = sequence.definition
  const update = (next: RunSequenceDefinition) =>
    onChange({
      ...sequence,
      ...planSequencePresentation(next),
      window: planSequenceWindow(next, sequence.window),
      definition: next,
    })
  const text =
    (key: 'targetName' | 'filterName') =>
    (event: ChangeEvent<HTMLInputElement>) =>
      update({
        ...definition,
        [key]: event.currentTarget.value || undefined,
      } as RunSequenceDefinition)
  const numeric =
    (
      key:
        | 'rightAscensionHours'
        | 'declinationDegrees'
        | 'exposureSeconds'
        | 'frameCount'
        | 'gain'
        | 'binning'
        | 'minimumAltitudeDegrees'
        | 'horizonClearanceDegrees'
        | 'recenterThresholdArcsec'
        | 'maxSolveAttempts'
        | 'maxCaptureRetries'
        | 'estimatedDurationSeconds'
        | 'estimatedStorageBytes'
        | 'priority',
    ) =>
    (event: ChangeEvent<HTMLInputElement>) =>
      update({ ...definition, [key]: Number(event.currentTarget.value) })
  const select =
    (key: 'acquisitionMode' | 'acquireFailure' | 'captureFailure') =>
    (event: ChangeEvent<HTMLSelectElement>) =>
      update({
        ...definition,
        [key]: event.currentTarget.value,
      } as RunSequenceDefinition)
  const window =
    (key: 'earliestStart' | 'latestEnd') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = dateTimeUtc(event.currentTarget.value)
      update({
        ...definition,
        [key]: value.length === 0 ? undefined : value,
      })
    }
  return (
    <>
      <PlanFieldGroup title="Sequence">
        <Field label="Target">
          <TextField
            value={definition.targetName}
            disabled={disabled}
            onChange={text('targetName')}
          />
        </Field>
        <Field label="Acquisition mode">
          <Select
            value={definition.acquisitionMode}
            disabled={disabled}
            onChange={select('acquisitionMode')}
          >
            <option value="cameraOnly">Camera only</option>
            <option value="deepSkyPlateSolve">Deep sky plate solve</option>
          </Select>
        </Field>
        <Field label="Right ascension" hint="Hours">
          <NumberField
            min={0}
            max={24}
            step={0.0001}
            value={definition.rightAscensionHours}
            disabled={disabled}
            onChange={numeric('rightAscensionHours')}
          />
        </Field>
        <Field label="Declination" hint="Degrees">
          <NumberField
            min={-90}
            max={90}
            step={0.0001}
            value={definition.declinationDegrees}
            disabled={disabled}
            onChange={numeric('declinationDegrees')}
          />
        </Field>
        <Field label="Priority">
          <NumberField
            min={0}
            step={1}
            value={definition.priority}
            disabled={disabled}
            onChange={numeric('priority')}
          />
        </Field>
      </PlanFieldGroup>
      <PlanFieldGroup title="Capture">
        <Field label="Exposure" hint="Seconds">
          <NumberField
            min={0.001}
            step={1}
            value={definition.exposureSeconds}
            disabled={disabled}
            onChange={numeric('exposureSeconds')}
          />
        </Field>
        <Field label="Frame count">
          <NumberField
            min={1}
            step={1}
            value={definition.frameCount}
            disabled={disabled}
            onChange={numeric('frameCount')}
          />
        </Field>
        <Field label="Gain">
          <NumberField
            min={0}
            step={1}
            value={definition.gain ?? 0}
            disabled={disabled}
            onChange={numeric('gain')}
          />
        </Field>
        <Field label="Binning">
          <NumberField
            min={1}
            step={1}
            value={definition.binning}
            disabled={disabled}
            onChange={numeric('binning')}
          />
        </Field>
        <Field label="Filter">
          <TextField
            value={definition.filterName ?? ''}
            disabled={disabled}
            onChange={text('filterName')}
          />
        </Field>
        <Field label="Estimated duration" hint="Seconds">
          <NumberField
            min={1}
            step={1}
            value={definition.estimatedDurationSeconds}
            disabled={disabled}
            onChange={numeric('estimatedDurationSeconds')}
          />
        </Field>
        <Field label="Estimated storage" hint="Bytes">
          <NumberField
            min={1}
            step={1_000_000}
            value={definition.estimatedStorageBytes}
            disabled={disabled}
            onChange={numeric('estimatedStorageBytes')}
          />
        </Field>
      </PlanFieldGroup>
      <PlanFieldGroup title="Window & bounds">
        <Field label="Earliest start UTC">
          <TextField
            type="datetime-local"
            value={dateTimeLocal(definition.earliestStart ?? '')}
            disabled={disabled}
            onChange={window('earliestStart')}
          />
        </Field>
        <Field label="Latest end UTC">
          <TextField
            type="datetime-local"
            value={dateTimeLocal(definition.latestEnd ?? '')}
            disabled={disabled}
            onChange={window('latestEnd')}
          />
        </Field>
        <Field label="Minimum altitude" hint="Degrees">
          <NumberField
            min={-90}
            max={90}
            value={definition.minimumAltitudeDegrees}
            disabled={disabled}
            onChange={numeric('minimumAltitudeDegrees')}
          />
        </Field>
        <Field label="Horizon clearance" hint="Degrees">
          <NumberField
            min={0}
            value={definition.horizonClearanceDegrees}
            disabled={disabled}
            onChange={numeric('horizonClearanceDegrees')}
          />
        </Field>
        <Field label="Recenter threshold" hint="Arcsec">
          <NumberField
            min={1}
            value={definition.recenterThresholdArcsec}
            disabled={disabled}
            onChange={numeric('recenterThresholdArcsec')}
          />
        </Field>
        <Field label="Solve attempts">
          <NumberField
            min={1}
            step={1}
            value={definition.maxSolveAttempts}
            disabled={disabled}
            onChange={numeric('maxSolveAttempts')}
          />
        </Field>
        <Field label="Capture retries">
          <NumberField
            min={0}
            step={1}
            value={definition.maxCaptureRetries}
            disabled={disabled}
            onChange={numeric('maxCaptureRetries')}
          />
        </Field>
        <Field label="Acquire failure">
          <Select
            value={definition.acquireFailure}
            disabled={disabled}
            onChange={select('acquireFailure')}
          >
            <option value="pause">Pause</option>
            <option value="skip">Skip</option>
            <option value="stop">Stop</option>
          </Select>
        </Field>
        <Field label="Capture failure">
          <Select
            value={definition.captureFailure}
            disabled={disabled}
            onChange={select('captureFailure')}
          >
            <option value="retry">Retry</option>
            <option value="pause">Pause</option>
            <option value="skip">Skip</option>
            <option value="stop">Stop</option>
          </Select>
        </Field>
      </PlanFieldGroup>
      <PlanFieldGroup title="Observed environment · read only">
        <DataList>
          <DataListItem
            label="Observed window"
            value={`${time(sequence.window.startsAt)}–${time(sequence.window.endsAt)} UTC`}
            detail={`${sequence.window.usableMinutes}m usable · peak ${sequence.window.peakAltitudeDeg}°`}
          />
          <DataListItem
            label="Horizon"
            value={titleCase(sequence.horizon)}
            detail={`${sequence.window.horizonClearanceDeg}° observed clearance`}
          />
          <DataListItem label="Storage" value={titleCase(sequence.storage)} />
        </DataList>
      </PlanFieldGroup>
    </>
  )
}

function PlanSequenceList({
  projection,
  sequences,
  selected,
  onSelect,
}: {
  projection: Projection
  sequences: readonly PlanSequence[]
  selected: number
  onSelect: (index: number) => void
}) {
  const run = projection.shell.currentRun
  const completed =
    run?.progressValue === undefined
      ? 0
      : Math.min(
          Math.max(0, projection.observe.source?.completedSequences ?? 0),
          sequences.length,
        )
  return (
    <Panel as="aside" className="beta-plan-sequences">
      <PanelHeader
        title="Plan order"
        meta={`rev ${projection.plan.source?.revision ?? '—'}`}
      />
      <PanelBody>
        {run ? (
          <div className="beta-plan-section-label">Accepted / current</div>
        ) : null}
        {sequences.map((sequence, index) => {
          const state = run
            ? index < completed
              ? 'done'
              : index === completed
                ? 'live'
                : 'queued'
            : 'queued'
          return (
            <button
              key={sequence.sequenceId}
              type="button"
              className="beta-plan-sequence"
              data-state={state}
              data-selected={index === selected ? 'true' : 'false'}
              aria-pressed={index === selected}
              onClick={() => onSelect(index)}
            >
              <b>
                {String(index + 1).padStart(2, '0')} ·{' '}
                {sequence.definition.targetName}
              </b>
              <span>
                {state === 'done'
                  ? 'Complete'
                  : state === 'live'
                    ? 'Current'
                    : 'Queued'}
              </span>
              <small>{sequencePresentation(sequence).capture}</small>
              <small>
                {time(sequence.window.startsAt)}–{time(sequence.window.endsAt)}{' '}
                UTC · {sequencePresentation(sequence).estimatedMinutes}m
              </small>
            </button>
          )
        })}
      </PanelBody>
    </Panel>
  )
}

function PlanSchedule({
  sequences,
  selected,
}: {
  sequences: readonly PlanSequence[]
  selected: number
}) {
  const timeline = allocatePlanTimeline(sequences)
  return (
    <Panel as="section" className="beta-plan-schedule">
      <PanelHeader title="Sky & schedule" meta="Plan projection" />
      <PanelBody>
        <div className="beta-plan-altitude">
          <svg
            viewBox="0 0 800 220"
            aria-label="Planned target altitude curves"
          >
            <path className="grid" d="M0 190H800 M0 130H800 M0 70H800" />
            {sequences.map((sequence, index) => {
              const offset = 40 + index * 160
              return (
                <path
                  key={sequence.sequenceId}
                  className={index === selected ? 'selected' : undefined}
                  d={`M${offset} 188C${offset + 80} 55 ${offset + 160} 45 ${Math.min(790, offset + 250)} 188`}
                />
              )
            })}
          </svg>
          <span>
            Planned sky evidence; selecting a row highlights its curve.
          </span>
        </div>
        <div className="beta-plan-timeline" aria-label="Plan timeline">
          <div
            className="beta-plan-timeline-track"
            style={
              {
                '--timeline-lane-count': Math.max(1, timeline.laneCount),
              } as CSSProperties
            }
          >
            {timeline.items.map(
              ({ sequence, sourceIndex, lane, left, width }) => (
                <article
                  key={sequence.sequenceId}
                  data-sequence-id={sequence.sequenceId}
                  data-lane={lane}
                  data-selected={sourceIndex === selected ? 'true' : 'false'}
                  style={
                    {
                      '--timeline-lane': lane,
                      '--timeline-left': `${left}%`,
                      '--timeline-width': `${width}%`,
                    } as CSSProperties
                  }
                >
                  <b>
                    {String(sourceIndex + 1).padStart(2, '0')} ·{' '}
                    {sequence.definition.targetName}
                  </b>
                  <small>
                    {time(sequence.window.startsAt)} UTC ·{' '}
                    {sequencePresentation(sequence).estimatedMinutes}m
                  </small>
                </article>
              ),
            )}
          </div>
        </div>
        <p className="beta-plan-muted">
          Accepted execution stays immutable. Draft changes update only the
          saved plan revision.
        </p>
      </PanelBody>
    </Panel>
  )
}

function PlanReview({
  projection,
  accepted,
  draft,
  pending,
  onPreview,
}: {
  projection: Projection
  accepted: readonly PlanSequence[] | undefined
  draft: readonly PlanSequence[]
  pending: boolean
  onPreview: (mutation: 'shortenSecond' | 'discardCurrent') => void
}) {
  const source = projection.plan.source
  const changed =
    accepted === undefined
      ? []
      : draft.flatMap((sequence, index) =>
          JSON.stringify(sequence) === JSON.stringify(accepted[index])
            ? []
            : [{ sequence, accepted: accepted[index] }],
        )
  const previewReason = projection.shell.readOnly
    ? projection.shell.protection
    : eligibilityReason(source?.actions?.previewRunMutation)
  return (
    <Stack gap={8}>
      <div className="beta-plan-review-grid">
        <Panel>
          <PanelHeader
            title={
              source?.acceptedRunDefinition
                ? 'Accepted run definition'
                : 'Current saved plan'
            }
            meta={
              source?.acceptedRunDefinition
                ? `rev ${source.acceptedRunDefinition.sourcePlanRevision}`
                : `rev ${source?.revision ?? '—'}`
            }
          />
          <PanelBody>
            <Stack gap={6}>
              {draft.map((sequence, index) => (
                <div className="beta-plan-frozen-row" key={sequence.sequenceId}>
                  <b>
                    {String(index + 1).padStart(2, '0')} ·{' '}
                    {sequence.definition.targetName}
                  </b>
                  <span>
                    {sequencePresentation(sequence).estimatedMinutes}m
                  </span>
                </div>
              ))}
              <p className="beta-plan-muted">
                An accepted run is a frozen service-owned definition. Plan edits
                cannot change it.
              </p>
            </Stack>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader
            title="Review changes"
            meta={
              changed.length
                ? `${changed.length} local change${changed.length === 1 ? '' : 's'}`
                : 'Current'
            }
          />
          <PanelBody>
            {changed.length > 0 ? (
              <div className="beta-plan-change-list">
                {changed.map(({ sequence, accepted: prior }) => (
                  <label className="beta-plan-change" key={sequence.sequenceId}>
                    <Checkbox checked readOnly />
                    <div>
                      <b>{sequence.definition.targetName}</b>
                      <StatusIndicator tone="warning" label="Draft" />
                    </div>
                    <p>
                      {prior === undefined
                        ? '—'
                        : sequencePresentation(prior).estimatedMinutes}
                      m → {sequencePresentation(sequence).estimatedMinutes}m ·{' '}
                      {prior === undefined
                        ? '—'
                        : sequencePresentation(prior).capture}{' '}
                      → {sequencePresentation(sequence).capture}
                    </p>
                  </label>
                ))}
              </div>
            ) : source?.runMutationPreview ? (
              <AttentionCard
                tone={
                  source.runMutationPreview.approvalRequired
                    ? 'danger'
                    : 'warning'
                }
                statusLabel={titleCase(
                  source.runMutationPreview.classification,
                )}
                title="Service preview is ready"
                description={source.runMutationPreview.consequences}
              />
            ) : projection.shell.currentRun ? (
              <div className="beta-plan-preview-options">
                <AttentionCard
                  tone="neutral"
                  statusLabel="Preview first"
                  title="Change accepted future work"
                  description={
                    previewReason ??
                    'Choose one bounded mutation to calculate its exact impact.'
                  }
                />
                <Cluster gap={6}>
                  <Button
                    disabled={pending || previewReason !== undefined}
                    onClick={() => onPreview('shortenSecond')}
                  >
                    Preview shorter second sequence
                  </Button>
                  <Button
                    tone="danger"
                    disabled={pending || previewReason !== undefined}
                    onClick={() => onPreview('discardCurrent')}
                  >
                    Preview discard current sequence
                  </Button>
                </Cluster>
              </div>
            ) : (
              <AttentionCard
                tone="positive"
                statusLabel="Current"
                title="Draft matches the saved plan"
                description="Edit an eligible sequence to create a reviewable draft."
              />
            )}
          </PanelBody>
        </Panel>
      </div>
    </Stack>
  )
}

export function BetaPlanPhone({
  projection,
  loading,
}: Pick<BetaPlanAppProps, 'projection' | 'loading'>) {
  const view = projection.plan
  const source = view.source
  return (
    <main
      id="beta-workspace"
      className="beta-phone-workspace beta-plan-phone"
      aria-label="Read-only phone Plan projection"
    >
      <header className="beta-phone-header">
        <div>
          <p>Plan / read only</p>
          <h1>{loading ? 'Loading plan' : view.title}</h1>
        </div>
        <StatusIndicator
          label={loading ? 'Loading' : view.readiness}
          tone={tone(planTone(view))}
        />
      </header>
      <AttentionCard
        tone="warning"
        statusLabel="Read-only on phone"
        title={
          projection.shell.currentRun
            ? 'Accepted run and future plan'
            : 'Future observing plan'
        }
        description="Plan mutations are intentionally unavailable on phone."
      />
      <Panel>
        <PanelHeader
          title="Plan summary"
          meta={`rev ${source?.revision ?? '—'}`}
        />
        <PanelBody>
          <DataList aria-label="Phone Plan summary">
            <DataListItem label="Readiness" value={view.readiness} />
            <DataListItem
              label="Accepted"
              value={
                source?.acceptedRunDefinition
                  ? `rev ${source.acceptedRunDefinition.sourcePlanRevision}`
                  : 'Not accepted'
              }
            />
            <DataListItem
              label="Current"
              value={projection.shell.currentRun?.target ?? 'No active run'}
            />
            <DataListItem
              label="Sequences"
              value={String(source?.sequences.length ?? 0)}
            />
            <DataListItem
              label="Freshness"
              value={projection.shell.freshness}
            />
          </DataList>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="Sequence order" meta="Saved plan" />
        <PanelBody>
          <div className="beta-plan-phone-sequences">
            {(source?.sequences ?? []).map((sequence, index) => (
              <article key={sequence.sequenceId}>
                <b>
                  {String(index + 1).padStart(2, '0')} ·{' '}
                  {sequence.definition.targetName}
                </b>
                <span>{sequencePresentation(sequence).capture}</span>
                <small>
                  {time(sequence.window.startsAt)}–
                  {time(sequence.window.endsAt)} UTC
                </small>
              </article>
            ))}
          </div>
        </PanelBody>
      </Panel>
    </main>
  )
}

function PlanStatusStrip({ projection }: { projection: Projection }) {
  const source = projection.plan.source
  const current = projection.shell.freshness.startsWith('Current ')
  return (
    <footer
      className="beta-operational-status beta-plan-status-strip"
      aria-label="Operational status"
    >
      <span className="beta-plan-status-desktop">
        <i data-tone={tone(planTone(projection.plan))} aria-hidden="true" />
        <b>
          {source?.acceptedRunDefinition ? 'Accepted plan' : 'Plan draft'}
        </b>{' '}
        · {projection.plan.readiness}
      </span>
      <span className="beta-plan-status-desktop">
        Plan · {current ? 'service-owned truth' : 'service truth unavailable'} ·
        revision {source?.revision ?? '—'}
      </span>
      <span className="beta-plan-status-desktop">
        {projection.shell.currentRun?.target ?? 'No active run'} ·{' '}
        {projection.shell.controller}
      </span>
      <span className="beta-plan-status-mobile">
        <i data-tone={tone(planTone(projection.plan))} aria-hidden="true" />
        <b>
          {source?.acceptedRunDefinition ? 'Accepted plan' : 'Plan draft'}
        </b>{' '}
        · {projection.plan.readiness}
      </span>
    </footer>
  )
}

function PlanDesktop({ projection, loading, submit }: BetaPlanAppProps) {
  const source = projection.plan.source
  const [selected, setSelected] = useState(0)
  const [tab, setTab] = useState<PlanTab>('editor')
  const [draft, setDraft] = useState<readonly PlanSequence[]>(
    source?.sequences ?? [],
  )
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<string>()
  const [confirm, setConfirm] = useState<ConfirmAction>()
  const portalRoot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(source?.sequences ?? [])
    setSelected((current) =>
      Math.min(current, Math.max(0, (source?.sequences.length ?? 1) - 1)),
    )
    setResult(undefined)
  }, [source?.planId, source?.revision])

  const changed = changedSequenceCount(source?.sequences, draft)
  const sequence = draft[selected]
  const saveReason = eligibilityReason(source?.actions?.saveDraft)
  const acceptReason = eligibilityReason(source?.actions?.acceptRunDefinition)
  const startReason = eligibilityReason(source?.actions?.startAcceptedRun)
  const canEdit =
    source !== undefined &&
    saveReason === undefined &&
    !projection.shell.readOnly
  const preview = source?.runMutationPreview

  const send = (action: PlanAction, after?: () => void) => {
    if (submit === undefined || pending) return
    setPending(true)
    setResult(undefined)
    void submit(action, IdempotencyKey.make(crypto.randomUUID()))
      .then((submission) =>
        PlanCommandSubmission.$match(submission, {
          Accepted: ({ result: accepted, safeNextAction }) => {
            setResult(`${resultLabel(accepted)} ${safeNextAction}`)
            after?.()
          },
          Rejected: ({ reason, safeNextAction }) =>
            setResult(`${reason} ${safeNextAction}`),
          Unavailable: ({ reason, safeNextAction }) =>
            setResult(`${reason} ${safeNextAction}`),
        }),
      )
      .finally(() => setPending(false))
  }

  const updateSelected = (next: PlanSequence) =>
    setDraft((current) =>
      current.map((item, index) => (index === selected ? next : item)),
    )

  const dialog = useMemo(() => {
    if (confirm?.kind === 'accept')
      return {
        title: `Accept plan revision ${source?.revision ?? '—'}?`,
        description:
          'This creates a frozen run definition. Later Plan edits cannot alter it.',
        tone: 'primary' as const,
        label: 'Accept run definition',
        action: { _tag: 'AcceptRunDefinition' } as PlanAction,
      }
    if (confirm?.kind === 'start')
      return {
        title: 'Start the accepted run?',
        description:
          'The service starts Preflight from the accepted definition. Navigation does not stop it.',
        tone: 'primary' as const,
        label: 'Start accepted run',
        action: { _tag: 'StartAcceptedRun' } as PlanAction,
      }
    if (confirm?.kind === 'apply-preview' && preview)
      return {
        title: preview.approvalRequired
          ? 'Approve this disruptive change?'
          : 'Apply this run change?',
        description: preview.consequences,
        tone: preview.approvalRequired
          ? ('danger' as const)
          : ('primary' as const),
        label: preview.approvalRequired
          ? 'Approve exact impact'
          : 'Apply exact impact',
        action:
          preview.approvalRequired && preview.approvalToken
            ? ({
                _tag: 'ApproveDisruptiveRunMutation',
                previewId: preview.previewId,
                approvalToken: preview.approvalToken,
              } as PlanAction)
            : ({
                _tag: 'ApplyRunMutation',
                previewId: preview.previewId,
              } as PlanAction),
      }
    return undefined
  }, [confirm, preview, source?.revision])

  const banner = source?.acceptedRunDefinition
    ? projection.shell.currentRun
      ? {
          label: 'Observing now',
          detail: `Run froze plan rev ${source.acceptedRunDefinition.sourcePlanRevision}`,
          copy: 'Accepted execution is immutable; review service previews before changing future work.',
          tone: 'positive' as const,
        }
      : {
          label: 'Accepted',
          detail: `Plan rev ${source.acceptedRunDefinition.sourcePlanRevision}`,
          copy: 'The accepted definition is ready to start when control and service eligibility agree.',
          tone: 'positive' as const,
        }
    : {
        label: loading ? 'Loading' : 'Draft plan',
        detail: `Plan rev ${source?.revision ?? '—'}`,
        copy: changed
          ? `${changed} local sequence change${changed === 1 ? '' : 's'} must be saved before acceptance.`
          : projection.plan.detail,
        tone: tone(planTone(projection.plan)),
      }

  if (!loading && source === undefined)
    return (
      <main
        id="beta-workspace"
        className="beta-desktop-workspace beta-plan-workspace"
      >
        <PageHeader
          eyebrow="Plan / Authoritative intent"
          title="Plan unavailable"
        />
        <AttentionCard
          tone="danger"
          statusLabel="No plan projection"
          title="Future observing intent is unavailable"
          description={projection.plan.detail}
          evidence={projection.shell.protection}
        />
      </main>
    )

  return (
    <main
      id="beta-workspace"
      className="beta-desktop-workspace beta-plan-workspace"
      aria-busy={loading}
    >
      <div ref={portalRoot} className="beta-plan-portal" />
      <PageHeader
        className="beta-plan-header"
        eyebrow={
          projection.shell.currentRun
            ? 'Plan / Observing now'
            : 'Plan / Future observing intent'
        }
        title={
          projection.shell.currentRun
            ? 'Accepted run and staged future'
            : 'Plan the next accepted run'
        }
      />
      <div className="beta-plan-freeze-banner">
        <StatusIndicator
          tone={banner.tone}
          label={banner.label}
          detail={banner.detail}
        />
        <span className="beta-plan-freeze-copy">{banner.copy}</span>
        <Button
          size="small"
          disabled={!preview && changed === 0}
          onClick={() => setTab('review')}
        >
          Review changes →
        </Button>
      </div>
      <Tabs
        className="beta-plan-tabs"
        label="Plan views"
        activeId={tab}
        onActiveChange={(id: string) => setTab(id as PlanTab)}
        items={[
          {
            id: 'editor',
            label: 'Night editor',
            content: sequence ? (
              <Stack gap={8}>
                <div className="beta-plan-active-grid">
                  <PlanSequenceList
                    projection={projection}
                    sequences={draft}
                    selected={selected}
                    onSelect={setSelected}
                  />
                  <PlanSchedule sequences={draft} selected={selected} />
                  <Panel as="aside" className="beta-plan-editor">
                    <PanelHeader
                      title={`Sequence ${String(selected + 1).padStart(2, '0')} · editor`}
                      meta={
                        canEdit
                          ? `Stages to rev ${(source?.revision ?? 0) + 1}`
                          : 'Read only'
                      }
                    />
                    <PanelBody>
                      <PlanEditor
                        sequence={sequence}
                        disabled={!canEdit || pending}
                        onChange={updateSelected}
                      />
                      <StatusIndicator
                        tone={changed ? 'warning' : 'positive'}
                        label={
                          changed
                            ? `${changed} sequence change${changed === 1 ? '' : 's'} staged locally`
                            : 'Draft matches saved plan'
                        }
                      />
                      <p className="beta-plan-muted">
                        Only the saved Plan revision is editable. Accepted
                        execution remains frozen.
                      </p>
                    </PanelBody>
                  </Panel>
                </div>
                <div className="beta-plan-action-dock">
                  <div>
                    <b>
                      {result ??
                        (canEdit
                          ? 'Local edits are unsaved until Save draft succeeds.'
                          : (saveReason ?? projection.shell.protection))}
                    </b>
                    <small>
                      Plan revision {source?.revision ?? '—'} · {changed}{' '}
                      changed
                    </small>
                  </div>
                  <Cluster gap={6}>
                    <Button
                      disabled={pending || !changed || saveReason !== undefined}
                      onClick={() =>
                        send({ _tag: 'SaveDraft', sequences: draft })
                      }
                    >
                      Save draft
                    </Button>
                    <Button
                      tone="primary"
                      disabled={pending || changed === 0}
                      onClick={() => setTab('review')}
                    >
                      Review draft ({changed}) →
                    </Button>
                    {acceptReason === undefined ? (
                      <Button
                        tone="primary"
                        disabled={pending || changed > 0}
                        onClick={() => setConfirm({ kind: 'accept' })}
                      >
                        Accept run definition
                      </Button>
                    ) : null}
                    {startReason === undefined ? (
                      <Button
                        tone="primary"
                        disabled={pending}
                        onClick={() => setConfirm({ kind: 'start' })}
                      >
                        Start accepted run
                      </Button>
                    ) : null}
                  </Cluster>
                </div>
              </Stack>
            ) : (
              <AttentionCard
                tone="neutral"
                statusLabel="Loading"
                title="Waiting for Plan detail"
                description="A current service projection is required."
              />
            ),
          },
          {
            id: 'review',
            label: projection.shell.currentRun
              ? 'Run change review'
              : 'Draft vs saved',
            badge: changed || (preview ? 1 : undefined),
            content: (
              <Stack gap={8}>
                <PlanReview
                  projection={projection}
                  accepted={source?.sequences}
                  draft={draft}
                  pending={pending}
                  onPreview={(mutation) =>
                    send({ _tag: 'PreviewRunMutation', mutation })
                  }
                />
                <div className="beta-plan-action-dock">
                  <div>
                    <b>
                      {result ??
                        (preview
                          ? 'Review the exact service consequences before applying.'
                          : 'No command applies silently.')}
                    </b>
                    <small>
                      {preview
                        ? `Preview expires ${preview.expiresAt}`
                        : `${changed} local change${changed === 1 ? '' : 's'}`}
                    </small>
                  </div>
                  <Cluster gap={6}>
                    <Button disabled={pending} onClick={() => setTab('editor')}>
                      Back to editor
                    </Button>
                    {changed > 0 ? (
                      <Button
                        tone="primary"
                        disabled={pending || saveReason !== undefined}
                        onClick={() =>
                          send({ _tag: 'SaveDraft', sequences: draft })
                        }
                      >
                        Save reviewed draft
                      </Button>
                    ) : null}
                    {preview ? (
                      <Button
                        tone={preview.approvalRequired ? 'danger' : 'primary'}
                        disabled={pending}
                        onClick={() => setConfirm({ kind: 'apply-preview' })}
                      >
                        Review exact impact…
                      </Button>
                    ) : null}
                  </Cluster>
                </div>
              </Stack>
            ),
          },
        ]}
      />
      <Dialog
        open={dialog !== undefined}
        onOpenChange={(open: boolean) => {
          if (!open) setConfirm(undefined)
        }}
        title={dialog?.title ?? 'Confirm Plan action'}
        description={dialog?.description}
        portalRoot={portalRoot.current ?? undefined}
        footer={
          <Cluster gap={6}>
            <Button disabled={pending} onClick={() => setConfirm(undefined)}>
              Cancel
            </Button>
            <Button
              tone={dialog?.tone}
              disabled={pending || dialog === undefined}
              onClick={() =>
                dialog && send(dialog.action, () => setConfirm(undefined))
              }
            >
              {pending ? 'Submitting…' : (dialog?.label ?? 'Confirm')}
            </Button>
          </Cluster>
        }
      >
        {preview && confirm?.kind === 'apply-preview' ? (
          <DataList aria-label="Run mutation preview">
            <DataListItem
              label="Classification"
              value={titleCase(preview.classification)}
            />
            <DataListItem label="Expires" value={preview.expiresAt} />
            <DataListItem
              label="Approval"
              value={
                preview.approvalRequired
                  ? 'Explicit approval required'
                  : 'Apply after review'
              }
            />
          </DataList>
        ) : null}
      </Dialog>
    </main>
  )
}

export function BetaPlanApp(props: BetaPlanAppProps) {
  const phone = usePhoneProjection()
  return (
    <div
      className="beta-app nb-theme"
      data-nb-theme="nightbook"
      data-nb-density="compact"
    >
      <a className="beta-skip-link" href="#beta-workspace">
        Skip to Plan
      </a>
      <BetaCommandBar
        projection={props.projection}
        loading={props.loading}
        workspace="plan"
        submitControl={props.submitControl}
        allowControlAction={!phone}
      />
      {phone ? (
        <BetaPlanPhone projection={props.projection} loading={props.loading} />
      ) : (
        <PlanDesktop {...props} />
      )}
      <PlanStatusStrip projection={props.projection} />
    </div>
  )
}

export default BetaPlanApp
