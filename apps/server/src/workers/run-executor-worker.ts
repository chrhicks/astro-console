import { createHash } from 'node:crypto'
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
import {
  materializeCapturedFrame,
  type CapturedFrameStorage,
} from '../services/captured-frame-intake.ts'
import {
  inspectCapturedFrame,
  type FrameInspectionResult,
  type FrameInspectionStorage,
} from '../services/frame-inspection.ts'
import {
  acquireSqliteRepository,
  targetAcquisitionSession,
} from '../persistence/acquire-sqlite-repository.ts'
import type {
  ExecutorWorkKind,
  ExecutorWorkResult,
} from '../observability/executor-telemetry.ts'
import type {
  SqliteBacklogObserver,
  SqliteTraceSync,
} from '../observability/sqlite-telemetry.ts'

type AcquireRepository = ReturnType<typeof acquireSqliteRepository>

const WorkRow = Schema.Struct({
  work_id: Schema.String,
  run_id: Schema.String,
  kind: Schema.Literals([
    'BeginRun',
    'StartExposure',
    'RetrieveFrame',
    'AbortExposure',
  ]),
  payload: Schema.String,
  state: Schema.Literals([
    'pending',
    'commandAttempted',
    'observing',
    'reconciling',
  ]),
  acknowledged_at: Schema.NullOr(Schema.String),
})
const startExposurePostAckGraceMs = 2_000
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
const RetrievePayload = Schema.Struct({
  assetId: Schema.String,
  frameId: Schema.String,
  capturedAt: Schema.NonEmptyString,
  equipment: Schema.Struct({
    rigId: Schema.NonEmptyString,
    cameraDeviceId: Schema.NonEmptyString,
  }),
  capture: Schema.Struct({
    exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
    filter: Schema.NonEmptyString,
    binning: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    frameType: Schema.Literal('light'),
  }),
  lineage: Schema.Struct({
    runId: Schema.String,
    sequenceId: Schema.NonEmptyString,
    acquisitionId: Schema.NonEmptyString,
  }),
  idempotencyKey: Schema.NonEmptyString,
})
const CapturedReceipt = Schema.Struct({ response: Schema.String })
const CapturedReceiptResponse = Schema.Struct({
  outcome: Schema.Literal('accepted'),
  assetId: Schema.String,
  cursor: Schema.Int,
})
const CountRow = Schema.Struct({ count: Schema.Int })

export type RunExecutorPassResult = ExecutorWorkResult

