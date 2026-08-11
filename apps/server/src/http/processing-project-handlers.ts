import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, Schema } from 'effect'
import {
  CreateProcessingProjectRequest,
  ExecutableProcessingStage,
  ProcessingProjectChangeRequest,
  ProcessingProjectError,
  ProcessingProjectEvidenceQuery,
  ProcessingProjectId,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  ProcessingProjectLifecycle,
  ProcessingProjectPersistenceUnavailable,
  ProcessingProjectRejected,
} from '../services/processing-project-service.ts'
import { BodyTooLarge, body } from './request-body.ts'
import { json } from './response.ts'

const projectPath = /^\/api\/process\/projects\/([^/]+)$/
const evidencePath = /^\/api\/process\/projects\/([^/]+)\/evidence$/

export class ProcessingProjectInputInvalid extends Schema.TaggedErrorClass<ProcessingProjectInputInvalid>()(
  'Server.ProcessingProjectInputInvalid',
  {},
) {}

export class ProcessingProjectBodyTooLarge extends Schema.TaggedErrorClass<ProcessingProjectBodyTooLarge>()(
  'Server.ProcessingProjectBodyTooLarge',
  {},
) {}

export const handleProcessingProjectsHttp = Effect.fn(
  'ProcessingProjectHttp.handle',
)(function* (
  response: ServerResponse,
  identity: LocalIdentity,
  request: IncomingMessage,
  url: URL,
) {
  const lifecycle = yield* ProcessingProjectLifecycle

  const route = Effect.gen(function* () {
    if (request.method === 'GET' && url.pathname === '/api/process/projects')
      return json(response, 200, yield* lifecycle.list(identity))

    if (request.method === 'POST' && url.pathname === '/api/process/projects') {
      const input = yield* decodeCreateRequest(request)
      return json(response, 201, yield* lifecycle.create(identity, input))
    }

    const evidenceMatch = evidencePath.exec(url.pathname)
    if (request.method === 'GET' && evidenceMatch !== null) {
      const query = yield* decodeEvidenceQuery(evidenceMatch[1], url)
      return json(response, 200, yield* lifecycle.evidence(identity, query))
    }

    const projectMatch = projectPath.exec(url.pathname)
    if (projectMatch !== null) {
      const projectId = yield* decodeProjectId(projectMatch[1])
      if (request.method === 'GET')
        return json(response, 200, yield* lifecycle.open(identity, projectId))
      if (request.method === 'PATCH') {
        const input = yield* decodeChangeRequest(request)
        if (input.projectId !== projectId)
          return yield* Effect.fail(new ProcessingProjectInputInvalid())
        return json(response, 200, yield* lifecycle.change(identity, input))
      }
    }

    return json(response, 404, {
      _tag: 'ProjectRouteNotFound',
      message: 'The Processing Project route does not exist.',
    })
  })

  return yield* route.pipe(
    Effect.catch((error) => {
      if (Schema.is(ProcessingProjectRejected)(error))
        return Effect.sync(() =>
          json(response, processingErrorStatus(error.error), error.error),
        )
      if (Schema.is(ProcessingProjectInputInvalid)(error))
        return Effect.sync(() =>
          json(response, 400, {
            _tag: 'InvalidInput',
            message:
              'The service could not read the Processing Project request.',
          }),
        )
      if (Schema.is(ProcessingProjectBodyTooLarge)(error))
        return Effect.sync(() =>
          json(response, 413, {
            _tag: 'RequestTooLarge',
            message: 'The Processing Project request is too large.',
          }),
        )
      if (Schema.is(ProcessingProjectPersistenceUnavailable)(error))
        return Effect.sync(() =>
          json(response, 503, {
            _tag: 'ServiceUnavailable',
            message: 'Processing Project persistence is unavailable.',
          }),
        )
      return Effect.fail(error)
    }),
  )
})

const decodeCreateRequest = Effect.fn('ProcessingProjectHttp.decodeCreate')(
  function* (request: IncomingMessage) {
    const raw = yield* readBody(request)
    return yield* Schema.decodeUnknownEffect(CreateProcessingProjectRequest)(
      raw,
    ).pipe(Effect.mapError(() => new ProcessingProjectInputInvalid()))
  },
)

const decodeChangeRequest = Effect.fn('ProcessingProjectHttp.decodeChange')(
  function* (request: IncomingMessage) {
    const raw = yield* readBody(request)
    return yield* Schema.decodeUnknownEffect(ProcessingProjectChangeRequest)(
      raw,
    ).pipe(Effect.mapError(() => new ProcessingProjectInputInvalid()))
  },
)

const readBody = Effect.fn('ProcessingProjectHttp.readBody')(function* (
  request: IncomingMessage,
) {
  const raw = yield* Effect.promise(() => body(request))
  if (raw === BodyTooLarge)
    return yield* Effect.fail(new ProcessingProjectBodyTooLarge())
  if (raw === undefined)
    return yield* Effect.fail(new ProcessingProjectInputInvalid())
  return raw
})

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
)(function* (encodedProjectId: string | undefined, url: URL) {
  const projectId = yield* decodeProjectId(encodedProjectId)
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

function processingErrorStatus(error: typeof ProcessingProjectError.Type) {
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
