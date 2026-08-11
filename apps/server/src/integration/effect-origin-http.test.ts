import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createConnection, type Socket } from 'node:net'
import test from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Schema,
  Scope,
  Stream,
} from 'effect'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import {
  BootstrapHttpSuccessEnvelope,
  CommandHttpFailureEnvelope,
  CommandHttpSuccessEnvelope,
  DevelopmentSimulationControlFailure,
  DevelopmentSimulationProjection,
  LibraryAssetDetail,
  LibraryPage,
  PlanWorkspaceProjection,
  PlanCommandResponse,
  ObserveCommandResponse,
  ObserveLiveFrameReview,
  ProcessSourceHandoff,
  RefreshPreflightResponse,
  ReviewAssetResponse,
  AcquireCommandResponse,
  CameraCommandResponse,
} from '@astro-console/protocol'
import {
  makeOriginHttpApplication,
  listenOriginHttp,
} from '../http/effect-origin-http.ts'
import type { LocalIdentity, RequestAdmission } from '../auth/identity.ts'
import {
  openOriginDatabase,
  originDatabaseLayer,
} from '../persistence/database.ts'
import {
  StateSqliteRepository,
  stateSqliteRepositoryLayer,
  type StateSqliteRepositoryShape,
} from '../persistence/state-sqlite-repository.ts'
import {
  RunSqliteRepository,
  runSqliteRepositoryLayer,
} from '../persistence/run-sqlite-repository.ts'
import {
  ProjectionPublication,
  projectionPublicationLayer,
  type ProjectionPublicationShape,
} from '../services/projection-publication.ts'
import {
  bootstrapPlanWorkspaceProjection,
  observeWorkspaceProjection,
} from '../services/workspace-projection-service.ts'
import {
  initializeRuntimeState,
  installM27Fixture,
} from '../services/runtime-bootstrap.ts'
import { reject } from '../http/origin-handlers.ts'
import type { DevelopmentSimulationConfig } from '../http/development-simulation.ts'
import { createAlpacaSimulator } from '../simulator/alpaca-simulator.ts'
import {
  acquireSqliteRepository,
  polarSession,
  targetAcquisitionSession,
} from '../persistence/acquire-sqlite-repository.ts'
import {
  AcquireCommandService,
  acquireCommandServiceLayer,
  absentCameraProviderSelectionLayer,
  absentPolarMeasurementProviderSelectionLayer,
  absentTargetAcquisitionProviderSelectionLayer,
  boundedSimulationAcquireOuterTransitionPolicyLayer,
  configuredTargetAcquisitionProviderSelectionLayer,
  standardAcquireOuterTransitionPolicyLayer,
  unavailableCameraExposureMaterializationLayer,
} from '../services/acquire-command-service.ts'
import {
  PreflightCommandService,
  absentReadOnlyPreflightProviderSelectionLayer,
  configuredReadOnlyPreflightProviderSelectionLayer,
  preflightCommandServiceLayer,
} from '../services/preflight-command-service.ts'
import type { ReadOnlyPreflightProviderShape } from '../services/preflight-service.ts'
import type { TargetAcquisitionProviderShape } from '../services/target-acquisition-service.ts'
import { sqliteLibraryServiceLayer } from '../persistence/library-sqlite-repository.ts'
import {
  LibraryReviewService,
  libraryReviewServiceLayer,
} from '../services/library-review-service.ts'
import {
  absentLibraryDownloadGrantLayer,
  configuredLibraryDownloadGrantLayer,
  configuredLibraryRepresentationStorageLayer,
  LibraryRepresentationService,
  libraryRepresentationServiceLayer,
} from '../services/library-representation-service.ts'
import { LibraryService } from '../services/library-service.ts'

const owner: LocalIdentity = {
  personId: 'owner-person',
  clientId: 'desktop-owner',
  capability: 'controlCapable',
  role: 'owner',
}
const viewer: LocalIdentity = {
  personId: 'viewer-person',
  clientId: 'viewer-client',
  capability: 'readOnly',
  role: 'viewer',
}

const keyedAdmission =
  (key: string, identity: LocalIdentity): RequestAdmission =>
  ({ headers }) =>
    headers['x-listener-key'] === key ? identity : undefined

const webFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-effect-http-web-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<main>Nightbook</main>')
  writeFileSync(join(root, 'assets', 'app-12345678.js'), 'export {}')
  return root
}

const acquireDependenciesLayer = (
  policy:
    | typeof standardAcquireOuterTransitionPolicyLayer
    | typeof boundedSimulationAcquireOuterTransitionPolicyLayer,
) =>
  Layer.mergeAll(
    absentCameraProviderSelectionLayer,
    absentPolarMeasurementProviderSelectionLayer,
    absentTargetAcquisitionProviderSelectionLayer,
    unavailableCameraExposureMaterializationLayer,
    policy,
  )

const defaultRouteDependenciesLayer = Layer.merge(
  acquireDependenciesLayer(standardAcquireOuterTransitionPolicyLayer),
  absentReadOnlyPreflightProviderSelectionLayer,
)

const boundedSimulationRouteDependenciesLayer = Layer.merge(
  acquireDependenciesLayer(boundedSimulationAcquireOuterTransitionPolicyLayer),
  absentReadOnlyPreflightProviderSelectionLayer,
)

const targetRouteDependenciesLayer = (
  provider: TargetAcquisitionProviderShape,
) =>
  Layer.mergeAll(
    absentCameraProviderSelectionLayer,
    absentPolarMeasurementProviderSelectionLayer,
    configuredTargetAcquisitionProviderSelectionLayer(provider),
    unavailableCameraExposureMaterializationLayer,
    standardAcquireOuterTransitionPolicyLayer,
    absentReadOnlyPreflightProviderSelectionLayer,
  )

const preflightRouteDependenciesLayer = (
  provider: ReadOnlyPreflightProviderShape,
) =>
  Layer.merge(
    acquireDependenciesLayer(standardAcquireOuterTransitionPolicyLayer),
    configuredReadOnlyPreflightProviderSelectionLayer(provider),
  )

type RouteDependenciesLayer = typeof defaultRouteDependenciesLayer

