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
  PreflightRefreshClient,
  type PreflightRefreshSubmission,
} from './preflight-refresh-client'
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
  const projectionRef = useRef(projection)
  projectionRef.current = projection
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
  const [refreshPreflight, setRefreshPreflight] = useState<
    (() => Promise<PreflightRefreshSubmission>) | undefined
  >()
  const [polarCommand, setPolarCommand] = useState<
    | ((action: 'capture' | 'accept', attemptId?: string) => Promise<void>)
    | undefined
  >()
  const [targetAcquisitionCommand, setTargetAcquisitionCommand] = useState<
    (() => Promise<void>) | undefined
  >()
  const [recordLiveFrameEvidence, setRecordLiveFrameEvidence] = useState<
    (() => Promise<void>) | undefined
  >()
  const [managedCaptureCommand, setManagedCaptureCommand] = useState<
    | ((
        action:
          | 'StartManagedCapture'
          | 'PauseManagedCapture'
          | 'StopManagedCapture'
          | 'RecenterManagedCapture',
      ) => Promise<void>)
    | undefined
  >()
  const [approvePointingCorrection, setApprovePointingCorrection] = useState<
    ((proposalId: string) => Promise<void>) | undefined
  >()
  const [revisePointingCorrection, setRevisePointingCorrection] = useState<
    | ((
        proposalId: string,
        rightAscensionArcsec: number,
        declinationArcsec: number,
      ) => Promise<void>)
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
    if (route.kind !== 'asset') {
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
    setRefreshPreflight(
      () => () =>
        runtime.runPromise(
          Effect.gen(function* () {
            const client = yield* PreflightRefreshClient
            return yield* client.refresh()
          }),
        ),
    )
    setPolarCommand(
      () => async (action: 'capture' | 'accept', attemptId?: string) => {
        const observe = projectionRef.current.observe
        if (
          observe.source?.acquire === undefined ||
          observe.leaseRevision === undefined
        )
          throw new Error('Polar state unavailable')
        const intent =
          action === 'capture'
            ? {
                _tag: 'CapturePolarAlignmentMeasurement',
                expectedLeaseRevision: observe.leaseRevision,
                expectedRunRevision: observe.source.revision,
                expectedAcquireRevision: observe.source.acquire.revision,
                idempotencyKey: crypto.randomUUID(),
              }
            : {
                _tag: 'AcceptPolarAlignmentEvidence',
                expectedLeaseRevision: observe.leaseRevision,
                expectedRunRevision: observe.source.revision,
                expectedAcquireRevision: observe.source.acquire.revision,
                attemptId,
                idempotencyKey: crypto.randomUUID(),
              }
        const response = await fetch('/api/acquire/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ intent }),
        })
        if (!response.ok) throw new Error('Polar command rejected')
      },
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
    setRecordLiveFrameEvidence(() => async () => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Live frame evidence state unavailable')
      const response = await fetch('/api/acquire/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: {
            _tag: 'RecordLiveFrameEvidence',
            expectedLeaseRevision: observe.leaseRevision,
            expectedRunRevision: observe.source.revision,
            expectedAcquireRevision: observe.source.acquire.revision,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      })
      if (!response.ok) throw new Error('Live frame evidence command rejected')
    })
    setManagedCaptureCommand(
      () =>
        async (
          action:
            | 'StartManagedCapture'
            | 'PauseManagedCapture'
            | 'StopManagedCapture'
            | 'RecenterManagedCapture',
        ) => {
          const observe = projectionRef.current.observe
          if (
            observe.source?.acquire === undefined ||
            observe.leaseRevision === undefined
          )
            throw new Error('Managed capture state unavailable')
          const response = await fetch('/api/acquire/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              intent: {
                _tag: action,
                expectedLeaseRevision: observe.leaseRevision,
                expectedRunRevision: observe.source.revision,
                expectedAcquireRevision: observe.source.acquire.revision,
                idempotencyKey: crypto.randomUUID(),
              },
            }),
          })
          if (!response.ok) throw new Error('Managed capture command rejected')
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
    setRevisePointingCorrection(
      () =>
        async (
          proposalId: string,
          rightAscensionArcsec: number,
          declinationArcsec: number,
        ) => {
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
                _tag: 'RevisePointingCorrection',
                expectedLeaseRevision: observe.leaseRevision,
                expectedRunRevision: observe.source.revision,
                expectedAcquireRevision: observe.source.acquire.revision,
                proposalId,
                correction: { rightAscensionArcsec, declinationArcsec },
                idempotencyKey: crypto.randomUUID(),
              },
            }),
          })
          if (!response.ok)
            throw new Error('Pointing correction revision rejected')
        },
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
      setRefreshPreflight(undefined)
      setPolarCommand(undefined)
      setTargetAcquisitionCommand(undefined)
      setRecordLiveFrameEvidence(undefined)
      setManagedCaptureCommand(undefined)
      setApprovePointingCorrection(undefined)
      setRevisePointingCorrection(undefined)
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
  const navigate = (next: Exclude<Route, { kind: 'not-found' }>) => {
    const path = routeWithProjection(next)
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
    href: routeWithProjection(next),
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
        {...(refreshPreflight === undefined ||
        projection.shell.readOnly ||
        projection.observe.source?.phase !== 'preflight'
          ? {}
          : { refreshPreflight })}
        {...(polarCommand === undefined || projection.shell.readOnly
          ? {}
          : { polarCommand })}
        {...(targetAcquisitionCommand === undefined || projection.shell.readOnly
          ? {}
          : { targetAcquisitionCommand })}
        {...(recordLiveFrameEvidence === undefined || projection.shell.readOnly
          ? {}
          : { recordLiveFrameEvidence })}
        {...(managedCaptureCommand === undefined || projection.shell.readOnly
          ? {}
          : { managedCaptureCommand })}
        {...(approvePointingCorrection === undefined ||
        projection.shell.readOnly
          ? {}
          : { approvePointingCorrection })}
        {...(revisePointingCorrection === undefined || projection.shell.readOnly
          ? {}
          : { revisePointingCorrection })}
      />
    ) : workspace === 'library' ? (
      <LibraryView
        view={projection.library}
        assetId={route.kind === 'asset' ? route.assetId : undefined}
        link={link}
        page={{
          query: libraryQuery,
          ...(libraryPage.value === undefined
            ? {}
            : { value: libraryPage.value }),
          ...(libraryPage.message === undefined
            ? {}
            : { message: libraryPage.message }),
        }}
        {...(libraryDetail.value === undefined
          ? {}
          : { detail: libraryDetail.value })}
        {...(libraryDetail.state === undefined
          ? {}
          : { detailState: libraryDetail.state })}
        onQuery={changeLibraryQuery}
        readOnly={projection.shell.readOnly}
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
