import { Effect, Exit, Match } from 'effect'
import { recordOperationalEvent } from './operational-telemetry.ts'
import type { OperationalOutcome } from './operational-telemetry.ts'

export function tracedPlateSolve<A extends PlateSolveResult, E, R>(
  effect: Effect.Effect<A, E, R>,
) {
  return tracedPipelineOperation(
    'PlateSolve.execute',
    'plateSolve',
    effect,
    (value) =>
      value.outcome === 'recorded'
        ? value.result === 'Solved'
          ? 'recorded.solved'
          : 'recorded.noSolution'
        : `rejected.${value.reason}`,
  )
}

export function tracedFrameIntake<A extends FrameIntakeResult, E, R>(
  effect: Effect.Effect<A, E, R>,
) {
  return tracedPipelineOperation(
    'FrameIntake.materialize',
    'frameIntake',
    effect,
    (value) =>
      value.outcome === 'accepted' ? 'accepted' : `rejected.${value.reason}`,
  )
}

export function tracedFrameInspection<
  A extends {
    readonly inspection:
      | { readonly _tag: 'Available' }
      | { readonly _tag: 'Unavailable' }
      | { readonly _tag: 'Failed' }
  },
  E,
  R,
>(effect: Effect.Effect<A, E, R>) {
  return tracedPipelineOperation(
    'FrameInspection.inspect',
    'frameInspection',
    effect,
    (value) =>
      Match.value(value.inspection).pipe(
        Match.tag('Available', () => 'available' as const),
        Match.tag('Unavailable', () => 'unavailable' as const),
        Match.tag('Failed', () => 'failed' as const),
        Match.exhaustive,
      ),
  )
}

export function tracedPublisherWork(run: () => Promise<PublisherWorkResult>) {
  return tracedPipelineOperation(
    'Publisher.work.publish',
    'publisher',
    Effect.tryPromise({ try: run, catch: (cause) => cause }),
    (value) => value,
  )
}

export function tracedPipelineStage<A>(
  stage: PipelineStage,
  run: () => Promise<A>,
) {
  return tracedPipelineOperation(
    pipelineStageSpanNames[stage],
    stage,
    Effect.tryPromise({ try: run, catch: (cause) => cause }),
    () => 'success',
  )
}

function tracedPipelineOperation<A, E, R, O extends PipelineOutcome>(
  spanName: string,
  operation: PipelineOperation,
  effect: Effect.Effect<A, E, R>,
  outcome: (value: A) => O,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    const operationOutcome: OperationalOutcome = Exit.match(result, {
      onFailure: () => 'unavailable' as const,
      onSuccess: (value): OperationalOutcome => outcome(value),
    })
    yield* Effect.annotateCurrentSpan({
      'astro.pipeline.outcome': operationOutcome,
    })
    yield* recordOperationalEvent({
      scope: 'pipeline',
      operation,
      outcome: operationOutcome,
    })
    return result
  }).pipe(
    Effect.withSpan(spanName, {
      attributes: { 'astro.pipeline.operation': operation },
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

type PipelineOperation =
  'plateSolve' | 'frameIntake' | 'frameInspection' | 'publisher' | PipelineStage
export type PipelineStage =
  | 'plateSolve.execute'
  | 'publisher.localRead'
  | 'publisher.put'
  | 'publisher.verify'
  | 'publisher.settle'
const pipelineStageSpanNames: Record<PipelineStage, string> = {
  'plateSolve.execute': 'PlateSolve.external.execute',
  'publisher.localRead': 'Publisher.local.read',
  'publisher.put': 'Publisher.provider.put',
  'publisher.verify': 'Publisher.provider.verify',
  'publisher.settle': 'Publisher.work.settle',
}
type PlateSolveResult =
  | { readonly outcome: 'recorded'; readonly result: 'Solved' | 'NoSolution' }
  | {
      readonly outcome: 'rejected'
      readonly reason:
        | 'SourceUnavailable'
        | 'SourceHintsUnavailable'
        | 'SourceFormatUnsupported'
        | 'SolveNotExpected'
    }
type FrameIntakeResult =
  | { readonly outcome: 'accepted' }
  | {
      readonly outcome: 'rejected'
      readonly reason: 'InvalidInput' | 'MaterializationFailed'
    }
export type PublisherWorkResult = 'published' | 'failed' | 'superseded'
type PipelineOutcome =
  | 'recorded.solved'
  | 'recorded.noSolution'
  | `rejected.${
      | 'SourceUnavailable'
      | 'SourceHintsUnavailable'
      | 'SourceFormatUnsupported'
      | 'SolveNotExpected'
      | 'InvalidInput'
      | 'MaterializationFailed'}`
  | 'accepted'
  | 'available'
  | 'unavailable'
  | 'failed'
  | PublisherWorkResult
  | 'success'