const makeGraph = (
  webRoot: string,
  observe?: (event: 'acquired' | 'finalized') => void,
  publicationFor?: (
    repository: StateSqliteRepositoryShape,
  ) => ProjectionPublicationShape,
  developmentSimulation?: DevelopmentSimulationConfig,
  routeDependenciesLayer?: RouteDependenciesLayer,
  fixtureDefinitionKind: 'fixture' | 'fake' = 'fixture',
  downloadGrant?: {
    readonly issue: (request: {
      readonly objectKey: string
      readonly expiresAt: string
    }) => Promise<string>
    readonly now: () => Date
  },
) =>
  Effect.gen(function* () {
    observe?.('acquired')
    const database = openOriginDatabase(':memory:')
    initializeRuntimeState(database)
    installM27Fixture(database, fixtureDefinitionKind)
    const originalsRoot = join(webRoot, 'library-originals')
    const previewsRoot = join(webRoot, 'library-previews')
    mkdirSync(originalsRoot)
    mkdirSync(previewsRoot)
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        database.close()
        observe?.('finalized')
      }),
    )

    const repositoryContext = yield* Layer.build(
      stateSqliteRepositoryLayer(database, {
        plan: bootstrapPlanWorkspaceProjection,
        observe: observeWorkspaceProjection,
      }),
    )
    const repository = Context.get(repositoryContext, StateSqliteRepository)
    const runRepository = Context.get(
      yield* Layer.build(
        runSqliteRepositoryLayer(database, repository, reject),
      ),
      RunSqliteRepository,
    )
    const publicationEvents: Array<'connect' | 'disconnect' | 'publish'> = []
    const publication =
      publicationFor === undefined
        ? Context.get(
            yield* Layer.build(
              projectionPublicationLayer({
                expire: repository.expireReconnectGrace,
                currentCursor: () => repository.state().eventCursor,
                eventFor: repository.projectionEvent,
                controllerConnected: repository.controllerConnected,
                controllerDisconnected: repository.controllerDisconnected,
                observe: (event) => publicationEvents.push(event),
              }),
            ),
            ProjectionPublication,
          )
        : publicationFor(repository)
    const graphLayer = Layer.merge(
      originDatabaseLayer(database),
      Layer.merge(
        Layer.succeed(StateSqliteRepository, repository),
        Layer.merge(
          Layer.succeed(RunSqliteRepository, runRepository),
          Layer.succeed(ProjectionPublication, publication),
        ),
      ),
    )
    const targetSimulation =
      developmentSimulation?.launchScenario === 'target-evidence-progression' ||
      developmentSimulation?.launchScenario === 'solve-success-no-solution'
    const integrations =
      routeDependenciesLayer ??
      (targetSimulation
        ? boundedSimulationRouteDependenciesLayer
        : defaultRouteDependenciesLayer)
    const serviceDependencies = Layer.merge(graphLayer, integrations)
    const acquireService = Context.get(
      yield* Layer.build(
        acquireCommandServiceLayer.pipe(Layer.provide(serviceDependencies)),
      ),
      AcquireCommandService,
    )
    const preflightService = Context.get(
      yield* Layer.build(
        preflightCommandServiceLayer.pipe(Layer.provide(serviceDependencies)),
      ),
      PreflightCommandService,
    )
    const libraryReviewService = Context.get(
      yield* Layer.build(
        libraryReviewServiceLayer.pipe(Layer.provide(graphLayer)),
      ),
      LibraryReviewService,
    )
    const libraryService = Context.get(
      yield* Layer.build(
        sqliteLibraryServiceLayer(
          database,
          () => repository.state().snapshotVersion,
        ),
      ),
      LibraryService,
    )
    const libraryRepresentationService = Context.get(
      yield* Layer.build(
        libraryRepresentationServiceLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(LibraryService, libraryService),
              configuredLibraryRepresentationStorageLayer({
                originalsRoot,
                previewsRoot,
              }),
              downloadGrant === undefined
                ? absentLibraryDownloadGrantLayer
                : configuredLibraryDownloadGrantLayer(
                    { issue: downloadGrant.issue },
                    downloadGrant.now,
                  ),
            ),
          ),
        ),
      ),
      LibraryRepresentationService,
    )
    const applicationLayer = Layer.mergeAll(
      graphLayer,
      Layer.succeed(LibraryService, libraryService),
      Layer.succeed(AcquireCommandService, acquireService),
      Layer.succeed(PreflightCommandService, preflightService),
      Layer.succeed(LibraryReviewService, libraryReviewService),
      Layer.succeed(LibraryRepresentationService, libraryRepresentationService),
    )
    const application = yield* makeOriginHttpApplication(
      webRoot,
      developmentSimulation,
    ).pipe(
      Effect.provide(applicationLayer),
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(NodePath.layer),
    )
    return {
      application,
      database,
      publication,
      publicationEvents,
      repository,
      originalsRoot,
      previewsRoot,
    }
  })

type TestGraph = Effect.Success<ReturnType<typeof makeGraph>>

const withOrigin = (
  bindings: ReadonlyArray<{
    readonly name: string
    readonly identity: LocalIdentity
  }>,
  verify: (fixture: {
    readonly graph: TestGraph
    readonly bases: Readonly<Record<string, string>>
  }) => Effect.Effect<void, unknown>,
  developmentSimulation?: DevelopmentSimulationConfig,
  routeDependenciesLayer?: RouteDependenciesLayer,
  fixtureDefinitionKind: 'fixture' | 'fake' = 'fixture',
  downloadGrant?: Parameters<typeof makeGraph>[6],
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* makeGraph(
          webFixture(),
          undefined,
          undefined,
          developmentSimulation,
          routeDependenciesLayer,
          fixtureDefinitionKind,
          downloadGrant,
        )
        const bound = yield* listenOriginHttp(
          graph.application,
          bindings.map(({ name, identity }) => ({
            name,
            host: '127.0.0.1',
            port: 0,
            admission: keyedAdmission(name, identity),
          })),
        )
        const bases: Record<string, string> = {}
        for (const { name } of bindings) {
          const listener = bound[name]
          if (listener === undefined)
            return yield* Effect.die(`Expected ${name} listener to bind`)
          bases[name] = `http://127.0.0.1:${listener.port}`
        }
        return yield* verify({ graph, bases })
      }),
    ),
  )

const ownerHeaders = {
  'content-type': 'application/json',
  'x-listener-key': 'owner',
}

const ownerOrigin = (
  verify: Parameters<typeof withOrigin>[1],
  developmentSimulation?: DevelopmentSimulationConfig,
  routeDependenciesLayer?: RouteDependenciesLayer,
  fixtureDefinitionKind: 'fixture' | 'fake' = 'fixture',
  downloadGrant?: Parameters<typeof makeGraph>[6],
) =>
  withOrigin(
    [{ name: 'owner', identity: owner }],
    verify,
    developmentSimulation,
    routeDependenciesLayer,
    fixtureDefinitionKind,
    downloadGrant,
  )

const ownerViewerOrigin = (
  verify: Parameters<typeof withOrigin>[1],
  developmentSimulation?: DevelopmentSimulationConfig,
  routeDependenciesLayer?: RouteDependenciesLayer,
  fixtureDefinitionKind: 'fixture' | 'fake' = 'fixture',
  downloadGrant?: Parameters<typeof makeGraph>[6],
) =>
  withOrigin(
    [
      { name: 'owner', identity: owner },
      { name: 'viewer', identity: viewer },
    ],
    verify,
    developmentSimulation,
    routeDependenciesLayer,
    fixtureDefinitionKind,
    downloadGrant,
  )

const fetchEffect = (url: string, init?: RequestInit) =>
  Effect.promise(() => fetch(url, init))

const responseJson = (response: Response) =>
  Effect.promise(async (): Promise<unknown> => response.json())

const startEffectRun = (
  graph: TestGraph,
  base: string | undefined,
  idempotencyKey: string,
) =>
  Effect.gen(function* () {
    if (base === undefined) return yield* Effect.die('Expected owner listener')
    graph.repository.commit({
      leaseRevision: 1,
      leaseHolder: owner.clientId,
      leaseState: 'held',
      reconnectGraceUntil: null,
    })
    const before = yield* fetchEffect(`${base}/api/snapshot`, {
      headers: { 'x-listener-key': 'owner' },
    }).pipe(
      Effect.flatMap(responseJson),
      Effect.flatMap(Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope)),
    )
    if (before.data.plan === undefined)
      return yield* Effect.die('Expected fixture Plan')
    const started = yield* fetchEffect(`${base}/api/plan/commands`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        intent: {
          _tag: 'StartAcceptedRun',
          planId: before.data.plan.planId,
          expectedPlanRevision: before.data.plan.revision,
          expectedLeaseRevision: before.data.control.revision,
          idempotencyKey,
        },
      }),
    }).pipe(
      Effect.flatMap(responseJson),
      Effect.flatMap(Schema.decodeUnknownEffect(PlanCommandResponse)),
    )
    if (
      started._tag !== 'Accepted' ||
      started.snapshot.activeRun._tag !== 'Active'
    )
      return yield* Effect.die('Expected active fixture Run')
    return started.snapshot
  })

const readSseEvent = (reader: ReadableStreamDefaultReader<Uint8Array>) =>
  Effect.promise(async () => {
    const decoder = new TextDecoder()
    let transcript = ''
    while (!transcript.includes('\n\n')) {
      const next = await reader.read()
      if (next.done) throw new Error('SSE ended before the next event')
      transcript += decoder.decode(next.value, { stream: true })
    }
    return transcript
  })

