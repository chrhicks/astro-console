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
          <b>{view.activeRun}</b>
          <span>{view.phase}</span>
        </div>
        <div className="status-anchor__progress">
          <progress value={view.progressValue} max={view.progressMax}>
            {view.progress}
          </progress>
          <span>{view.progress}</span>
          <span>{view.sequenceProgress}</span>
        </div>
        <div className="status-anchor__authority">
          <span className="status-anchor__controller">{view.controller}</span>
          <span className="status-anchor__service">{view.service}</span>
          <span className="status-anchor__capability">{view.capability}</span>
          <span className="status-anchor__protection">{view.protection}</span>
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
