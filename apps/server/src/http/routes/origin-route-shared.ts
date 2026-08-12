import { Context, Effect, FileSystem } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import type { LocalIdentity } from '../../auth/identity.ts'
import { tracedHttpRequest } from '../../observability/origin-telemetry.ts'
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

export type HttpTraceResponse = {
  statusCode: number
  headersSent: boolean
}

export const tracedHttpRoute = <E, R>(
  input: Parameters<typeof tracedHttpRequest>[1],
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  business?: (
    response: HttpTraceResponse,
    effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.suspend(() => {
    const response: HttpTraceResponse = { statusCode: 500, headersSent: false }
    const captured = effect.pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          response.statusCode = value.status
          response.headersSent = true
        }),
      ),
    )
    return tracedHttpRequest(
      response,
      input,
      business === undefined ? captured : business(response, captured),
    )
  })