test('one Effect HTTP graph serves two differently admitted listeners', async () => {
  const graphEvents: Array<'acquired' | 'finalized'> = []
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* makeGraph(webFixture(), (event) =>
          graphEvents.push(event),
        )
        const bound = yield* listenOriginHttp(graph.application, [
          {
            name: 'owner',
            host: '127.0.0.1',
            port: 0,
            admission: keyedAdmission('owner', owner),
          },
          {
            name: 'viewer',
            host: '127.0.0.1',
            port: 0,
            admission: keyedAdmission('viewer', viewer),
          },
        ])
        const ownerListener = bound.owner
        const viewerListener = bound.viewer
        if (ownerListener === undefined || viewerListener === undefined)
          return yield* Effect.die('Expected both listeners to bind')
        const ownerBase = `http://127.0.0.1:${ownerListener.port}`
        const viewerBase = `http://127.0.0.1:${viewerListener.port}`

        assert.equal(
          (yield* fetchEffect(`${ownerBase}/api/health/operations`, {
            headers: { 'x-listener-key': 'owner' },
          })).status,
          200,
        )
        assert.equal(
          (yield* fetchEffect(`${viewerBase}/api/health/operations`, {
            headers: { 'x-listener-key': 'viewer' },
          })).status,
          403,
        )
        assert.equal(
          (yield* fetchEffect(`${viewerBase}/api/snapshot`, {
            headers: { 'x-listener-key': 'owner' },
          })).status,
          401,
        )

        const ownerSnapshot = yield* fetchEffect(`${ownerBase}/api/snapshot`, {
          headers: { 'x-listener-key': 'owner' },
        }).pipe(
          Effect.flatMap(responseJson),
          Effect.flatMap(
            Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope),
          ),
        )
        const viewerSnapshot = yield* fetchEffect(
          `${viewerBase}/api/snapshot`,
          { headers: { 'x-listener-key': 'viewer' } },
        ).pipe(
          Effect.flatMap(responseJson),
          Effect.flatMap(
            Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope),
          ),
        )
        assert.equal(
          viewerSnapshot.data.snapshotVersion,
          ownerSnapshot.data.snapshotVersion,
        )
        assert.deepEqual(graphEvents, ['acquired'])
      }),
    ),
  )
  assert.deepEqual(graphEvents, ['acquired', 'finalized'])
})

test('the first admitted snapshot expires stale reconnect state', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* makeGraph(webFixture())
        graph.repository.commit({
          leaseRevision: 4,
          leaseHolder: owner.clientId,
          leaseState: 'reconnecting',
          reconnectGraceUntil: '2000-01-01T00:00:00.000Z',
        })
        const bound = yield* listenOriginHttp(graph.application, [
          {
            name: 'owner',
            host: '127.0.0.1',
            port: 0,
            admission: keyedAdmission('owner', owner),
          },
        ])
        const listener = bound.owner
        if (listener === undefined)
          return yield* Effect.die('Expected owner listener to bind')

        const snapshot = yield* fetchEffect(
          `http://127.0.0.1:${listener.port}/api/snapshot`,
          { headers: { 'x-listener-key': 'owner' } },
        ).pipe(
          Effect.flatMap(responseJson),
          Effect.flatMap(
            Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope),
          ),
        )

        assert.equal(snapshot.data.control.state, 'unheld')
        assert.equal(snapshot.data.control.holderClientId, undefined)
        assert.equal(snapshot.data.control.revision, 5)
      }),
    ),
  )
})

test('fixed routes preserve system, static, CSP, SSE, and not-found behavior', async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const graph = yield* makeGraph(webFixture())
        const bound = yield* listenOriginHttp(graph.application, [
          {
            name: 'owner',
            host: '127.0.0.1',
            port: 0,
            admission: keyedAdmission('owner', owner),
          },
        ])
        const listener = bound.owner
        if (listener === undefined)
          return yield* Effect.die('Expected owner listener to bind')
        const base = `http://127.0.0.1:${listener.port}`
        const admitted = { headers: { 'x-listener-key': 'owner' } }

        const live = yield* fetchEffect(`${base}/health/live`)
        assert.equal(live.status, 200)
        assert.deepEqual(yield* Effect.promise(() => live.json()), {
          status: 'alive',
        })

        const ready = yield* fetchEffect(`${base}/api/health/ready`, admitted)
        assert.equal(ready.status, 200)
        const operations = yield* fetchEffect(
          `${base}/api/health/operations`,
          admitted,
        )
        assert.equal(operations.status, 200)

        const plan = yield* fetchEffect(`${base}/api/workspaces/plan`, admitted)
        assert.equal(plan.status, 200)
        const planBody = yield* Effect.promise(() => plan.json()).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(PlanWorkspaceProjection)),
        )
        assert.equal(planBody.planId, 'plan-m27')

        const page = yield* fetchEffect(`${base}/plan`, admitted)
        assert.equal(page.status, 200)
        assert.equal(
          yield* Effect.promise(() => page.text()),
          '<main>Nightbook</main>',
        )
        assert.equal(page.headers.get('cache-control'), 'no-store')
        assert.match(
          page.headers.get('content-security-policy') ?? '',
          /style-src 'self'/,
        )

        const asset = yield* fetchEffect(
          `${base}/assets/app-12345678.js`,
          admitted,
        )
        assert.equal(asset.status, 200)
        assert.equal(
          asset.headers.get('cache-control'),
          'public, max-age=31536000, immutable',
        )
        assert.equal(asset.headers.get('x-content-type-options'), 'nosniff')

        const deferredRoute = yield* fetchEffect(
          `${base}/api/process/projects`,
          admitted,
        )
        assert.equal(deferredRoute.status, 404)
        assert.deepEqual(
          yield* Effect.promise(() => deferredRoute.json()),
          invalidInput,
        )
        assert.equal(
          (yield* fetchEffect(`${base}/api/simulation`, admitted)).status,
          404,
        )
        const missing = yield* fetchEffect(`${base}/missing`, admitted)
        assert.equal(missing.status, 404)
        assert.equal(yield* Effect.promise(() => missing.text()), '')

        const stream = yield* fetchEffect(`${base}/api/events`, admitted)
        assert.equal(stream.status, 200)
        assert.equal(stream.headers.get('content-type'), 'text/event-stream')
        const reader = stream.body?.getReader()
        if (reader === undefined) return yield* Effect.die('SSE body missing')
        const initial = yield* readSseEvent(reader)
        assert.match(initial, /event: ProjectionChanged/)
        const cursor = graph.repository.advanceProjectionCursor()
        yield* graph.publication.publish(cursor)
        const changed = yield* readSseEvent(reader)
        assert.match(changed, new RegExp(`id: ${cursor}`))
        yield* Effect.promise(() => reader.cancel())
        assert.ok(graph.publicationEvents.includes('connect'))
      }),
    ),
  )
})

const controlRequest = (commandId: string, expectedLeaseRevision: number) =>
  JSON.stringify({
    commandId,
    command: {
      _tag: 'RequestControl',
      expectedLeaseRevision,
      idempotencyKey: commandId,
    },
  })

const simulationOrigin = async (
  includeViewer: boolean,
  verify: Parameters<typeof withOrigin>[1],
) => {
  const simulator = createAlpacaSimulator({
    corpusRoot: '/unused',
    initialScenario: 'exposure-success',
  })
  const listener = await simulator.listen()
  try {
    const run = includeViewer ? ownerViewerOrigin : ownerOrigin
    await run(verify, {
      origin: listener.origin,
      launchScenario: 'exposure-success',
    })
  } finally {
    await listener.close()
  }
}

test('Plan rejects malformed command input through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(`${bases.owner}/api/plan/commands`, {
        method: 'POST',
        headers: ownerHeaders,
        body: '{}',
      })
      assert.equal(response.status, 400)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PlanCommandResponse)),
      )
      assert.equal(body._tag, 'Rejected')
    }),
  ))

test('Plan rejects an oversized command body through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(`${bases.owner}/api/plan/commands`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ padding: 'x'.repeat(16_384) }),
      })
      assert.equal(response.status, 400)
    }),
  ))

