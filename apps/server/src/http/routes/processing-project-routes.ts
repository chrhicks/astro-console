import { Effect, FileSystem, Layer, Match, Schema } from 'effect'
import {
  CreateProcessingProjectRequest,
  ExecutableProcessingStage,
  OpenedProcessingProjectResponse,
  ProcessingProjectChangeRequest,
  ProcessingProjectChangedResponse,
  ProcessingProjectError,
  ProcessingProjectEvidenceQuery,
  ProcessingProjectEvidenceResponse,
  ProcessingProjectHttpFailure,
  ProcessingProjectId,
  ProcessingProjectListResponse,
} from '@astro-console/protocol'
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
} from 'effect/unstable/http'
import {
  ProcessingProjectLifecycle,
  ProcessingProjectPersistenceUnavailable,
  ProcessingProjectRejected,
} from '../../services/processing-project-service.ts'
import { json, OriginRequestIdentity } from './origin-route-shared.ts'

class ProcessingProjectInputInvalid extends Schema.TaggedErrorClass<ProcessingProjectInputInvalid>()(
  'Server.ProcessingProjectInputInvalid',
  {},
) {}

class ProcessingProjectBodyTooLarge extends Schema.TaggedErrorClass<ProcessingProjectBodyTooLarge>()(
  'Server.ProcessingProjectBodyTooLarge',
  {},
) {}

const invalidInput = ProcessingProjectHttpFailure.cases.InvalidInput.make({
  message: 'The service could not read the Processing Project request.',
})
const requestTooLarge = ProcessingProjectHttpFailure.cases.RequestTooLarge.make(
  {
    message: 'The Processing Project request is too large.',
  },
)
const serviceUnavailable =
  ProcessingProjectHttpFailure.cases.ServiceUnavailable.make({
    message: 'Processing Project persistence is unavailable.',
  })
const projectRouteNotFound =
  ProcessingProjectHttpFailure.cases.ProjectRouteNotFound.make({
    message: 'The Processing Project route does not exist.',
  })

export const processingProjectRouteCompatibilityResponse = (
  method: string,
  requestPath: string,
) => {
  const collection = requestPath === '/api/process/projects'
  const detail = /^\/api\/process\/projects\/[^/]+$/.test(requestPath)
  const evidence = /^\/api\/process\/projects\/[^/]+\/evidence$/.test(
    requestPath,
  )
  if (!collection && !requestPath.startsWith('/api/process/projects/'))
    return undefined
  if (detail || (evidence && method === 'GET')) {
    const suffix = evidence ? '/evidence' : ''
    const encoded = requestPath.slice(
      '/api/process/projects/'.length,
      suffix === '' ? undefined : -suffix.length,
    )
    try {
      decodeURIComponent(encoded)
    } catch {
      return json(400, invalidInput)
    }
  }
  if (
    (collection && (method === 'GET' || method === 'POST')) ||
    (detail && (method === 'GET' || method === 'PATCH')) ||
    (evidence && method === 'GET')
  )
    return undefined
  return json(404, projectRouteNotFound)
}

const processingErrorStatus = (error: typeof ProcessingProjectError.Type) => {
  if (ProcessingProjectError.guards.ProcessAuthorityDenied(error)) return 403
  if (ProcessingProjectError.guards.ProjectNotFound(error)) return 404
  if (
    ProcessingProjectError.guards.SourceSelectionInvalid(error) ||
    ProcessingProjectError.guards.SourceNotFound(error) ||
    ProcessingProjectError.guards.DraftInvalid(error)
  )
    return 400
  return 409
}

const processingFailureResponse = (error: unknown) => {
  if (Schema.is(ProcessingProjectRejected)(error))
    return Effect.succeed(
      json(
        processingErrorStatus(error.error),
        ProcessingProjectHttpFailure.cases.DomainRejected.make({
          error: error.error,
        }),
      ),
    )
  if (Schema.is(ProcessingProjectInputInvalid)(error))
    return Effect.succeed(json(400, invalidInput))
  if (Schema.is(ProcessingProjectBodyTooLarge)(error))
    return Effect.succeed(json(413, requestTooLarge))
  if (Schema.is(ProcessingProjectPersistenceUnavailable)(error))
    return Effect.succeed(json(503, serviceUnavailable))
  return Effect.fail(error)
}

const bodyExceededLimit = (error: unknown) =>
  HttpServerError.isHttpServerError(error) &&
  Match.value(error.reason).pipe(
    Match.when(
      { _tag: 'RequestParseError' },
      (reason) =>
        reason.cause instanceof Error &&
        reason.cause.message === 'maxBytes exceeded',
    ),
    Match.orElse(() => false),
  )

const readJson = Effect.fn('ProcessingProjectHttp.readJson')(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const contentLength = request.headers['content-length']
  if (
    contentLength !== undefined &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > 16_384
  )
    return yield* Effect.fail(new ProcessingProjectBodyTooLarge())
  return yield* request.json.pipe(
    Effect.provideService(
      HttpServerRequest.MaxBodySize,
      FileSystem.Size(16_384),
    ),
    Effect.mapError((error) =>
      bodyExceededLimit(error)
        ? new ProcessingProjectBodyTooLarge()
        : new ProcessingProjectInputInvalid(),
    ),
  )
})

