import { Effect, Exit } from 'effect'
import { recordOperationalEvent } from './operational-telemetry.ts'

type StartupOperation = 'config.decode' | 'service.create' | 'listener.bind'

const spanNames: Record<StartupOperation, string> = {
  'config.decode': 'Origin.startup.config.decode',
  'service.create': 'Origin.startup.service.create',
  'listener.bind': 'Origin.startup.listener.bind',
}

export function tracedStartup<A, E, R>(
  operation: StartupOperation,
  effect: Effect.Effect<A, E, R>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    const outcome = Exit.isSuccess(result)
      ? ('ready' as const)
      : ('unavailable' as const)
    yield* Effect.annotateCurrentSpan({ 'astro.startup.outcome': outcome })
    yield* recordOperationalEvent({
      scope: 'startup',
      operation,
      outcome,
    })
    return result
  }).pipe(
    Effect.withSpan(spanNames[operation], {
      attributes: { 'astro.startup.operation': operation },
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
