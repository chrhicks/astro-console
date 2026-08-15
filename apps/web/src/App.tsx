import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type PlanAction,
  type PlanCommandSubmission,
} from './plan-command-client'
import {
  type ObserveAction,
  type ObserveCommandSubmission,
} from './observe-command-client'
import { type CommandSubmission, type ControlAction } from './command-client'
import { type PreflightRefreshSubmission } from './preflight-refresh-client'
import {
  AssetId,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
} from '@astro-console/protocol'
import { parseRoute, routeWorkspace, type Route } from './routes'
import { routeHref } from './route-href'
import {
  AcquireAction,
  WorkspaceSubmission,
  type LibraryQuery,
  type WorkspaceProjectSelection,
  type ProcessAction,
} from './workspace-runtime'
import { useWorkspaceRuntime } from './use-workspace-runtime'

const currentRoute = () => parseRoute(location.pathname, location.search)
const ObserveWorkspace = lazy(
  () => import('./components/workspaces/observe/ObserveWorkspace'),
)
const LibraryWorkspace = lazy(
  () => import('./components/workspaces/library/LibraryWorkspace'),
)
const PlanWorkspace = lazy(
  () => import('./components/workspaces/plan/PlanWorkspace'),
)
const ProcessWorkspace = lazy(
  () => import('./components/workspaces/process/ProcessWorkspace'),
)

