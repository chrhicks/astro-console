import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import type { LocalIdentity } from './identity.ts'

const Input = Schema.Struct({
  assetId: Schema.String.check(
    Schema.isPattern(/^asset-source-[a-z0-9-]{1,96}$/),
  ),
  sourceId: Schema.NonEmptyString,
  format: Schema.Literals(['fits', 'tiff']),
  capturedAt: Schema.NonEmptyString,
  comparisonGroupId: Schema.NonEmptyString,
  lineage: Schema.Struct({
    runId: Schema.NonEmptyString,
    solveAttemptId: Schema.NonEmptyString,
  }),
  idempotencyKey: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
})
const Existing = Schema.Struct({
  semantic_key: Schema.String,
  response: Schema.String,
})
export type SourceIngestStorage = {
  readonly sourcesRoot: string
  readonly originalsRoot: string
  readonly sources: Readonly<Record<string, string>>
}
export type SourceIngestResult =
  | { readonly outcome: 'accepted'; readonly assetId: string }
  | {
      readonly outcome: 'rejected'
      readonly reason:
        | 'OwnerRequired'
        | 'ClientReadOnly'
        | 'InvalidInput'
        | 'MaterializationFailed'
    }

export function ingestSourceAsset(
  database: DatabaseSync,
  storage: SourceIngestStorage,
  raw: unknown,
  identity: LocalIdentity,
): SourceIngestResult {
  if (identity.role !== 'owner')
    return { outcome: 'rejected', reason: 'OwnerRequired' }
  if (identity.capability !== 'controlCapable')
    return { outcome: 'rejected', reason: 'ClientReadOnly' }
  let input: typeof Input.Type
  try {
    input = Schema.decodeUnknownSync(Input)(raw)
  } catch {
    return { outcome: 'rejected', reason: 'InvalidInput' }
  }
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        assetId: input.assetId,
        sourceId: input.sourceId,
        format: input.format,
        capturedAt: input.capturedAt,
        comparisonGroupId: input.comparisonGroupId,
        lineage: input.lineage,
        ownerPersonId: identity.personId,
      }),
    )
    .digest('hex')
  const existingRaw: unknown = database
    .prepare(
      'SELECT semantic_key,response FROM source_ingest_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(Schema.optional(Existing))(
    existingRaw,
  )
  if (existing !== undefined) {
    try {
      return existing.semantic_key === semanticKey
        ? Schema.decodeUnknownSync(
            Schema.Struct({
              outcome: Schema.Literal('accepted'),
              assetId: Schema.String,
            }),
          )(JSON.parse(existing.response))
        : { outcome: 'rejected', reason: 'InvalidInput' }
    } catch {
      return { outcome: 'rejected', reason: 'InvalidInput' }
    }
  }
  let finalPath = ''
  let temporary = ''
  let checksum = ''
  try {
    const source = sourcePath(storage, input.sourceId)
    mkdirSync(storage.originalsRoot, { recursive: true })
    finalPath = appPath(
      storage.originalsRoot,
      `${input.assetId}.${input.format}`,
    )
    temporary = appPath(storage.originalsRoot, `.${input.assetId}.tmp`)
    if (existsSync(finalPath)) throw new Error('duplicate bytes')
    copyFileSync(source, temporary)
    checksum = createHash('sha256')
      .update(readFileSync(temporary))
      .digest('hex')
    renameSync(temporary, finalPath)
    temporary = ''
  } catch {
    if (temporary && existsSync(temporary)) rmSync(temporary)
    return { outcome: 'rejected', reason: 'MaterializationFailed' }
  }
  try {
    const result: SourceIngestResult = {
      outcome: 'accepted',
      assetId: input.assetId,
    }
    const detail = {
      assetId: input.assetId,
      revision: 1,
      role: 'original',
      format: input.format === 'fits' ? 'fits' : 'tiff',
      availability: 'availableLocally',
      capturedAt: input.capturedAt,
      comparisonGroupId: input.comparisonGroupId,
      lineage: {
        sourceAssetIds: [],
        runId: input.lineage.runId,
        solveAttemptId: input.lineage.solveAttemptId,
      },
      representations: [
        { label: 'Immutable local original retained', state: 'available' },
      ],
    }
    database.exec('BEGIN IMMEDIATE')
    database
      .prepare('INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(
        input.assetId,
        1,
        'original',
        detail.format,
        'availableLocally',
        input.comparisonGroupId,
        input.capturedAt,
        new Date().toISOString(),
        0,
        JSON.stringify(detail),
      )
    database
      .prepare('INSERT INTO source_ingest_events VALUES (?,?,?)')
      .run(input.assetId, 'SourceIngested', checksum)
    database
      .prepare('INSERT INTO source_ingest_receipts VALUES (?,?,?,?)')
      .run(
        input.idempotencyKey,
        identity.personId,
        semanticKey,
        JSON.stringify(result),
      )
    database.exec('COMMIT')
    return result
  } catch {
    try {
      database.exec('ROLLBACK')
    } catch {}
    if (existsSync(finalPath)) {
      try {
        database
          .prepare('INSERT OR IGNORE INTO source_ingest_orphans VALUES (?,?,?)')
          .run(finalPath, checksum, new Date().toISOString())
      } catch {}
    }
    return { outcome: 'rejected', reason: 'MaterializationFailed' }
  }
}

function sourcePath(storage: SourceIngestStorage, sourceId: string) {
  const configured = storage.sources[sourceId]
  if (configured === undefined) throw new Error('unknown source')
  const path = appPath(storage.sourcesRoot, configured)
  if (lstatSync(path).isSymbolicLink()) throw new Error('symlink source')
  return path
}
function appPath(root: string, child: string) {
  const base = resolve(root)
  const path = resolve(base, child)
  if (relative(base, path).startsWith('..') || relative(base, path) === '')
    throw new Error('path escape')
  return path
}
