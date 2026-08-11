import type { IncomingMessage, ServerResponse } from 'node:http'
import { Schema } from 'effect'
import {
  CreateProcessingProjectRequest,
  ExecutableProcessingStage,
  ProcessingProjectChangeRequest,
  ProcessingProjectError,
  ProcessingProjectEvidenceQuery,
  ProcessingProjectId,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import { body } from './request-body.ts'
import { json } from './response.ts'

type Lifecycle = ReturnType<
  typeof import('../services/processing-project-service.ts').createProcessingProjectLifecycle
>

const projectPath = /^\/api\/process\/projects\/([^/]+)$/
const evidencePath = /^\/api\/process\/projects\/([^/]+)\/evidence$/

export function createProcessingProjectsHttpHandler(lifecycle: Lifecycle) {
  return async (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
    url: URL,
  ) => {
    try {
      if (request.method === 'GET' && url.pathname === '/api/process/projects')
        return json(response, 200, await lifecycle.list(identity))

      if (
        request.method === 'POST' &&
        url.pathname === '/api/process/projects'
      ) {
        const input = Schema.decodeUnknownSync(CreateProcessingProjectRequest)(
          await body(request),
        )
        return processingResult(
          response,
          await lifecycle.create(identity, input),
          201,
        )
      }

      const evidenceMatch = evidencePath.exec(url.pathname)
      if (request.method === 'GET' && evidenceMatch !== null) {
        const projectId = decodeProjectId(evidenceMatch[1])
        const stageValue = url.searchParams.get('stage')
        const afterValue = url.searchParams.get('afterAttemptId')
        const limitValue = url.searchParams.get('limit')
        const query = Schema.decodeUnknownSync(ProcessingProjectEvidenceQuery)({
          projectId,
          ...(stageValue === null
            ? {}
            : {
                stage: Schema.decodeUnknownSync(ExecutableProcessingStage)(
                  stageValue,
                ),
              }),
          ...(afterValue === null ? {} : { afterAttemptId: afterValue }),
          ...(limitValue === null ? {} : { limit: Number(limitValue) }),
        })
        const result = await lifecycle.evidence(identity, query)
        return result === undefined
          ? projectNotFound(response, projectId)
          : json(response, 200, result)
      }

      const projectMatch = projectPath.exec(url.pathname)
      if (projectMatch !== null) {
        const projectId = decodeProjectId(projectMatch[1])
        if (request.method === 'GET') {
          const result = await lifecycle.open(identity, projectId)
          return result === undefined
            ? projectNotFound(response, projectId)
            : json(response, 200, result)
        }
        if (request.method === 'PATCH') {
          const input = Schema.decodeUnknownSync(
            ProcessingProjectChangeRequest,
          )(await body(request))
          if (input.projectId !== projectId)
            return json(response, 400, {
              _tag: 'InvalidInput',
              message: 'The Project ID in the path and request must match.',
            })
          return processingResult(
            response,
            await lifecycle.change(identity, input),
            200,
          )
        }
      }

      return json(response, 404, {
        _tag: 'ProjectRouteNotFound',
        message: 'The Processing Project route does not exist.',
      })
    } catch {
      return json(response, 400, {
        _tag: 'InvalidInput',
        message: 'The service could not read the Processing Project request.',
      })
    }
  }
}

function decodeProjectId(encoded: string | undefined) {
  if (encoded === undefined) throw new Error('Project ID is missing')
  return Schema.decodeUnknownSync(ProcessingProjectId)(
    decodeURIComponent(encoded),
  )
}

function processingResult(
  response: ServerResponse,
  result:
    | Awaited<ReturnType<Lifecycle['create']>>
    | Awaited<ReturnType<Lifecycle['change']>>,
  acceptedStatus: number,
) {
  if (!('_tag' in result)) return json(response, acceptedStatus, result)
  const error = Schema.decodeUnknownSync(ProcessingProjectError)(result)
  return json(response, processingErrorStatus(error), error)
}

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

function projectNotFound(
  response: ServerResponse,
  projectId: typeof ProcessingProjectId.Type,
) {
  return json(
    response,
    404,
    ProcessingProjectError.cases.ProjectNotFound.make({ projectId }),
  )
}
