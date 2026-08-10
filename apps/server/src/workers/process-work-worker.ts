import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import { settleProcessWork } from '../services/process-workspace.ts'
import { settleProcessingProjectStage } from '../services/processing-project-service.ts'
import { settleProcessingProjectDevelop } from '../services/processing-project-service.ts'

const buildStages = [
  'validate',
  'calibrate',
  'debayer',
  'align',
  'evaluate',
  'stack',
] as const

const BuildStage = Schema.Literals(buildStages)
const WorkKind = Schema.Literals([
  'projectStage',
  'projectDevelopApply',
  'build',
  'preview',
  'apply',
  'retry',
  'save',
  'cleanup',
])
const WorkRow = Schema.Struct({
  work_id: Schema.String,
  kind: WorkKind,
  payload: Schema.String,
  state: Schema.Literals(['pending', 'claimed']),
  stage: Schema.NullOr(
    Schema.Union([
      BuildStage,
      Schema.Literals(['Calibration', 'Registration', 'Stacking', 'Develop']),
    ]),
  ),
  claim_token: Schema.NullOr(Schema.String),
  attempts: Schema.Int,
})
const BacklogRow = Schema.Struct({
  count: Schema.Int,
  oldest: Schema.NullOr(Schema.String),
})
const StoredWorkspace = Schema.Struct({ state: Schema.String })
const WorkspaceState = Schema.Struct({
  sessions: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        activeAttempt: Schema.optionalKey(
          Schema.Struct({
            attemptId: Schema.optionalKey(Schema.String),
            toolId: Schema.optionalKey(Schema.String),
          }),
        ),
      }),
    ),
  ),
  pressure: Schema.optionalKey(
    Schema.Struct({ state: Schema.optionalKey(Schema.String) }),
  ),
})
const CleanupPayload = Schema.Struct({ sessionId: Schema.String })
const CleanupArtifact = Schema.Struct({
  artifact_id: Schema.String,
  path: Schema.String,
})
const SavePayload = Schema.Struct({
  artifacts: Schema.Array(
    Schema.Struct({ format: Schema.Literals(['fits', 'tiff', 'png', 'jpeg']) }),
  ),
})
const AttemptPayload = Schema.Struct({
  attemptId: Schema.optionalKey(Schema.String),
})
const SessionPayload = Schema.Struct({ sessionId: Schema.String })

type WorkRow = typeof WorkRow.Type
export type ProcessWorkKind = typeof WorkKind.Type
export type ProcessWorkStage =
  Exclude<(typeof WorkRow.Type)['stage'], null> | ProcessWorkKind

export type ProcessWorkPassResult =
  | { readonly outcome: 'idle' }
  | { readonly outcome: 'completed'; readonly kind: WorkRow['kind'] }
  | { readonly outcome: 'checkpointed'; readonly stage: string }
  | { readonly outcome: 'claimedUnresolved'; readonly kind: WorkRow['kind'] }
  | { readonly outcome: 'stale'; readonly kind: WorkRow['kind'] }
  | { readonly outcome: 'failed'; readonly kind: WorkRow['kind'] }
  | { readonly outcome: 'pressureThrottled' | 'pressurePaused' }

export const processWorkResultChangesProjection = (
  result: ProcessWorkPassResult,
) =>
  result.outcome === 'checkpointed' ||
  result.outcome === 'completed' ||
  result.outcome === 'failed'

export type ProcessWorkTrace = (
  kind: WorkRow['kind'],
  stage: ProcessWorkStage,
  run: () => ProcessWorkPassResult,
) => ProcessWorkPassResult

export type ProcessBacklogObserver = (
  count: number,
  oldestAgeSeconds: number,
) => void
export type ProcessPressureObserver = (
  state: 'normal' | 'throttled' | 'paused',
) => void

