import { useEffect, useRef, useState } from 'react'
import { unavailableProjection } from './future-adapter'
import type { Projection } from './presentation'
import {
  parseRoute,
  routeWithProjection,
  routeWorkspace,
  type Route,
} from './routes'
import { Shell } from './Shell'
import { LibraryView } from './workspaces/LibraryView'
import { ObserveView } from './workspaces/ObserveView'
import { PlanView } from './workspaces/PlanView'
import { ProcessView } from './workspaces/ProcessView'

const currentRoute = () => parseRoute(location.pathname, location.search)

export function App() {
  const [projection, setProjection] = useState<Projection>(
    unavailableProjection,
  )
  const [route, setRoute] = useState<Route>(currentRoute)
  const workspace = routeWorkspace(route)
  const initialRoute = useRef(true)

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute())
    addEventListener('popstate', onPopState)
    return () => removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (initialRoute.current) {
      initialRoute.current = false
      return
    }
    requestAnimationFrame(() => document.querySelector('h1')?.focus())
  }, [route])
  useEffect(() => {
    if (import.meta.env.DEV)
      void import('./fixture-adapter').then((module) =>
        setProjection(module.fixtureProjection),
      )
  }, [])

  const navigate = (next: Exclude<Route, { kind: 'not-found' }>) => {
    const path = routeWithProjection(next, location.search)
    history.pushState(null, '', path)
    setRoute(next)
  }
  const intercept = (
    event: React.MouseEvent<HTMLAnchorElement>,
    next: Exclude<Route, { kind: 'not-found' }>,
  ) => {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    event.preventDefault()
    navigate(next)
  }
  const link = (next: Exclude<Route, { kind: 'not-found' }>) => ({
    href: routeWithProjection(next, location.search),
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) =>
      intercept(event, next),
  })

  const content =
    route.kind === 'not-found' ? (
      <NotFound />
    ) : workspace === 'observe' ? (
      <ObserveView view={projection.observe} />
    ) : workspace === 'library' ? (
      <LibraryView
        view={projection.library}
        assetId={route.kind === 'asset' ? route.assetId : undefined}
        link={link}
      />
    ) : workspace === 'process' ? (
      <ProcessView
        view={projection.process}
        sessionId={route.kind === 'session' ? route.sessionId : undefined}
        sourceAssetId={
          route.kind === 'process-source' ? route.sourceAssetId : undefined
        }
      />
    ) : (
      <PlanView view={projection.plan} />
    )

  return (
    <Shell
      workspace={workspace}
      view={projection.shell}
      link={link}
      result={undefined}
    >
      {content}
    </Shell>
  )
}

function NotFound() {
  return (
    <section className="not-found">
      <h1 tabIndex={-1}>Not Found</h1>
      <p>This address does not name a Nightbook workspace.</p>
      <a href="/plan">Open Plan</a>
    </section>
  )
}
