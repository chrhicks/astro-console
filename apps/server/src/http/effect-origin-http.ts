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
  CommandHttpFailureEnvelope,
  DevelopmentSimulationControlFailure,
  DevelopmentSimulationProjection,
  DevelopmentSimulationUnavailable,
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
import { OriginDatabase } from '../persistence/database.ts'
import { RunSqliteRepository } from '../persistence/run-sqlite-repository.ts'
import { controlCommandFromEnvelope } from '../persistence/control-sqlite-repository.ts'
import {
  ProjectionPublication,
  type ProjectionPublicationShape,
} from '../services/projection-publication.ts'
import { responseHeaders } from './response.ts'
import { planWorkspaceProjection } from '../services/runtime-bootstrap.ts'
import {
  planCommandFromRequest,
  commandFailureStatuses,
  planInvalidResponse,
  planServiceResponse,
} from './command-handlers.ts'
import { BodyTooLarge } from './request-body.ts'
import {
  controlDevelopmentSimulation,
  DevelopmentSimulationControlRejected,
  readDevelopmentSimulation,
  type DevelopmentSimulationConfig,
} from './development-simulation.ts'

class OriginRequestIdentity extends Context.Service<
  OriginRequestIdentity,
  LocalIdentity
>()('@astro-console/server/OriginRequestIdentity') {}

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

const json = (status: number, value: unknown) =>
  HttpServerResponse.jsonUnsafe(value, {
    status,
    headers: responseHeaders('application/json; charset=utf-8'),
  })

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

const requestJson = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.provideService(
      HttpServerRequest.MaxBodySize,
      FileSystem.Size(16_384),
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  )

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
    const { database } = yield* OriginDatabase
    const runRepository = yield* RunSqliteRepository
    const publication = yield* ProjectionPublication
    const web = yield* makeWebResponse(webRoot)

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
    const planWorkspace = HttpRouter.add(
      'GET',
      '/api/workspaces/plan',
      Effect.sync(() => json(200, planWorkspaceProjection(database))),
    )
    const planCommands = HttpRouter.add(
      'POST',
      '/api/plan/commands',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const result = yield* planCommandFromRequest(
          Promise.resolve(raw),
          runRepository,
          repository,
          identity,
          (_type, cursor) => publication.publish(cursor),
        ).pipe(
          Effect.catchTags({
            'Server.PlanCommandInputInvalid': () =>
              planInvalidResponse(repository, identity),
            'Server.PlanServiceUnavailable': () =>
              planServiceResponse(
                'PlanServiceUnavailable',
                'The Plan service is temporarily unavailable.',
              ),
          }),
        )
        return json(result.status, result.body)
      }),
    )
    const controlCommands = HttpRouter.add(
      'POST',
      '/api/commands/control',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const result = yield* controlCommandFromEnvelope(
          Promise.resolve(raw),
          BodyTooLarge,
          database,
          repository,
          identity,
          (_type, cursor) => publication.publish(cursor),
        ).pipe(
          Effect.catchTags({
            'Server.CommandInputInvalid': () =>
              Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
                ok: false,
                failure: {
                  _tag: 'InvalidInput',
                  summary: 'The service could not read that action.',
                },
              }).pipe(Effect.map((body) => ({ status: 400, body }))),
            'Server.CommandRejected': ({ failure }) =>
              Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
                ok: false,
                failure: { _tag: 'CommandRejected', failure },
              }).pipe(
                Effect.map((body) => ({
                  status: commandFailureStatuses[failure._tag],
                  body,
                })),
              ),
          }),
        )
        return json(result.status, result.body)
      }),
    )
    const simulationRoutes =
      developmentSimulation === undefined
        ? []
        : [
            HttpRouter.add(
              'GET',
              '/api/simulation',
              Effect.tryPromise({
                try: () => readDevelopmentSimulation(developmentSimulation),
                catch: (cause) => cause,
              }).pipe(
                Effect.match({
                  onFailure: () =>
                    json(
                      503,
                      DevelopmentSimulationUnavailable.make({
                        mode: 'alpaca',
                        notice: 'SIMULATION · NOT LIVE HARDWARE',
                        state: 'unavailable',
                        launchScenario: developmentSimulation.launchScenario,
                        message: 'The development simulator is unavailable.',
                      }),
                    ),
                  onSuccess: (projection) =>
                    json(
                      200,
                      Schema.encodeSync(DevelopmentSimulationProjection)(
                        projection,
                      ),
                    ),
                }),
              ),
            ),
            HttpRouter.add(
              'POST',
              '/api/simulation',
              Effect.gen(function* () {
                const request = yield* HttpServerRequest.HttpServerRequest
                const identity = yield* OriginRequestIdentity
                const raw = yield* requestJson(request)
                const result = yield* Effect.tryPromise({
                  try: () =>
                    controlDevelopmentSimulation(
                      developmentSimulation,
                      identity,
                      raw,
                    ),
                  catch: (cause) => cause,
                }).pipe(
                  Effect.match({
                    onFailure: (cause) => {
                      const rejected =
                        cause instanceof DevelopmentSimulationControlRejected
                          ? cause
                          : undefined
                      return {
                        status: rejected?.status ?? 503,
                        body: DevelopmentSimulationControlFailure.make({
                          outcome: 'rejected',
                          reason:
                            rejected?.status === 403
                              ? 'ControlRequired'
                              : rejected?.status === 400
                                ? 'InvalidInput'
                                : 'SimulatorUnavailable',
                          message:
                            rejected?.message ??
                            'The development simulator is unavailable.',
                        }),
                      }
                    },
                    onSuccess: (projection) => ({
                      status: 200,
                      body: Schema.encodeSync(DevelopmentSimulationProjection)(
                        projection,
                      ),
                    }),
                  }),
                )
                return json(result.status, result.body)
              }),
            ),
          ]
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
        planWorkspace,
        planCommands,
        controlCommands,
        ...simulationRoutes,
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
      return identity === undefined
        ? yield* unauthenticated(request.method, requestPath)
        : yield* routes.pipe(
            Effect.provideService(OriginRequestIdentity, identity),
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
