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

export const processClient = {
  list: () =>
    request(
      '/api/process/projects',
      ProcessingProjectListResponse,
      ProcessingProjectListSchema,
    ),

  create: (input: CreateProcessingProjectRequest) =>
    Schema.decodeUnknownEffect(CreateProcessingProjectRequestSchema)(
      input,
    ).pipe(
      Effect.mapError(() => malformedRequest()),
      Effect.flatMap((requestBody) =>
        request(
          '/api/process/projects',
          ProcessingProjectChangedResponse,
          ProcessingProjectChangedSchema,
          {
            method: 'POST',
            body: JSON.stringify(requestBody),
          },
        ),
      ),
    ),

  open: (projectId: typeof ProcessingProjectId.Type) =>
    request(
      `/api/process/projects/${encodeURIComponent(projectId)}`,
      OpenedProcessingProjectResponse,
      OpenedProcessingProjectSchema,
    ),

  evidence: (projectId: typeof ProcessingProjectId.Type) =>
    request(
      `/api/process/projects/${encodeURIComponent(projectId)}/evidence`,
      ProcessingProjectEvidenceResponse,
      ProcessingProjectEvidenceSchema,
    ),

  change: (input: ProcessingProjectChangeRequest) =>
    Schema.decodeUnknownEffect(ProcessingProjectChangeRequestSchema)(
      input,
    ).pipe(
      Effect.mapError(() => malformedRequest()),
      Effect.flatMap((requestBody) =>
        request(
          `/api/process/projects/${encodeURIComponent(input.projectId)}`,
          ProcessingProjectChangedResponse,
          ProcessingProjectChangedSchema,
          { method: 'PATCH', body: JSON.stringify(requestBody) },
        ),
      ),
    ),
}

const request = <
  Response extends Schema.Top & Schema.ConstraintDecoder<unknown>,
  Success extends Schema.Top & Schema.ConstraintDecoder<unknown>,
>(
  path: string,
  responseSchema: Response,
  successSchema: Success,
  init?: RequestInit,
): Effect.Effect<Success['Type'], ProcessingProjectRequestError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(path, {
          ...init,
          headers: {
            ...(init?.body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
            ...init?.headers,
          },
          signal,
        }),
      catch: () =>
        requestError(0, {
          _tag: 'TransportUnavailable',
        }),
    })
    const value: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => malformedRequest(response.status),
    })
    const decoded = yield* Schema.decodeUnknownEffect(responseSchema)(
      value,
    ).pipe(Effect.mapError(() => malformedRequest(response.status)))
    if (Schema.is(ProcessingProjectHttpFailure)(decoded))
      return yield* Effect.fail(requestError(response.status, decoded))
    return yield* Schema.decodeUnknownEffect(successSchema)(decoded).pipe(
      Effect.mapError(() => malformedRequest(response.status)),
    )
  })
