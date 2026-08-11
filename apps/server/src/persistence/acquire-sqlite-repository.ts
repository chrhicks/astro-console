import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  AcquireRevision,
  AttemptId,
  PositiveInt,
  RunId,
} from '@astro-console/protocol'
import {
  AcquireActiveWork,
  AcquireSession,
  RecoverySeriesId,
} from '../services/acquire-domain.ts'

const StoredSession = Schema.Struct({ session: Schema.String })
const StoredStateValue = Schema.Struct({ value: Schema.String })
const StoredReceipt = Schema.Struct({ response: Schema.String })
const StoredReceiptResponse = Schema.Struct({
  status: Schema.Int,
  body: Schema.Unknown,
})

export const polarSession = (runId: string) =>
  AcquireSession.make({
    runId: RunId.make(runId),
    revision: AcquireRevision.make(0),
    mode: 'polar',
    phase: 'polarGuidance',
    policy: {
      centeringToleranceArcsec: 30,
      automaticCorrectionLimitArcsec: 60,
      hardCorrectionLimitArcsec: 180,
      maxSolveAttemptsPerSeries: 2,
      maxCorrectionAttempts: 2,
      maxRecoverySeries: 1,
      polarToleranceArcsec: 60,
    },
    solveSeries: [],
    evidence: [],
    activeWork: null,
    pendingCorrectionProposal: null,
    latestPolarMeasurementAttemptId: null,
    acceptedPolarMeasurementAttemptId: null,
  })

export const targetAcquisitionSession = (
  runId: string,
  acquisitionMethod: 'deepSkyPlateSolve' | 'lunarDiskLimb',
  options: {
    readonly centeringToleranceArcsec?: number
    readonly maxSolveAttemptsPerSeries?: number
  } = {},
) => {
  const attemptId = AttemptId.make(`${acquisitionMethod}-initial-1`)
  const seriesId = RecoverySeriesId.make(`${acquisitionMethod}-initial`)
  return AcquireSession.make({
    runId: RunId.make(runId),
    revision: AcquireRevision.make(0),
    mode: 'pointing',
    acquisitionMethod,
    phase: 'solving',
    policy: {
      centeringToleranceArcsec: options.centeringToleranceArcsec ?? 30,
      automaticCorrectionLimitArcsec: options.centeringToleranceArcsec ?? 60,
      hardCorrectionLimitArcsec: 180,
      maxSolveAttemptsPerSeries: options.maxSolveAttemptsPerSeries ?? 2,
      maxCorrectionAttempts: 2,
      maxRecoverySeries: 1,
      polarToleranceArcsec: 60,
    },
    solveSeries: [
      {
        seriesId,
        purpose: 'initial',
        parameters: {
          exposureSeconds: 5,
          binning: 1,
          solverProfile:
            acquisitionMethod === 'deepSkyPlateSolve'
              ? 'deep-sky-plate-solve'
              : 'lunar-disk-limb',
        },
        maxAttempts: PositiveInt.make(options.maxSolveAttemptsPerSeries ?? 2),
        verificationOfCorrectionAttemptId: null,
        completedAttemptIds: [],
      },
    ],
    evidence: [],
    activeWork: AcquireActiveWork.cases.SolveRequested.make({
      attemptId,
      seriesId,
      attemptNumber: PositiveInt.make(1),
      purpose: 'initial',
      verificationOfCorrectionAttemptId: null,
    }),
    pendingCorrectionProposal: null,
    latestPolarMeasurementAttemptId: null,
    acceptedPolarMeasurementAttemptId: null,
  })
}

export const acquireSqliteRepository = (database: DatabaseSync) => ({
  current: (runId: string) => {
    const row = Schema.decodeUnknownSync(Schema.optional(StoredSession))(
      database
        .prepare('SELECT session FROM acquire_sessions WHERE run_id=?')
        .get(runId),
    )
    return row === undefined
      ? undefined
      : Schema.decodeUnknownSync(AcquireSession)(JSON.parse(row.session))
  },
  install: (session: typeof AcquireSession.Type) =>
    database
      .prepare(
        'INSERT OR REPLACE INTO acquire_sessions (run_id,session) VALUES (?,?)',
      )
      .run(session.runId, JSON.stringify(session)),
  commit: (session: typeof AcquireSession.Type, type: string) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const row = Schema.decodeUnknownSync(StoredStateValue)(
        database
          .prepare("SELECT value FROM state WHERE key='eventCursor'")
          .get(),
      )
      const cursor = JSON.parse(row.value) + 1
      database
        .prepare(
          'INSERT OR REPLACE INTO acquire_sessions (run_id,session) VALUES (?,?)',
        )
        .run(session.runId, JSON.stringify(session))
      database
        .prepare('UPDATE state SET value=? WHERE key=?')
        .run(JSON.stringify(cursor), 'eventCursor')
      database
        .prepare('UPDATE state SET value=? WHERE key=?')
        .run(
          JSON.stringify(
            JSON.parse(
              Schema.decodeUnknownSync(StoredStateValue)(
                database
                  .prepare(
                    "SELECT value FROM state WHERE key='snapshotVersion'",
                  )
                  .get(),
              ).value,
            ) + 1,
          ),
          'snapshotVersion',
        )
      database
        .prepare('INSERT INTO events VALUES (?,?,?)')
        .run(cursor, type, JSON.stringify(session))
      database.exec('COMMIT')
      return { cursor }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  },
  receipt: (key: string, clientId: string) => {
    const row = Schema.decodeUnknownSync(Schema.optional(StoredReceipt))(
      database
        .prepare(
          'SELECT response FROM acquire_receipts WHERE idempotency_key=? AND actor_client_id=?',
        )
        .get(key, clientId),
    )
    return row === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredReceiptResponse)(
          JSON.parse(row.response),
        )
  },
  saveReceipt: (
    key: string,
    clientId: string,
    response: { readonly status: number; readonly body: unknown },
  ) =>
    database
      .prepare(
        'INSERT OR REPLACE INTO acquire_receipts (idempotency_key,actor_client_id,response) VALUES (?,?,?)',
      )
      .run(key, clientId, JSON.stringify(response)),
})
