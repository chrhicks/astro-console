import { openOriginDatabase } from './database.ts'
import type { RigWorkerConfig } from './rig-worker-config.ts'
import {
  createSeestarSolarAdapter,
  type SolarTestAdapter,
} from './seestar-solar-adapter.ts'
import { Cause, Effect, Exit, Schedule } from 'effect'
import { rigWorkerEnvironmentConfig } from './environment-config.ts'
import { runExecutable } from './executable.ts'
import { createSolarWorkService } from './solar-work-service.ts'

type DispatchResult =
  | 'providerAcknowledged'
  | 'uncertain'
  | 'dispatched'
  | 'failed'
  | 'none'
  | 'superseded'
type WorkerResult = DispatchResult | 'disabled' | 'unavailable'

export function createRigWorkerService(
  config: RigWorkerConfig,
  adapter: SolarTestAdapter | undefined,
  options: {
    readonly workerId?: string
    readonly pollIntervalMs?: number
    readonly now?: () => Date
  } = {},
) {
  const workerId = options.workerId ?? 'rig-worker'
  const pollIntervalMs = options.pollIntervalMs ?? 1_000
  if (
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs < 100 ||
    pollIntervalMs > 60_000
  )
    throw new Error('Rig worker poll interval must be between 100 and 60000 ms')
  const now = options.now ?? (() => new Date())
  if (config.mode === 'disabled') return disabledWorker(config.databasePath)
  const database = openOriginDatabase(config.databasePath)
  const service = createSolarWorkService(database)
  let closed = false
  const adapterState =
    adapter === undefined ? ('unconfigured' as const) : ('ready' as const)
  let currentHealth: {
    readonly mode: 'seestar'
    readonly status: 'unknown' | 'alive' | 'stopped'
    readonly adapter: 'ready' | 'unconfigured'
    readonly lastHeartbeat?: string
  } = { mode: config.mode, status: 'unknown', adapter: adapterState }
  const heartbeat = (state: 'alive' | 'stopped') => {
    const observedAt = now().toISOString()
    database
      .prepare(
        'INSERT INTO worker_status (worker_id,state,adapter_state,last_heartbeat) VALUES (?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET state=excluded.state,adapter_state=excluded.adapter_state,last_heartbeat=excluded.last_heartbeat',
      )
      .run(workerId, state, adapterState, observedAt)
    currentHealth = {
      mode: config.mode,
      status: state,
      adapter: adapterState,
      lastHeartbeat: observedAt,
    }
    return observedAt
  }
  const health = () => currentHealth
  const runOnce = async (): Promise<WorkerResult> => {
    if (closed) return 'disabled'
    heartbeat('alive')
    if (adapter === undefined) return 'unavailable'
    const start = await Effect.runPromise(
      service.dispatchStart(adapter, workerId),
    )
    if (start !== 'none') return start
    return Effect.runPromise(service.dispatchStop(adapter, workerId))
  }
  const close = () => {
    if (closed) return
    closed = true
    heartbeat('stopped')
    adapter?.close()
    database.close()
  }
  const run = async (
    runOptions: {
      readonly maxPasses?: number
      readonly signal?: AbortSignal
    } = {},
  ) => {
    const maxPasses = runOptions.maxPasses
    if (
      maxPasses !== undefined &&
      (!Number.isInteger(maxPasses) || maxPasses < 1)
    )
      throw new Error('Rig worker max passes must be a positive integer')
    let passes = 0
    return Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () => Effect.sync(close))
          const pass = Effect.promise(async () => {
            await runOnce()
            passes += 1
          })
          const schedule =
            maxPasses === undefined
              ? Schedule.spaced(`${pollIntervalMs} millis`)
              : Schedule.spaced(`${pollIntervalMs} millis`).pipe(
                  Schedule.upTo({ times: maxPasses - 1 }),
                )
          const exit = yield* Effect.promise(() =>
            Effect.runPromiseExit(Effect.repeat(pass, schedule), {
              signal: runOptions.signal,
            }),
          )
          if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause))
            throw Cause.squash(exit.cause)
          yield* Effect.sync(close)
          return { passes, health: health() }
        }),
      ),
    )
  }
  return {
    runOnce,
    run,
    health,
    close,
    recordSolarStackEvidence: (
      intentId: string,
      event: unknown,
      observedAt: string,
    ) =>
      Effect.runSync(service.recordStackEvidence(intentId, event, observedAt)),
  }
}

export async function runRigWorker(config: RigWorkerConfig) {
  const stackReceiver: {
    recordStack?: (
      intentId: string,
      event: unknown,
      observedAt: string,
    ) => boolean
  } = {}
  const adapter =
    config.mode === 'disabled'
      ? undefined
      : createSeestarSolarAdapter(config, {
          onStack: (intentId, event, observedAt) => {
            stackReceiver.recordStack?.(intentId, event, observedAt)
          },
        })
  const worker = createRigWorkerService(config, adapter)
  stackReceiver.recordStack = worker.recordSolarStackEvidence
  if (config.mode === 'disabled') return worker.run()
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    return await worker.run({ signal: controller.signal })
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

function disabledWorker(databasePath: string) {
  const health = () => ({
    mode: 'disabled' as const,
    status: 'disabled' as const,
    databasePath,
  })
  return {
    runOnce: async (): Promise<WorkerResult> => 'disabled',
    run: async () => ({ passes: 0, health: health() }),
    health,
    close: () => undefined,
    recordSolarStackEvidence: () => false,
  }
}

if (process.argv[1]?.endsWith('rig-worker.ts')) {
  runExecutable('rig worker', async () => {
    const result = await Effect.runPromise(rigWorkerEnvironmentConfig)
    const completed = await runRigWorker(result)
    console.log(`Astro rig worker stopped after ${completed.passes} passes`)
  })
}
