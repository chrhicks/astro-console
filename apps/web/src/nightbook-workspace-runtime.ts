import {
  Context,
  Data,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Schema,
  Stream,
  SubscriptionRef,
} from 'effect'
import {
  AcquireCommandRequest,
  AcquireCommandResponse,
  AcquireIntent,
  AssetId,
  CaptureSetId,
  IdempotencyKey,
  IntentId,
  LeaseRevision,
  ProcessingProjectId,
  ProcessingProjectRevision,
  type ProcessingProjectIntent,
} from '@astro-console/protocol'
import { BootstrapClient, type BootstrapClientState } from './bootstrap-client'
import { browserBootstrapClientLayer } from './bootstrap-runtime'
import {
  CommandClient,
  type CommandSubmission,
  type ControlAction,
} from './command-client'
import { unavailableProjection } from './future-adapter'
import {
  LibraryClient,
  LibraryAssetUnavailable,
  LibraryNotFound,
  type LibraryAssetDetail,
  type LibraryClientShape,
  type LibraryPage,
  type LibraryQuery,
  type ProcessSourceHandoff,
  type ReviewRequest,
} from './library-client'
import {
  ObserveCommandClient,
  type ObserveAction,
  type ObserveCommandSubmission,
} from './observe-command-client'
import {
  PlanCommandClient,
  type PlanAction,
  type PlanCommandSubmission,
} from './plan-command-client'
import {
  PreflightRefreshClient,
  type PreflightRefreshSubmission,
} from './preflight-refresh-client'
import { projectBootstrapState } from './bootstrap-projection'
import type { Projection } from './presentation'
import {
  processingProjectFailureCertainty,
  processClient,
  ProcessingProjectRequestError,
  type CreateProcessingProjectRequest,
  type OpenedProcessingProject,
  type ProcessingProjectEvidence,
  type ProcessingProjectList,
} from './process-client'
import type { Route } from './routes'

export type {
  LibraryAssetDetail,
  LibraryClientShape,
  LibraryPage,
  LibraryQuery,
  ProcessSourceHandoff,
  ReviewRequest,
  OpenedProcessingProject,
  ProcessingProjectEvidence,
  ProcessingProjectList,
}

export type AcquireCommandIntent = typeof AcquireIntent.Type
export type AcquireAction = Data.TaggedEnum<{
  CaptureTargetAcquisitionEvidence: { readonly _never?: never }
  RetryPlateSolveWithParameters: { readonly _never?: never }
  SkipAcquireTarget: { readonly _never?: never }
  AbortAcquire: { readonly _never?: never }
  ApprovePointingCorrection: { readonly proposalId: string }
}>

export const AcquireAction = Data.taggedEnum<AcquireAction>()

export type NightbookProjectSelection = {
  readonly assetIds: ReadonlyArray<typeof AssetId.Type>
  readonly captureSetIds: ReadonlyArray<typeof CaptureSetId.Type>
}

type LibraryDetailState = 'loading' | 'not-found' | 'unavailable'
type SourceState = 'loading' | 'not-found' | 'not-local' | 'unavailable'
type ProcessState = 'loading' | 'current' | 'unavailable'

export type NightbookWorkspaceState = {
  readonly projection: Projection
  readonly projectionReceived: boolean
  readonly libraryPage: {
    readonly value: LibraryPage | undefined
    readonly message: string | undefined
  }
  readonly libraryDetail: {
    readonly value: LibraryAssetDetail | undefined
    readonly state: LibraryDetailState | undefined
  }
  readonly processSource: {
    readonly value: ProcessSourceHandoff | undefined
    readonly state: SourceState | undefined
  }
  readonly process: {
    readonly projects: ProcessingProjectList
    readonly project: OpenedProcessingProject | undefined
    readonly evidence: ProcessingProjectEvidence | undefined
    readonly state: ProcessState
  }
  readonly comparison: {
    readonly assetId: typeof AssetId.Type | undefined
    readonly value: LibraryAssetDetail | undefined
    readonly state: 'loading' | 'unavailable' | undefined
  }
}

export type NightbookWorkspaceIntent = Data.TaggedEnum<{
  RouteChanged: {
    readonly route: Route
    readonly libraryQuery: LibraryQuery
  }
  ReviewLibraryAsset: {
    readonly assetId: typeof AssetId.Type
    readonly request: ReviewRequest
  }
  Control: { readonly action: ControlAction }
  Plan: {
    readonly action: PlanAction
    readonly key: typeof IdempotencyKey.Type
  }
  Observe: {
    readonly action: ObserveAction
    readonly key: typeof IdempotencyKey.Type
  }
  RefreshPreflight: { readonly _never?: never }
  Acquire: { readonly action: AcquireAction }
  SelectComparisonAsset: {
    readonly assetId: typeof AssetId.Type | undefined
  }
  CreateProject: {
    readonly name: string
    readonly selection: NightbookProjectSelection
  }
  AddProjectSources: {
    readonly projectId: typeof ProcessingProjectId.Type
    readonly expectedProjectRevision: typeof ProcessingProjectRevision.Type
    readonly selection: NightbookProjectSelection
  }
  ChangeProject: {
    readonly project: OpenedProcessingProject
    readonly intent: ProcessingProjectIntent
  }
}>

