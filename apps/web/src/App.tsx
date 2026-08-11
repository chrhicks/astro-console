import { Effect, Fiber, Stream } from 'effect'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  type PlanAction,
  type PlanCommandSubmission,
} from './plan-command-client'
import {
  type ObserveAction,
  type ObserveCommandSubmission,
} from './observe-command-client'
import { type CommandSubmission, type ControlIntent } from './command-client'
import { type PreflightRefreshSubmission } from './preflight-refresh-client'
import {
  AssetRevision,
  AssetId,
  IdempotencyKey,
  LeaseRevision,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
  ReviewAssetRequest,
} from '@astro-console/protocol'
import { parseRoute, routeWorkspace, type Route } from './routes'
import { nightbookHref } from './beta/route'
import {
  createNightbookWorkspaceRuntime,
  initialNightbookWorkspaceState,
  NightbookWorkspaceRuntime,
  type NightbookWorkspaceRuntimeShape,
  type LibraryQuery,
  type NightbookWorkspaceState,
} from './nightbook-workspace-runtime'

const currentRoute = () => parseRoute(location.pathname, location.search)
const BetaObserveApp = lazy(() => import('./beta/BetaObserveApp'))
const BetaLibraryApp = lazy(() => import('./beta/BetaLibraryApp'))
const BetaPlanApp = lazy(() => import('./beta/BetaPlanApp'))
const BetaProcessApp = lazy(() => import('./beta/BetaProcessApp'))

