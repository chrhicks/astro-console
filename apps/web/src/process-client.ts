import { Effect, Schema } from 'effect'
import {
  CreateProcessingProjectRequest as CreateProcessingProjectRequestSchema,
  OpenedProcessingProjectResponse,
  ProcessingProjectChangeRequest as ProcessingProjectChangeRequestSchema,
  ProcessingProjectChangedResponse,
  ProcessingProjectEvidenceResponse,
  ProcessingProjectHttpFailure,
  ProcessingProjectListResponse,
  ProcessingProjectList as ProcessingProjectListSchema,
  OpenedProcessingProject as OpenedProcessingProjectSchema,
  ProcessingProjectEvidence as ProcessingProjectEvidenceSchema,
  ProcessingProjectChanged as ProcessingProjectChangedSchema,
  ProcessingProjectId,
} from '@astro-console/protocol'

export type ProcessingProjectList = typeof ProcessingProjectListSchema.Type
export type OpenedProcessingProject = typeof OpenedProcessingProjectSchema.Type
export type ProcessingProjectEvidence =
  typeof ProcessingProjectEvidenceSchema.Type
export type ProcessingProjectChanged =
  typeof ProcessingProjectChangedSchema.Type
export type CreateProcessingProjectRequest =
  typeof CreateProcessingProjectRequestSchema.Type
export type ProcessingProjectChangeRequest =
  typeof ProcessingProjectChangeRequestSchema.Type

const ProcessingProjectClientFailureDetail = Schema.Union([
  ProcessingProjectHttpFailure,
  Schema.TaggedStruct('MalformedResponse', {}),
  Schema.TaggedStruct('TransportUnavailable', {}),
])

export type ProcessingProjectOperationFailure =
  typeof ProcessingProjectClientFailureDetail.Type

export class ProcessingProjectRequestError extends Schema.TaggedErrorClass<ProcessingProjectRequestError>()(
  'Web.ProcessingProjectRequestError',
  {
    status: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    detail: ProcessingProjectClientFailureDetail,
    message: Schema.String,
  },
) {}

const requestError = (
  status: number,
  detail: ProcessingProjectOperationFailure,
) =>
  new ProcessingProjectRequestError({
    status,
    detail,
    message: 'The Processing Project request was not accepted.',
  })

const malformedRequest = (status = 0) =>
  requestError(status, { _tag: 'MalformedResponse' })

const request = Effect.fn('ProcessClient.request')(function* <
  Response extends Schema.Top & Schema.ConstraintDecoder<unknown>,
  Success extends Schema.Top & Schema.ConstraintDecoder<unknown>,
>(
  path: string,
  responseSchema: Response,
  successSchema: Success,
  init?: RequestInit,
) {
  const response = yield* Effect.tryPromise({
    try: async (signal) => {
      const fetched = await fetch(path, {
        ...init,
        headers: {
          ...(init?.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...init?.headers,
        },
        signal,
      })
      return {
        status: fetched.status,
        value: (await fetched.json()) as unknown,
      }
    },
    catch: () =>
      requestError(0, {
        _tag: 'TransportUnavailable',
      }),
  })
  const decoded = yield* Schema.decodeUnknownEffect(responseSchema)(
    response.value,
  ).pipe(Effect.mapError(() => malformedRequest(response.status)))
  if (Schema.is(ProcessingProjectHttpFailure)(decoded))
    return yield* Effect.fail(requestError(response.status, decoded))
  return yield* Schema.decodeUnknownEffect(successSchema)(decoded).pipe(
    Effect.mapError(() => malformedRequest(response.status)),
  )
})

export const processClient = {
  list: Effect.fn('ProcessClient.list')(() =>
    request(
      '/api/process/projects',
      ProcessingProjectListResponse,
      ProcessingProjectListSchema,
    ),
  ),

  create: Effect.fn('ProcessClient.create')(function* (
    input: CreateProcessingProjectRequest,
  ) {
    const requestBody = yield* Schema.decodeUnknownEffect(
      CreateProcessingProjectRequestSchema,
    )(input).pipe(Effect.mapError(() => malformedRequest()))
    return yield* request(
      '/api/process/projects',
      ProcessingProjectChangedResponse,
      ProcessingProjectChangedSchema,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      },
    )
  }),

  open: Effect.fn('ProcessClient.open')(
    (projectId: typeof ProcessingProjectId.Type) =>
      request(
        `/api/process/projects/${encodeURIComponent(projectId)}`,
        OpenedProcessingProjectResponse,
        OpenedProcessingProjectSchema,
      ),
  ),

  evidence: Effect.fn('ProcessClient.evidence')(
    (projectId: typeof ProcessingProjectId.Type) =>
      request(
        `/api/process/projects/${encodeURIComponent(projectId)}/evidence`,
        ProcessingProjectEvidenceResponse,
        ProcessingProjectEvidenceSchema,
      ),
  ),

  change: Effect.fn('ProcessClient.change')(function* (
    input: ProcessingProjectChangeRequest,
  ) {
    const requestBody = yield* Schema.decodeUnknownEffect(
      ProcessingProjectChangeRequestSchema,
    )(input).pipe(Effect.mapError(() => malformedRequest()))
    return yield* request(
      `/api/process/projects/${encodeURIComponent(input.projectId)}`,
      ProcessingProjectChangedResponse,
      ProcessingProjectChangedSchema,
      { method: 'PATCH', body: JSON.stringify(requestBody) },
    )
  }),
}
