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
  ProcessingProjectId,
  ProcessingProjectRevision,
  type ProcessingProjectIntent,
} from '@astro-console/protocol'
import { BootstrapClient, type BootstrapClientState } from './bootstrap-client'
import { browserBootstrapClientLayer } from './bootstrap-runtime'
import {
  CommandClient,
  type CommandSubmission,
  type ControlIntent,
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
  processClient,
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
  Control: { readonly intent: ControlIntent }
  Plan: {
    readonly action: PlanAction
    readonly key: typeof IdempotencyKey.Type
  }
  Observe: {
    readonly action: ObserveAction
    readonly key: typeof IdempotencyKey.Type
  }
  RefreshPreflight: { readonly _never?: never }
  Acquire: { readonly intent: AcquireCommandIntent }
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
    reason: Schema.Literals(['not-found', 'not-local', 'unavailable']),
    message: Schema.String,
  },
) {}

export interface NightbookWorkspaceRemoteShape {
  readonly states: Stream.Stream<BootstrapClientState>
  readonly refresh: () => Effect.Effect<void>
  readonly control: (intent: ControlIntent) => Effect.Effect<CommandSubmission>
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
    name: string,
    selection: NightbookProjectSelection,
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
  reason: 'not-found' | 'not-local' | 'unavailable' = 'unavailable',
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

export const nightbookWorkspaceRuntimeLayer = Layer.effect(
  NightbookWorkspaceRuntime,
  Effect.gen(function* () {
    const remote = yield* NightbookWorkspaceRemote
    const scope = yield* Effect.scope
    const state = yield* SubscriptionRef.make<NightbookWorkspaceState>(
      initialNightbookWorkspaceState,
    )
    let routeGeneration = 0
    let pageFiber: Fiber.Fiber<void> | undefined
    let detailFiber: Fiber.Fiber<void> | undefined
    let sourceFiber: Fiber.Fiber<void> | undefined
    let processFiber: Fiber.Fiber<void> | undefined
    let comparisonFiber: Fiber.Fiber<void> | undefined

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
    const loadProcess = (route: Route, generation: number) =>
      Effect.gen(function* () {
        if (route.kind === 'process-project') {
          const [project, evidence] = yield* Effect.all(
            [
              remote.openProject(route.projectId),
              remote.projectEvidence(route.projectId),
            ],
            { concurrency: 'unbounded' },
          )
          if (generation === routeGeneration)
            yield* set((current) => ({
              ...current,
              process: {
                ...current.process,
                project,
                evidence,
                state: 'current',
              },
            }))
          return
        }
        const projects = yield* remote.listProjects()
        if (generation === routeGeneration)
          yield* set((current) => ({
            ...current,
            process: {
              projects,
              project: undefined,
              evidence: undefined,
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
        set((current) => ({
          ...current,
          projection: projectBootstrapState(bootstrap),
          projectionReceived: true,
        })),
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
        Control: ({ intent }) =>
          remote
            .control(intent)
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
        Acquire: ({ intent }) =>
          remote.acquire(intent).pipe(
            Effect.as(NightbookWorkspaceSubmission.Acquire({ accepted: true })),
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
          ),
        ReviewLibraryAsset: ({ assetId, request }) =>
          remote.review(assetId, request).pipe(
            Effect.tap((review) =>
              set((current) =>
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
              ),
            ),
            Effect.as(NightbookWorkspaceSubmission.Loaded({})),
            Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
              remote.detail(assetId).pipe(
                Effect.tap((value) =>
                  set((current) => ({
                    ...current,
                    libraryDetail: { value, state: undefined },
                  })),
                ),
                Effect.as(
                  unavailable(
                    'The review outcome was reloaded from current Library truth.',
                  ),
                ),
                Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                  set((current) => ({
                    ...current,
                    libraryDetail: {
                      value: current.libraryDetail.value,
                      state: 'unavailable',
                    },
                  })).pipe(
                    Effect.as(
                      unavailable(
                        'The review outcome is uncertain. Reload current Library truth before another review.',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
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
        CreateProject: ({ name, selection }) =>
          remote.createProject(name, selection).pipe(
            Effect.map((project) =>
              NightbookWorkspaceSubmission.Project({ project }),
            ),
            Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
              remote.listProjects().pipe(
                Effect.tap((projects) =>
                  set((current) => ({
                    ...current,
                    process: {
                      ...current.process,
                      projects,
                      state: 'current',
                    },
                  })),
                ),
                Effect.as(
                  unavailable(
                    'Project intake was reconciled with the current Project list.',
                  ),
                ),
                Effect.catchTag('NightbookWorkspaceRemoteFailure', () =>
                  set((current) => ({
                    ...current,
                    process: { ...current.process, state: 'unavailable' },
                  })).pipe(
                    Effect.as(
                      unavailable(
                        'Project intake is uncertain. Reload current Project truth before another intake.',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
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
        Effect.tryPromise({
          try: (signal) => processClient.list(signal),
          catch: () => remoteFailure('list-projects'),
        }),
      openProject: (projectId) =>
        Effect.tryPromise({
          try: (signal) => processClient.open(projectId, signal),
          catch: () => remoteFailure('open-project'),
        }),
      projectEvidence: (projectId) =>
        Effect.tryPromise({
          try: (signal) => processClient.evidence(projectId, signal),
          catch: () => remoteFailure('project-evidence'),
        }),
      createProject: (name, selection) =>
        Effect.tryPromise({
          try: async (signal) =>
            (
              await processClient.create(
                {
                  name,
                  selection,
                  intentId: IntentId.make(crypto.randomUUID()),
                },
                signal,
              )
            ).project,
          catch: () => remoteFailure('create-project'),
        }),
      changeProject: (project, intent) =>
        Effect.tryPromise({
          try: async (signal) =>
            (
              await processClient.change(
                {
                  projectId: project.projectId,
                  expectedProjectRevision: project.revision,
                  intentId: IntentId.make(crypto.randomUUID()),
                  intent,
                },
                signal,
              )
            ).project,
          catch: () => remoteFailure('change-project'),
        }),
      addProjectSources: (projectId, expectedProjectRevision, selection) =>
        Effect.tryPromise({
          try: async (signal) =>
            (
              await processClient.change(
                {
                  projectId,
                  expectedProjectRevision,
                  intentId: IntentId.make(crypto.randomUUID()),
                  intent: {
                    _tag: 'AddSources',
                    selection,
                  },
                },
                signal,
              )
            ).project,
          catch: () => remoteFailure('add-project-sources'),
        }),
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
    if (result._tag === 'Accepted' && response.ok) return
    if (result._tag === 'Accepted')
      return yield* Effect.fail(
        remoteFailure(
          'acquire',
          'unavailable',
          'Acquire response status is invalid.',
        ),
      )
    return yield* Effect.fail(
      remoteFailure('acquire', 'unavailable', result.summary),
    )
  },
)
