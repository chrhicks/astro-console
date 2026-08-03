import type { PropsWithChildren } from 'react'
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
  children,
}: PropsWithChildren<{
  workspace: Workspace | undefined
  view: ShellView
  link: (route: Exclude<Route, { kind: 'not-found' }>) => {
    href: string
    onClick: React.MouseEventHandler<HTMLAnchorElement>
  }
  result: ActionResultType | undefined
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
        <div className="status-anchor__identity">
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
              {workspace !== 'observe' && (
                <a
                  className="return-to-observe"
                  {...link({ kind: 'workspace', workspace: 'observe' })}
                >
                  Return to Observe
                </a>
              )}
            </>
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
        <div className="status-anchor__authority">
          <span className="status-anchor__controller">{view.controller}</span>
          <span className="status-anchor__membership">{view.membership}</span>
          <span className="status-anchor__presence">{view.presence}</span>
          <span className="status-anchor__attention-owner">
            {view.attentionOwner}
          </span>
          <span className="status-anchor__service">{view.service}</span>
          <span className="status-anchor__capability">{view.capability}</span>
          <span className="status-anchor__protection">{view.protection}</span>
        </div>
        <div className="status-anchor__health" aria-label="Service health">
          {view.health.map((fact) => (
            <Status key={fact.label} tone={fact.tone}>
              <span className="status-anchor__health-summary">
                {fact.summary}
              </span>
              <span className="status-anchor__health-detail">
                {fact.detail}
              </span>
            </Status>
          ))}
        </div>
      </section>
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
