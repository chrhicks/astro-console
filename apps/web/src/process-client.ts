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

export const processClient = {
  async list() {
    return request(
      '/api/process/projects',
      ProcessingProjectListResponse,
      ProcessingProjectListSchema,
    )
  },

  async create(input: CreateProcessingProjectRequest) {
    const requestBody = Schema.decodeUnknownSync(
      CreateProcessingProjectRequestSchema,
    )(input)
    return request(
      '/api/process/projects',
      ProcessingProjectChangedResponse,
      ProcessingProjectChangedSchema,
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      },
    )
  },

  async open(projectId: string) {
    return request(
      `/api/process/projects/${encodeURIComponent(projectId)}`,
      OpenedProcessingProjectResponse,
      OpenedProcessingProjectSchema,
    )
  },

  async evidence(projectId: string) {
    return request(
      `/api/process/projects/${encodeURIComponent(projectId)}/evidence`,
      ProcessingProjectEvidenceResponse,
      ProcessingProjectEvidenceSchema,
    )
  },

  async change(input: ProcessingProjectChangeRequest) {
    const requestBody = Schema.decodeUnknownSync(
      ProcessingProjectChangeRequestSchema,
    )(input)
    return request(
      `/api/process/projects/${encodeURIComponent(input.projectId)}`,
      ProcessingProjectChangedResponse,
      ProcessingProjectChangedSchema,
      { method: 'PATCH', body: JSON.stringify(requestBody) },
    )
  },
}

async function request<
  Response extends Schema.Top & Schema.ConstraintDecoder<unknown>,
  Success extends Schema.Top & Schema.ConstraintDecoder<unknown>,
>(
  path: string,
  responseSchema: Response,
  successSchema: Success,
  init?: RequestInit,
): Promise<Success['Type']> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  })
  const value: unknown = await response.json().catch(() => undefined)
  const malformed = () =>
    new ProcessingProjectRequestError(response.status, {
      _tag: 'MalformedResponse',
    })
  const decoded = await Effect.runPromise(
    Schema.decodeUnknownEffect(responseSchema)(value).pipe(
      Effect.mapError(malformed),
    ),
  )
  if (Schema.is(ProcessingProjectHttpFailure)(decoded))
    throw new ProcessingProjectRequestError(response.status, decoded)
  return Effect.runPromise(
    Schema.decodeUnknownEffect(successSchema)(decoded).pipe(
      Effect.mapError(malformed),
    ),
  )
}

export type ProcessingProjectOperationFailure =
  | typeof ProcessingProjectHttpFailure.Type
  | { readonly _tag: 'MalformedResponse' }

export class ProcessingProjectRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: ProcessingProjectOperationFailure,
  ) {
    super('The Processing Project request was not accepted.')
  }
}