test('Plan starts a revision-bound accepted Run through the Effect listener', () =>
  ownerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      graph.repository.commit({
        leaseRevision: 1,
        leaseHolder: owner.clientId,
        leaseState: 'held',
        reconnectGraceUntil: null,
      })
      const snapshot = yield* fetchEffect(`${bases.owner}/api/snapshot`, {
        headers: { 'x-listener-key': 'owner' },
      }).pipe(
        Effect.flatMap(responseJson),
        Effect.flatMap(
          Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope),
        ),
      )
      if (snapshot.data.plan === undefined)
        return yield* Effect.die('Expected fixture Plan')
      const response = yield* fetchEffect(`${bases.owner}/api/plan/commands`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          intent: {
            _tag: 'StartAcceptedRun',
            planId: snapshot.data.plan.planId,
            expectedPlanRevision: snapshot.data.plan.revision,
            expectedLeaseRevision: snapshot.data.control.revision,
            idempotencyKey: 'effect-plan-start-001',
          },
        }),
      })
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PlanCommandResponse)),
      )
      assert.equal(response.status, 202, JSON.stringify(body))
      assert.equal(body._tag, 'Accepted')
      assert.equal(body.snapshot.activeRun._tag, 'Active')
    }),
  ))

test('Observe rejects malformed command input through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.owner}/api/observe/commands`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: '{}',
        },
      )
      assert.equal(response.status, 400)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ObserveCommandResponse)),
      )
      assert.equal(body._tag, 'Rejected')
    }),
  ))

test('Observe accepts a fresh pause through the Effect listener', () =>
  ownerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      const started = yield* startEffectRun(
        graph,
        bases.owner,
        'effect-observe-start-001',
      )
      if (started.activeRun._tag !== 'Active')
        return yield* Effect.die('Expected active fixture Run')
      const intent = {
        _tag: 'PauseRun',
        expectedLeaseRevision: started.control.revision,
        expectedRunRevision: started.activeRun.run.revision,
        idempotencyKey: 'effect-observe-pause-001',
      }
      const acceptedResponse = yield* fetchEffect(
        `${bases.owner}/api/observe/commands`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({ intent }),
        },
      )
      const accepted = yield* responseJson(acceptedResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ObserveCommandResponse)),
      )
      assert.equal(acceptedResponse.status, 202)
      assert.equal(accepted._tag, 'Accepted')
    }),
  ))

test('Observe rejects a stale pause through the Effect listener', () =>
  ownerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      const started = yield* startEffectRun(
        graph,
        bases.owner,
        'effect-observe-stale-start-001',
      )
      if (started.activeRun._tag !== 'Active')
        return yield* Effect.die('Expected active fixture Run')
      const response = yield* fetchEffect(
        `${bases.owner}/api/observe/commands`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            intent: {
              _tag: 'PauseRun',
              expectedLeaseRevision: started.control.revision,
              expectedRunRevision: 99,
              idempotencyKey: 'effect-observe-stale-pause-001',
            },
          }),
        },
      )
      const body = yield* responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ObserveCommandResponse)),
      )
      assert.equal(response.status, 409)
      assert.equal(body._tag, 'Rejected')
    }),
  ))

test('Observe preflight rejects a request-local read-only identity', () =>
  ownerViewerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.viewer}/api/observe/preflight`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-listener-key': 'viewer',
          },
          body: '{}',
        },
      )
      assert.equal(response.status, 403)
    }),
  ))

test('Observe preflight publishes configured provider truth for its owner', () =>
  ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-preflight-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        const requestBody = JSON.stringify({
          runId: started.activeRun.run.runId,
          expectedRunRevision: started.activeRun.run.revision,
        })
        const ownerResponse = yield* fetchEffect(
          `${bases.owner}/api/observe/preflight`,
          { method: 'POST', headers: ownerHeaders, body: requestBody },
        )
        const refreshed = yield* responseJson(ownerResponse).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RefreshPreflightResponse)),
        )
        assert.equal(ownerResponse.status, 200)
        assert.equal(refreshed._tag, 'Refreshed')
        if (refreshed._tag === 'Refreshed')
          assert.equal(refreshed.snapshot.verdict, 'ready')
      }),
    undefined,
    preflightRouteDependenciesLayer({
      observe: () =>
        Effect.succeed({
          observedAt: '2026-08-11T00:00:00.000Z',
          verdict: 'ready',
          nextAction: 'Start the accepted run.',
          checks: [
            {
              key: 'camera-connected',
              state: 'ready',
              observedAt: '2026-08-11T00:00:00.000Z',
              reason: 'The configured camera is connected.',
            },
          ],
        }),
    }),
    'fake',
  ))

test('Observe preflight preserves the no-configured-provider response', () =>
  ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-preflight-absent-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        const response = yield* fetchEffect(
          `${bases.owner}/api/observe/preflight`,
          {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({
              runId: started.activeRun.run.runId,
              expectedRunRevision: started.activeRun.run.revision,
            }),
          },
        )
        const body = yield* responseJson(response).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RefreshPreflightResponse)),
        )
        assert.equal(response.status, 503)
        assert.deepEqual(
          body,
          RefreshPreflightResponse.cases.Unavailable.make({
            summary:
              'No read-only rig provider is configured. Preflight cannot report a safe verdict.',
          }),
        )
      }),
    undefined,
    undefined,
    'fake',
  ))

test('Observe live-frame review returns typed current identity projection truth', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.owner}/api/observe/live-frame`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      const review = yield* responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ObserveLiveFrameReview)),
      )
      assert.equal(response.status, 200)
      assert.equal(review._tag, 'Unavailable')
      if (review._tag === 'Unavailable')
        assert.equal(review.reason, 'NoCurrentFrame')
    }),
  ))

