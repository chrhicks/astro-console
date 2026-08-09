import { Effect, Exit } from 'effect'

type LibraryOperation = 'catalog.page' | 'asset.detail' | 'asset.review'

const operationSpanNames: Record<LibraryOperation, string> = {
  'catalog.page': 'Library.catalog.page',
  'asset.detail': 'Library.asset.detail',
  'asset.review': 'Library.asset.review',
}

export function tracedLibraryOperation<A, E, R>(
  response: { readonly statusCode: number; readonly headersSent?: boolean },
  operation: LibraryOperation,
  effect: Effect.Effect<A, E, R>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.library.outcome': Exit.match(result, {
        onFailure: () => 'unavailable',
        onSuccess: () => outcomeFor(response),
      }),
    })
    return result
  }).pipe(
    Effect.withSpan(operationSpanNames[operation], {
      attributes: {
        'astro.workspace': 'library',
        'astro.library.operation': operation,
      },
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

function outcomeFor(response: {
  readonly statusCode: number
  readonly headersSent?: boolean
}) {
  if (response.headersSent !== true || response.statusCode >= 500)
    return 'unavailable'
  if (response.statusCode >= 200 && response.statusCode < 300) return 'accepted'
  return 'rejected'
}
