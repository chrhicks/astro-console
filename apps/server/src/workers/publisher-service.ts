import { openPublisherDatabase } from '../persistence/database.ts'
import type { R2PublisherConfig } from '../config/publisher-config.ts'
import { createR2Provider } from '../storage/r2-provider.ts'
import { createPublisherWorker } from './publisher-worker.ts'
import { Effect } from 'effect'
import { publisherEnvironmentConfig } from '../config/environment-config.ts'
import { runExecutable } from '../app/executable.ts'
import { createOriginTelemetry } from '../observability/origin-telemetry.ts'
import {
  tracedPipelineStage,
  tracedPublisherWork,
} from '../observability/pipeline-telemetry.ts'
import {
  recordSqliteBacklog,
  tracedSqliteOperation,
} from '../observability/sqlite-telemetry.ts'

export async function runPublisher(config: R2PublisherConfig) {
  const database = openPublisherDatabase(config.databasePath)
  const telemetry = createOriginTelemetry()
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    await telemetry.initialize()
    const worker = createPublisherWorker(
      database,
      { outputsRoot: config.outputsRoot },
      createR2Provider(config),
      {
        traceWork: (run) => telemetry.runPromise(tracedPublisherWork(run)),
        traceStage: (stage, run) =>
          telemetry.runPromise(tracedPipelineStage(stage, run)),
        traceSqlite: (operation, run) =>
          telemetry.runSync(
            tracedSqliteOperation(
              operation,
              Effect.try({ try: run, catch: (cause) => cause }),
            ),
          ),
        observeSqliteBacklog: (backlog, count) =>
          telemetry.runSync(recordSqliteBacklog(backlog, count)),
      },
    )
    while (!controller.signal.aborted) {
      try {
        await worker.pass()
      } catch (error) {
        if (!isSqliteBusy(error)) throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await telemetry.dispose()
    database.close()
  }
}

export function isSqliteBusy(error: unknown) {
  return (
    error instanceof Error &&
    /(?:SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy)/i.test(
      error.message,
    )
  )
}

if (process.argv[1]?.endsWith('./publisher-service.ts'))
  runExecutable('publisher', async () =>
    runPublisher(await Effect.runPromise(publisherEnvironmentConfig)),
  )