export const NightbookWorkspaceIntent =
  Data.taggedEnum<NightbookWorkspaceIntent>()

export type NightbookWorkspaceSubmission = Data.TaggedEnum<{
  Loaded: { readonly _never?: never }
  Control: { readonly result: CommandSubmission }
  Plan: { readonly result: PlanCommandSubmission }
  Observe: { readonly result: ObserveCommandSubmission }
  Preflight: { readonly result: PreflightRefreshSubmission }
  Acquire: { readonly accepted: boolean; readonly message?: string }
  Project: { readonly project: OpenedProcessingProject }
  Unavailable: { readonly message: string }
}>

export const NightbookWorkspaceSubmission =
  Data.taggedEnum<NightbookWorkspaceSubmission>()

type ProjectChangeAttempt = Data.TaggedEnum<{
  Changed: { readonly project: OpenedProcessingProject }
  Failed: { readonly _never?: never }
}>

const ProjectChangeAttempt = Data.taggedEnum<ProjectChangeAttempt>()

const NightbookWorkspaceRemoteOperation = Schema.Literals([
  'acquire',
  'page',
  'detail',
  'process-source',
  'review',
  'list-projects',
  'open-project',
  'project-evidence',
  'create-project',
  'change-project',
  'add-project-sources',
])
type NightbookWorkspaceRemoteOperation =
  typeof NightbookWorkspaceRemoteOperation.Type

export class NightbookWorkspaceRemoteFailure extends Schema.TaggedErrorClass<NightbookWorkspaceRemoteFailure>()(
  'NightbookWorkspaceRemoteFailure',
  {
    operation: NightbookWorkspaceRemoteOperation,
    reason: Schema.Literals([
      'not-found',
      'not-local',
      'unavailable',
      'rejected',
    ]),
    message: Schema.String,
  },
) {}

export interface NightbookWorkspaceRemoteShape {
  readonly states: Stream.Stream<BootstrapClientState>
  readonly refresh: () => Effect.Effect<void>
  readonly control: (action: ControlAction) => Effect.Effect<CommandSubmission>
  readonly plan: (
    action: PlanAction,
    key: typeof IdempotencyKey.Type,
  ) => Effect.Effect<PlanCommandSubmission>
  readonly observe: (
    action: ObserveAction,
    key: typeof IdempotencyKey.Type,
  ) => Effect.Effect<ObserveCommandSubmission>
  readonly refreshPreflight: () => Effect.Effect<PreflightRefreshSubmission>
  readonly acquire: (
    intent: AcquireCommandIntent,
  ) => Effect.Effect<void, NightbookWorkspaceRemoteFailure>
  readonly page: (
    query: LibraryQuery,
  ) => Effect.Effect<LibraryPage, NightbookWorkspaceRemoteFailure>
  readonly detail: (
    assetId: typeof AssetId.Type,
  ) => Effect.Effect<LibraryAssetDetail, NightbookWorkspaceRemoteFailure>
  readonly processSource: (
    assetId: typeof AssetId.Type,
  ) => Effect.Effect<ProcessSourceHandoff, NightbookWorkspaceRemoteFailure>
  readonly review: (
    assetId: typeof AssetId.Type,
    request: ReviewRequest,
  ) => Effect.Effect<
    LibraryAssetDetail['review'],
    NightbookWorkspaceRemoteFailure
  >
  readonly listProjects: () => Effect.Effect<
    ProcessingProjectList,
    NightbookWorkspaceRemoteFailure
  >
  readonly openProject: (
    projectId: typeof ProcessingProjectId.Type,
  ) => Effect.Effect<OpenedProcessingProject, NightbookWorkspaceRemoteFailure>
  readonly projectEvidence: (
    projectId: typeof ProcessingProjectId.Type,
  ) => Effect.Effect<ProcessingProjectEvidence, NightbookWorkspaceRemoteFailure>
  readonly createProject: (
    request: CreateProcessingProjectRequest,
  ) => Effect.Effect<OpenedProcessingProject, NightbookWorkspaceRemoteFailure>
  readonly changeProject: (
    project: OpenedProcessingProject,
    intent: ProcessingProjectIntent,
  ) => Effect.Effect<OpenedProcessingProject, NightbookWorkspaceRemoteFailure>
  readonly addProjectSources: (
    projectId: typeof ProcessingProjectId.Type,
    expectedProjectRevision: typeof ProcessingProjectRevision.Type,
    selection: NightbookProjectSelection,
  ) => Effect.Effect<OpenedProcessingProject, NightbookWorkspaceRemoteFailure>
}