test('Library reads preserve catalog, detail, and Process-source truth through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const pageResponse = yield* fetchEffect(
        `${bases.owner}/api/library?queryId=effect-library&pageSize=3&sort=sharpestFirst`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      const page = yield* responseJson(pageResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LibraryPage)),
      )
      assert.equal(pageResponse.status, 200)
      assert.equal(page.results.length, 3)
      assert.equal(page.results[0]?.assetId, 'asset-m27-001')

      const detailResponse = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      const detail = yield* responseJson(detailResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(LibraryAssetDetail)),
      )
      assert.equal(detailResponse.status, 200)
      assert.equal(detail.lineage.runId, 'run-m27-001')
      assert.deepEqual(detail.actions, [
        { _tag: 'Eligible', action: 'download' },
        { _tag: 'Eligible', action: 'openInProcess' },
      ])

      const handoffResponse = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/process-source`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      const handoff = yield* responseJson(handoffResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ProcessSourceHandoff)),
      )
      assert.equal(handoffResponse.status, 200)
      assert.equal(handoff.sourceAssetId, 'asset-m27-001')
      assert.equal(handoff.lineage.runId, 'run-m27-001')
      assert.equal(handoff.recommendedSet?.candidateCount, 2)
    }),
  ))

test('Library review preserves owner authority, revisions, idempotency, and projection publication', () =>
  ownerViewerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      const request = {
        expectedAssetRevision: 1,
        expectedReviewRevision: 0,
        decision: 'accepted',
        rating: 5,
        annotation: 'Keep this frame.',
        idempotencyKey: 'effect-library-review-001',
      }
      const submit = (base: string | undefined, body: unknown) =>
        fetchEffect(`${base}/api/library/assets/asset-m27-001/review`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-listener-key': base === bases.owner ? 'owner' : 'viewer',
          },
          body: JSON.stringify(body),
        })

      const deniedResponse = yield* submit(bases.viewer, request)
      const denied = yield* responseJson(deniedResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)),
      )
      assert.equal(deniedResponse.status, 403)
      assert.equal(denied._tag, 'Rejected')
      if (denied._tag === 'Rejected')
        assert.equal(denied.failure._tag, 'ClientReadOnly')
      const deniedMalformedResponse = yield* submit(bases.viewer, {
        decision: 'accepted',
      })
      const deniedMalformed = yield* responseJson(deniedMalformedResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)),
      )
      assert.equal(deniedMalformedResponse.status, 403)
      assert.equal(deniedMalformed._tag, 'Rejected')
      if (deniedMalformed._tag === 'Rejected')
        assert.equal(deniedMalformed.failure._tag, 'ClientReadOnly')
      const deniedMalformedPathResponse = yield* fetchEffect(
        `${bases.viewer}/api/library/assets/%/review`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-listener-key': 'viewer',
          },
          body: JSON.stringify({ decision: 'accepted' }),
        },
      )
      const deniedMalformedPath = yield* responseJson(
        deniedMalformedPathResponse,
      ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)))
      assert.equal(deniedMalformedPathResponse.status, 403)
      assert.equal(deniedMalformedPath._tag, 'Rejected')
      if (deniedMalformedPath._tag === 'Rejected')
        assert.equal(deniedMalformedPath.failure._tag, 'ClientReadOnly')

      const acceptedResponse = yield* submit(bases.owner, request)
      const accepted = yield* responseJson(acceptedResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)),
      )
      assert.equal(acceptedResponse.status, 200)
      assert.equal(accepted._tag, 'Accepted')
      if (accepted._tag !== 'Accepted')
        return yield* Effect.die('Expected accepted review')
      assert.equal(accepted.review.revision, 1)
      assert.ok(graph.publicationEvents.includes('publish'))

      const replayResponse = yield* submit(bases.owner, request)
      assert.equal(replayResponse.status, 200)
      assert.deepEqual(yield* responseJson(replayResponse), accepted)

      const staleResponse = yield* submit(bases.owner, {
        ...request,
        decision: 'rejected',
        idempotencyKey: 'effect-library-review-stale',
      })
      const stale = yield* responseJson(staleResponse).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)),
      )
      assert.equal(staleResponse.status, 409)
      assert.equal(stale._tag, 'Rejected')
      if (stale._tag === 'Rejected')
        assert.equal(stale.failure._tag, 'RevisionConflict')
    }),
  ))

test('Library preview and local download preserve bounded immutable representations', () =>
  ownerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      const stored = Schema.decodeUnknownSync(
        Schema.Struct({ detail: Schema.String }),
      )(
        graph.database
          .prepare(
            "SELECT detail FROM library_assets WHERE asset_id='asset-m27-001'",
          )
          .get(),
      )
      graph.database
        .prepare(
          "UPDATE library_assets SET detail=? WHERE asset_id='asset-m27-001'",
        )
        .run(
          JSON.stringify({
            ...JSON.parse(stored.detail),
            inspection: {
              _tag: 'Available',
              preview: {
                format: 'png',
                checksum: 'effect-preview-checksum',
                provenance: {
                  algorithm: 'bounded-pixel-preview-v1',
                  sourceChecksum: 'effect-original-checksum',
                },
              },
              metrics: {
                clippingPercent: 0,
                framing: 'inFrame',
                sharpness: 90,
                shape: 90,
                driftArcsec: 0,
              },
              rationale: {
                decision: 'accepted',
                summary: 'The retained pixels support a bounded preview.',
              },
            },
          }),
        )
      const previewBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
      const originalBytes = new TextEncoder().encode('immutable-fits-bytes')
      writeFileSync(join(graph.previewsRoot, 'asset-m27-001.png'), previewBytes)
      writeFileSync(
        join(graph.originalsRoot, 'asset-m27-001.fits'),
        originalBytes,
      )

      const previewHead = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/preview`,
        { method: 'HEAD', headers: { 'x-listener-key': 'owner' } },
      )
      assert.equal(previewHead.status, 404)
      assert.equal(
        previewHead.headers.get('content-type'),
        'application/json; charset=utf-8',
      )

      const downloadHead = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/download`,
        { method: 'HEAD', headers: { 'x-listener-key': 'owner' } },
      )
      assert.equal(downloadHead.status, 404)

      const preview = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/preview`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      assert.equal(preview.status, 200)
      assert.equal(preview.headers.get('content-type'), 'image/png')
      assert.equal(preview.headers.get('cache-control'), 'private, no-store')
      assert.equal(preview.headers.get('content-length'), '8')
      assert.equal(preview.headers.get('x-astro-preview-max-bytes'), '65536')
      assert.equal(preview.headers.get('x-astro-preview-refresh-ms'), '1000')
      assert.equal(preview.headers.get('x-astro-preview-concurrent-limit'), '2')
      assert.deepEqual(
        new Uint8Array(yield* Effect.promise(() => preview.arrayBuffer())),
        previewBytes,
      )

      const repeated = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/preview`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      assert.equal(repeated.status, 429)
      assert.deepEqual(yield* responseJson(repeated), {
        outcome: 'rejected',
        reason: 'PreviewRefreshLimited',
      })

      const download = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/download`,
        { headers: { 'x-listener-key': 'owner' } },
      )
      assert.equal(download.status, 200)
      assert.equal(download.headers.get('content-type'), 'application/fits')
      assert.equal(download.headers.get('cache-control'), 'private, no-store')
      assert.equal(
        download.headers.get('content-disposition'),
        'attachment; filename="asset-m27-001.fits"',
      )
      assert.deepEqual(
        new Uint8Array(yield* Effect.promise(() => download.arrayBuffer())),
        originalBytes,
      )
    }),
  ))

test('Library published download preserves the bounded grant redirect', () => {
  const issued: Array<{
    readonly objectKey: string
    readonly expiresAt: string
  }> = []
  return ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const stored = Schema.decodeUnknownSync(
          Schema.Struct({ detail: Schema.String }),
        )(
          graph.database
            .prepare(
              "SELECT detail FROM library_assets WHERE asset_id='asset-m27-001'",
            )
            .get(),
        )
        graph.database
          .prepare(
            "UPDATE library_assets SET availability='published',detail=? WHERE asset_id='asset-m27-001'",
          )
          .run(
            JSON.stringify({
              ...JSON.parse(stored.detail),
              availability: 'published',
            }),
          )
        graph.database
          .prepare(
            'INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
          )
          .run(
            'asset-m27-001',
            'effect-published-checksum',
            'published',
            '2026-08-11T00:00:00.000Z',
            'published/run-m27-001/finals/asset-m27-001.fits',
          )
        const head = yield* fetchEffect(
          `${bases.owner}/api/library/assets/asset-m27-001/download`,
          {
            method: 'HEAD',
            headers: { 'x-listener-key': 'owner' },
            redirect: 'manual',
          },
        )
        assert.equal(head.status, 404)
        assert.equal(issued.length, 0)
        const response = yield* fetchEffect(
          `${bases.owner}/api/library/assets/asset-m27-001/download`,
          {
            headers: { 'x-listener-key': 'owner' },
            redirect: 'manual',
          },
        )
        assert.equal(response.status, 303)
        assert.equal(response.headers.get('cache-control'), 'private, no-store')
        assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
        assert.equal(
          response.headers.get('location'),
          'https://download.example/asset-m27-001',
        )
        assert.equal(yield* Effect.promise(() => response.text()), '')
        assert.deepEqual(issued, [
          {
            objectKey: 'published/run-m27-001/finals/asset-m27-001.fits',
            expiresAt: '2026-08-11T00:05:00.000Z',
          },
        ])
      }),
    undefined,
    undefined,
    'fixture',
    {
      issue: (request) => {
        issued.push(request)
        return Promise.resolve('https://download.example/asset-m27-001')
      },
      now: () => new Date('2026-08-11T00:00:00.000Z'),
    },
  )
})

