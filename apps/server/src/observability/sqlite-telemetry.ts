import { Effect, Exit, Metric } from 'effect'

export type SqliteOperation =
  | 'executor.work.select'
  | 'executor.work.settle'
  | 'publisher.outbox.claim'
  | 'publisher.outbox.settle'
  | 'projection.snapshot.read'
  | 'command.state.transaction'

export type SqliteBacklog = 'executor' | 'publisher'

export type SqliteTraceSync = <A>(operation: SqliteOperation, run: () => A) => A

export type SqliteBacklogObserver = (
  backlog: SqliteBacklog,
  count: number,
) => void

const operationCount = Metric.counter('astro.sqlite.operation.count', {
  incremental: true,
  description: 'Completed app-owned SQLite operations',
})
const operationDuration = Metric.histogram('astro.sqlite.operation.duration', {
  description: 'App-owned SQLite operation duration in seconds',
  attributes: { unit: 's' },
  boundaries: [
    0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1,
    2.5, 5,
  ],
})
const backlogGauge = Metric.gauge('astro.sqlite.backlog', {
  description: 'Current actionable app-owned SQLite work backlog',
})

const operationDefinitions = {
  'executor.work.select': {
    span: 'SQLite.executor.work.select',
    operation: 'SELECT',
    summary: 'executor work selection',
    collection: 'run_executor_work',
  },
  'executor.work.settle': {
    span: 'SQLite.executor.work.settle',
    operation: 'UPDATE',
    summary: 'executor work settlement',
    collection: 'run_executor_work',
  },
  'publisher.outbox.claim': {
    span: 'SQLite.publisher.outbox.claim',
    operation: 'TRANSACTION',
    summary: 'publisher outbox claim',
    collection: 'outbox',
  },
  'publisher.outbox.settle': {
    span: 'SQLite.publisher.outbox.settle',
    operation: 'TRANSACTION',
    summary: 'publisher outbox settlement',
    collection: 'outbox',
  },
  'projection.snapshot.read': {
    span: 'SQLite.projection.snapshot.read',
    operation: 'SELECT',
    summary: 'projection snapshot read',
    collection: 'state',
  },
  'command.state.transaction': {
    span: 'SQLite.command.state.transaction',
    operation: 'TRANSACTION',
    summary: 'command state transaction',
  },
} as const satisfies Record<
  SqliteOperation,
  {
    readonly span: string
    readonly operation: 'SELECT' | 'UPDATE' | 'TRANSACTION'
    readonly summary: string
    readonly collection?: string
  }
>

type SqliteOutcome =
  'success' | 'busy' | 'locked' | 'constraint' | 'unavailable'

export function tracedSqliteOperation<A, E, R>(
  operation: SqliteOperation,
  effect: Effect.Effect<A, E, R>,
) {
  const definition = operationDefinitions[operation]
  const attributes = {
    'db.system.name': 'sqlite',
    'db.operation.name': definition.operation,
    'db.query.summary': definition.summary,
    ...('collection' in definition
      ? { 'db.collection.name': definition.collection }
      : {}),
  }
  const traced = Effect.gen(function* () {
    const startedAt = performance.now()
    const result = yield* effect.pipe(Effect.exit)
    const durationSeconds = Math.max(0, performance.now() - startedAt) / 1_000
    const outcome: SqliteOutcome = Exit.isSuccess(result)
      ? 'success'
      : sqliteFailureOutcome(result.cause)
    const metricAttributes = {
      ...attributes,
      'astro.sqlite.outcome': outcome,
    }
    yield* Effect.annotateCurrentSpan({
      'astro.sqlite.outcome': outcome,
    })
    yield* Effect.all([
      Metric.update(Metric.withAttributes(operationCount, metricAttributes), 1),
      Metric.update(
        Metric.withAttributes(operationDuration, metricAttributes),
        durationSeconds,
      ),
    ])
    return result
  }).pipe(
    Effect.withSpan(definition.span, {
      attributes,
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

export function recordSqliteBacklog(backlog: SqliteBacklog, count: number) {
  const collection = backlog === 'executor' ? 'run_executor_work' : 'outbox'
  return Metric.update(
    Metric.withAttributes(backlogGauge, {
      'db.system.name': 'sqlite',
      'db.collection.name': collection,
      'astro.sqlite.backlog': backlog,
    }),
    Math.max(0, Math.trunc(count)),
  )
}

function sqliteFailureOutcome(
  cause: unknown,
): Exclude<SqliteOutcome, 'success'> {
  const diagnostic = String(cause)
  if (/SQLITE_BUSY|database is busy/i.test(diagnostic)) return 'busy'
  if (/SQLITE_LOCKED|database is locked/i.test(diagnostic)) return 'locked'
  if (/SQLITE_CONSTRAINT|constraint failed/i.test(diagnostic))
    return 'constraint'
  return 'unavailable'
}