export class NightbookWorkspaceRemote extends Context.Service<
  NightbookWorkspaceRemote,
  NightbookWorkspaceRemoteShape
>()('@astro-console/web/NightbookWorkspaceRemote') {}

export interface NightbookWorkspaceRuntimeShape {
  readonly states: Stream.Stream<NightbookWorkspaceState>
  readonly submit: (
    intent: NightbookWorkspaceIntent,
  ) => Effect.Effect<NightbookWorkspaceSubmission>
}

export class NightbookWorkspaceRuntime extends Context.Service<
  NightbookWorkspaceRuntime,
  NightbookWorkspaceRuntimeShape
>()('@astro-console/web/NightbookWorkspaceRuntime') {}

export const initialNightbookWorkspaceState: NightbookWorkspaceState = {
  projection: unavailableProjection,
  projectionReceived: false,
  libraryPage: { value: undefined, message: undefined },
  libraryDetail: { value: undefined, state: undefined },
  processSource: { value: undefined, state: undefined },
  process: {
    projects: [],
    project: undefined,
    evidence: undefined,
    state: 'loading',
  },
  comparison: { assetId: undefined, value: undefined, state: undefined },
}

const unavailable = (message: string) =>
  NightbookWorkspaceSubmission.Unavailable({ message })

const remoteFailure = (
  operation: NightbookWorkspaceRemoteOperation,
  reason:
    | 'not-found'
    | 'not-local'
    | 'unavailable'
    | 'rejected' = 'unavailable',
  message = 'The Nightbook workspace remote is unavailable.',
) =>
  new NightbookWorkspaceRemoteFailure({
    operation,
    reason,
    message,
  })

const libraryRemoteFailure = (
  operation: NightbookWorkspaceRemoteOperation,
  cause: unknown,
) =>
  cause instanceof LibraryNotFound
    ? remoteFailure(operation, 'not-found')
    : cause instanceof LibraryAssetUnavailable
      ? remoteFailure(operation, 'not-local')
      : remoteFailure(operation)

const createProjectRemoteFailure = (cause: ProcessingProjectRequestError) =>
  remoteFailure(
    'create-project',
    processingProjectFailureCertainty(cause.detail) === 'uncertain'
      ? 'unavailable'
      : 'rejected',
    cause.message,
  )

const projectCreationKey = (
  name: string,
  selection: NightbookProjectSelection,
) => JSON.stringify([name, selection.assetIds, selection.captureSetIds])

const acquireCommandIntent = (
  current: NightbookWorkspaceState,
  action: AcquireAction,
  idempotencyKey: typeof IdempotencyKey.Type,
): AcquireCommandIntent | undefined => {
  const observe = current.projection.observe
  const source = observe.source
  const acquire = source?.acquire
  if (
    !current.projectionReceived ||
    source === undefined ||
    acquire === undefined ||
    observe.leaseRevision === undefined
  )
    return undefined
  if (
    !acquire.actions.some(
      (candidate) =>
        candidate._tag === 'Available' && candidate.action === action._tag,
    ) ||
    (action._tag === 'ApprovePointingCorrection' &&
      acquire.pendingProposal?.proposalId !== action.proposalId)
  )
    return undefined
  const expected = {
    expectedLeaseRevision: LeaseRevision.make(observe.leaseRevision),
    expectedRunRevision: source.revision,
    expectedAcquireRevision: acquire.revision,
    idempotencyKey,
  }
  return AcquireAction.$match(action, {
    CaptureTargetAcquisitionEvidence: () =>
      AcquireIntent.cases.CaptureTargetAcquisitionEvidence.make(expected),
    RetryPlateSolveWithParameters: () =>
      AcquireIntent.cases.RetryPlateSolveWithParameters.make({
        ...expected,
        parameters: {
          exposureSeconds: 15,
          binning: 1,
          solverProfile: 'deep-sky-plate-solve',
        },
      }),
    SkipAcquireTarget: () =>
      AcquireIntent.cases.SkipAcquireTarget.make(expected),
    AbortAcquire: () => AcquireIntent.cases.AbortAcquire.make(expected),
    ApprovePointingCorrection: ({ proposalId }) =>
      AcquireIntent.cases.ApprovePointingCorrection.make({
        ...expected,
        proposalId,
      }),
  })
}

