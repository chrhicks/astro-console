import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import type {
  PipelineStage,
  PublisherWorkResult,
} from '../observability/pipeline-telemetry.ts'
import type {
  SqliteBacklogObserver,
  SqliteTraceSync,
} from '../observability/sqlite-telemetry.ts'

const Work = Schema.Struct({ assetId: Schema.String, checksum: Schema.String })
const Asset = Schema.Struct({
  asset_id: Schema.String,
  role: Schema.Literals(['linearMaster', 'final']),
  format: Schema.Literals(['fits', 'tiff']),
  detail: Schema.String,
})
const AssetDetail = Schema.Struct({
  assetId: Schema.String,
  lineage: Schema.Struct({ runId: Schema.NonEmptyString }),
})
const Publication = Schema.Struct({
  checksum: Schema.String,
  object_key: Schema.String,
  state: Schema.Literals([
    'published',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
})
const ClaimedWork = Schema.Struct({ id: Schema.String, payload: Schema.String })
const CountRow = Schema.Struct({ count: Schema.Int })
export type PublisherFile = {
  readonly path: string
  readonly bytes: number
  readonly checksum: string
}
export type PublisherProvider = {
  readonly put: (
    key: string,
    file: PublisherFile,
    metadata: { readonly assetId: string; readonly checksum: string },
  ) => Promise<void>
  readonly head: (
    key: string,
  ) => Promise<
    { readonly checksum: string; readonly bytes: number } | undefined
  >
}

export function createPublisherWorker(
  database: DatabaseSync,
  storage: { readonly outputsRoot: string },
  provider: PublisherProvider,
  observability: {
    readonly traceWork?: (
      run: () => Promise<PublisherWorkResult>,
    ) => Promise<PublisherWorkResult>
    readonly traceStage?: <A>(
      stage: Extract<PipelineStage, `publisher.${string}`>,
      run: () => Promise<A>,
    ) => Promise<A>
    readonly traceSqlite?: SqliteTraceSync
    readonly observeSqliteBacklog?: SqliteBacklogObserver
  } = {},
) {
  const traceStage = <A>(
    stage: Extract<PipelineStage, `publisher.${string}`>,
    run: () => Promise<A>,
  ) =>
    observability.traceStage === undefined
      ? run()
      : observability.traceStage(stage, run)
  const traceSqlite: SqliteTraceSync =
    observability.traceSqlite ?? ((_operation, run) => run())
  const pass = async (workerId = 'publisher-worker') => {
    const token = randomUUID()
    const now = new Date().toISOString()
    let transactionOpen = false
    database.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    try {
      database
        .prepare(
          "UPDATE outbox SET state='failed',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error='publisher lease expired',retry_after=? WHERE kind='PublishAsset' AND state='claimed' AND claim_until<=?",
        )
        .run(now, now)
      const backlog = Schema.decodeUnknownSync(CountRow)(
        database
          .prepare(
            "SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset' AND state IN ('pending','failed') AND (retry_after IS NULL OR retry_after<=?)",
          )
          .get(now),
      ).count
      observability.observeSqliteBacklog?.('publisher', backlog)
      if (backlog === 0) {
        database.exec('COMMIT')
        transactionOpen = false
        return 'none' as const
      }
      const work = traceSqlite('publisher.outbox.claim', () => {
        const raw: unknown = database
          .prepare(
            "SELECT id,payload FROM outbox WHERE kind='PublishAsset' AND state IN ('pending','failed') AND (retry_after IS NULL OR retry_after<=?) ORDER BY rowid LIMIT 1",
          )
          .get(now)
        const selected = Schema.decodeUnknownSync(Schema.optional(ClaimedWork))(
          raw,
        )
        if (selected === undefined) return undefined
        const claimed = database
          .prepare(
            "UPDATE outbox SET state='claimed',claim_token=?,claimed_by=?,claim_until=?,attempts=attempts+1 WHERE id=? AND state IN ('pending','failed')",
          )
          .run(
            token,
            workerId,
            new Date(Date.now() + 30_000).toISOString(),
            selected.id,
          )
        return claimed.changes === 1 ? selected : undefined
      })
      database.exec('COMMIT')
      transactionOpen = false
      if (work === undefined) {
        return 'none' as const
      }
      const run = () => publish(work, token)
      return await (observability.traceWork === undefined
        ? run()
        : observability.traceWork(run))
    } catch (error) {
      if (transactionOpen)
        try {
          database.exec('ROLLBACK')
        } catch {}
      throw error
    }
  }
  const publish = async (claimed: typeof ClaimedWork.Type, token: string) => {
    let work: typeof Work.Type | undefined
    let asset: typeof Asset.Type | undefined
    let detail: typeof AssetDetail.Type | undefined
    try {
      work = Schema.decodeUnknownSync(Work)(JSON.parse(claimed.payload))
      const raw: unknown = database
        .prepare(
          'SELECT asset_id,role,format,detail FROM library_assets WHERE asset_id=?',
        )
        .get(work.assetId)
      asset = Schema.decodeUnknownSync(Asset)(raw)
      detail = Schema.decodeUnknownSync(AssetDetail)(JSON.parse(asset.detail))
    } catch {
      return settleFailure(
        claimed.id,
        token,
        work?.assetId,
        'temporarilyUnavailable',
        'publisher provider failed',
      )
    }
    if (work === undefined || asset === undefined || detail === undefined)
      return settleFailure(
        claimed.id,
        token,
        work?.assetId,
        'temporarilyUnavailable',
        'publisher provider failed',
      )
    if (detail.assetId !== asset.asset_id)
      return settleFailure(
        claimed.id,
        token,
        asset.asset_id,
        'failedPublication',
        'asset detail identity mismatch',
      )
    let file: PublisherFile
    try {
      file = await traceStage('publisher.localRead', async () => {
        const path = outputPath(storage.outputsRoot, asset)
        return checksumFile(path)
      })
    } catch {
      return settleFailure(
        claimed.id,
        token,
        work.assetId,
        'temporarilyUnavailable',
        'publisher provider failed',
      )
    }
    if (file.checksum !== work.checksum)
      return settleFailure(
        claimed.id,
        token,
        asset.asset_id,
        'failedPublication',
        'local checksum mismatch',
      )
    let publication: typeof Publication.Type | undefined
    try {
      const publicationRaw: unknown = database
        .prepare(
          'SELECT checksum,object_key,state FROM asset_publications WHERE asset_id=?',
        )
        .get(asset.asset_id)
      publication = Schema.decodeUnknownSync(Schema.optional(Publication))(
        publicationRaw,
      )
    } catch {
      return settleFailure(
        claimed.id,
        token,
        work.assetId,
        'temporarilyUnavailable',
        'publisher provider failed',
      )
    }
    if (publication !== undefined && publication.checksum !== work.checksum)
      return settleFailure(
        claimed.id,
        token,
        asset.asset_id,
        'failedPublication',
        'publication checksum conflict',
      )
    const key = publication?.object_key
      ? publication.object_key
      : publicationKey(asset, detail.lineage.runId, work.checksum)
    let transactionOpen = false
    database.exec('BEGIN IMMEDIATE')
    transactionOpen = true
    try {
      database
        .prepare(
          'INSERT INTO asset_publications (asset_id,checksum,object_key,state,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET checksum=excluded.checksum,object_key=excluded.object_key,state=excluded.state,updated_at=excluded.updated_at WHERE asset_publications.checksum=excluded.checksum',
        )
        .run(
          asset.asset_id,
          work.checksum,
          key,
          'temporarilyUnavailable',
          new Date().toISOString(),
        )
      database.exec('COMMIT')
      transactionOpen = false
    } catch (error) {
      if (transactionOpen)
        try {
          database.exec('ROLLBACK')
        } catch {}
      throw error
    }
    let verified:
      { readonly checksum: string; readonly bytes: number } | undefined
    try {
      await traceStage('publisher.put', () =>
        provider.put(key, file, {
          assetId: asset.asset_id,
          checksum: work.checksum,
        }),
      )
      verified = await traceStage('publisher.verify', () => provider.head(key))
    } catch {
      return settleFailure(
        claimed.id,
        token,
        asset.asset_id,
        'temporarilyUnavailable',
        'publisher provider failed',
      )
    }
    if (verified?.checksum !== work.checksum || verified.bytes !== file.bytes)
      return settleFailure(
        claimed.id,
        token,
        asset.asset_id,
        'failedPublication',
        'provider verification failed',
      )
    return settlePublished(claimed.id, token, asset, work.checksum)
  }
  const settlePublishedUntraced = (
    outboxId: string,
    token: string,
    asset: typeof Asset.Type,
    checksum: string,
  ) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const acknowledged = database
        .prepare(
          "UPDATE outbox SET state='dispatched',ack_at=?,claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error=NULL WHERE id=? AND state='claimed' AND claim_token=?",
        )
        .run(new Date().toISOString(), outboxId, token)
      if (acknowledged.changes !== 1) {
        database.exec('COMMIT')
        return 'superseded' as const
      }
      database
        .prepare(
          "UPDATE asset_publications SET state='published',updated_at=? WHERE asset_id=? AND checksum=?",
        )
        .run(new Date().toISOString(), asset.asset_id, checksum)
      projectAvailability(asset.asset_id, 'published')
      database.exec('COMMIT')
      return 'published' as const
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  const settlePublished = (
    outboxId: string,
    token: string,
    asset: typeof Asset.Type,
    checksum: string,
  ) =>
    traceStage('publisher.settle', async () =>
      traceSqlite('publisher.outbox.settle', () =>
        settlePublishedUntraced(outboxId, token, asset, checksum),
      ),
    )
  const settleFailureUntraced = (
    outboxId: string,
    token: string,
    assetId: string | undefined,
    state: (typeof Publication.Type)['state'],
    message: string,
  ) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const failed = database
        .prepare(
          "UPDATE outbox SET state='failed',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error=?,retry_after=? WHERE id=? AND state='claimed' AND claim_token=?",
        )
        .run(message, new Date().toISOString(), outboxId, token)
      if (failed.changes !== 1) {
        database.exec('COMMIT')
        return 'superseded' as const
      }
      if (assetId !== undefined) {
        const checksumRaw: unknown = database
          .prepare(
            'SELECT checksum,object_key,state FROM asset_publications WHERE asset_id=?',
          )
          .get(assetId)
        const publication = Schema.decodeUnknownSync(
          Schema.optional(Publication),
        )(checksumRaw)
        if (publication !== undefined)
          database
            .prepare(
              'UPDATE asset_publications SET state=?,updated_at=? WHERE asset_id=?',
            )
            .run(state, new Date().toISOString(), assetId)
        projectAvailability(assetId, state)
      }
      database.exec('COMMIT')
      return 'failed' as const
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  const settleFailure = (
    outboxId: string,
    token: string,
    assetId: string | undefined,
    state: (typeof Publication.Type)['state'],
    message: string,
  ) =>
    traceStage('publisher.settle', async () =>
      traceSqlite('publisher.outbox.settle', () =>
        settleFailureUntraced(outboxId, token, assetId, state, message),
      ),
    )
  const projectAvailability = (
    assetId: string,
    availability: 'published' | 'temporarilyUnavailable' | 'failedPublication',
  ) => {
    const raw: unknown = database
      .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
      .get(assetId)
    const row = Schema.decodeUnknownSync(
      Schema.Struct({ detail: Schema.String }),
    )(raw)
    const detail = Schema.decodeUnknownSync(
      Schema.Struct({
        assetId: Schema.String,
        revision: Schema.Int,
        role: Schema.String,
        format: Schema.String,
        availability: Schema.String,
        capturedAt: Schema.String,
        comparisonGroupId: Schema.String,
        lineage: Schema.Unknown,
        representations: Schema.Array(
          Schema.Struct({ label: Schema.String, state: Schema.String }),
        ),
      }),
    )(JSON.parse(row.detail))
    database
      .prepare(
        'UPDATE library_assets SET availability=?,detail=?,updated_at=? WHERE asset_id=?',
      )
      .run(
        availability,
        JSON.stringify({
          ...detail,
          availability,
          representations: [
            {
              label:
                availability === 'published'
                  ? 'Published representation verified'
                  : 'Published representation temporarily unavailable',
              state: availability,
            },
          ],
        }),
        new Date().toISOString(),
        assetId,
      )
  }
  return { pass }
}

function outputPath(root: string, asset: typeof Asset.Type) {
  if (!/^asset-process-[0-9a-f-]+$/.test(asset.asset_id))
    throw new Error('asset identity is invalid')
  const resolvedRoot = resolve(root)
  const path = resolve(resolvedRoot, `${asset.asset_id}.${asset.format}`)
  if (relative(resolvedRoot, path).startsWith('..'))
    throw new Error('asset path escapes output root')
  return path
}
function publicationKey(
  asset: typeof Asset.Type,
  runId: string,
  checksum: string,
) {
  return `published/${runId}/${asset.role === 'final' ? 'finals' : 'intermediates'}/${asset.asset_id}-${checksum}.${asset.format}`
}
async function checksumFile(path: string): Promise<PublisherFile> {
  const checksum = createHash('sha256')
  const bytes = statSync(path).size
  for await (const chunk of createReadStream(path, {
    highWaterMark: 64 * 1024,
  }))
    checksum.update(chunk)
  return { path, bytes, checksum: checksum.digest('hex') }
}
