import { useEffect, useState, type PropsWithChildren } from 'react'
import { CommandId, IdempotencyKey } from '@astro-console/v2-contracts'
import type { ControlIntent } from './command-client'
import {
  ActionResult,
  type ActionResult as ActionResultType,
  type ShellView,
  type Workspace,
} from './presentation'
import type { Route } from './routes'
import { Status } from './workspaces/shared'

const workspaces: readonly Workspace[] = [
  'plan',
  'observe',
  'library',
  'process',
]

export function Shell({
  workspace,
  view,
  link,
  result,
  submitControl,
  children,
}: PropsWithChildren<{
  workspace: Workspace | undefined
  view: ShellView
  link: (route: Exclude<Route, { kind: 'not-found' }>) => {
    href: string
    onClick: React.MouseEventHandler<HTMLAnchorElement>
  }
  result: ActionResultType | undefined
  submitControl?: (intent: ControlIntent) => Promise<{
    readonly _tag: 'Accepted' | 'Rejected' | 'Unavailable'
    readonly safeNextAction: string
    readonly reason?: string
    readonly failure?: { readonly summary: string }
  }>
}>) {
  return (
    <main className="app-shell">
      <header className="app-shell__header">
        <a
          className="brand"
          aria-label="Open Plan workspace"
          {...link({ kind: 'workspace', workspace: 'plan' })}
        >
          <img src="/alignment-aperture-light.svg" alt="" />
          <strong>NIGHTBOOK</strong>
          <small>Backyard observatory</small>
        </a>
        <nav className="workspace-nav" aria-label="Workspaces">
          {workspaces.map((item) => (
            <a
              key={item}
              aria-current={workspace === item ? 'page' : undefined}
              {...link({ kind: 'workspace', workspace: item })}
            >
              {item}
            </a>
          ))}
        </nav>
        <div
          className="service-state"
          data-attention={view.attention !== 'safe'}
        >
          <span>{view.environment}</span>
          <b>{view.service}</b>
        </div>
      </header>
      <section
        className="status-anchor"
        aria-label="Current run monitoring register"
      >
        <div className="status-anchor__summary">
          <Status
            tone={
              view.attention === 'danger'
                ? 'danger'
                : view.attention === 'attention'
                  ? 'attention'
                  : 'safe'
            }
          >
            {view.freshness}
          </Status>
          {view.currentRun && (
            <>
              <b>{view.currentRun.target}</b>
              <span>{view.currentRun.phase}</span>
            </>
          )}
          <span>{view.controller}</span>
          <span className="status-anchor__health-glance">
            {view.health.map((fact) => fact.summary).join(' · ')}
          </span>
          {workspace !== 'observe' && view.currentRun && (
            <a className="return-to-observe" {...link({ kind: 'workspace', workspace: 'observe' })}>
              Return to Observe
            </a>
          )}
        </div>
        {view.currentRun && (
          <div className="status-anchor__progress">
            <progress
              value={view.currentRun.progressValue}
              max={view.currentRun.progressMax}
            >
              {view.currentRun.progress}
            </progress>
            <span>{view.currentRun.progress}</span>
            <span>{view.currentRun.sequenceProgress}</span>
            <span>{view.currentRun.estimatedCompletion}</span>
          </div>
        )}
        <details className="status-anchor__details">
          <summary aria-label="Open current run status details">
            Full status and service detail
          </summary>
          <div className="status-anchor__authority">
            <span>{view.membership}</span><span>{view.remoteAvailability}</span>
            <span>{view.authority}</span><span>{view.presence}</span>
            <span>{view.attentionOwner}</span><span>{view.service}</span>
            <span>{view.capability}</span><span>{view.protection}</span>
          </div>
          <div className="status-anchor__health" aria-label="Service health details">
            {view.health.map((fact) => (
              <Status key={fact.label} tone={fact.tone}>
                {fact.detail}
              </Status>
            ))}
          </div>
        </details>
      </section>
      <SharedControl control={view.control} submit={submitControl} />
      {result && (
        <p className="action-result" role="status">
          {ActionResult.$match(result, {
            Pending: ({ message }) => message,
            Rejected: ({ message }) => message,
            Unavailable: ({ message }) => message,
          })}
        </p>
      )}
      <section className="app-shell__content">{children}</section>
    </main>
  )
}

function SharedControl({
  control,
  submit,
}: {
  control: ShellView['control']
  submit: ((intent: ControlIntent) => Promise<{
    readonly _tag: 'Accepted' | 'Rejected' | 'Unavailable'
    readonly safeNextAction: string
    readonly reason?: string
    readonly failure?: { readonly summary: string }
  }>) | undefined
}) {
  const phone = usePhoneReadOnly()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | undefined>()
  const action = (value: (typeof control.actions)[number]) => {
    if (submit === undefined || pending) return
    const commandId = CommandId.make(crypto.randomUUID())
    const idempotencyKey = IdempotencyKey.make(crypto.randomUUID())
    const intent: ControlIntent =
      value.kind === 'request'
        ? { _tag: 'RequestControl', commandId, idempotencyKey }
        : value.kind === 'release'
          ? { _tag: 'ReleaseControl', commandId, idempotencyKey }
          : value.kind === 'take'
            ? { _tag: 'TakeControl', commandId, idempotencyKey }
            : value.kind === 'grant'
              ? {
                  _tag: 'GrantControl',
                  commandId,
                  idempotencyKey,
                  requestId: value.requestId,
                  targetClientId: value.targetClientId ?? '',
                }
              : {
                  _tag: 'DeclineControl',
                  commandId,
                  idempotencyKey,
                  requestId: value.requestId,
                }
    setPending(true)
    setMessage(undefined)
    void submit(intent).then(
      (result) => {
        setPending(false)
        setMessage(
          result._tag === 'Accepted'
            ? 'Control action recorded. Waiting for the current service projection.'
            : `${result.reason ?? result.failure?.summary ?? 'Control action unavailable.'} ${result.safeNextAction}`,
        )
      },
      () => {
        setPending(false)
        setMessage('Control action could not reach the service.')
      },
    )
  }
  return (
    <section className="shared-control" aria-label="Shared control">
      <div>
        <strong>Shared control</strong>
        <span>Lease revision {control.revision}</span>
        <span>{control.presence}</span>
      </div>
      {control.requests.length > 0 && (
        <p>{control.requests.map((request) => request.label).join(' ')}</p>
      )}
      {!control.readOnly && control.actions.length > 0 && (
        phone ? (
          <p>Read-only phone monitoring. {control.state}</p>
        ) : (
          <div className="shared-control__actions">
          {control.actions.map((value) => (
            <button
              key={`${value.kind}-${'requestId' in value ? value.requestId : ''}`}
              type="button"
              disabled={pending}
              onClick={() => action(value)}
            >
              {value.label}
            </button>
          ))}
          </div>
        )
      )}
      {control.readOnly && <p>This client is read-only; control actions are unavailable.</p>}
      {message && <p role="status">{message}</p>}
    </section>
  )
}

function usePhoneReadOnly() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const query = matchMedia('(max-width: 600px)')
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}
