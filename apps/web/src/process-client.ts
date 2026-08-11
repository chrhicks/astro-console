import { Schema } from 'effect'
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

export const processClient = {
  async list(signal?: AbortSignal) {
    return request(
      '/api/process/projects',
      ProcessingProjectListResponse,
      ProcessingProjectListSchema,
      undefined,
      signal,
    )
  },

  async create(input: CreateProcessingProjectRequest, signal?: AbortSignal) {
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
      signal,
    )
  },

  async open(projectId: typeof ProcessingProjectId.Type, signal?: AbortSignal) {
    return request(
      `/api/process/projects/${encodeURIComponent(projectId)}`,
      OpenedProcessingProjectResponse,
      OpenedProcessingProjectSchema,
      undefined,
      signal,
    )
  },

  async evidence(
    projectId: typeof ProcessingProjectId.Type,
    signal?: AbortSignal,
  ) {
    return request(
      `/api/process/projects/${encodeURIComponent(projectId)}/evidence`,
      ProcessingProjectEvidenceResponse,
      ProcessingProjectEvidenceSchema,
      undefined,
      signal,
    )
  },

  async change(input: ProcessingProjectChangeRequest, signal?: AbortSignal) {
    const requestBody = Schema.decodeUnknownSync(
      ProcessingProjectChangeRequestSchema,
    )(input)
    return request(
      `/api/process/projects/${encodeURIComponent(input.projectId)}`,
      ProcessingProjectChangedResponse,
      ProcessingProjectChangedSchema,
      { method: 'PATCH', body: JSON.stringify(requestBody) },
      signal,
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
  signal?: AbortSignal,
): Promise<Success['Type']> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
    ...(signal === undefined ? {} : { signal }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  const malformed = () =>
    new ProcessingProjectRequestError(response.status, {
      _tag: 'MalformedResponse',
    })
  const decoded = await Schema.decodeUnknownPromise(responseSchema)(
    value,
  ).catch(() => {
    throw malformed()
  })
  if (Schema.is(ProcessingProjectHttpFailure)(decoded))
    throw new ProcessingProjectRequestError(response.status, decoded)
  return Schema.decodeUnknownPromise(successSchema)(decoded).catch(() => {
    throw malformed()
  })
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
