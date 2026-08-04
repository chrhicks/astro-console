import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Effect, Schema } from 'effect'
import { FrameInspection } from '@astro-console/v2-contracts'

const AssetRow = Schema.Struct({
  asset_id: Schema.String,
  format: Schema.Literals(['fits', 'tiff']),
  detail: Schema.String,
})
const EventRow = Schema.Struct({ checksum: Schema.String })
const Detail = Schema.Struct({
  assetId: Schema.String,
  inspection: Schema.optionalKey(FrameInspection),
})

export type FrameInspectionStorage = {
  readonly originalsRoot: string
  readonly previewsRoot: string
}
export type FrameInspectionResult = {
  readonly inspection: typeof FrameInspection.Type
  readonly cursor: number
}

/** Deterministic local inspection only; it never invokes an image processor. */
export const inspectCapturedFrame = Effect.fn('Server.inspectCapturedFrame')(
  function* (
    database: DatabaseSync,
    storage: FrameInspectionStorage,
    assetId: string,
  ) {
    const asset = yield* Effect.sync(() =>
      Schema.decodeUnknownSync(Schema.optional(AssetRow))(
        database
          .prepare(
            'SELECT asset_id,format,detail FROM library_assets WHERE asset_id=?',
          )
          .get(assetId),
      ),
    )
    if (asset === undefined)
      return yield* Effect.die(new Error('unknown captured asset'))
    const event = Schema.decodeUnknownSync(Schema.optional(EventRow))(
      database
        .prepare('SELECT checksum FROM captured_frame_events WHERE asset_id=?')
        .get(assetId),
    )
    const inspection = inspect(asset, event?.checksum, storage)
    const existing = Schema.decodeUnknownSync(Detail)(
      JSON.parse(asset.detail),
    ).inspection
    if (
      existing !== undefined &&
      JSON.stringify(existing) === JSON.stringify(inspection)
    )
      return {
        inspection,
        cursor: stateNumber(database, 'eventCursor'),
      } satisfies FrameInspectionResult
    const cursor = stateNumber(database, 'eventCursor') + 1
    const detail = { ...JSON.parse(asset.detail), inspection }
    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          'INSERT INTO frame_inspections VALUES (?,?,?) ON CONFLICT(asset_id) DO UPDATE SET state=excluded.state,detail=excluded.detail',
        )
        .run(assetId, inspection._tag, JSON.stringify(inspection))
      database
        .prepare(
          'UPDATE library_assets SET detail=?,updated_at=? WHERE asset_id=?',
        )
        .run(JSON.stringify(detail), new Date().toISOString(), assetId)
      database
        .prepare('UPDATE state SET value=? WHERE key=?')
        .run(JSON.stringify(cursor), 'eventCursor')
      database
        .prepare('UPDATE state SET value=? WHERE key=?')
        .run(
          JSON.stringify(stateNumber(database, 'snapshotVersion') + 1),
          'snapshotVersion',
        )
      database
        .prepare('INSERT INTO events VALUES (?,?,?)')
        .run(
          cursor,
          'FrameInspectionUpdated',
          JSON.stringify({ assetId, inspection }),
        )
      database.exec('COMMIT')
      return { inspection, cursor } satisfies FrameInspectionResult
    } catch (cause) {
      database.exec('ROLLBACK')
      return yield* Effect.die(cause)
    }
  },
)

function inspect(
  asset: typeof AssetRow.Type,
  checksum: string | undefined,
  storage: FrameInspectionStorage,
): typeof FrameInspection.Type {
  const source = join(
    storage.originalsRoot,
    `${asset.asset_id}.${asset.format}`,
  )
  if (!existsSync(source))
    return FrameInspection.cases.Unavailable.make({
      summary: 'The immutable original is not available for inspection.',
    })
  const bytes = readFileSync(source)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (checksum === undefined || actual !== checksum)
    return FrameInspection.cases.Failed.make({
      summary: 'The retained original did not match its recorded checksum.',
      diagnosticRef: `checksum:${actual}`,
    })
  const previewBytes = Buffer.from(`deterministic-preview-v1:${checksum}`)
  mkdirSync(storage.previewsRoot, { recursive: true })
  const previewChecksum = createHash('sha256')
    .update(previewBytes)
    .digest('hex')
  writeFileSync(
    join(storage.previewsRoot, `${asset.asset_id}.png`),
    previewBytes,
  )
  const sharpness = parseInt(checksum.slice(0, 2), 16)
  const accepted = sharpness >= 32
  return FrameInspection.cases.Available.make({
    preview: {
      format: 'png',
      checksum: previewChecksum,
      provenance: {
        algorithm: 'deterministic-fixture-v1',
        sourceChecksum: checksum,
      },
    },
    metrics: {
      clippingPercent: parseInt(checksum.slice(2, 4), 16) % 8,
      framing: accepted ? 'inFrame' : 'attention',
      sharpness,
      shape: parseInt(checksum.slice(4, 6), 16),
      driftArcsec: parseInt(checksum.slice(6, 8), 16) % 20,
    },
    rationale: {
      decision: accepted ? 'accepted' : 'rejected',
      summary: accepted
        ? 'Deterministic inspection accepts this retained fixture frame.'
        : 'Deterministic inspection rejects this retained fixture frame for low sharpness.',
    },
  })
}
const StoredValue = Schema.Struct({ value: Schema.String })
const stateNumber = (database: DatabaseSync, key: string) =>
  Number(
    JSON.parse(
      Schema.decodeUnknownSync(StoredValue)(
        database.prepare('SELECT value FROM state WHERE key=?').get(key),
      ).value,
    ),
  )