test('Library routes preserve bounded input and truthful failure envelopes', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const headers = { 'x-listener-key': 'owner' }
      const headPaths = [
        '/api/library',
        '/api/library/assets/asset-m27-001',
        '/api/library/assets/asset-m27-001/preview',
        '/api/library/assets/asset-m27-001/download',
        '/api/library/assets/asset-m27-001/process-source',
        '/api/observe/live-frame',
      ]
      for (const path of headPaths) {
        const response = yield* fetchEffect(`${bases.owner}${path}`, {
          method: 'HEAD',
          headers,
        })
        assert.equal(response.status, 404, path)
        assert.equal(
          response.headers.get('content-type'),
          'application/json; charset=utf-8',
        )
      }
      const invalidPage = yield* fetchEffect(
        `${bases.owner}/api/library?pageSize=101&sort=capturedAtDescending`,
        { headers },
      )
      assert.equal(invalidPage.status, 400)
      assert.deepEqual(yield* responseJson(invalidPage), {
        _tag: 'InvalidInput',
        message: 'The service could not read that action.',
      })

      const invalidDetail = yield* fetchEffect(
        `${bases.owner}/api/library/assets/malformed`,
        { headers },
      )
      assert.equal(invalidDetail.status, 400)
      const malformedPath = yield* fetchEffect(
        `${bases.owner}/api/library/assets/%`,
        { headers },
      )
      assert.equal(malformedPath.status, 400)
      assert.deepEqual(yield* responseJson(malformedPath), {
        _tag: 'InvalidInput',
        message: 'The service could not read that action.',
      })
      const missingDetail = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-999`,
        { headers },
      )
      assert.equal(missingDetail.status, 404)
      assert.deepEqual(yield* responseJson(missingDetail), {
        _tag: 'AssetNotFound',
      })

      const unavailableSource = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-013/process-source`,
        { headers },
      )
      assert.equal(unavailableSource.status, 409)
      assert.deepEqual(yield* responseJson(unavailableSource), {
        _tag: 'AssetUnavailable',
        message:
          'This asset is temporarily unavailable and cannot open in Process.',
      })

      const invalidReview = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/review`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'accepted' }),
        },
      )
      assert.equal(invalidReview.status, 400)
      const invalidReviewBody = yield* responseJson(invalidReview).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)),
      )
      assert.equal(invalidReviewBody._tag, 'Rejected')
      if (invalidReviewBody._tag === 'Rejected')
        assert.equal(invalidReviewBody.failure._tag, 'InvalidInput')
      const malformedReviewPath = yield* fetchEffect(
        `${bases.owner}/api/library/assets/%/review`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedAssetRevision: 1,
            expectedReviewRevision: 0,
            decision: 'accepted',
            idempotencyKey: 'effect-malformed-review-path',
          }),
        },
      )
      assert.equal(malformedReviewPath.status, 400)
      const malformedReviewBody = yield* responseJson(malformedReviewPath).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReviewAssetResponse)),
      )
      assert.equal(malformedReviewBody._tag, 'Rejected')
      if (malformedReviewBody._tag === 'Rejected')
        assert.equal(malformedReviewBody.failure._tag, 'InvalidInput')

      const unavailablePreview = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-001/preview`,
        { headers },
      )
      assert.equal(unavailablePreview.status, 409)
      assert.deepEqual(yield* responseJson(unavailablePreview), {
        outcome: 'rejected',
        reason: 'PreviewUnavailable',
      })

      const missingDownload = yield* fetchEffect(
        `${bases.owner}/api/library/assets/asset-m27-999/download`,
        { headers },
      )
      assert.equal(missingDownload.status, 503)
      assert.deepEqual(yield* responseJson(missingDownload), {
        outcome: 'rejected',
        reason: 'DownloadUnavailable',
      })
      const invalidDownload = yield* fetchEffect(
        `${bases.owner}/api/library/assets/not-an-asset/download`,
        { headers },
      )
      assert.equal(invalidDownload.status, 503)
    }),
  ))

test('Acquire rejects malformed command input through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.owner}/api/acquire/commands`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: '{}',
        },
      )
      const body = yield* responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(AcquireCommandResponse)),
      )
      assert.equal(response.status, 409)
      assert.equal(body._tag, 'Rejected')
    }),
  ))