export function App() {
  const workspaceRuntime = useRef(createNightbookWorkspaceRuntime())
  const [workspaceState, setWorkspaceState] = useState<NightbookWorkspaceState>(
    initialNightbookWorkspaceState,
  )
  const projection = workspaceState.projection
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
  const {
    projectionReceived,
    libraryPage,
    libraryDetail,
    processSource,
    process: processWorkspace,
    comparison,
  } = workspaceState
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
    void workspaceRuntime.current.runPromise(
      Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
        workspace.submit({ _tag: 'RouteChanged', route, libraryQuery }),
      ),
    )
  }, [libraryQuery, route])
  useEffect(() => {
    const runtime = workspaceRuntime.current
    const submit = (
      intent: Parameters<NightbookWorkspaceRuntimeShape['submit']>[0],
    ) =>
      runtime.runPromise(
        Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
          workspace.submit(intent),
        ),
      )
    const fiber = runtime.runFork(
      Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
        workspace.states.pipe(
          Stream.runForEach((state) =>
            Effect.sync(() => setWorkspaceState(state)),
          ),
        ),
      ),
    )
    setSubmitPlan(
      () => async (action: PlanAction, key: typeof IdempotencyKey.Type) => {
        const result = await submit({ _tag: 'Plan', action, key })
        if (result._tag !== 'Plan')
          throw new Error('Plan submission unavailable')
        return result.result
      },
    )
    setSubmitObserve(
      () => async (action: ObserveAction, key: typeof IdempotencyKey.Type) => {
        const result = await submit({ _tag: 'Observe', action, key })
        if (result._tag !== 'Observe')
          throw new Error('Observe submission unavailable')
        return result.result
      },
    )
    setSubmitControl(() => async (intent: ControlIntent) => {
      const result = await submit({ _tag: 'Control', intent })
      if (result._tag !== 'Control')
        throw new Error('Control submission unavailable')
      return result.result
    })
    setRefreshPreflight(() => async () => {
      const result = await submit({ _tag: 'RefreshPreflight' })
      if (result._tag !== 'Preflight')
        throw new Error('Preflight refresh unavailable')
      return result.result
    })
    setTargetAcquisitionCommand(() => async () => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Target acquisition state unavailable')
      const result = await submit({
        _tag: 'Acquire',
        intent: {
          _tag: 'CaptureTargetAcquisitionEvidence',
          expectedLeaseRevision: LeaseRevision.make(observe.leaseRevision),
          expectedRunRevision: observe.source.revision,
          expectedAcquireRevision: observe.source.acquire.revision,
          idempotencyKey: IdempotencyKey.make(crypto.randomUUID()),
        },
      })
      if (result._tag !== 'Acquire' || !result.accepted)
        throw new Error(
          result._tag === 'Acquire' ? result.message : 'Acquire unavailable',
        )
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
          const expected = {
            expectedLeaseRevision: LeaseRevision.make(observe.leaseRevision),
            expectedRunRevision: observe.source.revision,
            expectedAcquireRevision: observe.source.acquire.revision,
            idempotencyKey: IdempotencyKey.make(crypto.randomUUID()),
          }
          const intent =
            action === 'RetryPlateSolveWithParameters'
              ? {
                  _tag: action,
                  ...expected,
                  parameters: {
                    exposureSeconds: 15,
                    binning: 1,
                    solverProfile: 'deep-sky-plate-solve',
                  },
                }
              : action === 'SkipAcquireTarget'
                ? { _tag: action, ...expected }
                : { _tag: action, ...expected }
          const result = await submit({ _tag: 'Acquire', intent })
          if (result._tag !== 'Acquire' || !result.accepted)
            throw new Error(
              result._tag === 'Acquire'
                ? result.message
                : 'Acquire unavailable',
            )
        },
    )
    setApprovePointingCorrection(() => async (proposalId: string) => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Pointing correction state unavailable')
      const result = await submit({
        _tag: 'Acquire',
        intent: {
          _tag: 'ApprovePointingCorrection',
          expectedLeaseRevision: LeaseRevision.make(observe.leaseRevision),
          expectedRunRevision: observe.source.revision,
          expectedAcquireRevision: observe.source.acquire.revision,
          proposalId,
          idempotencyKey: IdempotencyKey.make(crypto.randomUUID()),
        },
      })
      if (result._tag !== 'Acquire' || !result.accepted)
        throw new Error(
          result._tag === 'Acquire' ? result.message : 'Acquire unavailable',
        )
    })
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
    setLibraryQuery(query)
  }
  const selectNightbookLibraryAsset = (assetId: typeof AssetId.Type) => {
    const path = `/library/assets/${encodeURIComponent(assetId)}`
    const href = nightbookHref(path, location.search)
    const url = new URL(href, location.origin)
    const next = parseRoute(url.pathname, url.search)
    if (next.kind !== 'asset') return
    history.pushState(null, '', href)
    setRoute(next)
  }
  const openNightbookProcess = (assetId: typeof AssetId.Type) => {
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
  const selectComparisonAsset = useCallback(
    (assetId: typeof AssetId.Type | undefined) => {
      void workspaceRuntime.current.runPromise(
        Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
          workspace.submit({ _tag: 'SelectComparisonAsset', assetId }),
        ),
      )
    },
    [],
  )
  const reviewLibraryAsset = async (review: {
    decision: 'accepted' | 'rejected' | 'unreviewed'
    rating?: number
    annotation?: string
  }) => {
    const detail = libraryDetail.value
    if (!detail) throw new Error('Asset detail is unavailable.')
    const result = await workspaceRuntime.current.runPromise(
      Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
        workspace.submit({
          _tag: 'ReviewLibraryAsset',
          assetId: detail.assetId,
          request: ReviewAssetRequest.make({
            expectedAssetRevision: detail.revision,
            expectedReviewRevision: AssetRevision.make(
              detail.review?.revision ?? 0,
            ),
            ...review,
            idempotencyKey: crypto.randomUUID(),
          }),
        }),
      ),
    )
    if (result._tag !== 'Loaded')
      throw new Error(
        result._tag === 'Unavailable'
          ? result.message
          : 'The review was not saved.',
      )
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
          comparison={comparison}
          onSelectComparisonAsset={selectComparisonAsset}
          onOpenProcess={openNightbookProcess}
          processProjects={processWorkspace.projects}
          onCreateProject={async (name, selection) => {
            const result = await workspaceRuntime.current.runPromise(
              Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
                workspace.submit({ _tag: 'CreateProject', name, selection }),
              ),
            )
            if (result._tag !== 'Project')
              throw new Error('The Project was not created.')
            location.assign(
              nightbookHref(
                `/process/projects/${encodeURIComponent(result.project.projectId)}`,
              ),
            )
          }}
          onAddProjectSources={async (
            projectId,
            expectedProjectRevision,
            selection,
          ) => {
            const result = await workspaceRuntime.current.runPromise(
              Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
                workspace.submit({
                  _tag: 'AddProjectSources',
                  projectId,
                  expectedProjectRevision,
                  selection,
                }),
              ),
            )
            if (result._tag !== 'Project')
              throw new Error('The project intake was not accepted.')
            location.assign(
              nightbookHref(
                `/process/projects/${encodeURIComponent(result.project.projectId)}`,
              ),
            )
          }}
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
          process={processWorkspace}
          onCreateProject={async (name, selection) => {
            const result = await workspaceRuntime.current.runPromise(
              Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
                workspace.submit({ _tag: 'CreateProject', name, selection }),
              ),
            )
            if (result._tag !== 'Project')
              throw new Error('The Project was not created.')
            location.assign(
              nightbookHref(
                `/process/projects/${encodeURIComponent(result.project.projectId)}`,
              ),
            )
          }}
          onChangeProject={async (project, intent) => {
            const result = await workspaceRuntime.current.runPromise(
              Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
                workspace.submit({ _tag: 'ChangeProject', project, intent }),
              ),
            )
            if (result._tag !== 'Project')
              throw new Error(
                'The Project was reloaded after an uncertain outcome.',
              )
          }}
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
