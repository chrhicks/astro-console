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
  AcquireIntent,
  AssetRevision,
  AssetId,
  IdempotencyKey,
  LeaseRevision,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
  ReviewAssetRequest,
} from '@astro-console/protocol'
import { parseRoute, routeWorkspace, type Route } from './routes'
import { nightbookHref } from './route-href'
import {
  createNightbookWorkspaceRuntime,
  initialNightbookWorkspaceState,
  NightbookWorkspaceRuntime,
  NightbookWorkspaceSubmission,
  type LibraryQuery,
  type NightbookProjectSelection,
  type NightbookWorkspaceIntent,
  type NightbookWorkspaceState,
} from './nightbook-workspace-runtime'

const currentRoute = () => parseRoute(location.pathname, location.search)
const ObserveWorkspace = lazy(() => import('./nightbook/ObserveWorkspace'))
const LibraryWorkspace = lazy(() => import('./nightbook/LibraryWorkspace'))
const PlanWorkspace = lazy(() => import('./nightbook/PlanWorkspace'))
const ProcessWorkspace = lazy(() => import('./nightbook/ProcessWorkspace'))

type SubmissionHandlers<Result> = {
  readonly [Tag in NightbookWorkspaceSubmission['_tag']]?: (
    submission: Extract<NightbookWorkspaceSubmission, { readonly _tag: Tag }>,
  ) => Result
}

const applySubmissionHandler = <Result, Submission>(
  handler: ((submission: Submission) => Result) | undefined,
  submission: Submission,
  fallback: string,
): Result => {
  if (handler === undefined) throw new Error(fallback)
  return handler(submission)
}

const foldWorkspaceSubmission = <Result,>(
  submission: NightbookWorkspaceSubmission,
  handlers: SubmissionHandlers<Result>,
) =>
  NightbookWorkspaceSubmission.$match(submission, {
    Loaded: (value) =>
      applySubmissionHandler(
        handlers.Loaded,
        value,
        'Workspace load result is unavailable.',
      ),
    Control: (value) =>
      applySubmissionHandler(
        handlers.Control,
        value,
        'Control submission is unavailable.',
      ),
    Plan: (value) =>
      applySubmissionHandler(
        handlers.Plan,
        value,
        'Plan submission is unavailable.',
      ),
    Observe: (value) =>
      applySubmissionHandler(
        handlers.Observe,
        value,
        'Observe submission is unavailable.',
      ),
    Preflight: (value) =>
      applySubmissionHandler(
        handlers.Preflight,
        value,
        'Preflight refresh is unavailable.',
      ),
    Acquire: (value) =>
      applySubmissionHandler(
        handlers.Acquire,
        value,
        'Acquire submission is unavailable.',
      ),
    Project: (value) =>
      applySubmissionHandler(
        handlers.Project,
        value,
        'Project submission is unavailable.',
      ),
    Unavailable: (value) =>
      applySubmissionHandler(handlers.Unavailable, value, value.message),
  })

