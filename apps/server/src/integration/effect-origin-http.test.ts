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
import { BootstrapHttpSuccessEnvelope } from '@astro-console/protocol'
import {
  makeOriginHttpApplication,
  listenOriginHttp,
} from '../http/effect-origin-http.ts'
import type { LocalIdentity, RequestAdmission } from '../auth/identity.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import {
  StateSqliteRepository,
  stateSqliteRepositoryLayer,
  type StateSqliteRepositoryShape,
} from '../persistence/state-sqlite-repository.ts'
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

const owner: LocalIdentity = {
  personId: 'owner-person',
  clientId: 'owner-client',
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

const makeGraph = (
  webRoot: string,
  observe?: (event: 'acquired' | 'finalized') => void,
  publicationFor?: (
    repository: StateSqliteRepositoryShape,
  ) => ProjectionPublicationShape,
) =>
  Effect.gen(function* () {
    observe?.('acquired')
    const database = openOriginDatabase(':memory:')
    initializeRuntimeState(database)
    installM27Fixture(database)
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
      Layer.succeed(StateSqliteRepository, repository),
      Layer.succeed(ProjectionPublication, publication),
    )
    const application = yield* makeOriginHttpApplication(webRoot).pipe(
      Effect.provide(graphLayer),
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(NodePath.layer),
    )
    return { application, publication, publicationEvents, repository }
  })

const fetchEffect = (url: string, init?: RequestInit) =>
  Effect.promise(() => fetch(url, init))

const responseJson = (response: Response) =>
  Effect.promise(async (): Promise<unknown> => response.json())

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