test('Acquire preserves the read-only polar evidence denial', () =>
  ownerViewerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.viewer}/api/acquire/commands`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-listener-key': 'viewer',
          },
          body: '{}',
        },
      )
      const body = yield* responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(AcquireCommandResponse)),
      )
      assert.equal(response.status, 403)
      assert.equal(body._tag, 'Unavailable')
      if (body._tag === 'Unavailable')
        assert.equal(
          body.summary,
          'This client is read-only and cannot record polar evidence.',
        )
    }),
  ))

test('Acquire preserves the no-configured target provider response', () =>
  ownerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      const started = yield* startEffectRun(
        graph,
        bases.owner,
        'effect-target-absent-start-001',
      )
      if (started.activeRun._tag !== 'Active')
        return yield* Effect.die('Expected active fixture Run')
      acquireSqliteRepository(graph.database).install(
        targetAcquisitionSession(
          started.activeRun.run.runId,
          'deepSkyPlateSolve',
        ),
      )
      const response = yield* fetchEffect(
        `${bases.owner}/api/acquire/commands`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            intent: {
              _tag: 'CaptureTargetAcquisitionEvidence',
              expectedLeaseRevision: started.control.revision,
              expectedRunRevision: started.activeRun.run.revision,
              expectedAcquireRevision: 0,
              idempotencyKey: 'effect-target-absent-001',
            },
          }),
        },
      )
      const body = yield* responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(AcquireCommandResponse)),
      )
      assert.equal(response.status, 503)
      assert.deepEqual(
        body,
        AcquireCommandResponse.cases.Unavailable.make({
          summary: 'No target acquisition provider is configured.',
        }),
      )
    }),
  ))

test('Acquire preserves the no-configured polar provider response', () =>
  ownerOrigin(({ graph, bases }) =>
    Effect.gen(function* () {
      const started = yield* startEffectRun(
        graph,
        bases.owner,
        'effect-polar-absent-start-001',
      )
      if (started.activeRun._tag !== 'Active')
        return yield* Effect.die('Expected active fixture Run')
      acquireSqliteRepository(graph.database).install(
        polarSession(started.activeRun.run.runId),
      )
      const response = yield* fetchEffect(
        `${bases.owner}/api/acquire/commands`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            intent: {
              _tag: 'CapturePolarAlignmentMeasurement',
              expectedLeaseRevision: started.control.revision,
              expectedRunRevision: started.activeRun.run.revision,
              expectedAcquireRevision: 0,
              idempotencyKey: 'effect-polar-absent-001',
            },
          }),
        },
      )
      const body = yield* responseJson(response).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(AcquireCommandResponse)),
      )
      assert.equal(response.status, 503)
      assert.deepEqual(
        body,
        AcquireCommandResponse.cases.Unavailable.make({
          summary: 'No polar measurement provider is configured.',
        }),
      )
    }),
  ))

test('Acquire preserves the no-configured camera provider response', () =>
  ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-camera-absent-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        const preflightResponse = yield* fetchEffect(
          `${bases.owner}/api/observe/preflight`,
          {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({
              runId: started.activeRun.run.runId,
              expectedRunRevision: started.activeRun.run.revision,
            }),
          },
        )
        assert.equal(preflightResponse.status, 200)
        const response = yield* fetchEffect(
          `${bases.owner}/api/acquire/commands`,
          {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({
              intent: {
                _tag: 'StartCameraExposure',
                expectedLeaseRevision: started.control.revision,
                expectedRunRevision: started.activeRun.run.revision,
                durationSeconds: 2,
                idempotencyKey: 'effect-camera-absent-001',
              },
            }),
          },
        )
        const body = yield* responseJson(response).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(CameraCommandResponse)),
        )
        assert.equal(response.status, 503)
        assert.deepEqual(
          body,
          CameraCommandResponse.cases.Unavailable.make({
            summary: 'No configured camera provider is available.',
          }),
        )
      }),
    undefined,
    preflightRouteDependenciesLayer({
      observe: () =>
        Effect.succeed({
          observedAt: '2026-08-11T00:00:00.000Z',
          verdict: 'ready',
          nextAction: 'Camera command eligibility is current.',
          checks: [
            {
              key: 'camera-connected',
              state: 'ready',
              observedAt: '2026-08-11T00:00:00.000Z',
              reason: 'The configured camera is connected.',
            },
          ],
        }),
    }),
    'fake',
  ))

test('Acquire accepts target evidence once and returns its durable receipt without provider replay', () => {
  let providerCalls = 0
  return ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-acquire-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        acquireSqliteRepository(graph.database).install(
          targetAcquisitionSession(
            started.activeRun.run.runId,
            'deepSkyPlateSolve',
          ),
        )
        const intent = {
          _tag: 'CaptureTargetAcquisitionEvidence',
          expectedLeaseRevision: started.control.revision,
          expectedRunRevision: started.activeRun.run.revision,
          expectedAcquireRevision: 0,
          idempotencyKey: 'effect-acquire-evidence-001',
        }
        const submit = () =>
          fetchEffect(`${bases.owner}/api/acquire/commands`, {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({ intent }),
          }).pipe(
            Effect.flatMap((response) =>
              responseJson(response).pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(AcquireCommandResponse),
                ),
                Effect.map((body) => ({ response, body })),
              ),
            ),
          )
        const first = yield* submit()
        assert.equal(first.response.status, 200)
        assert.equal(first.body._tag, 'Accepted')
        assert.equal(providerCalls, 1)
        const replay = yield* submit()
        assert.equal(replay.response.status, 200)
        assert.equal(replay.body._tag, 'Accepted')
        assert.equal(providerCalls, 1)
      }),
    undefined,
    targetRouteDependenciesLayer({
      capture: () =>
        Effect.sync(() => {
          providerCalls += 1
          return {
            _tag: 'Captured' as const,
            slewAcknowledgement: {
              acknowledgedAtEpochMs: 1_722_729_600_000,
              acknowledgementRef: 'effect-slew-acknowledged',
            },
            evidence: {
              sourceFrameAssetId: 'effect-solved-frame',
              capturedAtEpochMs: 1_722_729_600_100,
              solverId: 'effect-test-solver',
              solverVersion: '1.0.0',
              result: {
                _tag: 'Solved' as const,
                desiredCenter: {
                  rightAscensionDegrees: 299.901,
                  declinationDegrees: 22.721,
                },
                solvedCenter: {
                  rightAscensionDegrees: 299.901,
                  declinationDegrees: 22.721,
                },
                correction: {
                  rightAscensionArcsec: 0,
                  declinationArcsec: 0,
                  convention: 'mountRaDec' as const,
                },
                uncertaintyArcsec: 4,
              },
            },
          }
        }),
      correct: () => Effect.die('Correction was not expected'),
    }),
  )
})

test('Acquire replays a legacy durable receipt without provider work', () => {
  let providerCalls = 0
  return ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-acquire-legacy-receipt-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        acquireSqliteRepository(graph.database).install(
          targetAcquisitionSession(
            started.activeRun.run.runId,
            'deepSkyPlateSolve',
          ),
        )
        const intent = {
          _tag: 'CaptureTargetAcquisitionEvidence',
          expectedLeaseRevision: started.control.revision,
          expectedRunRevision: started.activeRun.run.revision,
          expectedAcquireRevision: 0,
          idempotencyKey: 'effect-acquire-legacy-receipt-001',
        } as const
        const legacyResponse = AcquireCommandResponse.cases.Unavailable.make({
          summary: 'The legacy provider outcome remains unknown.',
        })
        acquireSqliteRepository(graph.database).saveReceipt(
          intent.idempotencyKey,
          owner.clientId,
          { status: 503, body: legacyResponse },
        )
        const response = yield* fetchEffect(
          `${bases.owner}/api/acquire/commands`,
          {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({ intent }),
          },
        )
        const body = yield* responseJson(response).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(AcquireCommandResponse)),
        )
        assert.equal(response.status, 503)
        assert.deepEqual(body, legacyResponse)
        assert.equal(providerCalls, 0)
      }),
    undefined,
    targetRouteDependenciesLayer({
      capture: () =>
        Effect.sync(() => {
          providerCalls += 1
          return { _tag: 'Aborted' as const, summary: 'Not expected.' }
        }),
      correct: () => Effect.die('Correction was not expected'),
    }),
  )
})

test('Acquire rejects stale target evidence before provider work', () => {
  let providerCalls = 0
  return ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-acquire-stale-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        acquireSqliteRepository(graph.database).install(
          targetAcquisitionSession(
            started.activeRun.run.runId,
            'deepSkyPlateSolve',
          ),
        )
        const response = yield* fetchEffect(
          `${bases.owner}/api/acquire/commands`,
          {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({
              intent: {
                _tag: 'CaptureTargetAcquisitionEvidence',
                expectedLeaseRevision: started.control.revision,
                expectedRunRevision: started.activeRun.run.revision,
                expectedAcquireRevision: 99,
                idempotencyKey: 'effect-acquire-stale-001',
              },
            }),
          },
        )
        const body = yield* responseJson(response).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(AcquireCommandResponse)),
        )
        assert.equal(response.status, 409)
        assert.equal(body._tag, 'Rejected')
        assert.equal(providerCalls, 0)
      }),
    undefined,
    targetRouteDependenciesLayer({
      capture: () =>
        Effect.sync(() => {
          providerCalls += 1
          return { _tag: 'Aborted' as const, summary: 'Not expected.' }
        }),
      correct: () => Effect.die('Correction was not expected'),
    }),
  )
})

test('Acquire exposes bounded recovery after exhausted solve evidence', () =>
  ownerOrigin(
    ({ graph, bases }) =>
      Effect.gen(function* () {
        const started = yield* startEffectRun(
          graph,
          bases.owner,
          'effect-acquire-recovery-start-001',
        )
        if (started.activeRun._tag !== 'Active')
          return yield* Effect.die('Expected active fixture Run')
        acquireSqliteRepository(graph.database).install(
          targetAcquisitionSession(
            started.activeRun.run.runId,
            'deepSkyPlateSolve',
          ),
        )
        const submit = (intent: unknown) =>
          fetchEffect(`${bases.owner}/api/acquire/commands`, {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({ intent }),
          }).pipe(
            Effect.flatMap((response) =>
              responseJson(response).pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(AcquireCommandResponse),
                ),
                Effect.map((body) => ({ response, body })),
              ),
            ),
          )
        const first = yield* submit({
          _tag: 'CaptureTargetAcquisitionEvidence',
          expectedLeaseRevision: started.control.revision,
          expectedRunRevision: started.activeRun.run.revision,
          expectedAcquireRevision: 0,
          idempotencyKey: 'effect-acquire-recovery-evidence-001',
        })
        assert.equal(first.body._tag, 'Accepted')
        if (first.body._tag !== 'Accepted')
          return yield* Effect.die('Expected first solve attempt')
        const nextAcquire = first.body.snapshot.observe?.acquire
        if (nextAcquire === undefined)
          return yield* Effect.die('Expected Acquire projection')
        const second = yield* submit({
          _tag: 'CaptureTargetAcquisitionEvidence',
          expectedLeaseRevision: first.body.snapshot.control.revision,
          expectedRunRevision:
            first.body.snapshot.activeRun._tag === 'Active'
              ? first.body.snapshot.activeRun.run.revision
              : -1,
          expectedAcquireRevision: nextAcquire.revision,
          idempotencyKey: 'effect-acquire-recovery-evidence-002',
        })
        assert.equal(second.body._tag, 'Accepted')
        if (second.body._tag !== 'Accepted')
          return yield* Effect.die('Expected exhausted solve attempt')
        const paused = second.body.snapshot.observe?.acquire
        if (
          paused === undefined ||
          second.body.snapshot.activeRun._tag !== 'Active'
        )
          return yield* Effect.die('Expected paused Acquire projection')
        assert.equal(paused.phase, 'paused')
        const recovery = yield* submit({
          _tag: 'RetryPlateSolveWithParameters',
          expectedLeaseRevision: second.body.snapshot.control.revision,
          expectedRunRevision: second.body.snapshot.activeRun.run.revision,
          expectedAcquireRevision: paused.revision,
          parameters: {
            exposureSeconds: 15,
            binning: 1,
            solverProfile: 'deep-sky-wide-search',
          },
          idempotencyKey: 'effect-acquire-recovery-001',
        })
        assert.equal(recovery.response.status, 200)
        assert.equal(recovery.body._tag, 'Accepted')
        if (recovery.body._tag === 'Accepted')
          assert.equal(
            recovery.body.snapshot.observe?.acquire?.phase,
            'solving',
          )
      }),
    undefined,
    targetRouteDependenciesLayer({
      capture: (_method, attemptId) =>
        Effect.succeed({
          _tag: 'Captured' as const,
          slewAcknowledgement: {
            acknowledgedAtEpochMs: 1_722_729_600_000,
            acknowledgementRef: `effect-${attemptId}-acknowledged`,
          },
          evidence: {
            sourceFrameAssetId: `effect-${attemptId}-frame`,
            capturedAtEpochMs: 1_722_729_600_100,
            solverId: 'effect-test-solver',
            solverVersion: '1.0.0',
            result: {
              _tag: 'NoSolution' as const,
              category: 'stars-insufficient' as const,
              retryable: true,
              diagnosticRef: `effect-${attemptId}-diagnostic`,
            },
          },
        }),
      correct: () => Effect.die('Correction was not expected'),
    }),
  ))

test('control rejects a read-only request identity', () =>
  ownerViewerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.viewer}/api/commands/control`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-listener-key': 'viewer',
          },
          body: controlRequest('viewer-control-request', 0),
        },
      )
      assert.equal(response.status, 403)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)),
      )
      assert.equal(body.failure._tag, 'CommandRejected')
    }),
  ))

