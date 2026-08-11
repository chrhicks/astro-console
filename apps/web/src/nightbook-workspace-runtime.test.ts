import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LibraryAssetDetail as LibraryAssetDetailSchema,
  LibraryPage as LibraryPageSchema,
  LibraryQuery as LibraryQuerySchema,
  LibraryQueryId,
  ProcessingProjectId,
  ProcessingProjectRevision,
} from '@astro-console/protocol'
import {
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Stream,
} from 'effect'
import {
  NightbookWorkspaceRemote,
  NightbookWorkspaceRemoteFailure,
  NightbookWorkspaceRuntime,
  nightbookWorkspaceRuntimeLayer,
  type NightbookWorkspaceIntent,
  type NightbookWorkspaceRemoteShape,
  type NightbookWorkspaceState,
  type ProcessingProjectList,
} from './nightbook-workspace-runtime'

const query = (id: string) =>
  LibraryQuerySchema.make({
    queryId: LibraryQueryId.make(id),
    pageSize: 40,
    sort: 'capturedAtDescending',
  })

const page = (id: string, version: number) =>
  Schema.decodeUnknownSync(LibraryPageSchema)({
    queryId: id,
    querySnapshotVersion: version,
    results: [],
    catalogChanged: false,
  })

const detail = Schema.decodeUnknownSync(LibraryAssetDetailSchema)({
  assetId: 'asset-1',
  revision: 1,
  role: 'original',
  format: 'fits',
  availability: 'availableLocally',
  capturedAt: '2026-08-11T00:00:00.000Z',
  comparisonGroupId: 'group-1',
  lineage: { sourceAssetIds: [] },
  representations: [],
  actions: [],
})

const projects = (id: string): ProcessingProjectList => [
  {
    projectId: ProcessingProjectId.make(id),
    revision: ProcessingProjectRevision.make(1),
    name: id,
    sourceCount: 1,
    state: 'Ready',
    updatedAt: '2026-08-11T00:00:00.000Z',
  },
]

const failure = (operation: string) =>
  new NightbookWorkspaceRemoteFailure({
    operation,
    reason: 'unavailable',
    message: `${operation} unavailable`,
  })

const makeRemote = (
  overrides: Partial<NightbookWorkspaceRemoteShape>,
): NightbookWorkspaceRemoteShape => ({
  states: Stream.empty,
  refresh: () => Effect.void,
  acquire: () => Effect.die('not used'),
  control: () => Effect.die('not used'),
  plan: () => Effect.die('not used'),
  observe: () => Effect.die('not used'),
  refreshPreflight: () => Effect.die('not used'),
  page: () => Effect.die('not used'),
  detail: () => Effect.die('not used'),
  processSource: () => Effect.die('not used'),
  review: () => Effect.die('not used'),
  listProjects: () => Effect.die('not used'),
  openProject: () => Effect.die('not used'),
  projectEvidence: () => Effect.die('not used'),
  createProject: () => Effect.die('not used'),
  changeProject: () => Effect.die('not used'),
  addProjectSources: () => Effect.die('not used'),
  ...overrides,
})

const makeRuntime = (remote: NightbookWorkspaceRemoteShape) =>
  ManagedRuntime.make(
    nightbookWorkspaceRuntimeLayer.pipe(
      Layer.provide(
        Layer.succeed(
          NightbookWorkspaceRemote,
          NightbookWorkspaceRemote.of(remote),
        ),
      ),
    ),
  )

const submit = (
  runtime: ReturnType<typeof makeRuntime>,
  intent: NightbookWorkspaceIntent,
) =>
  runtime.runPromise(
    Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
      workspace.submit(intent),
    ),
  )

const waitFor = (
  runtime: ReturnType<typeof makeRuntime>,
  predicate: (state: NightbookWorkspaceState) => boolean,
) =>
  runtime.runPromise(
    Effect.flatMap(NightbookWorkspaceRuntime, (workspace) =>
      workspace.states.pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      ),
    ),
  )

