import { Fragment, useEffect, useState } from 'react'
import {
  IdempotencyKey,
  PlanCommandResult,
  type PlanWorkspaceProjection,
} from '@astro-console/v2-contracts'
import { PlanCommandSubmission, type PlanAction } from '../plan-command-client'
import type {
  PlanSequenceView,
  PlanView as View,
  StatusTone,
} from '../presentation'
import { Evidence, Status } from './shared'

type PlanIneligibilityReason = Extract<
  NonNullable<NonNullable<PlanWorkspaceProjection['actions']>['saveDraft']>,
  { _tag: 'Ineligible' }
>['reason']

export function PlanView({
  view,
  submit,
}: {
  view: View
  submit?: (
    action: PlanAction,
    key: typeof IdempotencyKey.Type,
  ) => Promise<PlanCommandSubmission>
}) {
  const [selected, setSelected] = useState(0)
  const [result, setResult] = useState<string>()
  const [draft, setDraft] =
    useState<ReadonlyArray<PlanWorkspaceProjection['sequences'][number]>>()
  const [now, setNow] = useState(Date.now)
  const sequence = view.sequences[selected]
  const source = view.source
  const preview = source?.runMutationPreview
  const previewDeadline = preview && Date.parse(preview.expiresAt)
  const previewExpired = previewDeadline !== undefined && now >= previewDeadline
  useEffect(() => {
    setDraft(undefined)
    setResult(undefined)
  }, [
    source?.revision,
    source?.acceptedRunDefinition?.id,
    source?.planId,
    view.snapshotVersion,
    view.runRevision,
  ])
  useEffect(() => {
    setNow(Date.now())
    if (previewDeadline === undefined || previewDeadline <= Date.now()) return
    const timeout = setTimeout(
      () => setNow(previewDeadline),
      previewDeadline - Date.now(),
    )
    return () => clearTimeout(timeout)
  }, [preview?.previewId, preview?.expiresAt])
  const arcs = view.detailAvailable ? skyArcs(view.sequences) : []
  const timeline = view.detailAvailable
    ? planTimeline(view.sequences)
    : undefined
  const displayedDraft = draft ?? source?.sequences
  const canEditDraft =
    view.actionReason === undefined &&
    source?.actions?.saveDraft._tag === 'Eligible'
  const draftChanged =
    displayedDraft !== undefined &&
    JSON.stringify(displayedDraft) !== JSON.stringify(source?.sequences)
  const unavailableExplanation = planActionExplanation(
    view.actionReason,
    source?.actions,
  )
  const send = (action: PlanAction) => {
    if (submit === undefined) return
    void submit(action, IdempotencyKey.make(crypto.randomUUID())).then(
      (submission) =>
        PlanCommandSubmission.$match(submission, {
          Accepted: ({ result: accepted, safeNextAction }) => {
            setResult(`${resultLabel(accepted)} ${safeNextAction}`)
          },
          Rejected: ({ reason, safeNextAction }) =>
            setResult(`${reason} ${safeNextAction}`),
          Unavailable: ({ reason, safeNextAction }) =>
            setResult(`${reason} ${safeNextAction}`),
        }),
    )
  }
  return (
    <div className="workspace plan-workspace">
      <header className="workspace-heading">
        <div>
          <span>
            {view.detailAvailable
              ? nightLabel(view.sequences)
              : 'Plan availability'}
          </span>
          <h1 tabIndex={-1}>{view.title}</h1>
        </div>
        <Status tone={view.tone} className="plan-heading__readiness">
          {view.readiness}
        </Status>
      </header>
      <aside className="sequence-list">
        <span>Ordered sequences</span>
        {view.sequences.map((item, index) => (
          <button
            key={item.id}
            data-selected={index === selected}
            aria-pressed={index === selected}
            onClick={() => setSelected(index)}
          >
            <strong>{String(index + 1).padStart(2, '0')}</strong>
            <b>{item.target}</b>
            <small>{item.capture}</small>
            <small>
              {formatTimeUTC(item.windowStart)}–{formatTimeUTC(item.windowEnd)}{' '}
              UTC
            </small>
            <small>
              est. {formatDurationMinutes(item.estimatedMinutes)}
              {item.viability !== 'viable' && (
                <>
                  {' '}
                  ·{' '}
                  <span
                    className={`fact-tone fact-tone--${toneOf.viability(item.viability)}`}
                  >
                    {viabilityLabel(item.viability)}
                  </span>
                </>
              )}
            </small>
          </button>
        ))}
      </aside>
      <section className="plan-evidence">
        {view.detailAvailable ? (
          <div
            className="sky-field"
            role="img"
            aria-label={`Apparent sky motion for ${arcs
              .map((arc) => arc.target)
              .join(', ')} during the plan window`}
          >
            <i className="sky-field__horizon" />
            {arcs.map((arc) => (
              <Fragment key={arc.target}>
                <i
                  className="arc"
                  data-selected={sequence?.target === arc.target}
                  style={{
                    left: `${arc.left}%`,
                    width: `${arc.width}%`,
                    height: `${arc.height}%`,
                  }}
                />
                <span
                  className="sky-field__target"
                  style={{ left: `${arc.left}%` }}
                >
                  {arc.target} · peaks {Math.round(arc.peakAltitudeDeg)}°
                </span>
              </Fragment>
            ))}
            <span className="sky-field__caption">
              Apparent target motion across the plan window, not telescope
              travel.
            </span>
          </div>
        ) : (
          <div className="sky-field plan-unavailable" role="status">
            Sky and observing-window evidence are unavailable from bootstrap.
          </div>
        )}
      </section>
      <aside className="plan-inspector">
        <span>Selected sequence</span>
        <h2>{sequence?.target ?? 'No sequence available'}</h2>
        {view.detailAvailable && sequence ? (
          <>
            <Evidence label={`${sequence.target} evidence`} />
            <dl>
              <div>
                <dt>Window</dt>
                <dd>
                  {formatWindowRange(sequence.windowStart, sequence.windowEnd)}
                </dd>
              </div>
              <div>
                <dt>Usable window</dt>
                <dd>{formatDurationMinutes(sequence.usableMinutes)}</dd>
              </div>
              <div>
                <dt>Capture</dt>
                <dd>{sequence.capture}</dd>
              </div>
              <div>
                <dt>Estimated capture</dt>
                <dd>{formatDurationMinutes(sequence.estimatedMinutes)}</dd>
              </div>
              <div>
                <dt>Storage forecast</dt>
                <dd>
                  {formatStorage(sequence.storageForecastMb)}
                  {sequence.storage !== 'available' && (
                    <>
                      {' '}
                      ·{' '}
                      <span
                        className={`fact-tone fact-tone--${toneOf.storage(sequence.storage)}`}
                      >
                        {storageLabel(sequence.storage)}
                      </span>
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>Peak altitude</dt>
                <dd>{Math.round(sequence.peakAltitudeDeg)}°</dd>
              </div>
              <div>
                <dt>Horizon</dt>
                <dd>
                  <span
                    className={`fact-tone fact-tone--${toneOf.horizon(sequence.horizon)}`}
                  >
                    {horizonLabel(sequence.horizon)}
                  </span>{' '}
                  · {Math.round(sequence.horizonClearanceDeg)}° clearance
                </dd>
              </div>
              <div>
                <dt>Viability</dt>
                <dd>
                  <span
                    className={`fact-tone fact-tone--${toneOf.viability(sequence.viability)}`}
                  >
                    {viabilityLabel(sequence.viability)}
                  </span>
                </dd>
              </div>
            </dl>
            <p className="plan-profile">
              {sequence.acquisition} {sequence.stopCondition}
            </p>
            <p>{view.detail}</p>
          </>
        ) : (
          <>
            <p>Selected-sequence evidence is unavailable from bootstrap.</p>
            <p>{view.detail}</p>
          </>
        )}
        {view.source && (
          <p className="plan-draft-status" role="status">
            {planDraftStatus(view.source.revision, draftChanged)}
          </p>
        )}
        {view.source?.acceptedRunDefinition && (
          <p className="plan-definition-status">
            Immutable accepted fake RunDefinition{' '}
            {view.source.acceptedRunDefinition.id} from saved Plan revision{' '}
            {view.source.acceptedRunDefinition.sourcePlanRevision}. Later Plan
            edits do not alter it. Acceptance does not start a run or observe
            completion.
          </p>
        )}
        {view.source && (
          <section className="action-boundary" aria-label="Plan actions">
            {unavailableExplanation && <p>{unavailableExplanation}</p>}
            {canEditDraft && draftChanged && (
              <PlanActionButton
                label="Save draft"
                eligibility={view.source.actions?.saveDraft}
                onClick={() =>
                  displayedDraft &&
                  send({ _tag: 'SaveDraft', sequences: displayedDraft })
                }
              />
            )}
            {canEditDraft && source && sequence && (
              <button
                className="button-secondary"
                onClick={() =>
                  setDraft(
                    source.sequences.map((item, index) =>
                      index !== selected
                        ? item
                        : {
                            ...item,
                            estimatedMinutes: Math.max(
                              1,
                              item.estimatedMinutes - 15,
                            ),
                            capture: `${item.capture} · shortened`,
                          },
                    ),
                  )
                }
              >
                Shorten selected sequence
              </button>
            )}
            {view.actionReason === undefined && (
              <>
                <PlanActionButton
                  label="Accept run definition"
                  eligibility={view.source.actions?.acceptRunDefinition}
                  onClick={() => send({ _tag: 'AcceptRunDefinition' })}
                />
                <PlanActionButton
                  label="Start accepted fake run"
                  eligibility={view.source.actions?.startAcceptedRun}
                  onClick={() => send({ _tag: 'StartAcceptedRun' })}
                />
                <PlanActionButton
                  label="Preview shorten second sequence"
                  eligibility={view.source.actions?.previewRunMutation}
                  onClick={() =>
                    send({
                      _tag: 'PreviewRunMutation',
                      mutation: 'shortenSecond',
                    })
                  }
                />
                <PlanActionButton
                  label="Preview discard current sequence"
                  eligibility={view.source.actions?.previewRunMutation}
                  onClick={() =>
                    send({
                      _tag: 'PreviewRunMutation',
                      mutation: 'discardCurrent',
                    })
                  }
                />
              </>
            )}
            {view.actionReason === undefined && preview && (
              <div>
                <p>{preview.consequences}</p>
                {previewExpired ? (
                  <p role="status">
                    This preview expired. Refresh the Plan to request a current
                    preview.
                  </p>
                ) : (
                  <>
                    <p>Available until {preview.expiresAt}</p>
                    <PlanActionButton
                      label={
                        preview.approvalRequired
                          ? 'Approve exact preview'
                          : 'Apply exact preview'
                      }
                      eligibility={
                        preview.approvalRequired
                          ? view.source.actions?.approveDisruptiveRunMutation
                          : view.source.actions?.applyRunMutation
                      }
                      onClick={() =>
                        send(
                          preview.approvalRequired && preview.approvalToken
                            ? {
                                _tag: 'ApproveDisruptiveRunMutation',
                                previewId: preview.previewId,
                                approvalToken: preview.approvalToken,
                              }
                            : {
                                _tag: 'ApplyRunMutation',
                                previewId: preview.previewId,
                              },
                        )
                      }
                    />
                  </>
                )}
              </div>
            )}
            {result && <p role="status">{result}</p>}
          </section>
        )}
      </aside>
      <footer className="plan-timeline">
        {timeline ? (
          <>
            <div className="plan-timeline__ruler">
              <span>{timeline.startLabel}</span>
              <span>{timeline.endLabel}</span>
            </div>
            <div className="plan-timeline__lanes">
              {view.sequences.map((item, index) => {
                const startMs = Date.parse(item.windowStart)
                const endMs = Date.parse(item.windowEnd)
                const left =
                  ((startMs - timeline.startMs) / timeline.spanMs) * 100
                const width = Math.max(
                  4,
                  ((endMs - startMs) / timeline.spanMs) * 100,
                )
                const fill =
                  item.usableMinutes > 0
                    ? Math.min(1, item.estimatedMinutes / item.usableMinutes)
                    : 0
                return (
                  <div className="plan-timeline__lane" key={item.id}>
                    <button
                      data-selected={index === selected}
                      aria-pressed={index === selected}
                      onClick={() => setSelected(index)}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <b>{item.capture}</b>
                      <small>
                        {formatTimeUTC(item.windowStart)} –{' '}
                        {formatTimeUTC(item.windowEnd)} · est.{' '}
                        {formatDurationMinutes(item.estimatedMinutes)}
                      </small>
                      <i
                        className="plan-timeline__estimate"
                        style={{ width: `${fill * 100}%` }}
                      />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <p>Schedule detail is unavailable from bootstrap.</p>
        )}
      </footer>
    </div>
  )
}

function PlanActionButton({
  label,
  eligibility,
  onClick,
}: {
  label: string
  eligibility:
    | NonNullable<PlanWorkspaceProjection['actions']>[keyof NonNullable<
        PlanWorkspaceProjection['actions']
      >]
    | undefined
  onClick: () => void
}) {
  if (eligibility?._tag === 'Eligible')
    return (
      <button className="button-primary" onClick={onClick}>
        {label}
      </button>
    )
  return null
}

function planActionExplanation(
  actionReason: string | undefined,
  actions: PlanWorkspaceProjection['actions'],
) {
  if (actionReason !== undefined) return actionReason
  const reasons = actions
    ? [
        ...new Set(
          Object.values(actions).flatMap((eligibility) =>
            eligibility._tag === 'Ineligible'
              ? [ineligibilityExplanation(eligibility.reason)]
              : [],
          ),
        ),
      ]
    : []
  return reasons.length === 0
    ? undefined
    : `Some Plan actions are unavailable: ${reasons.join(' ')}`
}

export function planDraftStatus(revision: number, draftChanged: boolean) {
  return draftChanged
    ? 'Unsaved draft changes'
    : `Saved draft revision ${revision}`
}

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const MONTHS_SHORT = MONTHS_LONG.map((month) => month.slice(0, 3))

export function formatTimeUTC(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatDateUTC(iso: string, style: 'long' | 'short') {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const month =
    style === 'long'
      ? MONTHS_LONG[date.getUTCMonth()]
      : MONTHS_SHORT[date.getUTCMonth()]
  const day = date.getUTCDate()
  return style === 'long'
    ? `${day} ${month} ${date.getUTCFullYear()}`
    : `${day} ${month}`
}

function sameUTCDay(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  return (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate()
  )
}

export function formatWindowRange(startIso: string, endIso: string) {
  if (sameUTCDay(startIso, endIso))
    return `${formatDateUTC(startIso, 'short')} · ${formatTimeUTC(startIso)} – ${formatTimeUTC(endIso)} UTC`
  return `${formatDateUTC(startIso, 'short')} ${formatTimeUTC(startIso)} – ${formatDateUTC(endIso, 'short')} ${formatTimeUTC(endIso)} UTC`
}

export function formatDurationMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours === 0 ? `${rest} m` : `${hours} h ${rest} m`
}

export function formatStorage(megabytes: number) {
  return megabytes < 1000
    ? `${megabytes} MB`
    : `${(megabytes / 1000).toFixed(1)} GB`
}

export function nightLabel(sequences: readonly PlanSequenceView[]) {
  const first = sequences[0]
  if (first === undefined) return 'Plan availability'
  const startIso = sequences.reduce(
    (earliest, item) =>
      Date.parse(item.windowStart) < Date.parse(earliest)
        ? item.windowStart
        : earliest,
    first.windowStart,
  )
  const endIso = sequences.reduce(
    (latest, item) =>
      Date.parse(item.windowEnd) > Date.parse(latest) ? item.windowEnd : latest,
    first.windowEnd,
  )
  if (sameUTCDay(startIso, endIso))
    return `Plan night · ${formatDateUTC(startIso, 'long')}`
  const start = new Date(startIso)
  const end = new Date(endIso)
  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  return sameMonth
    ? `Plan window · ${start.getUTCDate()} – ${formatDateUTC(endIso, 'long')}`
    : `Plan window · ${formatDateUTC(startIso, 'long')} – ${formatDateUTC(endIso, 'long')}`
}

export function skyArcs(sequences: readonly PlanSequenceView[]) {
  const targets = [...new Set(sequences.map((item) => item.target))]
  const slot = 100 / Math.max(1, targets.length)
  return targets.map((target, index) => {
    const group = sequences.filter((item) => item.target === target)
    const peakAltitudeDeg = Math.max(
      ...group.map((item) => item.peakAltitudeDeg),
    )
    const width = Math.min(52, slot * 0.76)
    return {
      target,
      peakAltitudeDeg,
      width,
      left: index * slot + (slot - width) / 2,
      height: 15 + (Math.max(0, Math.min(90, peakAltitudeDeg)) / 90) * 50,
    }
  })
}

export function planTimeline(sequences: readonly PlanSequenceView[]) {
  const first = sequences[0]
  if (first === undefined) return undefined
  const startMs = Math.min(
    ...sequences.map((item) => Date.parse(item.windowStart)),
  )
  const endMs = Math.max(...sequences.map((item) => Date.parse(item.windowEnd)))
  const spanMs = Math.max(1, endMs - startMs)
  const startIso = sequences.find(
    (item) => Date.parse(item.windowStart) === startMs,
  )!.windowStart
  const endIso = sequences.find(
    (item) => Date.parse(item.windowEnd) === endMs,
  )!.windowEnd
  const sameDay = sameUTCDay(startIso, endIso)
  return {
    startMs,
    endMs,
    spanMs,
    startLabel: sameDay
      ? formatTimeUTC(startIso)
      : `${formatDateUTC(startIso, 'short')} ${formatTimeUTC(startIso)}`,
    endLabel: sameDay
      ? `${formatTimeUTC(endIso)} UTC`
      : `${formatDateUTC(endIso, 'short')} ${formatTimeUTC(endIso)} UTC`,
  }
}

export const toneOf = {
  viability: (value: PlanSequenceView['viability']): StatusTone =>
    value === 'viable' ? 'safe' : value === 'limited' ? 'attention' : 'danger',
  horizon: (value: PlanSequenceView['horizon']): StatusTone =>
    value === 'clear'
      ? 'safe'
      : value === 'limited'
        ? 'attention'
        : value === 'blocked'
          ? 'danger'
          : 'neutral',
  storage: (value: PlanSequenceView['storage']): StatusTone =>
    value === 'available'
      ? 'safe'
      : value === 'limited'
        ? 'attention'
        : value === 'blocked'
          ? 'danger'
          : 'neutral',
}

export function viabilityLabel(value: PlanSequenceView['viability']) {
  return value === 'viable'
    ? 'Viable'
    : value === 'limited'
      ? 'Limited'
      : 'Blocked'
}

export function horizonLabel(value: PlanSequenceView['horizon']) {
  return value === 'clear'
    ? 'Clear'
    : value === 'limited'
      ? 'Limited'
      : value === 'blocked'
        ? 'Blocked'
        : 'Not assessed'
}

export function storageLabel(value: PlanSequenceView['storage']) {
  return value === 'available'
    ? 'Available'
    : value === 'limited'
      ? 'Limited'
      : value === 'blocked'
        ? 'Blocked'
        : 'Not assessed'
}

function ineligibilityExplanation(reason: PlanIneligibilityReason) {
  const explanations: Record<PlanIneligibilityReason, string> = {
    ownerRequired: 'Only the owner can make this change.',
    readOnlyClient: 'This client is read-only.',
    controlRequired: 'The current controller is required.',
    planNotReady: 'The saved Plan is not ready for that action.',
    acceptedDefinitionRequired: 'An accepted RunDefinition is required first.',
    activeRunRequired: 'An active fake run is required first.',
    activeRunPresent: 'Resolve the active fake run before changing the Plan.',
    definitionAlreadyAccepted:
      'This saved Plan revision already has an accepted definition.',
    terminalRun: 'The fake run is already terminal.',
    pausedRun: 'Resume the fake run before this action.',
    runAdvanced: 'The fake run advanced; request a current preview.',
    previewRequired: 'Request an exact preview before applying this change.',
  }
  return explanations[reason]
}

function resultLabel(result: typeof PlanCommandResult.Type) {
  return PlanCommandResult.match(result, {
    DraftSaved: () =>
      'Draft save was accepted durably. Await the authoritative saved revision.',
    RunDefinitionAccepted: () =>
      'The immutable RunDefinition was accepted; this does not start or observe a run.',
    RunStarted: () => 'The fake run start was accepted by the service.',
    RunMutationPreviewed: () =>
      'The exact mutation preview is available for review.',
    RunMutationApplied: () =>
      'The exact preview application was accepted by the service.',
  })
}
