import { Effect, Exit } from 'effect'
import { recordOperationalEvent } from './operational-telemetry.ts'
import type { OperationalOutcome } from './operational-telemetry.ts'

export type ExecutorWorkKind =
  'BeginRun' | 'StartExposure' | 'RetrieveFrame' | 'AbortExposure'

export type ExecutorWorkOutcome =
  | 'noChange'
  | 'waitingPreflight'
  | 'acquireRequired'
  | 'captureReady'
  | 'awaitingObservation'
  | 'observing'
  | 'retrievalReady'
  | 'retrieved'
  | 'aborted'
  | 'rejected'
  | 'reconciling'

export type ExecutorWorkResult =
  Exclude<ExecutorWorkOutcome, 'noChange'> | 'none'

export function tracedExecutorWork(
  kind: ExecutorWorkKind,
  run: () => Promise<ExecutorWorkResult>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: run,
      catch: (cause) => cause,
    }).pipe(Effect.exit)
    const outcome: OperationalOutcome = Exit.match(result, {
      onFailure: () => 'unavailable' as const,
      onSuccess: (outcome): OperationalOutcome =>
        outcome === 'none' ? 'noChange' : outcome,
    })
    yield* Effect.annotateCurrentSpan({
      'astro.executor.work.outcome': outcome,
    })
    yield* recordOperationalEvent({
      scope: 'executor',
      operation: 'work.execute',
      outcome,
    })
    return result
  }).pipe(
    Effect.withSpan('RunExecutor.work.execute', {
      attributes: {
        'astro.workspace': 'observe',
        'astro.executor.work.kind': kind,
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
