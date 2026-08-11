import { Effect, Fiber, Stream } from 'effect'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
  CommandClient,
  type CommandSubmission,
  type ControlIntent,
} from './command-client'
import {
  PreflightRefreshClient,
  type PreflightRefreshSubmission,
} from './preflight-refresh-client'
import {
  IdempotencyKey,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
} from '@astro-console/protocol'
import { projectBootstrapState } from './bootstrap-projection'
import { createBootstrapRuntime } from './bootstrap-runtime'
import { unavailableProjection } from './future-adapter'
import type { Projection } from './presentation'
import { parseRoute, routeWorkspace, type Route } from './routes'
import { nightbookHref } from './beta/route'
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

const currentRoute = () => parseRoute(location.pathname, location.search)
const BetaObserveApp = lazy(() => import('./beta/BetaObserveApp'))
const BetaLibraryApp = lazy(() => import('./beta/BetaLibraryApp'))
const BetaPlanApp = lazy(() => import('./beta/BetaPlanApp'))
const BetaProcessApp = lazy(() => import('./beta/BetaProcessApp'))

const loadLibraryAssetDetail = async (assetId: string) => {
  const runtime = createLibraryRuntime()
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const client = yield* LibraryClient
        return yield* client.detail(assetId)
      }),
    )
  } finally {
    await runtime.dispose()
  }
}

