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
import { isBetaWorkspaceLocation } from './beta/route'
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
import {
  loadLiveFrameReview,
  type LiveFrameReview,
} from './live-frame-review-client'

const currentRoute = () => parseRoute(location.pathname, location.search)
const currentBetaWorkspace = () =>
  isBetaWorkspaceLocation(location.pathname, location.search)
const BetaObserveApp = lazy(() => import('./beta/BetaObserveApp'))
const BetaLibraryApp = lazy(() => import('./beta/BetaLibraryApp'))
const BetaPlanApp = lazy(() => import('./beta/BetaPlanApp'))
const BetaProcessApp = lazy(() => import('./beta/BetaProcessApp'))

export function App() {
  const [projection, setProjection] = useState<Projection>(
    unavailableProjection,
  )
  const projectionRef = useRef(projection)
  projectionRef.current = projection
  const [route, setRoute] = useState<Route>(currentRoute)
  const [betaWorkspace, setBetaWorkspace] = useState(currentBetaWorkspace)
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
  const [liveFrameReview, setLiveFrameReview] = useState<{
    value: LiveFrameReview | undefined
    state: 'loading' | 'unavailable' | undefined
  }>({ value: undefined, state: undefined })
  const libraryPageGeneration = useRef(0)
  const libraryDetailGeneration = useRef(0)
  const processSourceGeneration = useRef(0)
  const liveFrameReviewGeneration = useRef(0)
  const [processSource, setProcessSource] = useState<{
    value: ProcessSourceHandoff | undefined
    state: 'loading' | 'not-found' | 'not-local' | 'unavailable' | undefined
  }>({ value: undefined, state: undefined })
  const selectedLibraryAssetId =
    route.kind === 'asset'
      ? route.assetId
      : betaWorkspace && workspace === 'library'
        ? libraryPage.value?.results[0]?.assetId
        : undefined

  useEffect(() => {
    const frame = projection.observe.source?.acquire?.liveFrame
    if (!projection.observe.detailAvailable || frame === undefined) {
      setLiveFrameReview({ value: undefined, state: undefined })
      return
    }
    const generation = ++liveFrameReviewGeneration.current
    setLiveFrameReview({ value: undefined, state: 'loading' })
    void loadLiveFrameReview().then(
      (value) => {
        if (generation === liveFrameReviewGeneration.current)
          setLiveFrameReview({ value, state: undefined })
      },
      () => {
        if (generation === liveFrameReviewGeneration.current)
          setLiveFrameReview({ value: undefined, state: 'unavailable' })
      },
    )
    return () => {
      liveFrameReviewGeneration.current += 1
    }
  }, [
    projection.observe.detailAvailable,
    projection.observe.source?.acquire?.liveFrame?.sourceFrameAssetId,
    projection.observe.snapshotVersion,
  ])
  useEffect(() => {
    const onPopState = () => {
      setRoute(currentRoute())
      setBetaWorkspace(currentBetaWorkspace())
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
    if (
      !betaWorkspace ||
      route.kind !== 'workspace' ||
      route.workspace !== 'library'
    )
      return
    const firstAssetId = libraryPage.value?.results[0]?.assetId
    if (firstAssetId === undefined) return
    const path = `/library/assets/${encodeURIComponent(firstAssetId)}`
    const next = parseRoute(path, '?ui=beta')
    if (next.kind !== 'asset') return
    history.replaceState(null, '', `${path}?ui=beta`)
    setRoute(next)
  }, [betaWorkspace, libraryPage.value, route])
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
    setBetaWorkspace(false)
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
  const selectBetaLibraryAsset = (assetId: string) => {
    const path = `/library/assets/${encodeURIComponent(assetId)}`
    const next = parseRoute(path, '?ui=beta')
    if (next.kind !== 'asset') return
    history.pushState(null, '', `${path}?ui=beta`)
    setRoute(next)
    setBetaWorkspace(true)
  }
  const reviewLibraryAsset = async (decision: 'accepted' | 'rejected') => {
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
          decision,
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
        {...(liveFrameReview.value === undefined
          ? {}
          : { liveFrameReview: liveFrameReview.value })}
        {...(liveFrameReview.state === undefined
          ? {}
          : { liveFrameReviewState: liveFrameReview.state })}
        readOnly={projection.shell.readOnly}
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
        {...(acquireRecoveryCommand === undefined || projection.shell.readOnly
          ? {}
          : { acquireRecoveryCommand })}
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
        onReview={(decision) => {
          void reviewLibraryAsset(decision).catch(() => undefined)
        }}
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

  if (betaWorkspace && workspace === 'observe')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook beta">
            Loading Nightbook beta…
          </main>
        }
      >
        <BetaObserveApp
          projection={projection}
          loading={!projectionReceived}
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

  if (betaWorkspace && workspace === 'plan')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Plan beta">
            Loading Nightbook Plan beta…
          </main>
        }
      >
        <BetaPlanApp
          projection={projection}
          loading={!projectionReceived}
          {...(submitPlan === undefined || projection.shell.readOnly
            ? {}
            : { submit: submitPlan })}
        />
      </Suspense>
    )

  if (betaWorkspace && workspace === 'library')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Library beta">
            Loading Nightbook Library beta…
          </main>
        }
      >
        <BetaLibraryApp
          projection={projection}
          loading={!projectionReceived}
          page={{
            query: libraryQuery,
            ...(libraryPage.value === undefined
              ? {}
              : { value: libraryPage.value }),
            ...(libraryPage.message === undefined
              ? {}
              : { message: libraryPage.message }),
          }}
          onSelectAsset={selectBetaLibraryAsset}
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
        />
      </Suspense>
    )

  if (betaWorkspace && workspace === 'process')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Nightbook Process beta">
            Loading Nightbook Process beta…
          </main>
        }
      >
        <BetaProcessApp
          projection={projection}
          loading={!projectionReceived}
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
      </Suspense>
    )

  return (
    <Shell
      workspace={workspace}
      view={projection.shell}
      link={link}
      result={undefined}
      {...(submitControl === undefined ? {} : { submitControl })}
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