type SubmissionHandlers<Result> = {
  readonly [Tag in WorkspaceSubmission['_tag']]?: (
    submission: Extract<WorkspaceSubmission, { readonly _tag: Tag }>,
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
  submission: WorkspaceSubmission,
  handlers: SubmissionHandlers<Result>,
) =>
  WorkspaceSubmission.$match(submission, {
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
  const workspaceRuntime = useWorkspaceRuntime()
  const workspaceState = workspaceRuntime.state
  const submitWorkspace =
    workspaceRuntime._tag === 'Ready' ? workspaceRuntime.submit : undefined
  const projection = workspaceState.projection
  const [route, setRoute] = useState<Route>(currentRoute)
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
  const {
    submitPlan,
    submitObserve,
    submitControl,
    refreshPreflight,
    targetAcquisitionCommand,
    acquireRecoveryCommand,
    approvePointingCorrection,
  } = useMemo(() => {
    if (submitWorkspace === undefined)
      return {
        submitPlan: undefined,
        submitObserve: undefined,
        submitControl: undefined,
        refreshPreflight: undefined,
        targetAcquisitionCommand: undefined,
        acquireRecoveryCommand: undefined,
        approvePointingCorrection: undefined,
      }

    return {
      submitPlan: async (action: PlanAction): Promise<PlanCommandSubmission> =>
        foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'Plan', action }),
          { Plan: ({ result }) => result },
        ),
      submitObserve: async (
        action: ObserveAction,
      ): Promise<ObserveCommandSubmission> =>
        foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'Observe', action }),
          { Observe: ({ result }) => result },
        ),
      submitControl: async (
        action: ControlAction,
      ): Promise<CommandSubmission> =>
        foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'Control', action }),
          { Control: ({ result }) => result },
        ),
      refreshPreflight: async (): Promise<PreflightRefreshSubmission> =>
        foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'RefreshPreflight' }),
          { Preflight: ({ result }) => result },
        ),
      targetAcquisitionCommand: async () =>
        foldWorkspaceSubmission(
          await submitWorkspace({
            _tag: 'Acquire',
            action: AcquireAction.CaptureTargetAcquisitionEvidence({}),
          }),
          acceptedAcquireSubmission,
        ),
      acquireRecoveryCommand: async (
        action:
          | 'RetryPlateSolveWithParameters'
          | 'SkipAcquireTarget'
          | 'AbortAcquire',
      ) => {
        const semanticAction =
          action === 'RetryPlateSolveWithParameters'
            ? AcquireAction.RetryPlateSolveWithParameters({})
            : action === 'SkipAcquireTarget'
              ? AcquireAction.SkipAcquireTarget({})
              : AcquireAction.AbortAcquire({})
        return foldWorkspaceSubmission(
          await submitWorkspace({ _tag: 'Acquire', action: semanticAction }),
          acceptedAcquireSubmission,
        )
      },
      approvePointingCorrection: async (proposalId: string) =>
        foldWorkspaceSubmission(
          await submitWorkspace({
            _tag: 'Acquire',
            action: AcquireAction.ApprovePointingCorrection({ proposalId }),
          }),
          acceptedAcquireSubmission,
        ),
    }
  }, [submitWorkspace])

  useEffect(() => {
    const onPopState = () => {
      setRoute(currentRoute())
    }
    addEventListener('popstate', onPopState)
    return () => removeEventListener('popstate', onPopState)
  }, [])
  useEffect(() => {
    if (submitWorkspace === undefined) return
    void submitWorkspace({ _tag: 'RouteChanged', route, libraryQuery })
  }, [libraryQuery, route, submitWorkspace])
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
  const selectLibraryAsset = (assetId: typeof AssetId.Type) => {
    const path = `/library/assets/${encodeURIComponent(assetId)}`
    const href = routeHref(path)
    const url = new URL(href, location.origin)
    const next = parseRoute(url.pathname, url.search)
    if (next.kind !== 'asset') return
    history.pushState(null, '', href)
    setRoute(next)
  }
  const openProcess = (assetId: typeof AssetId.Type) => {
    const href = routeHref(
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
      if (submitWorkspace === undefined) return
      void submitWorkspace({ _tag: 'SelectComparisonAsset', assetId })
    },
    [submitWorkspace],
  )
  const reviewLibraryAsset = async (review: {
    decision: 'accepted' | 'rejected' | 'unreviewed'
    rating?: number
    annotation?: string
  }) => {
    if (submitWorkspace === undefined)
      throw new Error('Workspace runtime is unavailable.')
    const result = await submitWorkspace({
      _tag: 'ReviewCurrentLibraryAsset',
      review,
    })
    return foldWorkspaceSubmission(result, { Loaded: () => undefined })
  }
  const createProject = useCallback(
    async (name: string, selection: WorkspaceProjectSelection) => {
      if (submitWorkspace === undefined)
        throw new Error('Workspace runtime is unavailable.')
      const project = foldWorkspaceSubmission(
        await submitWorkspace({
          _tag: 'CreateProject',
          name,
          selection,
        }),
        { Project: ({ project }) => project },
      )
      location.assign(
        routeHref(`/process/projects/${encodeURIComponent(project.projectId)}`),
      )
    },
    [submitWorkspace],
  )
  if (route.kind === 'not-found') return <NotFound />

  if (workspace === 'observe')
    return (
      <Suspense
        fallback={
          <main aria-busy="true" aria-label="Loading Observe">
            Loading Observe…
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
          <main aria-busy="true" aria-label="Loading Plan">
            Loading Plan…
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
          <main aria-busy="true" aria-label="Loading Library">
            Loading Library…
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
          onSelectAsset={selectLibraryAsset}
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
          onOpenProcess={openProcess}
          processProjects={processWorkspace.projects}
          {...(!projection.libraryProcessMutation.allowed
            ? {}
            : {
                onCreateProject: createProject,
                onAddProjectSources: async (projectId, selection) => {
                  if (submitWorkspace === undefined)
                    throw new Error('Workspace runtime is unavailable.')
                  const project = foldWorkspaceSubmission(
                    await submitWorkspace({
                      _tag: 'AddProjectSources',
                      projectId,
                      selection,
                    }),
                    { Project: ({ project }) => project },
                  )
                  location.assign(
                    routeHref(
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
          <main aria-busy="true" aria-label="Loading Process">
            Loading Process…
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
          onChangeProject={async (action: ProcessAction) => {
            if (submitWorkspace === undefined)
              throw new Error('Workspace runtime is unavailable.')
            foldWorkspaceSubmission(
              await submitWorkspace({ _tag: 'Process', action }),
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
      <p>This address does not name an Astro Console workspace.</p>
      <a href="/plan">Open Plan</a>
    </section>
  )
}
