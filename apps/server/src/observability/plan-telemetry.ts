import { Effect, Exit } from 'effect'

export type PlanCommandIntent =
  | 'SaveDraft'
  | 'AcceptRunDefinition'
  | 'StartAcceptedRun'
  | 'PreviewRunMutation'
  | 'ApplyRunMutation'
  | 'ApproveDisruptiveRunMutation'

type PlanCommandStage = 'applyIntent' | 'publishChange' | 'readSnapshot'

const stageSpanNames: Record<PlanCommandStage, string> = {
  applyIntent: 'Plan.command.applyIntent',
  publishChange: 'Plan.command.publishChange',
  readSnapshot: 'Plan.command.readSnapshot',
}

export function tracedPlanWorkspaceRead<A, E, R>(
  effect: Effect.Effect<A, E, R>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.plan.read.outcome': Exit.isSuccess(result) ? 'served' : 'failed',
    })
    return result
  }).pipe(
    Effect.withSpan('Plan.workspace.read', {
      attributes: { 'astro.workspace': 'plan' },
    }),
  )
  return restoreExit(traced)
}

export function tracedPlanCommand<A extends { readonly status: number }, E, R>(
  effect: Effect.Effect<A, E, R>,
  intent: PlanCommandIntent,
) {
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
    Effect.withSpan('Plan.command.execute', {
      attributes: {
        'astro.workspace': 'plan',
        'astro.command.intent': intent,
      },
    }),
  )
  return restoreExit(traced)
}

export function tracedPlanCommandStage<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  stage: PlanCommandStage,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.plan.stage.outcome': Exit.isSuccess(result)
        ? 'success'
        : 'failure',
    })
    return result
  }).pipe(
    Effect.withSpan(stageSpanNames[stage], {
      attributes: {
        'astro.workspace': 'plan',
        'astro.plan.stage': stage,
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
