import { Effect, Exit, Metric, Schema } from 'effect'
import {
  Command,
  CommandEnvelope,
  ProcessingAction,
} from '@astro-console/v2-contracts'
import type {
  ProcessWorkPassResult,
  ProcessWorkKind,
  ProcessWorkStage,
} from '../workers/process-work-worker.ts'

type ProcessOperation = 'workspace.open' | 'command.execute'
type ProcessCommandIntent = typeof ProcessingAction.Type
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
  'workspace.open': 'Process.workspace.open',
  'command.execute': 'Process.command.execute',
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

export function annotateProcessCommandIntent(
  intent: ProcessCommandIntent,
  selection: 'recommended' | 'direct' | 'notApplicable' = 'notApplicable',
) {
  return Effect.annotateCurrentSpan({
    'astro.command.intent': intent,
    'astro.process.selection': selection,
  })
}

export function processCommandSelection(raw: unknown) {
  try {
    const envelope = Schema.decodeUnknownSync(CommandEnvelope)(raw)
    return Command.guards.StartProcessingSession(envelope.command)
      ? envelope.command.selection === 'recommended'
        ? ('recommended' as const)
        : ('direct' as const)
      : ('notApplicable' as const)
  } catch {
    return 'notApplicable' as const
  }
}

export function tracedProcessWorker<E, R>(
  kind: ProcessWorkKind,
  stage: ProcessWorkStage,
  effect: Effect.Effect<ProcessWorkPassResult, E, R>,
) {
  const attributes = {
    'astro.process.phase':
      kind === 'build'
        ? 'build'
        : kind === 'save' || kind === 'cleanup'
          ? 'session'
          : 'develop',
    'astro.process.work': kind,
    'astro.process.stage': stage,
    'astro.process.retry': kind === 'retry' ? 'retry' : 'initial',
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
    const checkpointState =
      Exit.isSuccess(result) && result.value.outcome === 'checkpointed'
        ? 'created'
        : kind === 'retry' &&
            Exit.isSuccess(result) &&
            result.value.outcome === 'completed'
          ? 'reused'
          : 'unavailable'
    const measured = {
      ...attributes,
      'astro.process.outcome': outcome,
    }
    yield* Effect.annotateCurrentSpan({
      'astro.process.outcome': outcome,
      'astro.process.checkpoint.state': checkpointState,
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

export function processCommandIntent(raw: unknown) {
  try {
    const envelope = Schema.decodeUnknownSync(CommandEnvelope)(raw)
    return Schema.decodeUnknownSync(ProcessingAction)(envelope.command._tag)
  } catch {
    return undefined
  }
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
