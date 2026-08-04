import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  AcquireRevision,
  AcquireSession,
  RunId,
} from '@astro-console/v2-contracts'

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
        'INSERT INTO acquire_receipts (idempotency_key,actor_client_id,response) VALUES (?,?,?)',
      )
      .run(key, clientId, JSON.stringify(response)),
})
