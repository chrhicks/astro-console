import { Effect, Exit } from 'effect'

export type ObserveCommandIntent =
  | 'PauseRun'
  | 'ResumeRun'
  | 'StopRun'
  | 'SkipSequence'
  | 'RetryPhase'
  | 'RequestPark'

type ObserveCommandStage = 'applyIntent' | 'publishChange' | 'readSnapshot'

const stageSpanNames: Record<ObserveCommandStage, string> = {
  applyIntent: 'Observe.command.applyIntent',
  publishChange: 'Observe.command.publishChange',
  readSnapshot: 'Observe.command.readSnapshot',
}

export function tracedObserveCommand<
  A extends { readonly status: number },
  E,
  R,
>(effect: Effect.Effect<A, E, R>, intent: ObserveCommandIntent) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.command.outcome': Exit.match(result, {
        onFailure: () => 'unavailable',
        onSuccess: ({ status }) =>
          status >= 200 && status < 300 ? 'accepted' : 'rejected',
      }),
    })
    return result
  }).pipe(
    Effect.withSpan('Observe.command.execute', {
      attributes: {
        'astro.workspace': 'observe',
        'astro.command.intent': intent,
      },
    }),
  )
  return restoreExit(traced)
}

export function tracedObserveCommandStage<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  stage: ObserveCommandStage,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.observe.stage.outcome': Exit.isSuccess(result)
        ? 'success'
        : 'failure',
    })
    return result
  }).pipe(
    Effect.withSpan(stageSpanNames[stage], {
      attributes: {
        'astro.workspace': 'observe',
        'astro.observe.stage': stage,
      },
    }),
  )
  return restoreExit(traced)
}

function restoreExit<A, E, R>(
  effect: Effect.Effect<Exit.Exit<A, E>, never, R>,
) {
  return effect.pipe(
    Effect.flatMap(
      Exit.match({
        onFailure: Effect.failCause,
        onSuccess: Effect.succeed,
      }),
    ),
  )
}