const requestProjectId = (
  request: HttpServerRequest.HttpServerRequest,
  suffix = '',
) => {
  const path = new URL(request.url, 'http://local').pathname
  return new RegExp(
    `^/api/process/projects/([^/]+)${suffix.replace('/', '\\/')}$`,
  ).exec(path)?.[1]
}

const decodeProjectId = Effect.fn('ProcessingProjectHttp.decodeProjectId')(
  function* (encoded: string | undefined) {
    if (encoded === undefined)
      return yield* Effect.fail(new ProcessingProjectInputInvalid())
    const decoded = yield* Effect.try({
      try: () => decodeURIComponent(encoded),
      catch: () => new ProcessingProjectInputInvalid(),
    })
    return yield* Schema.decodeUnknownEffect(ProcessingProjectId)(decoded).pipe(
      Effect.mapError(() => new ProcessingProjectInputInvalid()),
    )
  },
)

const decodeEvidenceQuery = Effect.fn(
  'ProcessingProjectHttp.decodeEvidenceQuery',
)(function* (request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, 'http://local')
  const projectId = yield* decodeProjectId(
    requestProjectId(request, '/evidence'),
  )
  const stageValue = url.searchParams.get('stage')
  const afterValue = url.searchParams.get('afterAttemptId')
  const limitValue = url.searchParams.get('limit')
  const stage =
    stageValue === null
      ? undefined
      : yield* Schema.decodeUnknownEffect(ExecutableProcessingStage)(
          stageValue,
        ).pipe(Effect.mapError(() => new ProcessingProjectInputInvalid()))
  return yield* Schema.decodeUnknownEffect(ProcessingProjectEvidenceQuery)({
    projectId,
    ...(stage === undefined ? {} : { stage }),
    ...(afterValue === null ? {} : { afterAttemptId: afterValue }),
    ...(limitValue === null ? {} : { limit: Number(limitValue) }),
  }).pipe(Effect.mapError(() => new ProcessingProjectInputInvalid()))
})

export const makeProcessingProjectRoutes = Effect.fn(
  'OriginHttp.makeProcessingProjectRoutes',
)(function* () {
  const lifecycle = yield* ProcessingProjectLifecycle

  const list = HttpRouter.add(
    'GET',
    '/api/process/projects',
    Effect.gen(function* () {
      const identity = yield* OriginRequestIdentity
      const result = yield* lifecycle.list(identity).pipe(
        Effect.map((body) => ({ status: 200, body })),
        Effect.catchTag('Server.ProcessingProjectPersistenceUnavailable', () =>
          Effect.succeed({ status: 503, body: serviceUnavailable }),
        ),
      )
      return json(
        result.status,
        Schema.encodeSync(ProcessingProjectListResponse)(result.body),
      )
    }),
  )

  const create = HttpRouter.add(
    'POST',
    '/api/process/projects',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const identity = yield* OriginRequestIdentity
      return yield* Effect.gen(function* () {
        const raw = yield* readJson(request)
        const input = yield* Schema.decodeUnknownEffect(
          CreateProcessingProjectRequest,
        )(raw).pipe(Effect.mapError(() => new ProcessingProjectInputInvalid()))
        const body = yield* lifecycle.create(identity, input)
        return json(
          201,
          Schema.encodeSync(ProcessingProjectChangedResponse)(body),
        )
      }).pipe(Effect.catch(processingFailureResponse))
    }),
  )

  const open = HttpRouter.add(
    'GET',
    '/api/process/projects/:projectId',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const identity = yield* OriginRequestIdentity
      return yield* Effect.gen(function* () {
        const projectId = yield* decodeProjectId(requestProjectId(request))
        const body = yield* lifecycle.open(identity, projectId)
        return json(
          200,
          Schema.encodeSync(OpenedProcessingProjectResponse)(body),
        )
      }).pipe(Effect.catch(processingFailureResponse))
    }),
  )

  const evidence = HttpRouter.add(
    'GET',
    '/api/process/projects/:projectId/evidence',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const identity = yield* OriginRequestIdentity
      return yield* Effect.gen(function* () {
        const query = yield* decodeEvidenceQuery(request)
        const body = yield* lifecycle.evidence(identity, query)
        return json(
          200,
          Schema.encodeSync(ProcessingProjectEvidenceResponse)(body),
        )
      }).pipe(Effect.catch(processingFailureResponse))
    }),
  )

  const change = HttpRouter.add(
    'PATCH',
    '/api/process/projects/:projectId',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const identity = yield* OriginRequestIdentity
      return yield* Effect.gen(function* () {
        const projectId = yield* decodeProjectId(requestProjectId(request))
        const raw = yield* readJson(request)
        const input = yield* Schema.decodeUnknownEffect(
          ProcessingProjectChangeRequest,
        )(raw).pipe(Effect.mapError(() => new ProcessingProjectInputInvalid()))
        if (input.projectId !== projectId)
          return yield* Effect.fail(new ProcessingProjectInputInvalid())
        const body = yield* lifecycle.change(identity, input)
        return json(
          200,
          Schema.encodeSync(ProcessingProjectChangedResponse)(body),
        )
      }).pipe(Effect.catch(processingFailureResponse))
    }),
  )

  return Layer.mergeAll(list, create, open, evidence, change)
})