export const nightbookWorkspaceRuntimeLayer = Layer.effect(
  NightbookWorkspaceRuntime,
  Effect.gen(function* () {
    const remote = yield* NightbookWorkspaceRemote
    const scope = yield* Effect.scope
    const state = yield* SubscriptionRef.make<NightbookWorkspaceState>(
      initialNightbookWorkspaceState,
    )
    let routeGeneration = 0
    let currentRoute: Route | undefined
    let lastBootstrapCursor: number | undefined
    let pageFiber: Fiber.Fiber<void> | undefined
    let detailFiber: Fiber.Fiber<void> | undefined
    let sourceFiber: Fiber.Fiber<void> | undefined
    let processFiber: Fiber.Fiber<void> | undefined
    let comparisonFiber: Fiber.Fiber<void> | undefined
    let latestReviewOperation: string | undefined
    const pendingProjectCreations = new Map<
      string,
      CreateProcessingProjectRequest
    >()
    let processListReadGeneration = 0

    const set = (
      update: (current: NightbookWorkspaceState) => NightbookWorkspaceState,
    ) => SubscriptionRef.update(state, update)
    const replace = (
      fiber: Fiber.Fiber<void> | undefined,
      effect: Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        if (fiber !== undefined) yield* Fiber.interrupt(fiber)
        return yield* Effect.forkIn(scope)(effect)
      })

    const loadPage = (query: LibraryQuery, generation: number) =>
      remote.page(query).pipe(
        Effect.tap((value) =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                libraryPage: { value, message: undefined },
              }))
            : Effect.void,
        ),
        Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                libraryPage: {
                  value: current.libraryPage.value,
                  message: 'Library evidence is unavailable.',
                },
              }))
            : Effect.void,
        ),
        Effect.asVoid,
      )
    const loadDetail = (assetId: typeof AssetId.Type, generation: number) =>
      remote.detail(assetId).pipe(
        Effect.tap((value) =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                libraryDetail: { value, state: undefined },
              }))
            : Effect.void,
        ),
        Effect.catchTag('NightbookWorkspaceRemoteFailure', (error) =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                libraryDetail: {
                  value: current.libraryDetail.value,
                  state:
                    error.reason === 'not-found' ? 'not-found' : 'unavailable',
                },
              }))
            : Effect.void,
        ),
        Effect.asVoid,
      )
    const loadComparison = (assetId: typeof AssetId.Type, generation: number) =>
      remote.detail(assetId).pipe(
        Effect.tap((value) =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                comparison: { assetId, value, state: undefined },
              }))
            : Effect.void,
        ),
        Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                comparison: {
                  assetId,
                  value:
                    current.comparison.assetId === assetId
                      ? current.comparison.value
                      : undefined,
                  state: 'unavailable',
                },
              }))
            : Effect.void,
        ),
        Effect.asVoid,
      )
    const loadSource = (assetId: typeof AssetId.Type, generation: number) =>
      remote.processSource(assetId).pipe(
        Effect.tap((value) =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                processSource: { value, state: undefined },
              }))
            : Effect.void,
        ),
        Effect.catchTag('NightbookWorkspaceRemoteFailure', (error) =>
          generation === routeGeneration
            ? set((current) => ({
                ...current,
                processSource: {
                  value: current.processSource.value,
                  state:
                    error.reason === 'not-found'
                      ? 'not-found'
                      : error.reason === 'not-local'
                        ? 'not-local'
                        : 'unavailable',
                },
              }))
            : Effect.void,
        ),
        Effect.asVoid,
      )
    const loadProcess = (route: Route, generation: number) => {
      if (route.kind === 'process-project')
        return Effect.gen(function* () {
          const [project, evidence] = yield* Effect.all(
            [
              remote.openProject(route.projectId),
              remote.projectEvidence(route.projectId),
            ],
            { concurrency: 'unbounded' },
          )
          if (
            generation === routeGeneration &&
            project.projectId === route.projectId &&
            evidence.projectId === route.projectId
          )
            yield* set((current) => ({
              ...current,
              process: {
                ...current.process,
                project,
                evidence,
                state: 'current',
              },
            }))
        }).pipe(
          Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
            generation === routeGeneration
              ? set((current) => ({
                  ...current,
                  process: { ...current.process, state: 'unavailable' },
                }))
              : Effect.void,
          ),
          Effect.asVoid,
        )

      const listReadGeneration = ++processListReadGeneration
      const ownsProcessListRead = () =>
        generation === routeGeneration &&
        listReadGeneration === processListReadGeneration
      return remote.listProjects().pipe(
        Effect.tap((projects) =>
          ownsProcessListRead()
            ? set((current) => ({
                ...current,
                process: {
                  projects,
                  project: undefined,
                  evidence: undefined,
                  state: 'current',
                },
              }))
            : Effect.void,
        ),
        Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
          ownsProcessListRead()
            ? set((current) => ({
                ...current,
                process: { ...current.process, state: 'unavailable' },
              }))
            : Effect.void,
        ),
        Effect.asVoid,
      )
    }
    const readProjectPair = (projectId: typeof ProcessingProjectId.Type) =>
      Effect.all(
        {
          project: remote.openProject(projectId),
          evidence: remote.projectEvidence(projectId),
        },
        { concurrency: 'unbounded' },
      )
    const publishProjectPair = (pair: {
      readonly project: OpenedProcessingProject
      readonly evidence: ProcessingProjectEvidence
    }) =>
      set((current) => ({
        ...current,
        process: {
          ...current.process,
          project: pair.project,
          evidence: pair.evidence,
          state: 'current',
        },
      }))
    const reconcileProjectPair = (
      projectId: typeof ProcessingProjectId.Type,
      message: string,
    ) =>
      readProjectPair(projectId).pipe(
        Effect.tap(publishProjectPair),
        Effect.as(unavailable(message)),
        Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
          set((current) => ({
            ...current,
            process: { ...current.process, state: 'unavailable' },
          })).pipe(
            Effect.as(
              unavailable(
                'The Project outcome is uncertain. Reload current Project truth before another change.',
              ),
            ),
          ),
        ),
      )
    const routeChanged = (route: Route, libraryQuery: LibraryQuery) =>
      Effect.gen(function* () {
        const generation = ++routeGeneration
        currentRoute = route
        const keepsLibraryPage =
          (route.kind === 'workspace' && route.workspace === 'library') ||
          route.kind === 'asset'
        const keepsProcess =
          (route.kind === 'workspace' && route.workspace === 'process') ||
          route.kind === 'process-project' ||
          route.kind === 'process-source'
        if (!keepsLibraryPage && pageFiber !== undefined) {
          yield* Fiber.interrupt(pageFiber)
          pageFiber = undefined
        }
        if (route.kind !== 'asset' && detailFiber !== undefined) {
          yield* Fiber.interrupt(detailFiber)
          detailFiber = undefined
        }
        if (route.kind !== 'process-source' && sourceFiber !== undefined) {
          yield* Fiber.interrupt(sourceFiber)
          sourceFiber = undefined
        }
        if (!keepsProcess && processFiber !== undefined) {
          yield* Fiber.interrupt(processFiber)
          processFiber = undefined
        }
        if (comparisonFiber !== undefined) {
          yield* Fiber.interrupt(comparisonFiber)
          comparisonFiber = undefined
        }
        yield* set((current) => ({
          ...current,
          comparison: {
            assetId: undefined,
            value: undefined,
            state: undefined,
          },
        }))
        if (
          (route.kind === 'workspace' && route.workspace === 'library') ||
          route.kind === 'asset'
        ) {
          yield* set((current) => ({
            ...current,
            libraryPage: {
              value: current.libraryPage.value,
              message: 'Loading Library records.',
            },
          }))
          pageFiber = yield* replace(
            pageFiber,
            loadPage(libraryQuery, generation),
          )
          yield* set((current) => ({
            ...current,
            process: { ...current.process, state: 'loading' },
          }))
          processFiber = yield* replace(
            processFiber,
            loadProcess(
              { kind: 'workspace', workspace: 'process' },
              generation,
            ),
          )
        }
        if (route.kind === 'asset') {
          yield* set((current) => ({
            ...current,
            libraryDetail: {
              value:
                current.libraryDetail.value?.assetId === route.assetId
                  ? current.libraryDetail.value
                  : undefined,
              state: 'loading',
            },
          }))
          detailFiber = yield* replace(
            detailFiber,
            loadDetail(route.assetId, generation),
          )
        } else {
          yield* set((current) => ({
            ...current,
            libraryDetail: { value: undefined, state: undefined },
          }))
        }
        if (route.kind === 'process-source') {
          yield* set((current) => ({
            ...current,
            processSource: {
              value:
                current.processSource.value?.sourceAssetId ===
                route.sourceAssetId
                  ? current.processSource.value
                  : undefined,
              state: 'loading',
            },
          }))
          sourceFiber = yield* replace(
            sourceFiber,
            loadSource(route.sourceAssetId, generation),
          )
        } else {
          yield* set((current) => ({
            ...current,
            processSource: { value: undefined, state: undefined },
          }))
        }
        if (
          (route.kind === 'workspace' && route.workspace === 'process') ||
          route.kind === 'process-project' ||
          route.kind === 'process-source'
        ) {
          yield* set((current) => ({
            ...current,
            process: { ...current.process, state: 'loading' },
          }))
          processFiber = yield* replace(
            processFiber,
            loadProcess(route, generation),
          )
        }
      })

    yield* remote.states.pipe(
      Stream.runForEach((bootstrap) =>
        Effect.gen(function* () {
          yield* set((current) => ({
            ...current,
            projection: projectBootstrapState(bootstrap),
            projectionReceived: true,
          }))
          const cursor =
            bootstrap._tag === 'Unavailable'
              ? undefined
              : bootstrap.snapshot.eventCursor
          const route = currentRoute
          const refreshesOpenProject =
            route?.kind === 'process-project' &&
            cursor !== undefined &&
            lastBootstrapCursor !== undefined &&
            cursor > lastBootstrapCursor
          if (
            cursor !== undefined &&
            (lastBootstrapCursor === undefined || cursor > lastBootstrapCursor)
          )
            lastBootstrapCursor = cursor
          if (refreshesOpenProject) {
            processFiber = yield* replace(
              processFiber,
              loadProcess(route, routeGeneration),
            )
          }
        }),
      ),
      Effect.forkScoped,
    )

    const submit: NightbookWorkspaceRuntimeShape['submit'] = Effect.fn(
      'NightbookWorkspaceRuntime.submit',
    )((intent) =>
      NightbookWorkspaceIntent.$match(intent, {
        RouteChanged: ({ route, libraryQuery }) =>
          routeChanged(route, libraryQuery).pipe(
            Effect.as(NightbookWorkspaceSubmission.Loaded({})),
          ),
        Control: ({ action }) =>
          remote
            .control(action)
            .pipe(
              Effect.map((result) =>
                NightbookWorkspaceSubmission.Control({ result }),
              ),
            ),
        Plan: ({ action, key }) =>
          remote
            .plan(action, key)
            .pipe(
              Effect.map((result) =>
                NightbookWorkspaceSubmission.Plan({ result }),
              ),
            ),
        Observe: ({ action, key }) =>
          remote
            .observe(action, key)
            .pipe(
              Effect.map((result) =>
                NightbookWorkspaceSubmission.Observe({ result }),
              ),
            ),
        RefreshPreflight: () =>
          remote
            .refreshPreflight()
            .pipe(
              Effect.map((result) =>
                NightbookWorkspaceSubmission.Preflight({ result }),
              ),
            ),
        Acquire: ({ action }) =>
          Effect.gen(function* () {
            const current = yield* SubscriptionRef.get(state)
            const idempotencyKey = yield* Effect.sync(() =>
              IdempotencyKey.make(crypto.randomUUID()),
            )
            const intent = acquireCommandIntent(current, action, idempotencyKey)
            if (intent === undefined)
              return NightbookWorkspaceSubmission.Acquire({
                accepted: false,
                message: 'Current target acquisition state is unavailable.',
              })
            return yield* remote.acquire(intent).pipe(
              Effect.as(
                NightbookWorkspaceSubmission.Acquire({ accepted: true }),
              ),
              Effect.catchTag('NightbookWorkspaceRemoteFailure', (error) =>
                remote.refresh().pipe(
                  Effect.as(
                    NightbookWorkspaceSubmission.Acquire({
                      accepted: false,
                      message: error.message,
                    }),
                  ),
                ),
              ),
            )
          }),
        ReviewLibraryAsset: ({ assetId, request }) =>
          Effect.gen(function* () {
            const generation = routeGeneration
            const operation = request.idempotencyKey
            latestReviewOperation = operation
            const ownsCurrentAssetRoute = () =>
              generation === routeGeneration &&
              currentRoute?.kind === 'asset' &&
              currentRoute.assetId === assetId &&
              latestReviewOperation === operation
            return yield* remote.review(assetId, request).pipe(
              Effect.tap((review) =>
                ownsCurrentAssetRoute()
                  ? set((current) =>
                      current.libraryDetail.value?.assetId === assetId
                        ? {
                            ...current,
                            libraryDetail: {
                              value: {
                                ...current.libraryDetail.value,
                                ...(review === undefined ? {} : { review }),
                              },
                              state: undefined,
                            },
                          }
                        : current,
                    )
                  : Effect.void,
              ),
              Effect.as(NightbookWorkspaceSubmission.Loaded({})),
              Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                remote.detail(assetId).pipe(
                  Effect.tap((value) =>
                    ownsCurrentAssetRoute()
                      ? set((current) => ({
                          ...current,
                          libraryDetail: { value, state: undefined },
                        }))
                      : Effect.void,
                  ),
                  Effect.as(
                    unavailable(
                      'The review outcome was reloaded from current Library truth.',
                    ),
                  ),
                  Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                    (ownsCurrentAssetRoute()
                      ? set((current) => ({
                          ...current,
                          libraryDetail: {
                            value: current.libraryDetail.value,
                            state: 'unavailable',
                          },
                        }))
                      : Effect.void
                    ).pipe(
                      Effect.as(
                        unavailable(
                          'The review outcome is uncertain. Reload current Library truth before another review.',
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            )
          }),
        SelectComparisonAsset: ({ assetId }) =>
          Effect.gen(function* () {
            if (assetId === undefined) {
              yield* set((current) => ({
                ...current,
                comparison: {
                  assetId: undefined,
                  value: undefined,
                  state: undefined,
                },
              }))
              return NightbookWorkspaceSubmission.Loaded({})
            }
            const generation = routeGeneration
            yield* set((current) => ({
              ...current,
              comparison: {
                assetId,
                value:
                  current.comparison.assetId === assetId
                    ? current.comparison.value
                    : undefined,
                state: 'loading',
              },
            }))
            comparisonFiber = yield* replace(
              comparisonFiber,
              loadComparison(assetId, generation),
            )
            return NightbookWorkspaceSubmission.Loaded({})
          }),
        CreateProject: ({ name, selection }) => {
          const generation = routeGeneration
          const key = projectCreationKey(name, selection)
          const request =
            pendingProjectCreations.get(key) ??
            ({
              name,
              selection,
              intentId: IntentId.make(crypto.randomUUID()),
            } satisfies CreateProcessingProjectRequest)
          pendingProjectCreations.set(key, request)
          const clearRequest = () => {
            if (pendingProjectCreations.get(key) === request)
              pendingProjectCreations.delete(key)
          }
          return remote.createProject(request).pipe(
            Effect.tap(() => Effect.sync(clearRequest)),
            Effect.map((project) =>
              NightbookWorkspaceSubmission.Project({ project }),
            ),
            Effect.catchTag('NightbookWorkspaceRemoteFailure', (error) =>
              Effect.sync(() => {
                if (error.reason === 'rejected') clearRequest()
                return generation === routeGeneration
              }).pipe(
                Effect.flatMap((ownsRoute) => {
                  if (!ownsRoute)
                    return Effect.succeed(
                      error.reason === 'rejected'
                        ? unavailable(error.message)
                        : unavailable(
                            'Project intake is uncertain. Reload current Project truth before another intake.',
                          ),
                    )

                  const listReadGeneration = ++processListReadGeneration
                  const ownsProcessListRead = () =>
                    generation === routeGeneration &&
                    listReadGeneration === processListReadGeneration
                  return remote.listProjects().pipe(
                    Effect.tap((projects) =>
                      ownsProcessListRead()
                        ? set((current) => ({
                            ...current,
                            process: {
                              ...current.process,
                              projects,
                              state: 'current',
                            },
                          }))
                        : Effect.void,
                    ),
                    Effect.as(
                      unavailable(
                        'Project intake was reconciled with the current Project list.',
                      ),
                    ),
                    Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                      (ownsProcessListRead()
                        ? set((current) => ({
                            ...current,
                            process: {
                              ...current.process,
                              state: 'unavailable',
                            },
                          }))
                        : Effect.void
                      ).pipe(
                        Effect.as(
                          unavailable(
                            'Project intake is uncertain. Reload current Project truth before another intake.',
                          ),
                        ),
                      ),
                    ),
                  )
                }),
              ),
            ),
          )
        },
        ChangeProject: ({ project: selected, intent }) =>
          remote.changeProject(selected, intent).pipe(
            Effect.map((project) => ProjectChangeAttempt.Changed({ project })),
            Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
              Effect.succeed(ProjectChangeAttempt.Failed({})),
            ),
            Effect.flatMap((attempt) =>
              ProjectChangeAttempt.$match(attempt, {
                Failed: () =>
                  reconcileProjectPair(
                    selected.projectId,
                    'The Project was reloaded after an uncertain outcome.',
                  ),
                Changed: ({ project }) =>
                  remote.projectEvidence(project.projectId).pipe(
                    Effect.map((evidence) => ({ project, evidence })),
                    Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                      readProjectPair(project.projectId),
                    ),
                    Effect.tap(publishProjectPair),
                    Effect.map(({ project: confirmed }) =>
                      NightbookWorkspaceSubmission.Project({
                        project: confirmed,
                      }),
                    ),
                    Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                      set((current) => ({
                        ...current,
                        process: {
                          ...current.process,
                          state: 'unavailable',
                        },
                      })).pipe(
                        Effect.as(
                          unavailable(
                            'The Project outcome is uncertain. Reload current Project truth before another change.',
                          ),
                        ),
                      ),
                    ),
                  ),
              }),
            ),
          ),
        AddProjectSources: ({
          projectId,
          expectedProjectRevision,
          selection,
        }) =>
          remote
            .addProjectSources(projectId, expectedProjectRevision, selection)
            .pipe(
              Effect.map((project) =>
                NightbookWorkspaceSubmission.Project({ project }),
              ),
              Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                reconcileProjectPair(
                  projectId,
                  'Project intake was reconciled with current Project truth.',
                ),
              ),
            ),
      }),
    )
    return NightbookWorkspaceRuntime.of({
      states: SubscriptionRef.changes(state),
      submit,
    })
  }),
)