test('reconciles an uncertain Acquire outcome once without replaying it', async () => {
  let submissions = 0
  let refreshes = 0
  const runtime = makeRuntime(
    makeRemote({
      refresh: () => Effect.sync(() => void (refreshes += 1)),
      acquire: () =>
        Effect.sync(() => void (submissions += 1)).pipe(
          Effect.andThen(Effect.fail(failure('acquire'))),
        ),
    }),
  )

  const result = await submit(runtime, {
    _tag: 'Acquire',
    intent: { _tag: 'AbortAcquire' },
  })
  await runtime.dispose()

  assert.equal(result._tag, 'Acquire')
  assert.equal(submissions, 1)
  assert.equal(refreshes, 1)
})

test('cancels replaced and disposed Library and Process loads and ignores late results', async () => {
  const pageStarted = Effect.runSync(Deferred.make<void>())
  const processStarted = Effect.runSync(Deferred.make<void>())
  const thirdPageStarted = Effect.runSync(Deferred.make<void>())
  const thirdProcessStarted = Effect.runSync(Deferred.make<void>())
  const firstPage = Effect.runSync(Deferred.make<ReturnType<typeof page>>())
  const firstProjects = Effect.runSync(Deferred.make<ProcessingProjectList>())
  const thirdPage = Effect.runSync(Deferred.make<ReturnType<typeof page>>())
  const thirdProjects = Effect.runSync(Deferred.make<ProcessingProjectList>())
  let pageCalls = 0
  let processCalls = 0
  let pageInterruptions = 0
  let processInterruptions = 0
  const latestPage = page('latest', 2)
  const latestProjects = projects('latest-project')
  const runtime = makeRuntime(
    makeRemote({
      page: () =>
        Effect.gen(function* () {
          pageCalls += 1
          if (pageCalls === 2) return latestPage
          yield* Deferred.succeed(
            pageCalls === 1 ? pageStarted : thirdPageStarted,
            undefined,
          )
          return yield* Deferred.await(
            pageCalls === 1 ? firstPage : thirdPage,
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => void (pageInterruptions += 1)),
            ),
          )
        }),
      listProjects: () =>
        Effect.gen(function* () {
          processCalls += 1
          if (processCalls === 2) return latestProjects
          yield* Deferred.succeed(
            processCalls === 1 ? processStarted : thirdProcessStarted,
            undefined,
          )
          return yield* Deferred.await(
            processCalls === 1 ? firstProjects : thirdProjects,
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => void (processInterruptions += 1)),
            ),
          )
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('first'),
  })
  await runtime.runPromise(
    Effect.all([Deferred.await(pageStarted), Deferred.await(processStarted)]),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('second'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.libraryPage.value?.querySnapshotVersion === 2 &&
      state.process.projects[0]?.projectId === 'latest-project',
  )

  await runtime.runPromise(
    Effect.all([
      Deferred.succeed(firstPage, page('late', 1)),
      Deferred.succeed(firstProjects, projects('late-project')),
    ]),
  )
  const latest = await waitFor(
    runtime,
    (state) => state.libraryPage.value?.querySnapshotVersion === 2,
  )
  assert.equal(latest.process.projects[0]?.projectId, 'latest-project')
  assert.equal(pageInterruptions, 1)
  assert.equal(processInterruptions, 1)

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('third'),
  })
  await runtime.runPromise(
    Effect.all([
      Deferred.await(thirdPageStarted),
      Deferred.await(thirdProcessStarted),
    ]),
  )
  await runtime.dispose()
  assert.equal(pageInterruptions, 2)
  assert.equal(processInterruptions, 2)
})

