import { useEffect, useState } from 'react'
import {
  IdempotencyKey,
  PlanCommandResult,
  type PlanWorkspaceProjection,
} from '@astro-console/v2-contracts'
import { PlanCommandSubmission, type PlanAction } from '../plan-command-client'
import type { PlanView as View } from '../presentation'
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
            {view.detailAvailable ? 'Tonight / 25 July' : 'Plan availability'}
          </span>
          <h1 tabIndex={-1}>{view.title}</h1>
        </div>
        <Status tone="attention" className="plan-heading__readiness">
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
            <strong>0{index + 1}</strong>
            <b>{item.target}</b>
            <small>
              {item.capture} · {compactWindow(item.window)}
            </small>
          </button>
        ))}
      </aside>
      <section className="plan-evidence">
        {view.detailAvailable ? (
          <div
            className="sky-field"
            role="img"
            aria-label="Night sky with independent target motion arcs"
          >
            <i className="arc arc--one" />
            <i className="arc arc--two" />
            <i className="arc arc--three" />
            <span>Independent target motion, not telescope travel</span>
          </div>
        ) : (
          <div className="sky-field plan-unavailable" role="status">
            Sky and observing-window evidence are unavailable from bootstrap.
          </div>
        )}
        <p className="plan-readiness">{view.readiness}</p>
      </section>
      <aside className="plan-inspector">
        <span>Selected sequence</span>
        <h2>{sequence?.target ?? 'No sequence available'}</h2>
        {view.detailAvailable ? (
          <Evidence
            label={`${sequence?.target ?? 'Selected target'} evidence`}
          />
        ) : (
          <p>Selected-sequence evidence is unavailable from bootstrap.</p>
        )}
        <dl>
          <div>
            <dt>Window</dt>
            <dd>{sequence?.window}</dd>
          </div>
          <div>
            <dt>Capture</dt>
            <dd>{sequence?.capture}</dd>
          </div>
          <div>
            <dt>Viability</dt>
            <dd>{sequence?.readiness ?? view.readiness}</dd>
          </div>
        </dl>
        <p>{view.detail}</p>
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
        {view.detailAvailable ? (
          <>
            <span>21:00</span>
            {view.sequences.map((item, index) => (
              <button
                key={item.id}
                data-selected={index === selected}
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
              >
                {item.target}
                <small>{item.window}</small>
              </button>
            ))}
            <span>Dawn 04:32</span>
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

function compactWindow(window: string) {
  const [startsAt, endsAt] = window.split(' – ')
  if (startsAt === undefined || endsAt === undefined) return window
  return `${startsAt.slice(11, 16)}–${endsAt.slice(11, 16)} UTC`
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