const acceptedAcquireSubmission: SubmissionHandlers<void> = {
  Acquire: ({ accepted, message }) => {
    if (!accepted) throw new Error(message ?? 'Acquire unavailable')
  },
}

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
  const submitWorkspace = useCallback(
    (intent: NightbookWorkspaceIntent) =>
      workspaceRuntime.current.runPromise(
        Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
          workspace.submit(intent),
        ),
      ),
    [],
  )

  useEffect(() => {
    const onPopState = () => {
      setRoute(currentRoute())
    }
    addEventListener('popstate', onPopState)
    return () => removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    void submitWorkspace({ _tag: 'RouteChanged', route, libraryQuery })
  }, [libraryQuery, route, submitWorkspace])
  useEffect(() => {
    const runtime = workspaceRuntime.current
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
        return foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'Plan', action, key }),
          { Plan: ({ result }) => result },
        )
      },
    )
    setSubmitObserve(
      () => async (action: ObserveAction, key: typeof IdempotencyKey.Type) => {
        return foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'Observe', action, key }),
          { Observe: ({ result }) => result },
        )
      },
    )
    setSubmitControl(() => async (intent: ControlIntent) => {
      return foldWorkspaceSubmission(
        await submitWorkspace({ _tag: 'Control', intent }),
        { Control: ({ result }) => result },
      )
    })
    setRefreshPreflight(() => async () => {
      return foldWorkspaceSubmission(
        await submitWorkspace({ _tag: 'RefreshPreflight' }),
        { Preflight: ({ result }) => result },
      )
    })
    setTargetAcquisitionCommand(() => async () => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Target acquisition state unavailable')
      const result = await submitWorkspace({
        _tag: 'Acquire',
        intent: AcquireIntent.cases.CaptureTargetAcquisitionEvidence.make({
          expectedLeaseRevision: LeaseRevision.make(observe.leaseRevision),
          expectedRunRevision: observe.source.revision,
          expectedAcquireRevision: observe.source.acquire.revision,
          idempotencyKey: IdempotencyKey.make(crypto.randomUUID()),
        }),
      })
      return foldWorkspaceSubmission(result, acceptedAcquireSubmission)
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
              ? AcquireIntent.cases.RetryPlateSolveWithParameters.make({
                  ...expected,
                  parameters: {
                    exposureSeconds: 15,
                    binning: 1,
                    solverProfile: 'deep-sky-plate-solve',
                  },
                })
              : action === 'SkipAcquireTarget'
                ? AcquireIntent.cases.SkipAcquireTarget.make(expected)
                : AcquireIntent.cases.AbortAcquire.make(expected)
          const result = await submitWorkspace({ _tag: 'Acquire', intent })
          return foldWorkspaceSubmission(result, acceptedAcquireSubmission)
        },
    )
    setApprovePointingCorrection(() => async (proposalId: string) => {
      const observe = projectionRef.current.observe
      if (
        observe.source?.acquire === undefined ||
        observe.leaseRevision === undefined
      )
        throw new Error('Pointing correction state unavailable')
      const result = await submitWorkspace({
        _tag: 'Acquire',
        intent: AcquireIntent.cases.ApprovePointingCorrection.make({
          expectedLeaseRevision: LeaseRevision.make(observe.leaseRevision),
          expectedRunRevision: observe.source.revision,
          expectedAcquireRevision: observe.source.acquire.revision,
          proposalId,
          idempotencyKey: IdempotencyKey.make(crypto.randomUUID()),
        }),
      })
      return foldWorkspaceSubmission(result, acceptedAcquireSubmission)
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
  }, [submitWorkspace])
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
    const href = nightbookHref(path)
    const url = new URL(href, location.origin)
    const next = parseRoute(url.pathname, url.search)
    if (next.kind !== 'asset') return
    history.pushState(null, '', href)
    setRoute(next)
  }
  const openNightbookProcess = (assetId: typeof AssetId.Type) => {
    const href = nightbookHref(
      `/process?sourceAssetId=${encodeURIComponent(assetId)}`,
    )
    const url = new URL(href, location.origin)
    const next = parseRoute(url.pathname, url.search)
    if (next.kind !== 'process-source') return
    history.pushState(null, '', href)
    setRoute(next)
  }
  const selectComparisonAsset = useCallback(
    (assetId: typeof AssetId.Type | undefined) => {
      void submitWorkspace({ _tag: 'SelectComparisonAsset', assetId })
    },
    [submitWorkspace],
  )
  const reviewLibraryAsset = async (review: {
    decision: 'accepted' | 'rejected' | 'unreviewed'
    rating?: number
    annotation?: string
  }) => {
    const detail = libraryDetail.value
    if (!detail) throw new Error('Asset detail is unavailable.')
    const result = await submitWorkspace({
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
    })
    return foldWorkspaceSubmission(result, { Loaded: () => undefined })
  }
  const createProject = useCallback(
    async (name: string, selection: NightbookProjectSelection) => {
      const project = foldWorkspaceSubmission(
        await submitWorkspace({
          _tag: 'CreateProject',
          name,
          selection,
        }),
        { Project: ({ project }) => project },
      )
      location.assign(
        nightbookHref(
          `/process/projects/${encodeURIComponent(project.projectId)}`,
        ),
      )
    },
    [submitWorkspace],
  )
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
        <ObserveWorkspace
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
        <PlanWorkspace
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
        <LibraryWorkspace
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
          {...(!projection.libraryProcessMutation.allowed
            ? {}
            : { onReview: reviewLibraryAsset })}
          comparison={comparison}
          onSelectComparisonAsset={selectComparisonAsset}
          onOpenProcess={openNightbookProcess}
          processProjects={processWorkspace.projects}
          {...(!projection.libraryProcessMutation.allowed
            ? {}
            : {
                onCreateProject: createProject,
                onAddProjectSources: async (
                  projectId,
                  expectedProjectRevision,
                  selection,
                ) => {
                  const project = foldWorkspaceSubmission(
                    await submitWorkspace({
                      _tag: 'AddProjectSources',
                      projectId,
                      expectedProjectRevision,
                      selection,
                    }),
                    { Project: ({ project }) => project },
                  )
                  location.assign(
                    nightbookHref(
                      `/process/projects/${encodeURIComponent(project.projectId)}`,
                    ),
                  )
                },
              })}
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
        <ProcessWorkspace
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
          {...(!projection.libraryProcessMutation.allowed
            ? {}
            : { onCreateProject: createProject })}
          onChangeProject={async (project, intent) => {
            foldWorkspaceSubmission(
              await submitWorkspace({
                _tag: 'ChangeProject',
                project,
                intent,
              }),
              { Project: () => undefined },
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