test('control rejects malformed input through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.owner}/api/commands/control`,
        { method: 'POST', headers: ownerHeaders, body: '{}' },
      )
      assert.equal(response.status, 400)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)),
      )
      assert.equal(body.failure._tag, 'InvalidInput')
    }),
  ))

test('control accepts a fresh request through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.owner}/api/commands/control`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: controlRequest('owner-control-request', 0),
        },
      )
      assert.equal(response.status, 202)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CommandHttpSuccessEnvelope)),
      )
      assert.equal(body.data.control.pendingRequests?.length, 1)
    }),
  ))

test('control rejects a stale lease revision through the Effect listener', () =>
  ownerOrigin(({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(
        `${bases.owner}/api/commands/control`,
        {
          method: 'POST',
          headers: ownerHeaders,
          body: controlRequest('stale-control-request', 99),
        },
      )
      assert.equal(response.status, 409)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)),
      )
      assert.equal(body.failure._tag, 'CommandRejected')
      if (body.failure._tag === 'CommandRejected')
        assert.equal(body.failure.failure._tag, 'FreshnessConflict')
    }),
  ))

test('development simulation projects through the configured Effect route', () =>
  simulationOrigin(false, ({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(`${bases.owner}/api/simulation`, {
        headers: { 'x-listener-key': 'owner' },
      })
      assert.equal(response.status, 200)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(DevelopmentSimulationProjection),
        ),
      )
      assert.equal(body.scenario, 'exposure-success')
    }),
  ))

test('development simulation rejects read-only controls', () =>
  simulationOrigin(true, ({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(`${bases.viewer}/api/simulation`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-listener-key': 'viewer',
        },
        body: JSON.stringify({ action: 'advance', milliseconds: 1_000 }),
      })
      assert.equal(response.status, 403)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(DevelopmentSimulationControlFailure),
        ),
      )
      assert.equal(body.reason, 'ControlRequired')
    }),
  ))

test('development simulation rejects malformed controls', () =>
  simulationOrigin(false, ({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(`${bases.owner}/api/simulation`, {
        method: 'POST',
        headers: ownerHeaders,
        body: '{}',
      })
      assert.equal(response.status, 400)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(DevelopmentSimulationControlFailure),
        ),
      )
      assert.equal(body.reason, 'InvalidInput')
    }),
  ))

test('development simulation advances through an admitted Effect route', () =>
  simulationOrigin(false, ({ bases }) =>
    Effect.gen(function* () {
      const response = yield* fetchEffect(`${bases.owner}/api/simulation`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ action: 'advance', milliseconds: 1_000 }),
      })
      assert.equal(response.status, 200)
      const body = yield* Effect.promise(() => response.json()).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(DevelopmentSimulationProjection),
        ),
      )
      assert.equal(body.clock.nowMs, 1_000)
    }),
  ))

const invalidInput = {
  outcome: 'rejected',
  reason: 'InvalidInput',
  message: 'The service could not read that action.',
}

const availablePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string')
        return reject(new Error('Expected a TCP port'))
      const port = address.port
      server.close((error) =>
        error === undefined ? resolve(port) : reject(error),
      )
    })
  })

const connectTcp = (port: number) =>
  new Promise<Socket>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const onConnect = () => {
      socket.off('error', onError)
      resolve(socket)
    }
    const onError = (cause: Error) => {
      socket.off('connect', onConnect)
      reject(cause)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })

test('a later bind failure rolls back the listener already acquired', async () => {
  const firstPort = await availablePort()
  const graphEvents: Array<'acquired' | 'finalized'> = []
  const blocker = createServer()
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(0, '127.0.0.1', resolve)
  })
  const address = blocker.address()
  if (address === null || typeof address === 'string')
    throw new Error('Expected blocker TCP port')
  try {
    await assert.rejects(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const graph = yield* makeGraph(webFixture(), (event) =>
              graphEvents.push(event),
            )
            yield* listenOriginHttp(graph.application, [
              {
                name: 'first',
                host: '127.0.0.1',
                port: firstPort,
                admission: keyedAdmission('owner', owner),
              },
              {
                name: 'blocked',
                host: '127.0.0.1',
                port: address.port,
                admission: keyedAdmission('owner', owner),
              },
            ])
          }),
        ),
      ),
    )
    await assert.rejects(fetch(`http://127.0.0.1:${firstPort}/health/live`))
    assert.deepEqual(graphEvents, ['acquired', 'finalized'])
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
  }
})

test(
  'sequential scope shutdown finalizes active SSE before closing the listener',
  { timeout: 5_000 },
  async () => {
    const finalizerStarted = await Effect.runPromise(Deferred.make<void>())
    const releaseFinalizer = await Effect.runPromise(Deferred.make<void>())
    const scope = Effect.runSync(Scope.make('sequential'))
    const graph = await Effect.runPromise(
      Scope.provide(
        makeGraph(webFixture(), undefined, (repository) => ({
          publish: () => Effect.void,
          stream: (identity) =>
            Stream.fromEffect(
              Effect.acquireRelease(
                Effect.succeed(repository.projectionEvent(identity)),
                () =>
                  Deferred.succeed(finalizerStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseFinalizer)),
                  ),
              ),
            ).pipe(Stream.concat(Stream.never), Stream.scoped),
        })),
        scope,
      ),
    )
    const bound = await Effect.runPromise(
      Scope.provide(
        listenOriginHttp(graph.application, [
          {
            name: 'owner',
            host: '127.0.0.1',
            port: 0,
            admission: keyedAdmission('owner', owner),
          },
        ]),
        scope,
      ),
    )
    const listener = bound.owner
    if (listener === undefined) throw new Error('Expected owner listener')
    const base = `http://127.0.0.1:${listener.port}`
    const stream = await fetch(`${base}/api/events`, {
      headers: { 'x-listener-key': 'owner' },
    })
    const reader = stream.body?.getReader()
    if (reader === undefined) throw new Error('SSE body missing')
    await Effect.runPromise(readSseEvent(reader))

    const closing = Effect.runPromise(Scope.close(scope, Exit.void))
    await Effect.runPromise(Deferred.await(finalizerStarted))
    const stillBound = await connectTcp(listener.port)
    stillBound.destroy()
    await Effect.runPromise(Deferred.succeed(releaseFinalizer, undefined))
    await closing
    await assert.rejects(connectTcp(listener.port))
  },
)