test('cancels route work when the next workspace no longer needs it', async () => {
  const pageStarted = Effect.runSync(Deferred.make<void>())
  const processStarted = Effect.runSync(Deferred.make<void>())
  let pageInterruptions = 0
  let processInterruptions = 0
  const runtime = makeRuntime(
    makeRemote({
      page: () =>
        Deferred.succeed(pageStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => void (pageInterruptions += 1)),
          ),
        ),
      listProjects: () =>
        Deferred.succeed(processStarted, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => void (processInterruptions += 1)),
          ),
        ),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'library' },
    libraryQuery: query('library'),
  })
  await runtime.runPromise(
    Effect.all([Deferred.await(pageStarted), Deferred.await(processStarted)]),
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'workspace', workspace: 'plan' },
    libraryQuery: query('plan'),
  })
  await runtime.dispose()

  assert.equal(pageInterruptions, 1)
  assert.equal(processInterruptions, 1)
})

test('retains last-confirmed Library and Process values while reload fails', async () => {
  const pageReloadStarted = Effect.runSync(Deferred.make<void>())
  const detailReloadStarted = Effect.runSync(Deferred.make<void>())
  const processReloadStarted = Effect.runSync(Deferred.make<void>())
  const releaseReloads = Effect.runSync(Deferred.make<void>())
  let pageCalls = 0
  let detailCalls = 0
  let processCalls = 0
  const confirmedPage = page('confirmed', 7)
  const confirmedProjects = projects('confirmed-project')
  const reloadFailure = (started: Deferred.Deferred<void>, operation: string) =>
    Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Deferred.await(releaseReloads)),
      Effect.andThen(Effect.fail(failure(operation))),
    )
  const runtime = makeRuntime(
    makeRemote({
      page: () =>
        ++pageCalls === 1
          ? Effect.succeed(confirmedPage)
          : reloadFailure(pageReloadStarted, 'page'),
      detail: () =>
        ++detailCalls === 1
          ? Effect.succeed(detail)
          : reloadFailure(detailReloadStarted, 'detail'),
      listProjects: () =>
        ++processCalls === 1
          ? Effect.succeed(confirmedProjects)
          : reloadFailure(processReloadStarted, 'list-projects'),
    }),
  )
  const route = { kind: 'asset', assetId: detail.assetId } as const

  await submit(runtime, {
    _tag: 'RouteChanged',
    route,
    libraryQuery: query('confirmed'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.libraryPage.value?.querySnapshotVersion === 7 &&
      state.libraryDetail.value?.assetId === detail.assetId &&
      state.process.projects[0]?.projectId === 'confirmed-project',
  )
  await submit(runtime, {
    _tag: 'RouteChanged',
    route,
    libraryQuery: query('reload'),
  })
  await runtime.runPromise(
    Effect.all([
      Deferred.await(pageReloadStarted),
      Deferred.await(detailReloadStarted),
      Deferred.await(processReloadStarted),
    ]),
  )
  const loading = await waitFor(
    runtime,
    (state) =>
      state.libraryPage.message === 'Loading Library records.' &&
      state.libraryDetail.state === 'loading' &&
      state.process.state === 'loading',
  )
  assert.equal(loading.libraryPage.value?.querySnapshotVersion, 7)
  assert.equal(loading.libraryDetail.value?.assetId, detail.assetId)
  assert.equal(loading.process.projects[0]?.projectId, 'confirmed-project')

  const failedState = waitFor(
    runtime,
    (state) =>
      state.libraryPage.message === 'Library evidence is unavailable.' &&
      state.libraryDetail.state === 'unavailable' &&
      state.process.state === 'unavailable',
  )
  await runtime.runPromise(Deferred.succeed(releaseReloads, undefined))
  const failed = await failedState
  await runtime.dispose()

  assert.equal(failed.libraryPage.value?.querySnapshotVersion, 7)
  assert.equal(failed.libraryDetail.value?.assetId, detail.assetId)
  assert.equal(failed.process.projects[0]?.projectId, 'confirmed-project')
})
