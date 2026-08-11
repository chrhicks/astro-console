import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import {
  Context,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Schedule,
  Schema,
  Scope,
  Stream,
} from 'effect'
import {
  BootstrapHttpFailureEnvelope,
  BootstrapHttpSuccessEnvelope,
} from '@astro-console/protocol'
import {
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http'
import type {
  AdmissionRequest,
  LocalIdentity,
  RequestAdmission,
} from '../auth/identity.ts'
import { StateSqliteRepository } from '../persistence/state-sqlite-repository.ts'
import {
  ProjectionPublication,
  type ProjectionPublicationShape,
} from '../services/projection-publication.ts'
import { responseHeaders } from './response.ts'
import type { DevelopmentSimulationConfig } from './development-simulation.ts'
import { makeControlRoutes } from './routes/control-routes.ts'
import { makeAcquireRoutes } from './routes/acquire-routes.ts'
import { json, OriginRequestIdentity } from './routes/origin-route-shared.ts'
import {
  makeObserveRoutes,
  observeRouteCompatibilityResponse,
} from './routes/observe-routes.ts'
import { makePlanRoutes } from './routes/plan-routes.ts'
import { makeSimulationRoutes } from './routes/simulation-routes.ts'
import {
  makeLibraryRouteCompatibility,
  makeLibraryRoutes,
} from './routes/library-routes.ts'

class OriginRequestAdmission extends Context.Service<
  OriginRequestAdmission,
  RequestAdmission
>()('@astro-console/server/OriginRequestAdmission') {}

export type OriginHttpApplication = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  unknown,
  OriginRequestAdmission | Scope.Scope | HttpServerRequest.HttpServerRequest
>

export type OriginHttpBinding = {
  readonly name: string
  readonly host: '127.0.0.1' | '0.0.0.0'
  readonly port: number
  readonly admission: RequestAdmission
}

export type BoundOriginHttp = Readonly<
  Record<string, { readonly port: number }>
>

const invalidInput = {
  outcome: 'rejected',
  reason: 'InvalidInput',
  message: 'The service could not read that action.',
} as const

const ownerRequired = {
  outcome: 'rejected',
  reason: 'OwnerRequired',
  message: 'Only the owner can accept a RunDefinition.',
} as const

const encoder = new TextEncoder()

const unauthenticated = (method: string, pathname: string) => {
  if (method === 'GET' && pathname === '/api/snapshot')
    return Schema.decodeUnknownEffect(BootstrapHttpFailureEnvelope)({
      ok: false,
      failure: {
        _tag: 'AuthenticationFailure',
        reason: 'Unauthenticated',
        summary: 'A verified member identity is required.',
      },
    }).pipe(Effect.map((body) => json(401, body)))
  return Effect.succeed(
    json(401, {
      outcome: 'rejected',
      reason: 'Unauthenticated',
      message: 'A verified member identity is required.',
    }),
  )
}

const pathname = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, 'http://local').pathname

const webRoute = (value: string) =>
  value === '/' ||
  /^\/(?:plan|observe|library|process)$/.test(value) ||
  /^\/library\/assets\/[^/]+$/.test(value) ||
  /^\/process\/projects\/[^/]+$/.test(value)

const webContentType = (path: Path.Path, value: string) => {
  switch (path.extname(value)) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
  }
}

const makeWebResponse = (root: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const canonicalRoot = yield* fileSystem.realPath(root)

    const read = (requestPath: string) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try(() => decodeURIComponent(requestPath))
        if (decoded.split('/').some((part) => part === '.' || part === '..'))
          return undefined
        const candidate = path.resolve(canonicalRoot, `.${decoded}`)
        if (path.relative(canonicalRoot, candidate).startsWith('..'))
          return undefined
        const resolved = yield* fileSystem.realPath(candidate)
        if (path.relative(canonicalRoot, resolved).startsWith('..'))
          return undefined
        return yield* fileSystem.readFile(resolved)
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

    return Effect.fn('OriginHttp.web')(function* (requestPath: string) {
      const contentType = webContentType(path, requestPath)
      if (contentType !== undefined) {
        const body = yield* read(requestPath)
        if (body !== undefined)
          return HttpServerResponse.uint8Array(body, {
            headers: responseHeaders(
              contentType,
              /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(requestPath)
                ? 'public, max-age=31536000, immutable'
                : 'no-store',
            ),
          })
      }
      if (webRoute(requestPath)) {
        const body = yield* read('/index.html')
        if (body !== undefined)
          return HttpServerResponse.uint8Array(body, {
            headers: responseHeaders('text/html; charset=utf-8', 'no-store'),
          })
      }
      return HttpServerResponse.empty({
        status: 404,
        headers: responseHeaders('text/plain; charset=utf-8'),
      })
    })
  })