export const productionNightbookWorkspaceRemoteLayer = Layer.effect(
  NightbookWorkspaceRemote,
  Effect.gen(function* () {
    const bootstrap = yield* BootstrapClient
    const command = yield* CommandClient
    const plan = yield* PlanCommandClient
    const observe = yield* ObserveCommandClient
    const preflight = yield* PreflightRefreshClient
    const library = yield* LibraryClient
    return NightbookWorkspaceRemote.of({
      states: bootstrap.states,
      refresh: bootstrap.refresh,
      control: command.submit,
      plan: plan.submit,
      observe: observe.submit,
      refreshPreflight: preflight.refresh,
      acquire: submitAcquireIntent,
      page: (query) =>
        library
          .page(query)
          .pipe(
            Effect.mapError((cause) => libraryRemoteFailure('page', cause)),
          ),
      detail: (assetId) =>
        library
          .detail(assetId)
          .pipe(
            Effect.mapError((cause) => libraryRemoteFailure('detail', cause)),
          ),
      processSource: (assetId) =>
        library
          .processSourceHandoff(assetId)
          .pipe(
            Effect.mapError((cause) =>
              libraryRemoteFailure('process-source', cause),
            ),
          ),
      review: (assetId, request) =>
        library
          .reviewAsset(assetId, request)
          .pipe(
            Effect.mapError((cause) => libraryRemoteFailure('review', cause)),
          ),
      listProjects: () =>
        processClient
          .list()
          .pipe(Effect.mapError(() => remoteFailure('list-projects'))),
      openProject: (projectId) =>
        processClient
          .open(projectId)
          .pipe(Effect.mapError(() => remoteFailure('open-project'))),
      projectEvidence: (projectId) =>
        processClient
          .evidence(projectId)
          .pipe(Effect.mapError(() => remoteFailure('project-evidence'))),
      createProject: (request) =>
        processClient.create(request).pipe(
          Effect.map((changed) => changed.project),
          Effect.mapError(createProjectRemoteFailure),
        ),
      changeProject: (project, intent) =>
        processClient
          .change({
            projectId: project.projectId,
            expectedProjectRevision: project.revision,
            intentId: IntentId.make(crypto.randomUUID()),
            intent,
          })
          .pipe(
            Effect.map((changed) => changed.project),
            Effect.mapError(() => remoteFailure('change-project')),
          ),
      addProjectSources: (projectId, expectedProjectRevision, selection) =>
        processClient
          .change({
            projectId,
            expectedProjectRevision,
            intentId: IntentId.make(crypto.randomUUID()),
            intent: {
              _tag: 'AddSources',
              selection,
            },
          })
          .pipe(
            Effect.map((changed) => changed.project),
            Effect.mapError(() => remoteFailure('add-project-sources')),
          ),
    } satisfies NightbookWorkspaceRemoteShape)
  }),
)

