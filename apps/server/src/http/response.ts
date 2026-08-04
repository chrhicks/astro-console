import type { ServerResponse } from 'node:http'
import { Effect, Schema } from 'effect'
import {
  BootstrapHttpFailureEnvelope,
  CommandHttpFailureEnvelope,
} from '@astro-console/v2-contracts'

export function responseHeaders(
  contentType: string,
  cacheControl = 'no-store',
) {
  return {
    'content-type': contentType,
    'cache-control': cacheControl,
    'content-security-policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }
}
export function json(response: ServerResponse, status: number, value: unknown) {
  response
    .writeHead(status, responseHeaders('application/json; charset=utf-8'))
    .end(JSON.stringify(value))
}
export function unauthenticated(
  response: ServerResponse,
  method: string | undefined,
  path: string,
) {
  if (method === 'GET' && path === '/api/snapshot')
    return void Effect.runSync(
      Schema.decodeUnknownEffect(BootstrapHttpFailureEnvelope)({
        ok: false,
        failure: {
          _tag: 'AuthenticationFailure',
          reason: 'Unauthenticated',
          summary: 'A verified member identity is required.',
        },
      }).pipe(Effect.map((body) => json(response, 401, body))),
    )
  if (method === 'POST' && path === '/api/commands/control')
    return void Effect.runSync(
      Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
        ok: false,
        failure: {
          _tag: 'AuthenticationFailure',
          summary: 'A verified member identity is required.',
        },
      }).pipe(Effect.map((body) => json(response, 401, body))),
    )
  return json(response, 401, {
    outcome: 'rejected',
    reason: 'Unauthenticated',
    message: 'A verified member identity is required.',
  })
}
