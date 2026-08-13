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

const ProcessingProjectClientFailureDetail = Schema.TaggedUnion({
  InvalidInput: ProcessingProjectHttpFailure.cases.InvalidInput.fields,
  RequestTooLarge: ProcessingProjectHttpFailure.cases.RequestTooLarge.fields,
  ServiceUnavailable:
    ProcessingProjectHttpFailure.cases.ServiceUnavailable.fields,
  ProjectRouteNotFound:
    ProcessingProjectHttpFailure.cases.ProjectRouteNotFound.fields,
  DomainRejected: ProcessingProjectHttpFailure.cases.DomainRejected.fields,
  InvalidRequest: {},
  MalformedResponse: {},
  TransportUnavailable: {},
})

export type ProcessingProjectOperationFailure =
  typeof ProcessingProjectClientFailureDetail.Type

export const processingProjectFailureCertainty = (
  failure: ProcessingProjectOperationFailure,
): 'uncertain' | 'definite' =>
  ProcessingProjectClientFailureDetail.match(failure, {
    InvalidInput: () => 'definite',
    RequestTooLarge: () => 'definite',
    ServiceUnavailable: () => 'definite',
    ProjectRouteNotFound: () => 'definite',
    DomainRejected: () => 'definite',
    InvalidRequest: () => 'definite',
    MalformedResponse: () => 'uncertain',
    TransportUnavailable: () => 'uncertain',
  })

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

const invalidRequest = () => requestError(0, { _tag: 'InvalidRequest' })

const malformedResponse = (status = 0) =>
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
      return await fetch(path, {
        ...init,
        headers: {
          ...(init?.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
          ...init?.headers,
        },
        signal,
      })
    },
    catch: () =>
      requestError(0, {
        _tag: 'TransportUnavailable',
      }),
  })
  const value = yield* Effect.tryPromise({
    try: async () => (await response.json()) as unknown,
    catch: () => malformedResponse(response.status),
  })
  const decoded = yield* Schema.decodeUnknownEffect(responseSchema)(value).pipe(
    Effect.mapError(() => malformedResponse(response.status)),
  )
  if (Schema.is(ProcessingProjectHttpFailure)(decoded))
    return yield* Effect.fail(requestError(response.status, decoded))
  return yield* Schema.decodeUnknownEffect(successSchema)(decoded).pipe(
    Effect.mapError(() => malformedResponse(response.status)),
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
    )(input).pipe(Effect.mapError(() => invalidRequest()))
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
    )(input).pipe(Effect.mapError(() => invalidRequest()))
    return yield* request(
      `/api/process/projects/${encodeURIComponent(input.projectId)}`,
      ProcessingProjectChangedResponse,
      ProcessingProjectChangedSchema,
      { method: 'PATCH', body: JSON.stringify(requestBody) },
    )
  }),
}
