import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AcquireRevision,
  AssetRevision,
  BootstrapSnapshot,
  IdempotencyKey,
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
  LibraryQueryId,
  LeaseRevision,
  OpenedProcessingProject,
  ProcessingProjectEvidence,
  ProcessingProjectId,
  ProcessingProjectRevision,
  RunRevision,
} from '@astro-console/protocol'
import {
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schema,
  Stream,
} from 'effect'
import { BootstrapClientState } from './bootstrap-client'
import {
  NightbookWorkspaceRemote,
  NightbookWorkspaceRemoteFailure,
  NightbookWorkspaceIntent,
  NightbookWorkspaceRuntime,
  nightbookWorkspaceRuntimeLayer,
  type NightbookWorkspaceRemoteShape,
  type NightbookWorkspaceState,
  type ProcessingProjectList,
} from './nightbook-workspace-runtime'
import { bootstrapFixtures } from './testing/bootstrap-fixtures'

const query = (id: string) =>
  LibraryQuery.make({
    queryId: LibraryQueryId.make(id),
    pageSize: 40,
    sort: 'capturedAtDescending',
  })

const page = (id: string, version: number) =>
  Schema.decodeUnknownSync(LibraryPage)({
    queryId: id,
    querySnapshotVersion: version,
    results: [],
    catalogChanged: false,
  })