export function createProcessWorkWorker(options: {
  readonly database: DatabaseSync
  readonly outputRoot: string
  readonly traceWork?: ProcessWorkTrace
  readonly observeBacklog?: ProcessBacklogObserver
  readonly observePressure?: ProcessPressureObserver
  readonly now?: () => Date
  readonly failBuildStage?: 'align'
}) {
  mkdirSync(options.outputRoot, { recursive: true })
  const now = options.now ?? (() => new Date())

  const pass = (): ProcessWorkPassResult => {
    const backlog = Schema.decodeUnknownSync(BacklogRow)(
      options.database
        .prepare(
          "SELECT COUNT(*) AS count,MIN(enqueued_at) AS oldest FROM processing_work WHERE state IN ('pending','claimed')",
        )
        .get(),
    )
    options.observeBacklog?.(
      backlog.count,
      backlog.oldest === null
        ? 0
        : Math.max(0, now().getTime() - Date.parse(backlog.oldest)) / 1_000,
    )
    const pressure = pressureState(options.database)
    options.observePressure?.(pressure)
    if (pressure === 'paused') return { outcome: 'pressurePaused' }
    if (pressure === 'throttled') return { outcome: 'pressureThrottled' }
    const row = Schema.decodeUnknownSync(Schema.optional(WorkRow))(
      options.database
        .prepare(
          "SELECT work_id,kind,payload,state,stage,claim_token,attempts FROM processing_work WHERE state IN ('pending','claimed') ORDER BY rowid LIMIT 1",
        )
        .get(),
    )
    if (row === undefined) return { outcome: 'idle' }
    const stage: ProcessWorkStage = row.stage ?? row.kind
    const run = () => execute(row, stage)
    return options.traceWork?.(row.kind, stage, run) ?? run()
  }

  const execute = (
    row: WorkRow,
    stage: ProcessWorkStage,
  ): ProcessWorkPassResult => {
    let claimToken = row.claim_token
    if (row.state === 'pending') {
      claimToken = randomUUID()
      const claimed = options.database
        .prepare(
          "UPDATE processing_work SET state='claimed',claim_token=?,claimed_at=?,attempts=attempts+1 WHERE work_id=? AND state='pending'",
        )
        .run(claimToken, now().toISOString(), row.work_id)
      if (claimed.changes !== 1) return { outcome: 'stale', kind: row.kind }
    }
    if (claimToken === null)
      return { outcome: 'claimedUnresolved', kind: row.kind }

    if (
      row.kind === 'build' &&
      stage === options.failBuildStage &&
      row.attempts === buildStages.indexOf(stage)
    ) {
      const failed = options.database
        .prepare(
          "UPDATE processing_work SET state='failed',claim_token=NULL,claimed_at=NULL,last_error='deterministic-stage-failure' WHERE work_id=? AND state='claimed' AND claim_token=?",
        )
        .run(row.work_id, claimToken)
      return failed.changes === 1
        ? { outcome: 'failed', kind: row.kind }
        : { outcome: 'stale', kind: row.kind }
    }

    if (row.kind === 'cleanup') {
      cleanupArtifacts(options.database, row.payload)
      const settled = settleProcessWork(
        options.database,
        row.work_id,
        claimToken,
        { outcome: 'completed', checksum: `sha256:${digest('cleanup')}` },
      )
      return settled.outcome === 'settled'
        ? { outcome: 'completed', kind: row.kind }
        : settled.outcome === 'stale'
          ? { outcome: 'stale', kind: row.kind }
          : { outcome: 'claimedUnresolved', kind: row.kind }
    }

    if (row.kind === 'save') {
      const artifacts = materializeSavedArtifacts(
        options.outputRoot,
        row,
        claimToken,
      )
      if (artifacts === undefined)
        return { outcome: 'claimedUnresolved', kind: row.kind }
      const settled = settleProcessWork(
        options.database,
        row.work_id,
        claimToken,
        {
          outcome: 'completed',
          checksum: artifacts[0]?.checksum ?? `sha256:${digest('empty')}`,
          artifacts,
        },
      )
      return settled.outcome === 'settled'
        ? { outcome: 'completed', kind: row.kind }
        : settled.outcome === 'stale'
          ? { outcome: 'stale', kind: row.kind }
          : { outcome: 'claimedUnresolved', kind: row.kind }
    }

    const artifactPath = outputPath(options.outputRoot, row.work_id, stage)
    const bytes = JSON.stringify({
      adapter:
        row.kind === 'projectStage'
          ? stage === 'Calibration'
            ? 'deterministic-calibration-adapter-v1'
            : stage === 'Registration'
              ? 'deterministic-registration-adapter-v1'
              : 'deterministic-stacking-adapter-v1'
          : row.kind === 'projectDevelopApply'
            ? 'deterministic-develop-adapter-v1'
            : 'deterministic-file-v1',
      kind: row.kind,
      stage,
      payloadDigest: digest(row.payload),
    })
    if (!existsSync(artifactPath)) {
      const temporaryPath = `${artifactPath}.${claimToken}.tmp`
      if (existsSync(temporaryPath)) {
        if (readFileSync(temporaryPath, 'utf8') !== bytes)
          return { outcome: 'claimedUnresolved', kind: row.kind }
      } else writeFileSync(temporaryPath, bytes, { flag: 'wx' })
      renameSync(temporaryPath, artifactPath)
    }
    if (readFileSync(artifactPath, 'utf8') !== bytes)
      return { outcome: 'claimedUnresolved', kind: row.kind }
    const checksum = `sha256:${digest(readFileSync(artifactPath))}`
    if (row.kind === 'projectStage') {
      const settled = settleProcessingProjectStage(
        options.database,
        row.work_id,
        claimToken,
        checksum,
        artifactPath,
      )
      return settled.outcome === 'settled'
        ? settled.stageOutcome === 'Failed' ||
          settled.stageOutcome === 'Unavailable'
          ? { outcome: 'failed', kind: row.kind }
          : { outcome: 'completed', kind: row.kind }
        : { outcome: 'stale', kind: row.kind }
    }
    if (row.kind === 'projectDevelopApply') {
      const settled = settleProcessingProjectDevelop(
        options.database,
        row.work_id,
        claimToken,
        artifactPath,
      )
      return settled.outcome === 'settled'
        ? settled.successful
          ? { outcome: 'completed', kind: row.kind }
          : { outcome: 'failed', kind: row.kind }
        : { outcome: 'stale', kind: row.kind }
    }
    if (row.kind === 'build') {
      const index = buildStages.findIndex((candidate) => candidate === stage)
      const next = buildStages[index + 1]
      if (next !== undefined) {
        options.database.exec('BEGIN IMMEDIATE')
        try {
          const changed = options.database
            .prepare(
              "UPDATE processing_work SET state='pending',stage=?,checkpoint=?,claim_token=NULL,claimed_at=NULL WHERE work_id=? AND state='claimed' AND claim_token=?",
            )
            .run(next, stage, row.work_id, claimToken)
          if (changed.changes !== 1) throw new Error('stale checkpoint')
          options.database
            .prepare(
              'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
            )
            .run(
              `${row.work_id}:${stage}`,
              Schema.decodeUnknownSync(SessionPayload)(JSON.parse(row.payload))
                .sessionId,
              row.work_id,
              null,
              artifactPath,
              checksum,
            )
          options.database.exec('COMMIT')
          return { outcome: 'checkpointed', stage }
        } catch {
          options.database.exec('ROLLBACK')
          return { outcome: 'stale', kind: row.kind }
        }
      }
    }
    const parsed = Schema.decodeUnknownSync(AttemptPayload)(
      JSON.parse(row.payload),
    )
    const failed =
      row.kind === 'apply' &&
      activeToolId(options.database, parsed.attemptId) === 'deterministic-fail'
    const settled = settleProcessWork(
      options.database,
      row.work_id,
      claimToken,
      {
        outcome: failed ? 'failed' : 'completed',
        checksum,
        artifacts: [{ path: artifactPath, checksum }],
      },
    )
    return settled.outcome === 'settled'
      ? { outcome: 'completed', kind: row.kind }
      : settled.outcome === 'stale'
        ? { outcome: 'stale', kind: row.kind }
        : { outcome: 'claimedUnresolved', kind: row.kind }
  }

  return { pass }
}

