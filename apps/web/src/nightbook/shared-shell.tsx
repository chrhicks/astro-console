import {
  Button,
  DataList,
  DataListItem,
  StatusIndicator,
  type Tone,
} from '@nightbook/ui'
import { useEffect, useId, useRef, useState } from 'react'
import {
  ControlAction,
  type CommandSubmission,
  type ControlAction as SemanticControlAction,
} from '../command-client'
import type {
  HealthFact,
  Projection,
  ShellView,
  StatusTone,
} from '../presentation'
import { nightbookHref } from '../route-href'
import { DevelopmentSimulationStrip } from './development-simulation'

export type ControlSubmit = (
  action: SemanticControlAction,
) => Promise<CommandSubmission>

export type ControlPresentation = {
  label: string
  dialogLabel: string
  heading: string
  state: string
  tone: 'neutral' | 'positive' | 'warning' | 'danger' | 'info'
  subjectLabel: string
  subject: string
  presence: string
  protection: string
}

type RunPresentation = {
  label: string
  percent: number | undefined
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

const titleCase = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())

const healthSlotLabels = ['Service', 'Rig', 'Tunnel', 'Processing', 'Storage']

const healthFacts = (health: readonly HealthFact[]): readonly HealthFact[] =>
  healthSlotLabels.map(
    (label) =>
      health.find(
        (candidate) => candidate.label.toLowerCase() === label.toLowerCase(),
      ) ?? {
        label,
        state: 'unknown',
        summary: `${label} health is unknown without an authoritative projection.`,
        detail: `${label} health is unknown without an authoritative projection.`,
        tone: 'neutral',
      },
  )

