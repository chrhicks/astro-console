import { DatabaseSync } from 'node:sqlite'
import { Effect, Exit, Schema } from 'effect'
import {
  CameraExposureObservation,
  RunDefinition,
} from '@astro-console/v2-contracts'
import type { StateSqliteRepositoryShape } from '../persistence/state-sqlite-repository.ts'
import type {
  CameraProviderCommandOutcome,
  CameraProviderShape,
} from '../services/camera-command-service.ts'
import type { Run } from '../services/domain-state.ts'

const WorkRow = Schema.Struct({
  work_id: Schema.String,
  run_id: Schema.String,
  kind: Schema.Literals(['BeginRun', 'StartExposure', 'AbortExposure']),
  payload: Schema.String,
  state: Schema.Literals([
    'pending',
    'commandAttempted',
    'observing',
    'reconciling',
  ]),
})
const DefinitionRow = Schema.Struct({ definition: Schema.String })
const StoredDefinition = Schema.Struct({
  id: Schema.String,
  definition: RunDefinition,
  plan: Schema.Unknown,
})
const StartPayload = Schema.Struct({
  sequenceIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  durationSeconds: Schema.optionalKey(
    Schema.Finite.check(Schema.isGreaterThan(0)),
  ),
})

export type RunExecutorPassResult =
  | 'none'
  | 'waitingPreflight'
  | 'acquireRequired'
  | 'captureReady'
  | 'observing'
  | 'verified'
  | 'aborted'
  | 'rejected'
  | 'reconciling'