export function App() {
  const [projection, setProjection] = useState<Projection>(
    unavailableProjection,
  )
  const projectionRef = useRef(projection)
  projectionRef.current = projection
  const [route, setRoute] = useState<Route>(currentRoute)
  const [projectionReceived, setProjectionReceived] = useState(false)
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
  const [submitControl, setSubmitControl] = useState<
    ((intent: ControlIntent) => Promise<CommandSubmission>) | undefined
  >()
  const [refreshPreflight, setRefreshPreflight] = useState<
    (() => Promise<PreflightRefreshSubmission>) | undefined
  >()
  const [targetAcquisitionCommand, setTargetAcquisitionCommand] = useState<
    (() => Promise<void>) | undefined
  >()
  const [acquireRecoveryCommand, setAcquireRecoveryCommand] = useState<
    | ((
        action:
          | 'RetryPlateSolveWithParameters'
          | 'SkipAcquireTarget'
          | 'AbortAcquire',
      ) => Promise<void>)
    | undefined
  >()
  const [approvePointingCorrection, setApprovePointingCorrection] = useState<
    ((proposalId: string) => Promise<void>) | undefined
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
  const selectedLibraryAssetId =
    route.kind === 'asset' ? route.assetId : undefined

  useEffect(() => {
    const onPopState = () => {
      setRoute(currentRoute())
    }
    addEventListener('popstate', onPopState)
    return () => removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (workspace !== 'library') return
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
    if (selectedLibraryAssetId === undefined) {
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
          return yield* client.detail(selectedLibraryAssetId)
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
  }, [selectedLibraryAssetId])
  useEffect(() => {
    if (route.kind !== 'process-source') {
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
    setSubmitControl(
      () => (intent: ControlIntent) =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* CommandClient
            return yield* client.submit(intent)
          }),
        ),
    )
    setRefreshPreflight(
      () => () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* PreflightRefreshClient
            return yield* client.refresh()
          }),
        ),
    )
    setTargetAcquisitionCommand(() => async () => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Target acquisition state unavailable')
      const response = await fetch('/api/acquire/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: {
            _tag: 'CaptureTargetAcquisitionEvidence',
            expectedLeaseRevision: observe.leaseRevision,
            expectedRunRevision: observe.source.revision,
            expectedAcquireRevision: observe.source.acquire.revision,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      })
      if (!response.ok) throw new Error('Target acquisition command rejected')
    })
    setAcquireRecoveryCommand(
      () =>
        async (
          action:
            | 'RetryPlateSolveWithParameters'
            | 'SkipAcquireTarget'
            | 'AbortAcquire',
        ) => {
          const observe = projectionRef.current.observe
          if (
            observe.source?.acquire === undefined ||
            observe.leaseRevision === undefined
          )
            throw new Error('Acquire recovery state unavailable')
          const intent = {
            _tag: action,
            expectedLeaseRevision: observe.leaseRevision,
            expectedRunRevision: observe.source.revision,
            expectedAcquireRevision: observe.source.acquire.revision,
            idempotencyKey: crypto.randomUUID(),
            ...(action === 'RetryPlateSolveWithParameters'
              ? {
                  parameters: {
                    exposureSeconds: 15,
                    binning: 1,
                    solverProfile: 'deep-sky-plate-solve',
                  },
                }
              : {}),
          }
          const response = await fetch('/api/acquire/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ intent }),
          })
          if (!response.ok) throw new Error('Acquire recovery command rejected')
        },
    )
    setApprovePointingCorrection(() => async (proposalId: string) => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Pointing correction state unavailable')
      const response = await fetch('/api/acquire/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: {
            _tag: 'ApprovePointingCorrection',
            expectedLeaseRevision: observe.leaseRevision,
            expectedRunRevision: observe.source.revision,
            expectedAcquireRevision: observe.source.acquire.revision,
            proposalId,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      })
      if (!response.ok) throw new Error('Pointing correction rejected')
    })
    const fiber = runtime.runFork(
      Effect.gen(function* () {
        const client = yield* BootstrapClient
        yield* client.states.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => {
              setProjection(projectBootstrapState(state))
              setProjectionReceived(true)
            }),
          ),
        )
      }),
    )
    return () => {
      setSubmitPlan(undefined)
      setSubmitObserve(undefined)
      setSubmitControl(undefined)
      setRefreshPreflight(undefined)
      setTargetAcquisitionCommand(undefined)
      setAcquireRecoveryCommand(undefined)
      setApprovePointingCorrection(undefined)
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
  const changeLibraryQuery = (query: LibraryQuery) => {
    setLibraryPage({
      value: undefined,
      message: 'Loading Library records.',
    })
    setLibraryQuery(query)
  }
  const selectNightbookLibraryAsset = (assetId: string) => {
    const path = `/library/assets/${encodeURIComponent(assetId)}`
    const href = nightbookHref(path, location.search)
    const url = new URL(href, location.origin)
    const next = parseRoute(url.pathname, url.search)
    if (next.kind !== 'asset') return
    history.pushState(null, '', href)
    setRoute(next)
  }
  const openNightbookProcess = (assetId: string) => {
    const href = nightbookHref(
      `/process?sourceAssetId=${encodeURIComponent(assetId)}`,
      location.search,
    )
    const url = new URL(href, location.origin)
    const next = parseRoute(url.pathname, url.search)
    if (next.kind !== 'process-source') return
    history.pushState(null, '', href)
    setRoute(next)
  }
  const reviewLibraryAsset = async (review: {
    decision: 'accepted' | 'rejected' | 'unreviewed'
    rating?: number
    annotation?: string
  }) => {
    const detail = libraryDetail.value
    if (!detail) throw new Error('Asset detail is unavailable.')
    const response = await fetch(
      `/api/library/assets/${encodeURIComponent(detail.assetId)}/review`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedAssetRevision: detail.revision,
          expectedReviewRevision: detail.review?.revision ?? 0,
          ...review,
          idempotencyKey: crypto.randomUUID(),
        }),
      },
    )
    if (!response.ok) throw new Error('The review was not accepted.')
    const result = await response.json()
    if (result.outcome !== 'accepted')
      throw new Error('The review was not accepted.')
    setLibraryDetail({
      value: { ...detail, review: result.review },
      state: undefined,
    })
  }
  if (route.kind === 'not-found') return <NotFound />

  if (workspace === 'observe')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Observe">
            Loading Nightbook Observe…
          </main>
        }
      >
        <BetaObserveApp
          projection={projection}
          loading={!projectionReceived}
          {...(submitControl === undefined ? {} : { submitControl })}
          {...(submitObserve === undefined || projection.shell.readOnly
            ? {}
            : { submit: submitObserve })}
          {...(refreshPreflight === undefined ||
          projection.shell.readOnly ||
          projection.observe.source?.phase !== 'preflight'
            ? {}
            : { refreshPreflight })}
          {...(targetAcquisitionCommand === undefined ||
          projection.shell.readOnly
            ? {}
            : { targetAcquisitionCommand })}
          {...(acquireRecoveryCommand === undefined || projection.shell.readOnly
            ? {}
            : { acquireRecoveryCommand })}
          {...(approvePointingCorrection === undefined ||
          projection.shell.readOnly
            ? {}
            : { approvePointingCorrection })}
        />
      </Suspense>
    )

  if (workspace === 'plan')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Plan">
            Loading Nightbook Plan…
          </main>
        }
      >
        <BetaPlanApp
          projection={projection}
          loading={!projectionReceived}
          {...(submitControl === undefined ? {} : { submitControl })}
          {...(submitPlan === undefined || projection.shell.readOnly
            ? {}
            : { submit: submitPlan })}
        />
      </Suspense>
    )

  if (workspace === 'library')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Library">
            Loading Nightbook Library…
          </main>
        }
      >
        <BetaLibraryApp
          projection={projection}
          loading={!projectionReceived}
          {...(submitControl === undefined ? {} : { submitControl })}
          page={{
            query: libraryQuery,
            ...(libraryPage.value === undefined
              ? {}
              : { value: libraryPage.value }),
            ...(libraryPage.message === undefined
              ? {}
              : { message: libraryPage.message }),
          }}
          onQuery={changeLibraryQuery}
          onSelectAsset={selectNightbookLibraryAsset}
          {...(selectedLibraryAssetId === undefined
            ? {}
            : { assetId: selectedLibraryAssetId })}
          {...(libraryDetail.value === undefined
            ? {}
            : { detail: libraryDetail.value })}
          {...(libraryDetail.state === undefined
            ? {}
            : { detailState: libraryDetail.state })}
          {...(projection.shell.readOnly
            ? {}
            : { onReview: reviewLibraryAsset })}
          loadDetail={loadLibraryAssetDetail}
          onOpenProcess={openNightbookProcess}
        />
      </Suspense>
    )

  if (workspace === 'process')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Process">
            Loading Nightbook Process…
          </main>
        }
      >
        <BetaProcessApp
          projection={projection}
          loading={!projectionReceived}
          {...(route.kind === 'process-project'
            ? { projectId: route.projectId }
            : {})}
          {...(route.kind === 'process-source'
            ? { sourceAssetId: route.sourceAssetId }
            : {})}
          {...(processSource.value === undefined
            ? {}
            : { sourceHandoff: processSource.value })}
          {...(processSource.state === undefined
            ? {}
            : { sourceHandoffState: processSource.state })}
        />
      </Suspense>
    )

  return <NotFound />
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
