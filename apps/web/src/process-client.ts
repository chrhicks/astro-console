import { Schema } from 'effect'
import {
  CreateProcessingProjectRequest as CreateProcessingProjectRequestSchema,
  OpenedProcessingProject as OpenedProcessingProjectSchema,
  ProcessingProjectChangeRequest as ProcessingProjectChangeRequestSchema,
  ProcessingProjectChanged as ProcessingProjectChangedSchema,
  ProcessingProjectEvidence as ProcessingProjectEvidenceSchema,
  ProcessingProjectList as ProcessingProjectListSchema,
} from '@astro-console/v2-contracts'

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
    return request('/api/process/projects', ProcessingProjectListSchema)
  },

  async create(input: CreateProcessingProjectRequest) {
    const requestBody = Schema.decodeUnknownSync(
      CreateProcessingProjectRequestSchema,
    )(input)
    return request('/api/process/projects', ProcessingProjectChangedSchema, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
  },

  async open(projectId: string) {
    return request(
      `/api/process/projects/${encodeURIComponent(projectId)}`,
      OpenedProcessingProjectSchema,
    )
  },

  async evidence(projectId: string) {
    return request(
      `/api/process/projects/${encodeURIComponent(projectId)}/evidence`,
      ProcessingProjectEvidenceSchema,
    )
  },

  async change(input: ProcessingProjectChangeRequest) {
    const requestBody = Schema.decodeUnknownSync(
      ProcessingProjectChangeRequestSchema,
    )(input)
    return request(
      `/api/process/projects/${encodeURIComponent(input.projectId)}`,
      ProcessingProjectChangedSchema,
      { method: 'PATCH', body: JSON.stringify(requestBody) },
    )
  },
}

async function request<
  S extends Schema.Top & Schema.ConstraintDecoder<unknown>,
>(path: string, schema: S, init?: RequestInit): Promise<S['Type']> {
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
  if (!response.ok)
    throw new ProcessingProjectRequestError(response.status, value)
  return Schema.decodeUnknownSync(schema)(value)
}

export class ProcessingProjectRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super('The Processing Project request was not accepted.')
  }
}