const eventsResponse = (
  identity: LocalIdentity,
  publication: ProjectionPublicationShape,
) => {
  const events = publication
    .stream(identity)
    .pipe(
      Stream.map((event) =>
        encoder.encode(
          `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
        ),
      ),
    )
  const heartbeat = Stream.fromSchedule(Schedule.spaced('15 seconds')).pipe(
    Stream.map(() => encoder.encode(': heartbeat\n\n')),
  )
  return HttpServerResponse.stream(Stream.merge(events, heartbeat), {
    headers: {
      ...responseHeaders('text/event-stream'),
      connection: 'keep-alive',
    },
  })
}

export const makeOriginHttpApplication = (
  webRoot: string,
  developmentSimulation?: DevelopmentSimulationConfig,
) =>
  Effect.gen(function* () {
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication
    const web = yield* makeWebResponse(webRoot)
    const planRoutes = yield* makePlanRoutes()
    const controlRoutes = yield* makeControlRoutes()
    const observeRoutes = yield* makeObserveRoutes()
    const acquireRoutes = yield* makeAcquireRoutes()
    const simulationRoutes = makeSimulationRoutes(developmentSimulation)
    const libraryRoutes = yield* makeLibraryRoutes()
    const libraryRouteCompatibility = yield* makeLibraryRouteCompatibility()

    const live = HttpRouter.add(
      'GET',
      '/health/live',
      json(200, { status: 'alive' }),
    )
    const snapshot = HttpRouter.add(
      'GET',
      '/api/snapshot',
      Effect.gen(function* () {
        const identity = yield* OriginRequestIdentity
        const data = yield* repository.bootstrapSnapshot(identity)
        const body = yield* Schema.decodeUnknownEffect(
          BootstrapHttpSuccessEnvelope,
        )({ ok: true, data })
        return json(200, body)
      }),
    )
    const ready = HttpRouter.add(
      'GET',
      '/api/health/ready',
      Effect.sync(() => json(200, repository.readiness())),
    )
    const operations = HttpRouter.add(
      'GET',
      '/api/health/operations',
      Effect.gen(function* () {
        const identity = yield* OriginRequestIdentity
        return identity.role === 'owner'
          ? json(200, repository.operations())
          : json(403, ownerRequired)
      }),
    )
    const events = HttpRouter.add(
      'GET',
      '/api/events',
      Effect.gen(function* () {
        const identity = yield* OriginRequestIdentity
        return eventsResponse(identity, publication)
      }),
    )
    const apiNotFound = HttpRouter.add('*', '/api/*', json(404, invalidInput))
    const webAndNotFound = HttpRouter.add(
      '*',
      '/*',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return request.method === 'GET'
          ? yield* web(pathname(request))
          : HttpServerResponse.empty({
              status: 404,
              headers: responseHeaders('text/plain; charset=utf-8'),
            })
      }),
    )

    const routes = yield* HttpRouter.toHttpEffect(
      Layer.mergeAll(
        live,
        snapshot,
        ready,
        operations,
        planRoutes,
        controlRoutes,
        observeRoutes,
        acquireRoutes,
        ...simulationRoutes,
        libraryRoutes,
        events,
        apiNotFound,
        webAndNotFound,
      ),
    )

    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const requestPath = pathname(request)
      if (request.method === 'GET' && requestPath === '/health/live')
        return yield* routes.pipe(
          Effect.provideService(OriginRequestIdentity, {
            personId: 'health',
            clientId: 'health',
            capability: 'readOnly',
          }),
        )

      repository.expireReconnectGrace()
      const admission = yield* OriginRequestAdmission
      const admissionRequest: AdmissionRequest = {
        method: request.method,
        path: requestPath,
        headers: request.headers,
      }
      const identity = yield* Effect.promise(async () =>
        admission(admissionRequest),
      )
      if (identity === undefined)
        return yield* unauthenticated(request.method, requestPath)
      const observeCompatibility = observeRouteCompatibilityResponse(
        request.method,
        requestPath,
      )
      const libraryCompatibility = yield* libraryRouteCompatibility(
        request.method,
        requestPath,
        identity,
      )
      return (
        observeCompatibility ??
        libraryCompatibility ??
        (yield* routes.pipe(
          Effect.provideService(OriginRequestIdentity, identity),
        ))
      )
    })
  })

const tcpPort = (address: HttpServer.Address) => {
  const formatted = HttpServer.formatAddress(address)
  if (!formatted.startsWith('http://'))
    throw new Error('Origin HTTP requires a TCP listener')
  return Number(new URL(formatted).port)
}

export const listenOriginHttp = Effect.fn('OriginHttp.listen')(function* (
  application: OriginHttpApplication,
  bindings: ReadonlyArray<OriginHttpBinding>,
) {
  const listenerScope = yield* Scope.make('sequential')
  const close = Scope.close(listenerScope, Exit.void).pipe(
    Effect.uninterruptible,
  )
  yield* Effect.addFinalizer(() => close)

  return yield* Effect.gen(function* () {
    const bound: Record<string, { readonly port: number }> = {}
    for (const binding of bindings) {
      const server = yield* Scope.provide(
        NodeHttpServer.make(createServer, {
          host: binding.host,
          port: binding.port,
          disablePreemptiveShutdown: true,
          gracefulShutdownTimeout: Duration.seconds(1),
        }),
        listenerScope,
      )
      yield* Scope.provide(
        server.serve(
          application.pipe(
            Effect.provideService(OriginRequestAdmission, binding.admission),
          ),
        ),
        listenerScope,
      )
      bound[binding.name] = { port: tcpPort(server.address) }
    }
    return bound
  }).pipe(Effect.onError(() => close))
})