export const createRunExecutorWorker = (options: {
  readonly database: DatabaseSync
  readonly stateRepository: StateSqliteRepositoryShape
  readonly cameraProvider: CameraProviderShape
  readonly capturedFrameStorage?: CapturedFrameStorage
  readonly frameInspectionStorage?: FrameInspectionStorage
  readonly acquireRepository?: AcquireRepository
  readonly developmentDeepSkyHold?: boolean
  readonly now?: () => Date
  readonly publish?: (type: string, cursor: number) => void
  readonly traceWork?: (
    kind: ExecutorWorkKind,
    run: () => Promise<ExecutorWorkResult>,
  ) => Promise<ExecutorWorkResult>
  readonly traceFrameIntake?: (
    run: () => ReturnType<typeof materializeCapturedFrame>,
  ) => ReturnType<typeof materializeCapturedFrame>
  readonly traceFrameInspection?: (
    effect: ReturnType<typeof inspectCapturedFrame>,
  ) => Promise<Exit.Exit<FrameInspectionResult>>
  readonly traceSqlite?: SqliteTraceSync
  readonly observeSqliteBacklog?: SqliteBacklogObserver
}) => {
  const db = options.database
  const now = options.now ?? (() => new Date())
  const traceSqlite: SqliteTraceSync =
    options.traceSqlite ?? ((_operation, run) => run())

  const pass = async (): Promise<RunExecutorPassResult> => {
    const backlog = Schema.decodeUnknownSync(CountRow)(
      db
        .prepare(
          "SELECT count(*) AS count FROM run_executor_work WHERE state IN ('pending','commandAttempted','observing','reconciling')",
        )
        .get(),
    ).count
    options.observeSqliteBacklog?.('executor', backlog)
    if (backlog === 0) return continueCompletedAcquire()
    const raw: unknown = traceSqlite('executor.work.select', () =>
      db
        .prepare(
          "SELECT work_id,run_id,kind,payload,state,acknowledged_at FROM run_executor_work WHERE state IN ('pending','commandAttempted','observing','reconciling') ORDER BY CASE WHEN kind='AbortExposure' THEN 0 ELSE 1 END,rowid LIMIT 1",
        )
        .get(),
    )
    const row = Schema.decodeUnknownSync(Schema.optional(WorkRow))(raw)
    if (row === undefined) return continueCompletedAcquire()
    const run = () => runWork(row)
    return options.traceWork === undefined
      ? run()
      : options.traceWork(row.kind, run)
  }

  const runWork = async (
    row: typeof WorkRow.Type,
  ): Promise<RunExecutorPassResult> => {
    if (row.kind === 'BeginRun') return beginRun(row)
    if (row.kind === 'RetrieveFrame') return retrieveFrame(row)
    let currentRow = row
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
      const acknowledgedAt = now().toISOString()
      db.prepare(
        "UPDATE run_executor_work SET acknowledged_at=?,last_error=NULL WHERE work_id=? AND state='commandAttempted'",
      ).run(acknowledgedAt, row.work_id)
      currentRow = {
        ...row,
        state: 'commandAttempted',
        acknowledged_at: acknowledgedAt,
      }
    }
    return reconcile(currentRow)
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
    const supported =
      definition.sequences.length === 1 &&
      sequence !== undefined &&
      sequence.frameCount === 1 &&
      ((sequence.acquisitionMode === 'cameraOnly' &&
        sequence.exposureSeconds <= 60) ||
        (sequence.acquisitionMode === 'deepSkyPlateSolve' &&
          sequence.exposureSeconds <= 120 &&
          definition.executionContext.completionBehavior === 'hold' &&
          options.developmentDeepSkyHold === true &&
          options.acquireRepository !== undefined))
    if (!supported || sequence === undefined) {
      commitWorkTransition({
        runId: row.run_id,
        phase: 'recover',
        eventType: 'RunDefinitionUnavailable',
        updateWork: () =>
          settle(
            row.work_id,
            'rejected',
            'This executor supports one camera-only frame up to 60 seconds or one deep-sky acquired frame up to 120 seconds with hold completion.',
          ),
      })
      return 'rejected'
    }
    db.exec('BEGIN IMMEDIATE')
    let published: { readonly type: string; readonly cursor: number }
    const result = 'captureReady' as const
    try {
      const acquire = sequence.acquisitionMode === 'deepSkyPlateSolve'
      const next = nextRun(run, acquire ? 'acquire' : 'capture', 25)
      published = commitRun(
        next,
        acquire ? 'RunAcquireRequired' : 'RunCaptureReady',
      )
      if (acquire)
        options.acquireRepository?.install(
          targetAcquisitionSession(run.id, 'deepSkyPlateSolve', {
            centeringToleranceArcsec: sequence.recenterThresholdArcsec,
            maxSolveAttemptsPerSeries: sequence.maxSolveAttempts,
          }),
        )
      else
        enqueueExposure(run.id, payload.sequenceIndex, sequence.exposureSeconds)
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

  const continueCompletedAcquire = (): RunExecutorPassResult => {
    const run = options.stateRepository.state().run
    if (
      run === null ||
      run.phase !== 'acquire' ||
      options.acquireRepository === undefined
    )
      return 'none'
    const session = options.acquireRepository.current(run.id)
    if (session === undefined || session.phase !== 'completed') return 'none'
    const definition = readDefinition(run)
    const sequenceIndex = run.activeSequenceIndex ?? 0
    const sequence = definition.sequences[sequenceIndex]
    if (sequence === undefined) return 'none'
    db.exec('BEGIN IMMEDIATE')
    let published: { readonly type: string; readonly cursor: number }
    try {
      published = commitRun(nextRun(run, 'capture', 50), 'RunCaptureReady')
      enqueueExposure(run.id, sequenceIndex, sequence.exposureSeconds)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    options.publish?.(published.type, published.cursor)
    return 'captureReady'
  }

  const enqueueExposure = (
    runId: string,
    sequenceIndex: number,
    durationSeconds: number,
  ) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO run_executor_work (work_id,run_id,kind,payload,state) VALUES (?,?,?,?, 'pending')",
      )
      .run(
        `${runId}:sequence:${sequenceIndex}:exposure`,
        runId,
        'StartExposure',
        JSON.stringify({ sequenceIndex, durationSeconds }),
      )

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
        if (insideStartExposurePostAckGrace(row.acknowledged_at, now()))
          return 'awaitingObservation'
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
      const payload = Schema.decodeUnknownSync(StartPayload)(
        JSON.parse(row.payload),
      )
      const run = options.stateRepository.state().run
      if (run?.id !== row.run_id)
        throw new Error('The originating run is unavailable at completion.')
      const definition = readDefinition(run)
      const sequence = definition.sequences[payload.sequenceIndex]
      if (sequence === undefined)
        throw new Error('The accepted sequence is unavailable at completion.')
      const identity = captureIdentity(row.run_id, sequence.sequenceId)
      commitWorkTransition({
        runId: row.run_id,
        observation: observation.value,
        phase: 'capture',
        progress: 60,
        eventType: 'RunExposureCompletionObserved',
        updateWork: () => {
          db.prepare(
            "INSERT OR IGNORE INTO run_executor_work (work_id,run_id,kind,payload,state) VALUES (?,?,?,?, 'pending')",
          ).run(
            `${row.run_id}:sequence:${payload.sequenceIndex}:retrieve-frame`,
            row.run_id,
            'RetrieveFrame',
            JSON.stringify({
              assetId: identity.assetId,
              frameId: identity.frameId,
              capturedAt: observation.value.observedAt,
              equipment: {
                rigId: definition.executionContext.rigId,
                cameraDeviceId: definition.executionContext.cameraDeviceId,
              },
              capture: {
                exposureSeconds: sequence.exposureSeconds,
                filter: sequence.filterName ?? 'No filter',
                binning: sequence.binning,
                frameType: 'light',
              },
              lineage: {
                runId: row.run_id,
                sequenceId: sequence.sequenceId,
                acquisitionId: `camera-${sequence.sequenceId}`,
              },
              idempotencyKey: `run-executor:${row.run_id}:sequence:${payload.sequenceIndex}:retrieve-frame`,
            }),
          )
          settle(row.work_id, 'completed')
        },
      })
      return 'retrievalReady'
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

  const retrieveFrame = async (
    row: typeof WorkRow.Type,
  ): Promise<RunExecutorPassResult> => {
    const payload = Schema.decodeUnknownSync(RetrievePayload)(
      JSON.parse(row.payload),
    )
    const receipt = Schema.decodeUnknownSync(Schema.optional(CapturedReceipt))(
      db
        .prepare(
          'SELECT response FROM captured_frame_receipts WHERE idempotency_key=?',
        )
        .get(payload.idempotencyKey),
    )
    if (receipt !== undefined) {
      const retained = Schema.decodeUnknownSync(CapturedReceiptResponse)(
        JSON.parse(receipt.response),
      )
      if (retained.assetId !== payload.assetId) {
        rejectRetrieval(
          row,
          'The retained-frame receipt does not match this work.',
        )
        return 'rejected'
      }
      return finishRetrievedFrame(row, retained.assetId)
    }
    const reader = options.cameraProvider.readImageArray
    const capturedFrameStorage = options.capturedFrameStorage
    if (reader === undefined || capturedFrameStorage === undefined) {
      rejectRetrieval(
        row,
        'The camera image reader or retained-original storage is unavailable.',
      )
      return 'rejected'
    }
    if (row.state === 'pending') {
      const claimed = db
        .prepare(
          "UPDATE run_executor_work SET state='commandAttempted',command_attempted_at=?,last_error=NULL WHERE work_id=? AND state='pending'",
        )
        .run(now().toISOString(), row.work_id)
      if (claimed.changes !== 1) return 'none'
    }
    const image = await Effect.runPromise(reader().pipe(Effect.exit))
    if (Exit.isFailure(image)) {
      rejectRetrieval(row, boundedDiagnostic(image.cause))
      return 'rejected'
    }
    const materialize = () =>
      materializeCapturedFrame(
        db,
        capturedFrameStorage,
        {
          ...payload,
          format: image.value.format,
        },
        image.value.bytes,
      )
    const retained =
      options.traceFrameIntake === undefined
        ? materialize()
        : options.traceFrameIntake(materialize)
    if (retained.outcome !== 'accepted') {
      rejectRetrieval(
        row,
        `The completed camera image could not be retained: ${retained.reason}.`,
      )
      return 'rejected'
    }
    options.publish?.('CapturedFrameMaterialized', retained.cursor)
    return finishRetrievedFrame(row, retained.assetId)
  }

  const finishRetrievedFrame = async (
    row: typeof WorkRow.Type,
    assetId: string,
  ): Promise<RunExecutorPassResult> => {
    let inspectionError: string | undefined
    if (options.frameInspectionStorage !== undefined) {
      const effect = inspectCapturedFrame(
        db,
        options.frameInspectionStorage,
        assetId,
      )
      const inspected =
        options.traceFrameInspection === undefined
          ? await Effect.runPromise(effect.pipe(Effect.exit))
          : await options.traceFrameInspection(effect)
      if (Exit.isSuccess(inspected))
        options.publish?.('FrameInspectionUpdated', inspected.value.cursor)
      else inspectionError = boundedDiagnostic(inspected.cause)
    } else inspectionError = 'Bounded inspection storage is unavailable.'
    const run = options.stateRepository.state().run
    const definition = run?.id === row.run_id ? readDefinition(run) : undefined
    const completed =
      definition?.sequences[run?.activeSequenceIndex ?? 0]?.acquisitionMode ===
      'deepSkyPlateSolve'
    commitWorkTransition({
      runId: row.run_id,
      phase: completed ? 'completed' : 'verify',
      progress: completed ? 100 : 75,
      eventType:
        inspectionError === undefined
          ? 'RunFrameInspectionUpdated'
          : 'RunFrameInspectionUnavailable',
      updateWork: () =>
        settle(
          row.work_id,
          'completed',
          inspectionError === undefined
            ? undefined
            : `The original is retained. ${inspectionError}`,
        ),
    })
    return 'retrieved'
  }

  const rejectRetrieval = (row: typeof WorkRow.Type, reason: string) =>
    commitWorkTransition({
      runId: row.run_id,
      phase: 'recover',
      eventType: 'RunFrameRetrievalFailed',
      updateWork: () => settle(row.work_id, 'rejected', reason),
    })

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
    traceSqlite('executor.work.settle', () =>
      db
        .prepare(
          "UPDATE run_executor_work SET state='reconciling',last_error=? WHERE work_id=?",
        )
        .run(boundedDiagnostic(cause), workId),
    )

  const settle = (
    workId: string,
    state: 'completed' | 'rejected',
    error?: string,
  ) =>
    traceSqlite('executor.work.settle', () =>
      db
        .prepare(
          'UPDATE run_executor_work SET state=?,settled_at=?,last_error=? WHERE work_id=?',
        )
        .run(state, now().toISOString(), error ?? null, workId),
    )

  const cancelPending = (workId: string, reason: string) =>
    traceSqlite('executor.work.settle', () =>
      db
        .prepare(
          "UPDATE run_executor_work SET state='cancelled',settled_at=?,last_error=? WHERE work_id=? AND state='pending'",
        )
        .run(now().toISOString(), reason, workId),
    )

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

function insideStartExposurePostAckGrace(
  acknowledgedAt: string | null,
  observedAt: Date,
) {
  if (acknowledgedAt === null) return false
  const acknowledgedEpochMs = Date.parse(acknowledgedAt)
  if (!Number.isFinite(acknowledgedEpochMs)) return false
  const elapsedMs = observedAt.getTime() - acknowledgedEpochMs
  return elapsedMs >= 0 && elapsedMs < startExposurePostAckGraceMs
}

function captureIdentity(runId: string, sequenceId: string) {
  const digest = createHash('sha256')
    .update(`${runId}:${sequenceId}:frame:0`)
    .digest('hex')
    .slice(0, 32)
  return {
    assetId: `asset-capture-${digest}`,
    frameId: `frame-${digest}`,
  }
}

function boundedDiagnostic(cause: unknown) {
  return String(cause)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240)
}
