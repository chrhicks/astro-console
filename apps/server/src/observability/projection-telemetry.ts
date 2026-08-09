import { Effect, Exit } from 'effect'
import { recordOperationalEvent } from './operational-telemetry.ts'
import type { OperationalOutcome } from './operational-telemetry.ts'

type ProjectionDelivery = 'snapshot' | 'sse.open'
export type ProjectionControlState =
  'held' | 'reconnecting' | 'unheld' | 'notApplicable'

const spanNames: Record<ProjectionDelivery, string> = {
  snapshot: 'Projection.snapshot.deliver',
  'sse.open': 'Projection.sse.open',
}

export function tracedProjectionDelivery<A, E, R>(
  response: { readonly statusCode: number; readonly headersSent?: boolean },
  delivery: ProjectionDelivery,
  effect: Effect.Effect<A, E, R>,
  controlState?: () => ProjectionControlState,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    const outcome: OperationalOutcome = Exit.match(result, {
      onFailure: () => 'unavailable' as const,
      onSuccess: (): OperationalOutcome =>
        response.headersSent === true && response.statusCode < 500
          ? 'delivered'
          : 'unavailable',
    })
    yield* Effect.annotateCurrentSpan({
      'astro.projection.delivery.outcome': outcome,
      ...(controlState === undefined
        ? {}
        : { 'astro.projection.control.state': controlState() }),
    })
    yield* recordOperationalEvent({
      scope: 'projection',
      operation: delivery,
      outcome,
    })
    return result
  }).pipe(
    Effect.withSpan(spanNames[delivery], {
      attributes: {
        'astro.workspace': 'projection',
        'astro.projection.delivery': delivery,
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
