import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
    if (existsSync(finalPath)) {
      const retainedChecksum = fileChecksum(finalPath)
      if (retainedChecksum !== checksum) {
        recordCapturedFrameOrphan(database, finalPath, retainedChecksum)
        if (existsSync(temporary)) rmSync(temporary)
        return { outcome: 'rejected', reason: 'MaterializationFailed' }
      }
      if (existsSync(temporary)) rmSync(temporary)
    } else {
      if (existsSync(temporary)) {
        if (fileChecksum(temporary) === checksum) {
          renameSync(temporary, finalPath)
          temporary = ''
        } else rmSync(temporary)
      }
      if (!existsSync(finalPath)) {
        writeFileSync(temporary, bytes, { flag: 'wx' })
        renameSync(temporary, finalPath)
      }
    }
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
      equipment: input.equipment,
      lineage: {
        sourceAssetIds: [],
        runId: input.lineage.runId,
        solveAttemptId: input.lineage.acquisitionId,
        sequenceId: input.lineage.sequenceId,
        acquisitionId: input.lineage.acquisitionId,
      },
      capture: { frameId: input.frameId, ...input.capture },
      provenance: {
        source: 'alpaca-imagearray',
        checksum,
        ...(input.format === 'fits'
          ? { fitsHeader: safeFitsHeader(bytes) }
          : {}),
        ...(input.format === 'cameraRaw'
          ? { imageBytesHeader: safeImageBytesHeader(bytes) }
          : {}),
      },
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
    database
      .prepare('DELETE FROM captured_frame_orphans WHERE path=? AND checksum=?')
      .run(finalPath, checksum)
    database.exec('COMMIT')
    return result
  } catch {
    try {
      database.exec('ROLLBACK')
    } catch {}
    recordCapturedFrameOrphan(database, finalPath, checksum)
    return { outcome: 'rejected', reason: 'MaterializationFailed' }
  }
}

function fileChecksum(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function recordCapturedFrameOrphan(
  database: DatabaseSync,
  path: string,
  checksum: string,
) {
  try {
    database
      .prepare('INSERT OR IGNORE INTO captured_frame_orphans VALUES (?,?,?)')
      .run(path, checksum, new Date().toISOString())
  } catch {}
}

function safeFitsHeader(bytes: Uint8Array) {
  const text = new TextDecoder('ascii').decode(bytes.slice(0, 64 * 1024))
  const facts: Record<string, string | number | boolean> = {}
  for (let offset = 0; offset + 80 <= text.length; offset += 80) {
    const card = text.slice(offset, offset + 80)
    const key = card.slice(0, 8).trim()
    if (key === 'END') break
    if (
      ![
        'SIMPLE',
        'BITPIX',
        'NAXIS',
        'NAXIS1',
        'NAXIS2',
        'EXPTIME',
        'DATE-OBS',
        'INSTRUME',
        'FILTER',
      ].includes(key) ||
      card[8] !== '='
    )
      continue
    const value = card.slice(10, 80).split('/')[0]?.trim().replace(/^'|'$/g, '')
    if (value === undefined || value.length === 0 || value.length > 80) continue
    if (/^-?\d+(?:\.\d+)?$/.test(value)) facts[key] = Number(value)
    else if (value === 'T' || value === 'F') facts[key] = value === 'T'
    else facts[key] = value
  }
  return facts
}

function safeImageBytesHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    headerVersion: view.getUint32(0, true),
    dataStart: view.getUint32(16, true),
    imageElementType: view.getUint32(20, true),
    transmissionElementType: view.getUint32(24, true),
    rank: view.getUint32(28, true),
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