function Health({ health }: { health: readonly HealthFact[] }) {
  const id = useId()
  return (
    <div className="nightbook-health" aria-label="System health">
      {healthFacts(health).map((fact, index) => {
        const tooltipId = `${id}-${index}`
        return (
          <div
            className="nightbook-health-item"
            data-tone={tone(fact.tone)}
            key={fact.label}
          >
            <button
              type="button"
              aria-label={`${fact.label}: ${fact.state}. ${fact.summary}`}
              aria-describedby={tooltipId}
            >
              <i aria-hidden="true" />
            </button>
            <span role="tooltip" id={tooltipId}>
              <b>{fact.label}</b>
              {fact.state} · {fact.summary}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const controlLabel = (shell: ShellView, loading: boolean) => {
  if (loading) return 'Control · wait'
  if (shell.readOnly) return 'Control · view'
  return 'Control · you'
}

export const projectedControlActions = (shell: ShellView) =>
  shell.control.readOnly ? [] : shell.control.actions

const semanticControlAction = (
  action: ShellView['control']['actions'][number],
): SemanticControlAction => {
  switch (action.kind) {
    case 'request':
      return ControlAction.RequestControl({})
    case 'release':
      return ControlAction.ReleaseControl({})
    case 'take':
      return ControlAction.TakeControl({})
    case 'grant':
      return ControlAction.GrantControl({
        requestId: action.requestId,
        targetClientId: action.targetClientId,
      })
    case 'decline':
      return ControlAction.DeclineControl({ requestId: action.requestId })
  }
}

const controlActionKey = (action: ShellView['control']['actions'][number]) =>
  action.kind === 'grant' || action.kind === 'decline'
    ? `${action.kind}-${action.requestId}`
    : action.kind

export function ControlActionList({
  actions,
  loading,
  pending,
  pendingAction,
  submitControl,
  submitAction,
}: {
  actions: ShellView['control']['actions']
  loading: boolean
  pending: boolean
  pendingAction?: string | undefined
  submitControl: ControlSubmit | undefined
  submitAction: (action: ShellView['control']['actions'][number]) => void
}) {
  return (
    <div className="nightbook-control-actions">
      {actions.map((action) => {
        const actionKey = controlActionKey(action)
        return (
          <Button
            key={actionKey}
            tone={
              action.kind === 'release'
                ? 'danger'
                : action.kind === 'decline'
                  ? 'neutral'
                  : 'primary'
            }
            size="small"
            disabled={loading || pending || submitControl === undefined}
            title={
              submitControl === undefined
                ? 'Control command service is not ready.'
                : undefined
            }
            onClick={() => submitAction(action)}
          >
            {pending &&
            (pendingAction === undefined || pendingAction === actionKey)
              ? `${action.label} pending…`
              : action.label}
          </Button>
        )
      })}
    </div>
  )
}

function Control({
  shell,
  loading,
  presentation,
  submitControl,
  allowAction,
}: {
  shell: ShellView
  loading: boolean
  presentation: ControlPresentation | undefined
  submitControl: ControlSubmit | undefined
  allowAction: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | undefined>()
  const [message, setMessage] = useState<string | undefined>()
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const actions = allowAction ? projectedControlActions(shell) : []
  const submitAction = (action: ShellView['control']['actions'][number]) => {
    if (
      shell.control.readOnly ||
      submitControl === undefined ||
      pendingAction !== undefined
    )
      return
    setPendingAction(controlActionKey(action))
    setMessage(undefined)
    void submitControl(semanticControlAction(action)).then(
      (result) => {
        setPendingAction(undefined)
        setMessage(
          result._tag === 'Accepted'
            ? 'Control action recorded. Waiting for the current service projection.'
            : `${result._tag === 'Rejected' ? result.failure.summary : result.reason} ${result.safeNextAction}`,
        )
      },
      () => {
        setPendingAction(undefined)
        setMessage('Control action could not reach the service.')
      },
    )
  }
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      requestAnimationFrame(() => triggerRef.current?.focus())
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])
  return (
    <div className="nightbook-control">
      <button
        ref={triggerRef}
        className="nightbook-control-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {presentation?.label ?? controlLabel(shell, loading)}
      </button>
      {open ? (
        <section
          className="nightbook-control-flyout"
          id={panelId}
          role="dialog"
          aria-label={presentation?.dialogLabel ?? 'Control state'}
        >
          <header>
            <b>{presentation?.heading ?? 'Control state'}</b>
            <StatusIndicator
              label={presentation?.state ?? shell.control.state}
              tone={
                presentation?.tone ?? (shell.readOnly ? 'warning' : 'positive')
              }
            />
          </header>
          <DataList>
            <DataListItem
              label={presentation?.subjectLabel ?? 'Controller'}
              value={presentation?.subject ?? shell.controller}
            />
            <DataListItem
              label="Presence"
              value={presentation?.presence ?? shell.control.presence}
            />
            <DataListItem
              label="Revision"
              value={String(shell.control.revision)}
            />
          </DataList>
          <p>
            {presentation?.protection ??
              (actions.length > 0 && shell.readOnly
                ? 'Workspace actions remain read-only until the service grants control.'
                : shell.protection)}
          </p>
          {message ? <p role="status">{message}</p> : null}
          {actions.length > 0 && !shell.control.readOnly ? (
            <ControlActionList
              actions={actions}
              loading={loading}
              pending={pendingAction !== undefined}
              pendingAction={pendingAction}
              submitControl={submitControl}
              submitAction={submitAction}
            />
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

const projectedRunPresentation = (
  projection: Projection,
  loading: boolean,
): RunPresentation => {
  const run = projection.shell.currentRun
  return {
    label: run?.phase ?? (loading ? 'Loading' : 'No run'),
    percent:
      run === undefined || run.progressMax <= 0
        ? undefined
        : Math.round((run.progressValue / run.progressMax) * 100),
  }
}

export function CommandBar({
  projection,
  loading,
  workspace = 'observe',
  controlPresentation,
  submitControl,
  allowControlAction = true,
  runPresentation,
}: {
  projection: Projection
  loading: boolean
  workspace?: 'plan' | 'observe' | 'library' | 'process'
  controlPresentation?: ControlPresentation | undefined
  submitControl?: ControlSubmit | undefined
  allowControlAction?: boolean
  runPresentation?: RunPresentation | undefined
}) {
  const run = projection.shell.currentRun
  const currentRun =
    runPresentation ?? projectedRunPresentation(projection, loading)
  const workspaceLabel = titleCase(workspace)
  return (
    <div className="nightbook-shell-header">
      <header className="nightbook-command-bar">
        <a
          className="nightbook-brand"
          href={nightbookHref(`/${workspace}`)}
          aria-label={`Nightbook ${workspaceLabel}`}
        >
          <span aria-hidden="true">N</span>
          <span>
            <strong>Nightbook</strong>
            <small>Backyard observatory</small>
          </span>
        </a>
        <nav aria-label="Workspaces">
          <a
            href={nightbookHref('/plan')}
            aria-current={workspace === 'plan' ? 'page' : undefined}
          >
            Plan
          </a>
          <a
            href={nightbookHref('/observe')}
            aria-current={workspace === 'observe' ? 'page' : undefined}
          >
            Observe
          </a>
          <a
            href={nightbookHref('/library')}
            aria-current={workspace === 'library' ? 'page' : undefined}
          >
            Library
          </a>
          <a
            href={nightbookHref('/process')}
            aria-current={workspace === 'process' ? 'page' : undefined}
          >
            Process
          </a>
        </nav>
        <div className="nightbook-run-capsule" aria-label="Current run">
          <i
            data-active={run === undefined ? 'false' : 'true'}
            aria-hidden="true"
          />
          <b>{run?.target ?? (loading ? 'WAIT' : 'NONE')}</b>
          <span>{currentRun.label}</span>
          <strong>
            {currentRun.percent === undefined ? '—' : `${currentRun.percent}%`}
          </strong>
        </div>
        <Health health={projection.shell.health} />
        <Control
          shell={projection.shell}
          loading={loading}
          presentation={controlPresentation}
          submitControl={submitControl}
          allowAction={allowControlAction}
        />
      </header>
      <DevelopmentSimulationStrip readOnly={projection.shell.readOnly} />
    </div>
  )
}
