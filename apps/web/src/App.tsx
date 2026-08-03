import { Effect, Fiber, Stream } from 'effect'
import { useEffect, useRef, useState } from 'react'
import { BootstrapClient } from './bootstrap-client'
import {
  PlanCommandClient,
  type PlanAction,
  type PlanCommandSubmission,
} from './plan-command-client'
import {
  ObserveCommandClient,
  type ObserveAction,
  type ObserveCommandSubmission,
} from './observe-command-client'
import {
  IdempotencyKey,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
} from '@astro-console/v2-contracts'
import { projectBootstrapState } from './bootstrap-projection'
import { createBootstrapRuntime } from './bootstrap-runtime'
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
import {
  LibraryClient,
  LibraryAssetUnavailable,
  LibraryNotFound,
  LibraryUnavailable,
  createLibraryRuntime,
  type LibraryAssetDetail,
  type LibraryPage,
  type LibraryQuery,
  type ProcessSourceHandoff,
} from './library-client'
import { ObserveView } from './workspaces/ObserveView'
import { PlanView } from './workspaces/PlanView'
import { ProcessView } from './workspaces/ProcessView'

const currentRoute = () => parseRoute(location.pathname, location.search)

export function App() {
  const [projection, setProjection] = useState<Projection>(
    unavailableProjection,
  )
  const [route, setRoute] = useState<Route>(currentRoute)
  const [submitPlan, setSubmitPlan] = useState<
    | ((
        action: PlanAction,
        key: typeof IdempotencyKey.Type,
      ) => Promise<PlanCommandSubmission>)
    | undefined
  >()
  const [submitObserve, setSubmitObserve] = useState<
    | ((
        action: ObserveAction,
        key: typeof IdempotencyKey.Type,
      ) => Promise<ObserveCommandSubmission>)
    | undefined
  >()
  const workspace = routeWorkspace(route)
  const initialRoute = useRef(true)
  const [libraryQuery, setLibraryQuery] = useState<LibraryQuery>(() =>
    LibraryQuerySchema.make({
      queryId: LibraryQueryId.make('nightbook'),
      pageSize: 40,
      sort: 'capturedAtDescending',
    }),
  )
  const [libraryPage, setLibraryPage] = useState<{
    value: LibraryPage | undefined
    message: string | undefined
  }>({ value: undefined, message: undefined })
  const [libraryDetail, setLibraryDetail] = useState<{
    value: LibraryAssetDetail | undefined
    state: 'loading' | 'not-found' | 'unavailable' | undefined
  }>({ value: undefined, state: undefined })
  const libraryPageGeneration = useRef(0)
  const libraryDetailGeneration = useRef(0)
  const processSourceGeneration = useRef(0)
  const [processSource, setProcessSource] = useState<{
    value: ProcessSourceHandoff | undefined
    state: 'loading' | 'not-found' | 'not-local' | 'unavailable' | undefined
  }>({ value: undefined, state: undefined })

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute())
    addEventListener('popstate', onPopState)
    return () => removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (!import.meta.env.VITE_ASTRO_BOOTSTRAP || workspace !== 'library') return
    const runtime = createLibraryRuntime()
    const generation = ++libraryPageGeneration.current
    setLibraryPage({
      value: undefined,
      message: 'Loading Library records.',
    })
    const load = async () => {
      try {
        const result = await runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* LibraryClient
            return yield* client.page(libraryQuery)
          }),
        )
        if (generation === libraryPageGeneration.current)
          setLibraryPage({ value: result, message: undefined })
      } catch {
        if (generation === libraryPageGeneration.current)
          setLibraryPage({
            value: undefined,
            message: 'Library evidence is unavailable.',
          })
      }
    }
    void load()
    return () => {
      libraryPageGeneration.current += 1
      void runtime.dispose()
    }
  }, [libraryQuery, workspace])
  useEffect(() => {
    if (!import.meta.env.VITE_ASTRO_BOOTSTRAP || route.kind !== 'asset') {
      setLibraryDetail({ value: undefined, state: undefined })
      return
    }
    const runtime = createLibraryRuntime()
    const generation = ++libraryDetailGeneration.current
    setLibraryDetail({ value: undefined, state: 'loading' })
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return yield* client.detail(route.assetId)
        }),
      )
      .then(
        (value) => {
          if (generation === libraryDetailGeneration.current)
            setLibraryDetail({ value, state: undefined })
        },
        (error: unknown) => {
          if (generation !== libraryDetailGeneration.current) return
          setLibraryDetail({
            value: undefined,
            state:
              error instanceof LibraryNotFound
                ? 'not-found'
                : error instanceof LibraryUnavailable
                  ? 'unavailable'
                  : 'unavailable',
          })
        },
      )
    return () => {
      libraryDetailGeneration.current += 1
      void runtime.dispose()
    }
  }, [route])
  useEffect(() => {
    if (
      !import.meta.env.VITE_ASTRO_BOOTSTRAP ||
      route.kind !== 'process-source'
    ) {
      setProcessSource({ value: undefined, state: undefined })
      return
    }
    const runtime = createLibraryRuntime()
    const generation = ++processSourceGeneration.current
    setProcessSource({ value: undefined, state: 'loading' })
    void runtime
      .runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return yield* client.processSourceHandoff(route.sourceAssetId)
        }),
      )
      .then(
        (value) => {
          if (generation === processSourceGeneration.current)
            setProcessSource({ value, state: undefined })
        },
        (error: unknown) => {
          if (generation === processSourceGeneration.current)
            setProcessSource({
              value: undefined,
              state:
                error instanceof LibraryNotFound
                  ? 'not-found'
                  : error instanceof LibraryAssetUnavailable
                    ? 'not-local'
                    : 'unavailable',
            })
        },
      )
    return () => {
      processSourceGeneration.current += 1
      void runtime.dispose()
    }
  }, [route])
  useEffect(() => {
    if (import.meta.env.DEV && !import.meta.env.VITE_ASTRO_BOOTSTRAP) return
    const runtime = createBootstrapRuntime()
    setSubmitPlan(
      () => (action: PlanAction, key: typeof IdempotencyKey.Type) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* PlanCommandClient
            return yield* client.submit(action, key)
          }),
        ),
    )
    setSubmitObserve(
      () => (action: ObserveAction, key: typeof IdempotencyKey.Type) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* ObserveCommandClient
            return yield* client.submit(action, key)
          }),
        ),
    )
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const client = yield* BootstrapClient
        yield* client.states.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => setProjection(projectBootstrapState(state))),
          ),
        )
      }),
    )
    return () => {
      setSubmitPlan(undefined)
      setSubmitObserve(undefined)
      void runtime
        .runPromise(Fiber.interrupt(fiber))
        .then(() => runtime.dispose())
    }
  }, [])
  useEffect(() => {
    if (initialRoute.current) {
      initialRoute.current = false
      return
    }
    requestAnimationFrame(() => document.querySelector('h1')?.focus())
  }, [route])
  useEffect(() => {
    if (import.meta.env.DEV && !import.meta.env.VITE_ASTRO_BOOTSTRAP)
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
  const changeLibraryQuery = (query: LibraryQuery) => {
    setLibraryPage({
      value: undefined,
      message: 'Loading Library records.',
    })
    setLibraryQuery(query)
  }

  const content =
    route.kind === 'not-found' ? (
      <NotFound />
    ) : workspace === 'observe' ? (
      <ObserveView
        key={
          projection.observe.source === undefined
            ? 'unavailable'
            : projection.observe.source.runId
        }
        view={projection.observe}
        {...(submitObserve === undefined ? {} : { submit: submitObserve })}
      />
    ) : workspace === 'library' ? (
      <LibraryView
        view={projection.library}
        assetId={route.kind === 'asset' ? route.assetId : undefined}
        link={link}
        {...(import.meta.env.VITE_ASTRO_BOOTSTRAP
          ? {
              page: {
                query: libraryQuery,
                ...(libraryPage.value === undefined
                  ? {}
                  : { value: libraryPage.value }),
                ...(libraryPage.message === undefined
                  ? {}
                  : { message: libraryPage.message }),
              },
              ...(libraryDetail.value === undefined
                ? {}
                : { detail: libraryDetail.value }),
              ...(libraryDetail.state === undefined
                ? {}
                : { detailState: libraryDetail.state }),
              onQuery: changeLibraryQuery,
              readOnly: projection.shell.readOnly,
            }
          : {})}
      />
    ) : workspace === 'process' ? (
      <ProcessView
        sourceAssetId={
          route.kind === 'process-source' ? route.sourceAssetId : undefined
        }
        {...(processSource.value === undefined
          ? {}
          : { sourceHandoff: processSource.value })}
        {...(processSource.state === undefined
          ? {}
          : { sourceHandoffState: processSource.state })}
      />
    ) : (
      <PlanView
        view={projection.plan}
        {...(submitPlan === undefined ? {} : { submit: submitPlan })}
      />
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