export const createRunExecutorWorker = (options: {
  readonly database: DatabaseSync
  readonly stateRepository: StateSqliteRepositoryShape
  readonly cameraProvider: CameraProviderShape
  readonly now?: () => Date
  readonly publish?: (type: string, cursor: number) => void
}) => {
  const db = options.database
  const now = options.now ?? (() => new Date())

  const pass = async (): Promise<RunExecutorPassResult> => {
    const raw: unknown = db
      .prepare(
        "SELECT work_id,run_id,kind,payload,state FROM run_executor_work WHERE state IN ('pending','commandAttempted','observing','reconciling') ORDER BY CASE WHEN kind='AbortExposure' THEN 0 ELSE 1 END,rowid LIMIT 1",
      )
      .get()
    const row = Schema.decodeUnknownSync(Schema.optional(WorkRow))(raw)
    if (row === undefined) return 'none'
    if (row.kind === 'BeginRun') return beginRun(row)
    if (row.state === 'pending') {
      const run = options.stateRepository.state().run
      if (row.kind === 'StartExposure' && run?.phase !== 'capture') {
        cancelPending(row.work_id, 'The run is no longer in Capture.')
        return 'none'
      }
      const attemptedAt = now().toISOString()
      const marked = db
        .prepare(
          "UPDATE run_executor_work SET state='commandAttempted',command_attempted_at=?,last_error=NULL WHERE work_id=? AND state='pending'",
        )
        .run(attemptedAt, row.work_id)
      if (marked.changes !== 1) return 'none'
      const payload = Schema.decodeUnknownSync(StartPayload)(
        JSON.parse(row.payload),
      )
      const command =
        row.kind === 'StartExposure'
          ? options.cameraProvider.startExposure(
              payload.durationSeconds ?? invalidDuration(),
            )
          : options.cameraProvider.abortExposure()
      const acknowledgement = await Effect.runPromise(command.pipe(Effect.exit))
      if (Exit.isFailure(acknowledgement)) {
        commitWorkTransition({
          runId: row.run_id,
          phase: 'recover',
          eventType: 'RunProviderOutcomeUnknown',
          updateWork: () =>
            markForReconciliation(row.work_id, acknowledgement.cause),
        })
        return 'reconciling'
      }
      const outcome = acknowledgement.value
      if (isRejected(outcome)) {
        commitWorkTransition({
          runId: row.run_id,
          phase: 'recover',
          eventType: 'RunProviderCommandRejected',
          updateWork: () => settle(row.work_id, 'rejected', outcome.summary),
        })
        return 'rejected'
      }
      db.prepare(
        "UPDATE run_executor_work SET acknowledged_at=?,last_error=NULL WHERE work_id=? AND state='commandAttempted'",
      ).run(now().toISOString(), row.work_id)
    }
    return reconcile(row)
  }

  const beginRun = (row: typeof WorkRow.Type): RunExecutorPassResult => {
    const run = options.stateRepository.state().run
    if (run?.id !== row.run_id || run.phase !== 'preflight') {
      cancelPending(
        row.work_id,
        'The run is no longer available for BeginRun execution.',
      )
      return 'none'
    }
    if (
      (run.preflight?.verdict !== 'ready' &&
        run.preflight?.verdict !== 'unknown') ||
      run.preflight.checks.some(
        (check) => check.key === 'camera-connected' && check.state !== 'ready',
      ) ||
      !run.preflight.checks.some(
        (check) => check.key === 'camera-connected' && check.state === 'ready',
      )
    ) {
      db.prepare(
        "UPDATE run_executor_work SET last_error='Current preflight is not ready.' WHERE work_id=? AND state='pending'",
      ).run(row.work_id)
      return 'waitingPreflight'
    }
    const payload = Schema.decodeUnknownSync(StartPayload)(
      JSON.parse(row.payload),
    )
    const definition = readDefinition(run)
    const sequence = definition.sequences[payload.sequenceIndex]
    if (
      definition.sequences.length !== 1 ||
      sequence === undefined ||
      sequence.acquisitionMode !== 'cameraOnly' ||
      sequence.frameCount !== 1 ||
      sequence.exposureSeconds > 60
    ) {
      commitWorkTransition({
        runId: row.run_id,
        phase: 'recover',
        eventType: 'RunDefinitionUnavailable',
        updateWork: () =>
          settle(
            row.work_id,
            'rejected',
            'This executor milestone requires exactly one camera-only sequence with one frame and an exposure of at most 60 seconds.',
          ),
      })
      return 'rejected'
    }
    db.exec('BEGIN IMMEDIATE')
    let published: { readonly type: string; readonly cursor: number }
    const result = 'captureReady' as const
    try {
      const next = nextRun(run, 'capture', 25)
      published = commitRun(next, 'RunCaptureReady')
      db.prepare(
        "INSERT INTO run_executor_work (work_id,run_id,kind,payload,state) VALUES (?,?,?,?, 'pending')",
      ).run(
        `${run.id}:sequence:${payload.sequenceIndex}:exposure`,
        run.id,
        'StartExposure',
        JSON.stringify({
          sequenceIndex: payload.sequenceIndex,
          durationSeconds: sequence.exposureSeconds,
        }),
      )
      db.prepare(
        "UPDATE run_executor_work SET state='completed',settled_at=?,last_error=NULL WHERE work_id=? AND state='pending'",
      ).run(now().toISOString(), row.work_id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    options.publish?.(published.type, published.cursor)
    return result
  }

  const reconcile = async (
    row: typeof WorkRow.Type,
  ): Promise<RunExecutorPassResult> => {
    const observation = await Effect.runPromise(
      options.cameraProvider
        .readState()
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(CameraExposureObservation)),
          Effect.exit,
        ),
    )
    if (Exit.isFailure(observation)) {
      commitWorkTransition({
        runId: row.run_id,
        phase: 'recover',
        eventType: 'RunReconciliationUnavailable',
        updateWork: () => markForReconciliation(row.work_id, observation.cause),
      })
      return 'reconciling'
    }
    if (observation.value.cameraState === 'idle') {
      if (row.kind === 'StartExposure' && row.state !== 'observing') {
        commitWorkTransition({
          runId: row.run_id,
          observation: observation.value,
          phase: 'recover',
          eventType: 'RunReconciliationUnavailable',
          updateWork: () =>
            markForReconciliation(
              row.work_id,
              new Error(
                'Camera returned idle before this work observed an active exposure.',
              ),
            ),
        })
        return 'reconciling'
      }
      if (row.kind === 'AbortExposure') {
        commitWorkTransition({
          runId: row.run_id,
          observation: observation.value,
          phase: 'recover',
          eventType: 'RunExposureAbortObserved',
          updateWork: () => {
            settle(row.work_id, 'completed')
            db.prepare(
              "UPDATE run_executor_work SET state='completed',settled_at=?,last_error='Exposure abort was observed.' WHERE run_id=? AND kind='StartExposure' AND state IN ('commandAttempted','observing','reconciling')",
            ).run(now().toISOString(), row.run_id)
          },
        })
        return 'aborted'
      }
      commitWorkTransition({
        runId: row.run_id,
        observation: observation.value,
        phase: 'verify',
        progress: 75,
        eventType: 'RunExposureCompletionObserved',
        updateWork: () => settle(row.work_id, 'completed'),
      })
      return 'verified'
    }
    if (
      observation.value.cameraState === 'waiting' ||
      observation.value.cameraState === 'exposing' ||
      observation.value.cameraState === 'reading' ||
      observation.value.cameraState === 'download'
    ) {
      if (row.state === 'observing') return 'observing'
      commitWorkTransition({
        runId: row.run_id,
        observation: observation.value,
        phase: 'capture',
        progress: 50,
        eventType: 'RunExposureObserved',
        updateWork: () =>
          db
            .prepare(
              "UPDATE run_executor_work SET state='observing',last_error=NULL WHERE work_id=?",
            )
            .run(row.work_id),
      })
      return 'observing'
    }
    commitWorkTransition({
      runId: row.run_id,
      observation: observation.value,
      phase: 'recover',
      eventType: 'RunReconciliationUnavailable',
      updateWork: () =>
        markForReconciliation(
          row.work_id,
          new Error(
            `Unexpected camera state ${observation.value.cameraState}.`,
          ),
        ),
    })
    return 'reconciling'
  }

  const enqueueAbort = (runId: string) => {
    db.prepare(
      "INSERT OR IGNORE INTO run_executor_work (work_id,run_id,kind,payload,state) VALUES (?,?,?,?, 'pending')",
    ).run(
      `${runId}:abort`,
      runId,
      'AbortExposure',
      JSON.stringify({ sequenceIndex: 0 }),
    )
  }

  const readDefinition = (run: Run) => {
    if (run.sourceDefinitionId === undefined)
      throw new Error('The active run has no accepted definition.')
    const row = Schema.decodeUnknownSync(DefinitionRow)(
      db
        .prepare(
          'SELECT definition FROM run_definitions WHERE run_definition_id=?',
        )
        .get(run.sourceDefinitionId),
    )
    return Schema.decodeUnknownSync(StoredDefinition)(
      JSON.parse(row.definition),
    ).definition
  }

  const commitWorkTransition = (input: {
    readonly runId: string
    readonly observation?: typeof CameraExposureObservation.Type
    readonly phase: Run['phase']
    readonly eventType: string
    readonly progress?: number
    readonly updateWork: () => unknown
  }) => {
    db.exec('BEGIN IMMEDIATE')
    let published:
      { readonly type: string; readonly cursor: number } | undefined
    try {
      if (input.observation !== undefined)
        db.prepare(
          'INSERT OR REPLACE INTO camera_observations (run_id,observation) VALUES (?,?)',
        ).run(input.runId, JSON.stringify(input.observation))
      input.updateWork()
      const run = options.stateRepository.state().run
      if (
        run?.id === input.runId &&
        run.phase !== 'paused' &&
        run.phase !== 'stopped' &&
        (run.phase !== input.phase || input.progress !== undefined)
      )
        published = commitRun(
          nextRun(run, input.phase, input.progress ?? run.progress),
          input.eventType,
        )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    if (published !== undefined)
      options.publish?.(published.type, published.cursor)
  }

  const commitRun = (run: Run, eventType: string) => {
    const current = options.stateRepository.state()
    const cursor = current.eventCursor + 1
    options.stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run,
    })
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      eventType,
      JSON.stringify({ run }),
    )
    return { type: eventType, cursor }
  }

  const markForReconciliation = (workId: string, cause: unknown) =>
    db
      .prepare(
        "UPDATE run_executor_work SET state='reconciling',last_error=? WHERE work_id=?",
      )
      .run(boundedDiagnostic(cause), workId)

  const settle = (
    workId: string,
    state: 'completed' | 'rejected',
    error?: string,
  ) =>
    db
      .prepare(
        'UPDATE run_executor_work SET state=?,settled_at=?,last_error=? WHERE work_id=?',
      )
      .run(state, now().toISOString(), error ?? null, workId)

  const cancelPending = (workId: string, reason: string) =>
    db
      .prepare(
        "UPDATE run_executor_work SET state='cancelled',settled_at=?,last_error=? WHERE work_id=? AND state='pending'",
      )
      .run(now().toISOString(), reason, workId)

  return { pass, enqueueAbort }
}

const nextRun = (run: Run, phase: Run['phase'], progress: number): Run => {
  const { resumablePhase: _resumablePhase, ...current } = run
  return {
    ...current,
    revision: run.revision + 1,
    phase,
    progress,
    ...(phase === 'recover' ? { resumablePhase: 'capture' as const } : {}),
  }
}

const isRejected = (
  value: CameraProviderCommandOutcome | void,
): value is Extract<
  CameraProviderCommandOutcome,
  { readonly _tag: 'Rejected' }
> => value?._tag === 'Rejected'

function invalidDuration(): never {
  throw new Error('The accepted exposure duration is unavailable.')
}

function boundedDiagnostic(cause: unknown) {
  return String(cause)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240)
}
