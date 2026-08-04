import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import { CapturedFrameIntake } from '@astro-console/v2-contracts'

const Existing = Schema.Struct({
  semantic_key: Schema.String,
  response: Schema.String,
})

export type CapturedFrameStorage = { readonly originalsRoot: string }
export type CapturedFrameResult =
  | {
      readonly outcome: 'accepted'
      readonly assetId: string
      readonly checksum: string
      readonly cursor: number
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: 'InvalidInput' | 'MaterializationFailed'
    }

/**
 * Server-only boundary from a capture adapter to Library. This function never
 * talks to a camera: callers provide deterministic bytes and metadata.
 */
export function materializeCapturedFrame(
  database: DatabaseSync,
  storage: CapturedFrameStorage,
  raw: unknown,
  bytes: Uint8Array,
): CapturedFrameResult {
  let input: CapturedFrameIntake
  try {
    input = Schema.decodeUnknownSync(CapturedFrameIntake)(raw)
    if (
      !/^asset-capture-[a-z0-9-]{1,96}$/.test(input.assetId) ||
      bytes.byteLength === 0
    )
      return { outcome: 'rejected', reason: 'InvalidInput' }
  } catch {
    return { outcome: 'rejected', reason: 'InvalidInput' }
  }
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        input: { ...input, idempotencyKey: undefined },
        checksum,
      }),
    )
    .digest('hex')
  const existingRaw: unknown = database
    .prepare(
      'SELECT semantic_key,response FROM captured_frame_receipts WHERE idempotency_key=?',
    )
    .get(input.idempotencyKey)
  const existing = Schema.decodeUnknownSync(Schema.optional(Existing))(
    existingRaw,
  )
  if (existing !== undefined) {
    if (existing.semantic_key !== semanticKey)
      return { outcome: 'rejected', reason: 'InvalidInput' }
    try {
      return Schema.decodeUnknownSync(CapturedFrameResultSchema)(
        JSON.parse(existing.response),
      )
    } catch {
      return { outcome: 'rejected', reason: 'InvalidInput' }
    }
  }

  let finalPath = ''
  let temporary = ''
  try {
    mkdirSync(storage.originalsRoot, { recursive: true })
    finalPath = appPath(
      storage.originalsRoot,
      `${input.assetId}.${input.format}`,
    )
    temporary = appPath(storage.originalsRoot, `.${input.assetId}.tmp`)
    if (existsSync(finalPath)) throw new Error('duplicate original')
    writeFileSync(temporary, bytes, { flag: 'wx' })
    renameSync(temporary, finalPath)
    temporary = ''
  } catch {
    if (temporary && existsSync(temporary)) rmSync(temporary)
    return { outcome: 'rejected', reason: 'MaterializationFailed' }
  }

  try {
    database.exec('BEGIN IMMEDIATE')
    const cursor = nextCursor(database)
    const result: CapturedFrameResult = {
      outcome: 'accepted',
      assetId: input.assetId,
      checksum,
      cursor,
    }
    const capturedAt = input.capturedAt
    const detail = {
      assetId: input.assetId,
      revision: 1,
      role: 'original',
      format: input.format,
      availability: 'availableLocally',
      capturedAt,
      comparisonGroupId: `${input.lineage.runId}-${input.lineage.sequenceId}`,
      lineage: {
        sourceAssetIds: [],
        runId: input.lineage.runId,
        solveAttemptId: input.lineage.acquisitionId,
        sequenceId: input.lineage.sequenceId,
        acquisitionId: input.lineage.acquisitionId,
      },
      capture: { frameId: input.frameId, ...input.capture },
      representations: [
        { label: 'Immutable captured original retained', state: 'available' },
      ],
    }
    database
      .prepare('INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(
        input.assetId,
        1,
        'original',
        input.format,
        'availableLocally',
        detail.comparisonGroupId,
        capturedAt,
        capturedAt,
        0,
        JSON.stringify(detail),
      )
    database
      .prepare('INSERT INTO captured_frame_events VALUES (?,?,?)')
      .run(input.assetId, 'CapturedFrameMaterialized', checksum)
    database
      .prepare('UPDATE state SET value=? WHERE key=?')
      .run(JSON.stringify(cursor), 'eventCursor')
    database
      .prepare('UPDATE state SET value=? WHERE key=?')
      .run(
        JSON.stringify(readStateNumber(database, 'snapshotVersion') + 1),
        'snapshotVersion',
      )
    database
      .prepare('INSERT INTO events VALUES (?,?,?)')
      .run(
        cursor,
        'CapturedFrameMaterialized',
        JSON.stringify({ assetId: input.assetId, checksum }),
      )
    database
      .prepare('INSERT INTO captured_frame_receipts VALUES (?,?,?)')
      .run(input.idempotencyKey, semanticKey, JSON.stringify(result))
    database.exec('COMMIT')
    return result
  } catch {
    try {
      database.exec('ROLLBACK')
    } catch {}
    try {
      database
        .prepare('INSERT OR IGNORE INTO captured_frame_orphans VALUES (?,?,?)')
        .run(finalPath, checksum, new Date().toISOString())
    } catch {}
    return { outcome: 'rejected', reason: 'MaterializationFailed' }
  }
}

const CapturedFrameResultSchema = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal('accepted'),
    assetId: Schema.String,
    checksum: Schema.String,
    cursor: Schema.Int,
  }),
  Schema.Struct({
    outcome: Schema.Literal('rejected'),
    reason: Schema.Literals(['InvalidInput', 'MaterializationFailed']),
  }),
])
const StoredValue = Schema.Struct({ value: Schema.String })
const readStateNumber = (database: DatabaseSync, key: string) =>
  Number(
    JSON.parse(
      Schema.decodeUnknownSync(StoredValue)(
        database.prepare('SELECT value FROM state WHERE key=?').get(key),
      ).value,
    ),
  )
const nextCursor = (database: DatabaseSync) =>
  readStateNumber(database, 'eventCursor') + 1
const appPath = (root: string, child: string) => {
  const base = resolve(root)
  const path = resolve(base, child)
  if (relative(base, path).startsWith('..') || relative(base, path) === '')
    throw new Error('path escape')
  return path
}