export const createNightbookWorkspaceRuntime = () =>
  ManagedRuntime.make(
    nightbookWorkspaceRuntimeLayer.pipe(
      Layer.provide(
        productionNightbookWorkspaceRemoteLayer.pipe(
          Layer.provide(browserBootstrapClientLayer),
        ),
      ),
    ),
  )

const submitAcquireIntent = Effect.fn('NightbookWorkspaceRemote.acquire')(
  function* (intent: AcquireCommandIntent) {
    const request = yield* Schema.decodeUnknownEffect(AcquireCommandRequest)({
      intent,
    }).pipe(Effect.mapError(() => remoteFailure('acquire')))
    const response = yield* Effect.tryPromise({
      try: async (signal) => {
        const fetched = await fetch('/api/acquire/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
          signal,
        })
        return {
          ok: fetched.ok,
          body: await fetched.json().catch(() => undefined),
        }
      },
      catch: () => remoteFailure('acquire'),
    })
    const result = yield* Schema.decodeUnknownEffect(AcquireCommandResponse)(
      response.body,
    ).pipe(Effect.mapError(() => remoteFailure('acquire')))
    return yield* AcquireCommandResponse.match(result, {
      Accepted: () =>
        response.ok
          ? Effect.void
          : Effect.fail(
              remoteFailure(
                'acquire',
                'unavailable',
                'Acquire response status is invalid.',
              ),
            ),
      Rejected: ({ summary }) =>
        Effect.fail(remoteFailure('acquire', 'unavailable', summary)),
      Unavailable: ({ summary }) =>
        Effect.fail(remoteFailure('acquire', 'unavailable', summary)),
    })
  },
)
