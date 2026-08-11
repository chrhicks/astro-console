import { Context, Effect, FileSystem } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import type { LocalIdentity } from '../../auth/identity.ts'
import { responseHeaders } from '../response.ts'

export class OriginRequestIdentity extends Context.Service<
  OriginRequestIdentity,
  LocalIdentity
>()('@astro-console/server/OriginRequestIdentity') {}

export const json = (status: number, value: unknown) =>
  HttpServerResponse.jsonUnsafe(value, {
    status,
    headers: responseHeaders('application/json; charset=utf-8'),
  })

export const requestJson = (request: HttpServerRequest.HttpServerRequest) =>
  request.json.pipe(
    Effect.provideService(
      HttpServerRequest.MaxBodySize,
      FileSystem.Size(16_384),
    ),
    Effect.catch(() => Effect.succeed(undefined)),
  )