const detail = Schema.decodeUnknownSync(LibraryAssetDetail)({
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

const processingStages = [
  {
    stage: 'Calibration',
    draft: {
      revision: 0,
      value: { _tag: 'Calibration', settings: [], overrides: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Registration',
    draft: {
      revision: 0,
      value: { _tag: 'Registration', settings: [], inclusions: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Stacking',
    draft: {
      revision: 0,
      value: { _tag: 'Stacking', settings: [], frameChoices: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Develop',
    draft: {
      revision: 0,
      value: {
        _tag: 'Develop',
        operation: { _tag: 'Stretch', method: 'asinh', amount: 0.35 },
      },
      canUndo: false,
      canRedo: false,
    },
  },
].map((stage) => ({
  ...stage,
  resultHistory: { canUndo: false, canRedo: false },
  run: { _tag: 'Unavailable', reason: 'CurrentUpstreamResultRequired' },
}))

const openedProject = (revision: number) =>
  Schema.decodeUnknownSync(OpenedProcessingProject)({
    projectId: 'project-1',
    revision,
    name: 'M27',
    authority: { _tag: 'Allowed' },
    sources: [],
    warnings: [],
    stages: processingStages,
    savedAssetIds: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: `2026-08-11T00:00:0${revision}.000Z`,
  })

const projectEvidence = () =>
  Schema.decodeUnknownSync(ProcessingProjectEvidence)({
    projectId: 'project-1',
    attempts: [],
  })

const failure = (operation: NightbookWorkspaceRemoteFailure['operation']) =>
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

test('constructs closed Acquire and branded resource intents', () => {
  const acquire = NightbookWorkspaceIntent.Acquire({
    intent: {
      _tag: 'AbortAcquire',
      expectedLeaseRevision: LeaseRevision.make(1),
      expectedRunRevision: RunRevision.make(1),
      expectedAcquireRevision: AcquireRevision.make(1),
      idempotencyKey: IdempotencyKey.make('abort-typed'),
    },
  })
  const comparison = NightbookWorkspaceIntent.SelectComparisonAsset({
    assetId: detail.assetId,
  })
  const intake = NightbookWorkspaceIntent.AddProjectSources({
    projectId: ProcessingProjectId.make('project-typed'),
    expectedProjectRevision: ProcessingProjectRevision.make(1),
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })

  assert.equal(acquire.intent._tag, 'AbortAcquire')
  assert.equal(comparison.assetId, detail.assetId)
  assert.equal(intake.projectId, 'project-typed')
})

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
    intent: {
      _tag: 'AbortAcquire',
      expectedLeaseRevision: LeaseRevision.make(1),
      expectedRunRevision: RunRevision.make(1),
      expectedAcquireRevision: AcquireRevision.make(1),
      idempotencyKey: IdempotencyKey.make('abort-1'),
    },
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
  const reloadFailure = (
    started: Deferred.Deferred<void>,
    operation: NightbookWorkspaceRemoteFailure['operation'],
  ) =>
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

test('publishes a matched Process pair when post-change evidence needs reconciliation', async () => {
  const confirmed = openedProject(1)
  const changed = openedProject(2)
  const confirmedEvidence = projectEvidence()
  const changedEvidence = projectEvidence()
  let openCalls = 0
  let evidenceCalls = 0
  let changeCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      openProject: () =>
        Effect.succeed(++openCalls === 1 ? confirmed : changed),
      projectEvidence: () => {
        evidenceCalls += 1
        if (evidenceCalls === 1) return Effect.succeed(confirmedEvidence)
        if (evidenceCalls === 2) return Effect.fail(failure('project-evidence'))
        return Effect.succeed(changedEvidence)
      },
      changeProject: () =>
        Effect.sync(() => {
          changeCalls += 1
          return changed
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process'),
  })
  await waitFor(
    runtime,
    (state) =>
      state.process.project?.revision === confirmed.revision &&
      state.process.evidence === confirmedEvidence,
  )
  const result = await submit(runtime, {
    _tag: 'ChangeProject',
    project: confirmed,
    intent: { _tag: 'UndoDraft', stage: 'Calibration' },
  })
  const reconciled = await waitFor(
    runtime,
    (state) =>
      state.process.project?.revision === changed.revision &&
      state.process.evidence === changedEvidence,
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Project')
  assert.equal(reconciled.process.project, changed)
  assert.equal(reconciled.process.evidence, changedEvidence)
  assert.equal(changeCalls, 1)
  assert.equal(openCalls, 2)
  assert.equal(evidenceCalls, 3)
})

test('retains the last-confirmed Process pair when changed evidence stays unavailable', async () => {
  const confirmed = openedProject(1)
  const changed = openedProject(2)
  const confirmedEvidence = projectEvidence()
  let evidenceCalls = 0
  let changeCalls = 0
  const runtime = makeRuntime(
    makeRemote({
      openProject: () =>
        Effect.succeed(evidenceCalls === 0 ? confirmed : changed),
      projectEvidence: () =>
        ++evidenceCalls === 1
          ? Effect.succeed(confirmedEvidence)
          : Effect.fail(failure('project-evidence')),
      changeProject: () =>
        Effect.sync(() => {
          changeCalls += 1
          return changed
        }),
    }),
  )

  await submit(runtime, {
    _tag: 'RouteChanged',
    route: { kind: 'process-project', projectId: confirmed.projectId },
    libraryQuery: query('process'),
  })
  await waitFor(runtime, (state) => state.process.state === 'current')
  const result = await submit(runtime, {
    _tag: 'ChangeProject',
    project: confirmed,
    intent: { _tag: 'UndoDraft', stage: 'Calibration' },
  })
  const unavailableState = await waitFor(
    runtime,
    (state) => state.process.state === 'unavailable',
  )
  await runtime.dispose()

  assert.equal(result._tag, 'Unavailable')
  assert.equal(unavailableState.process.project, confirmed)
  assert.equal(unavailableState.process.evidence, confirmedEvidence)
  assert.equal(changeCalls, 1)
  assert.equal(evidenceCalls, 3)
})

test(
  'refreshes the open Process pair after a later bootstrap state',
  { timeout: 2_000 },
  async () => {
    const states = Effect.runSync(Queue.unbounded<BootstrapClientState>())
    const confirmed = openedProject(1)
    const settled = openedProject(2)
    const confirmedEvidence = projectEvidence()
    const settledEvidence = projectEvidence()
    let openCalls = 0
    let evidenceCalls = 0
    let changeCalls = 0
    const runtime = makeRuntime(
      makeRemote({
        states: Stream.fromQueue(states),
        openProject: () =>
          Effect.sync(() => (++openCalls === 1 ? confirmed : settled)),
        projectEvidence: () =>
          Effect.sync(() =>
            ++evidenceCalls === 1 ? confirmedEvidence : settledEvidence,
          ),
        changeProject: () =>
          Effect.sync(() => {
            changeCalls += 1
            return settled
          }),
      }),
    )

    const initialBootstrap = Schema.decodeUnknownSync(BootstrapSnapshot)(
      bootstrapFixtures.fresh,
    )
    await runtime.runPromise(
      Queue.offer(
        states,
        BootstrapClientState.Current({ snapshot: initialBootstrap }),
      ),
    )
    await waitFor(
      runtime,
      (state) =>
        state.projection.snapshotVersion === initialBootstrap.snapshotVersion,
    )
    await submit(runtime, {
      _tag: 'RouteChanged',
      route: { kind: 'process-project', projectId: confirmed.projectId },
      libraryQuery: query('process'),
    })
    await waitFor(
      runtime,
      (state) =>
        state.process.project === confirmed &&
        state.process.evidence === confirmedEvidence,
    )
    await runtime.runPromise(
      Queue.offer(
        states,
        BootstrapClientState.Reconnecting({
          snapshot: initialBootstrap,
          reason: 'Reconnect without a new service event.',
        }),
      ),
    )
    await waitFor(runtime, (state) =>
      state.projection.shell.freshness.startsWith('Reconnecting snapshot'),
    )
    assert.equal(openCalls, 1)
    assert.equal(evidenceCalls, 1)

    const settledBootstrap = Schema.decodeUnknownSync(BootstrapSnapshot)({
      ...initialBootstrap,
      snapshotVersion: initialBootstrap.snapshotVersion + 1,
      eventCursor: initialBootstrap.eventCursor + 1,
    })
    await runtime.runPromise(
      Queue.offer(
        states,
        BootstrapClientState.Current({ snapshot: settledBootstrap }),
      ),
    )
    const refreshed = await waitFor(
      runtime,
      (state) =>
        state.process.project === settled &&
        state.process.evidence === settledEvidence,
    )
    await runtime.dispose()

    assert.equal(refreshed.process.project?.revision, settled.revision)
    assert.equal(openCalls, 2)
    assert.equal(evidenceCalls, 2)
    assert.equal(changeCalls, 0)
  },
)

test('reconciles Review and Project intake failures through reads without replay', async () => {
  const confirmedProject = openedProject(1)
  const confirmedEvidence = projectEvidence()
  let reviewCalls = 0
  let createCalls = 0
  let addCalls = 0
  let detailReads = 0
  let listReads = 0
  let projectReads = 0
  let evidenceReads = 0
  const runtime = makeRuntime(
    makeRemote({
      review: () =>
        Effect.sync(() => void (reviewCalls += 1)).pipe(
          Effect.andThen(Effect.fail(failure('review'))),
        ),
      detail: () =>
        Effect.sync(() => {
          detailReads += 1
          return detail
        }),
      createProject: () =>
        Effect.sync(() => void (createCalls += 1)).pipe(
          Effect.andThen(Effect.fail(failure('create-project'))),
        ),
      listProjects: () =>
        Effect.sync(() => {
          listReads += 1
          return projects('project-1')
        }),
      addProjectSources: () =>
        Effect.sync(() => void (addCalls += 1)).pipe(
          Effect.andThen(Effect.fail(failure('add-project-sources'))),
        ),
      openProject: () =>
        Effect.sync(() => {
          projectReads += 1
          return confirmedProject
        }),
      projectEvidence: () =>
        Effect.sync(() => {
          evidenceReads += 1
          return confirmedEvidence
        }),
    }),
  )

  const reviewResult = await submit(runtime, {
    _tag: 'ReviewLibraryAsset',
    assetId: detail.assetId,
    request: {
      expectedAssetRevision: detail.revision,
      expectedReviewRevision: AssetRevision.make(0),
      decision: 'accepted',
      idempotencyKey: 'review-1',
    },
  })
  const reviewState = await waitFor(
    runtime,
    (state) => state.libraryDetail.value === detail,
  )
  const createResult = await submit(runtime, {
    _tag: 'CreateProject',
    name: 'M27',
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  const listState = await waitFor(
    runtime,
    (state) => state.process.projects[0]?.projectId === 'project-1',
  )
  const addResult = await submit(runtime, {
    _tag: 'AddProjectSources',
    projectId: confirmedProject.projectId,
    expectedProjectRevision: confirmedProject.revision,
    selection: { assetIds: [detail.assetId], captureSetIds: [] },
  })
  const pairState = await waitFor(
    runtime,
    (state) =>
      state.process.project === confirmedProject &&
      state.process.evidence === confirmedEvidence,
  )
  await runtime.dispose()

  assert.equal(reviewResult._tag, 'Unavailable')
  assert.equal(createResult._tag, 'Unavailable')
  assert.equal(addResult._tag, 'Unavailable')
  assert.equal(reviewState.libraryDetail.value, detail)
  assert.equal(listState.process.projects[0]?.projectId, 'project-1')
  assert.equal(pairState.process.project, confirmedProject)
  assert.equal(pairState.process.evidence, confirmedEvidence)
  assert.equal(reviewCalls, 1)
  assert.equal(createCalls, 1)
  assert.equal(addCalls, 1)
  assert.equal(detailReads, 1)
  assert.equal(listReads, 1)
  assert.equal(projectReads, 1)
  assert.equal(evidenceReads, 1)
})
