import { Effect, Exit, Metric } from 'effect'
import type {
  ProcessWorkPassResult,
  ProcessWorkKind,
  ProcessWorkStage,
} from '../workers/process-work-worker.ts'

type ProcessOperation = 'project.read' | 'project.change'
const workCount = Metric.counter('astro.process.work.count', {
  incremental: true,
  description: 'Settled Process worker passes',
})
const workDuration = Metric.histogram('astro.process.work.duration', {
  description: 'Process worker pass duration in seconds',
  attributes: { unit: 's' },
  boundaries: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
})
const backlogCount = Metric.gauge('astro.process.backlog.count', {
  description: 'Actionable durable Process work count',
})
const backlogAge = Metric.gauge('astro.process.backlog.oldest.age', {
  description: 'Oldest actionable Process work age in seconds',
  attributes: { unit: 's' },
})
const pressureGauge = Metric.gauge('astro.process.pressure', {
  description: 'Current measured Process pressure state',
})

const operationSpanNames: Record<ProcessOperation, string> = {
  'project.read': 'Process.project.read',
  'project.change': 'Process.project.change',
}

export function tracedProcessOperation<A, E, R>(
  response: { readonly statusCode: number; readonly headersSent?: boolean },
  operation: ProcessOperation,
  effect: Effect.Effect<A, E, R>,
) {
  const traced = Effect.gen(function* () {
    const result = yield* effect.pipe(Effect.exit)
    yield* Effect.annotateCurrentSpan({
      'astro.process.outcome': Exit.match(result, {
        onFailure: () => 'unavailable',
        onSuccess: () => outcomeFor(response),
      }),
    })
    return result
  }).pipe(
    Effect.withSpan(operationSpanNames[operation], {
      attributes: {
        'astro.workspace': 'process',
        'astro.process.operation': operation,
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

export function tracedProcessWorker<E, R>(
  kind: ProcessWorkKind,
  stage: ProcessWorkStage,
  effect: Effect.Effect<ProcessWorkPassResult, E, R>,
) {
  const attributes = {
    'astro.process.phase': stage.toLowerCase(),
    'astro.process.work': kind,
    'astro.process.stage': stage,
    'astro.process.adapter': 'deterministic-file-v1',
    'astro.process.pressure': 'normal',
  }
  return Effect.gen(function* () {
    const startedAt = performance.now()
    const result = yield* effect.pipe(Effect.exit)
    const outcome = Exit.isSuccess(result)
      ? result.value.outcome === 'claimedUnresolved'
        ? 'unavailable'
        : result.value.outcome
      : 'unavailable'
    const measured = {
      ...attributes,
      'astro.process.outcome': outcome,
    }
    yield* Effect.annotateCurrentSpan({
      'astro.process.outcome': outcome,
    })
    yield* Effect.all([
      Metric.update(Metric.withAttributes(workCount, measured), 1),
      Metric.update(
        Metric.withAttributes(workDuration, measured),
        Math.max(0, performance.now() - startedAt) / 1_000,
      ),
    ])
    return result
  }).pipe(
    Effect.withSpan('Process.worker.execute', { attributes }),
    Effect.flatMap(
      Exit.match({ onFailure: Effect.failCause, onSuccess: Effect.succeed }),
    ),
  )
}

export function recordProcessBacklog(count: number, oldestAgeSeconds: number) {
  const attributes = { 'astro.process.work': 'backlog' }
  return Effect.all([
    Metric.update(Metric.withAttributes(backlogCount, attributes), count),
    Metric.update(
      Metric.withAttributes(backlogAge, attributes),
      oldestAgeSeconds,
    ),
  ])
}

export function recordProcessPressureMetric(
  state: 'normal' | 'throttled' | 'paused',
) {
  return Metric.update(
    Metric.withAttributes(pressureGauge, {
      'astro.process.pressure': state,
    }),
    1,
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
