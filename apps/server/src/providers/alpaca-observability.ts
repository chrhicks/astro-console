import { Effect, Exit } from 'effect'

type AlpacaOperation =
  | 'preflight.inventory'
  | 'preflight.device.read'
  | 'camera.start_exposure'
  | 'camera.abort_exposure'
  | 'camera.read_state'
  | 'camera.read_image'

export type AlpacaRequestMetadata = {
  readonly method: 'GET' | 'PUT'
  readonly operation: AlpacaOperation
  readonly route: string
  readonly deviceKind?: 'camera' | 'filterWheel' | 'focuser' | 'telescope'
}

const attributes = (metadata: AlpacaRequestMetadata) => ({
  'astro.provider': 'alpaca',
  'astro.provider.operation': metadata.operation,
  'http.request.method': metadata.method,
  'http.route': metadata.route,
  ...(metadata.deviceKind === undefined
    ? {}
    : { 'astro.device.kind': metadata.deviceKind }),
})

const tracedFetch = Effect.fn('AlpacaProvider.fetch')(function* (
  request: typeof fetch,
  url: string,
  init: Omit<RequestInit, 'signal'>,
  metadata: AlpacaRequestMetadata,
) {
  yield* Effect.annotateCurrentSpan(attributes(metadata))
  const result = yield* Effect.tryPromise({
    try: (signal) => request(url, { ...init, signal }),
    catch: (cause) => cause,
  }).pipe(Effect.exit)
  yield* Exit.match(result, {
    onFailure: () =>
      Effect.annotateCurrentSpan({
        'astro.provider.request.outcome': 'transport_error',
      }),
    onSuccess: (response) =>
      Effect.annotateCurrentSpan({
        'astro.provider.request.outcome': 'response',
        'http.response.status_code': response.status,
      }),
  })
  return result
})

/**
 * Adds a safe child span around the raw fetch. The original transport failure
 * is restored outside that child span so adapter failure semantics do not
 * change and the child span never records the request URL as an exception.
 */
export function alpacaFetch(
  request: typeof fetch,
  url: string,
  init: Omit<RequestInit, 'signal'>,
  metadata: AlpacaRequestMetadata,
) {
  return tracedFetch(request, url, init, metadata).pipe(
    Effect.flatMap(
      Exit.match({
        onFailure: Effect.failCause,
        onSuccess: Effect.succeed,
      }),
    ),
  )
}

/**
 * Measures the complete adapter operation, including response decode or image
 * transfer and validation. The original failure is restored after the span so
 * provider diagnostics keep their current behavior without becoming span
 * exception fields at this new boundary.
 */
export function alpacaOperation<A, E>(
  effect: Effect.Effect<A, E>,
  metadata: AlpacaRequestMetadata,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.provider.operation.outcome': Exit.isSuccess(result)
        ? 'success'
        : 'failure',
    })
    return result
  }).pipe(
    Effect.withSpan('AlpacaProvider.operation', {
      kind: 'client',
      attributes: attributes(metadata),
    }),
  )
  return traced.pipe(
    Effect.flatMap(
      Exit.match({
        onFailure: Effect.failCause,
        onSuccess: Effect.succeed,
      }),
    ),
  )
}