function outputPath(root: string, workId: string, stage: string) {
  return join(root, `${digest(`${workId}:${stage}`)}.json`)
}

function digest(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function activeToolId(database: DatabaseSync, attemptId: string | undefined) {
  if (attemptId === undefined) return undefined
  const row = Schema.decodeUnknownSync(Schema.optional(StoredWorkspace))(
    database.prepare('SELECT state FROM processing_workspace WHERE id=1').get(),
  )
  const state =
    row === undefined
      ? undefined
      : Schema.decodeUnknownSync(WorkspaceState)(JSON.parse(row.state))
  return state?.sessions?.find(
    (session) => session.activeAttempt?.attemptId === attemptId,
  )?.activeAttempt?.toolId
}

function pressureState(database: DatabaseSync) {
  const row = Schema.decodeUnknownSync(Schema.optional(StoredWorkspace))(
    database.prepare('SELECT state FROM processing_workspace WHERE id=1').get(),
  )
  if (row === undefined) return 'normal'
  const pressure = Schema.decodeUnknownSync(WorkspaceState)(
    JSON.parse(row.state),
  ).pressure?.state
  return pressure === 'paused' || pressure === 'throttled' ? pressure : 'normal'
}

function cleanupArtifacts(database: DatabaseSync, payload: string) {
  const sessionId = Schema.decodeUnknownSync(CleanupPayload)(
    JSON.parse(payload),
  ).sessionId
  const rows = Schema.decodeUnknownSync(Schema.Array(CleanupArtifact))(
    database
      .prepare(
        'SELECT artifact_id,path FROM processing_artifacts WHERE session_id=? AND saved=0',
      )
      .all(sessionId),
  )
  for (const row of rows) {
    if (existsSync(row.path)) unlinkSync(row.path)
    database
      .prepare('DELETE FROM processing_artifacts WHERE artifact_id=?')
      .run(row.artifact_id)
  }
}

function materializeSavedArtifacts(
  root: string,
  row: WorkRow,
  claimToken: string,
) {
  const payload = Schema.decodeUnknownSync(SavePayload)(JSON.parse(row.payload))
  const result: Array<{ path: string; checksum: string }> = []
  for (const [index, artifact] of payload.artifacts.entries()) {
    const path = join(
      root,
      `${digest(`${row.work_id}:saved:${index}`)}.${artifact.format}`,
    )
    const bytes = bytesForFormat(artifact.format)
    const temporaryPath = `${path}.${claimToken}.tmp`
    if (!existsSync(path)) {
      if (existsSync(temporaryPath)) {
        if (!readFileSync(temporaryPath).equals(bytes)) return undefined
      } else writeFileSync(temporaryPath, bytes, { flag: 'wx' })
      renameSync(temporaryPath, path)
    }
    if (!readFileSync(path).equals(bytes)) return undefined
    result.push({ path, checksum: `sha256:${digest(bytes)}` })
  }
  return result
}

function bytesForFormat(format: 'fits' | 'tiff' | 'png' | 'jpeg') {
  if (format === 'fits') {
    const cards = [
      'SIMPLE  =                    T',
      'BITPIX  =                    8',
      'NAXIS   =                    0',
      'END',
    ].map((card) => card.padEnd(80, ' '))
    return Buffer.from(cards.join('').padEnd(2880, ' '), 'ascii')
  }
  if (format === 'tiff')
    return Buffer.from([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00,
    ])
  if (format === 'png')
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
  return Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
    'base64',
  )
}
