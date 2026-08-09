import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Schema } from 'effect'
import {
  LibraryQuery,
  ObserveLiveFrameReview,
} from '@astro-console/v2-contracts'
import { ReviewAssetRequest } from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import { body } from './request-body.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import { sqliteLibraryServiceLayer } from '../persistence/library-sqlite-repository.ts'
import {
  LibraryInputInvalid,
  LibraryService,
} from '../services/library-service.ts'
import { planWorkspaceProjection } from '../services/runtime-bootstrap.ts'
import { json, responseHeaders } from './response.ts'
import { tracedLibraryOperation } from '../observability/library-telemetry.ts'

export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}
const ReviewAssetRow = Schema.Struct({
  revision: Schema.Int,
  detail: Schema.String,
})
const ReviewReceiptRow = Schema.Struct({ response: Schema.String })
const ReviewRow = Schema.Struct({ revision: Schema.Int, review: Schema.String })
const StateValueRow = Schema.Struct({ value: Schema.String })

export function workspace(
  response: ServerResponse,
  db: DatabaseSync,
  name: 'plan',
) {
  return json(response, 200, planWorkspaceProjection(db, name))
}

export function processWorkspace(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
  snapshotVersion: () => number,
) {
  const sourceAssetId = url.searchParams.get('sourceAssetId')
  if (sourceAssetId !== null) {
    return LibraryService.pipe(
      Effect.flatMap((library) => library.processSource(sourceAssetId)),
      Effect.map((body) => ({ status: 200, body })),
      Effect.catchTags({
        'Server.LibraryInputInvalid': () =>
          Effect.succeed({ status: 400, reason: 'InvalidInput' }),
        'Server.LibraryAssetNotFound': () =>
          Effect.succeed({ status: 404, reason: 'AssetNotFound' }),
        'Server.LibraryAssetUnavailable': () =>
          Effect.succeed({ status: 409, reason: 'AssetUnavailable' }),
        'Server.LibraryPersistenceUnavailable': () =>
          Effect.succeed({ status: 503, reason: 'LibraryUnavailable' }),
      }),
      Effect.provide(sqliteLibraryServiceLayer(db, snapshotVersion)),
      Effect.map((result) => {
        if ('reason' in result)
          return json(response, result.status, {
            outcome: 'rejected',
            reason: result.reason,
            ...(result.status === 409
              ? {
                  message:
                    'This asset is temporarily unavailable and cannot open in Process.',
                }
              : {}),
          })
        return json(response, result.status, result.body)
      }),
    )
  }
  return Effect.sync(() =>
    json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' }),
  )
}
export function libraryPage(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
  snapshotVersion: () => number,
) {
  const operation = decodeLibraryQuery(url).pipe(
    Effect.flatMap((query) =>
      LibraryService.pipe(Effect.flatMap((library) => library.page(query))),
    ),
    Effect.map((body) => ({ status: 200, body })),
    Effect.catchTags({
      'Server.LibraryInputInvalid': () =>
        Effect.succeed({ status: 400, body: libraryInvalidBody }),
      'Server.LibraryPersistenceUnavailable': () =>
        Effect.succeed({ status: 503, body: libraryUnavailableBody }),
    }),
    Effect.provide(sqliteLibraryServiceLayer(db, snapshotVersion)),
    Effect.map((result) => json(response, result.status, result.body)),
  )
  return tracedLibraryOperation(response, 'catalog.page', operation)
}
function decodeLibraryQuery(url: URL) {
  const allowed = new Set(['queryId', 'cursor', 'pageSize', 'role', 'sort'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
    return Effect.fail(new LibraryInputInvalid())
  const cursor = url.searchParams.get('cursor')
  const pageSize = url.searchParams.get('pageSize') ?? '40'
  if (cursor !== null && !/^\d+$/.test(cursor))
    return Effect.fail(new LibraryInputInvalid())
  if (!/^\d+$/.test(pageSize)) return Effect.fail(new LibraryInputInvalid())
  return Schema.decodeUnknownEffect(LibraryQuery)({
    queryId: url.searchParams.get('queryId') ?? 'library-m27',
    ...(cursor === null ? {} : { cursor }),
    pageSize: Number(pageSize),
    ...(url.searchParams.get('role') === null
      ? {}
      : { role: url.searchParams.get('role') }),
    sort: url.searchParams.get('sort') ?? 'capturedAtDescending',
  }).pipe(Effect.mapError(() => new LibraryInputInvalid()))
}
export function libraryDetail(
  response: ServerResponse,
  db: DatabaseSync,
  encodedAssetId: string,
  snapshotVersion: () => number,
) {
  const operation = LibraryService.pipe(
    Effect.flatMap((library) => library.detail(decodedAssetId(encodedAssetId))),
    Effect.map((body) => ({ status: 200, body })),
    Effect.catchTags({
      'Server.LibraryInputInvalid': () =>
        Effect.succeed({ status: 400, body: libraryInvalidBody }),
      'Server.LibraryAssetNotFound': () =>
        Effect.succeed({ status: 404, body: libraryNotFoundBody }),
      'Server.LibraryPersistenceUnavailable': () =>
        Effect.succeed({ status: 503, body: libraryUnavailableBody }),
    }),
    Effect.provide(sqliteLibraryServiceLayer(db, snapshotVersion)),
    Effect.map((result) => json(response, result.status, result.body)),
  )
  return tracedLibraryOperation(response, 'asset.detail', operation)
}
const previewLimitBytes = 64 * 1024
const previewRefreshMs = 1_000
const previewConcurrentLimit = 2
export function createLibraryPreviewHandler(previewsRoot: string) {
  let active = 0
  const lastDelivered = new Map<string, number>()
  return async function libraryPreview(
    response: ServerResponse,
    db: DatabaseSync,
    encodedAssetId: string,
    identity: LocalIdentity,
    snapshotVersion: () => number,
  ) {
    const assetId = decodedAssetId(encodedAssetId)
    if (!/^[A-Za-z0-9-]+$/.test(assetId))
      return json(response, 400, {
        outcome: 'rejected',
        reason: 'InvalidInput',
      })
    const now = Date.now()
    if ((lastDelivered.get(identity.clientId) ?? 0) + previewRefreshMs > now)
      return json(response, 429, {
        outcome: 'rejected',
        reason: 'PreviewRefreshLimited',
      })
    if (active >= previewConcurrentLimit)
      return json(response, 429, { outcome: 'rejected', reason: 'PreviewBusy' })
    active += 1
    try {
      const detail = await Effect.runPromise(
        LibraryService.pipe(
          Effect.flatMap((library) => library.detail(assetId)),
          Effect.provide(sqliteLibraryServiceLayer(db, snapshotVersion)),
        ),
      )
      if (detail.inspection?._tag !== 'Available')
        return json(response, 409, {
          outcome: 'rejected',
          reason: 'PreviewUnavailable',
        })
      const path = join(previewsRoot, `${assetId}.png`)
      const metadata = await stat(path)
      if (metadata.size > previewLimitBytes)
        return json(response, 413, {
          outcome: 'rejected',
          reason: 'PreviewTooLarge',
        })
      const bytes = await readFile(path)
      lastDelivered.set(identity.clientId, now)
      return response
        .writeHead(200, {
          ...responseHeaders('image/png', 'private, no-store'),
          'content-length': String(bytes.byteLength),
          'x-astro-preview-max-bytes': String(previewLimitBytes),
          'x-astro-preview-refresh-ms': String(previewRefreshMs),
          'x-astro-preview-concurrent-limit': String(previewConcurrentLimit),
        })
        .end(bytes)
    } catch {
      return json(response, 409, {
        outcome: 'rejected',
        reason: 'PreviewUnavailable',
      })
    } finally {
      active -= 1
    }
  }
}

export async function observeLiveFrameReview(
  response: ServerResponse,
  db: DatabaseSync,
  snapshotVersion: () => number,
  currentFrame: () => Promise<
    | {
        readonly sourceFrameAssetId: string
        readonly capturedAtEpochMs: number
        readonly disposition: 'accepted' | 'rejected'
      }
    | undefined
  >,
) {
  const frame = await currentFrame()
  if (frame === undefined)
    return json(
      response,
      200,
      ObserveLiveFrameReview.cases.Unavailable.make({
        reason: 'NoCurrentFrame',
        message: 'No current captured frame is available for review.',
      }),
    )
  const result = await Effect.runPromise(
    LibraryService.pipe(
      Effect.flatMap((library) => library.detail(frame.sourceFrameAssetId)),
      Effect.map((asset) =>
        ObserveLiveFrameReview.cases.Available.make({
          capturedAtEpochMs: frame.capturedAtEpochMs,
          disposition: frame.disposition,
          asset,
        }),
      ),
      Effect.catchTags({
        'Server.LibraryAssetNotFound': () =>
          Effect.succeed(
            ObserveLiveFrameReview.cases.Unavailable.make({
              reason: 'LibraryAssetNotFound',
              message: 'The current frame has not materialized in Library yet.',
            }),
          ),
        'Server.LibraryInputInvalid': () =>
          Effect.succeed(
            ObserveLiveFrameReview.cases.Unavailable.make({
              reason: 'LibraryAssetNotFound',
              message: 'The current frame cannot be resolved in Library.',
            }),
          ),
        'Server.LibraryPersistenceUnavailable': () =>
          Effect.succeed(
            ObserveLiveFrameReview.cases.Unavailable.make({
              reason: 'LibraryUnavailable',
              message: 'Library review evidence is temporarily unavailable.',
            }),
          ),
      }),
      Effect.provide(sqliteLibraryServiceLayer(db, snapshotVersion)),
    ),
  )
  return json(response, 200, result)
}
export async function libraryReview(
  response: ServerResponse,
  db: DatabaseSync,
  identity: LocalIdentity,
  request: import('node:http').IncomingMessage,
  encodedAssetId: string,
) {
  if (identity.role !== 'owner' || identity.capability !== 'controlCapable')
    return json(response, 403, {
      outcome: 'rejected',
      reason: 'ClientReadOnly',
    })
  let input: typeof ReviewAssetRequest.Type
  const assetId = decodedAssetId(encodedAssetId)
  try {
    input = Schema.decodeUnknownSync(ReviewAssetRequest)(await body(request))
  } catch {
    return json(response, 400, libraryInvalidBody)
  }
  const row = Schema.decodeUnknownSync(Schema.optional(ReviewAssetRow))(
    db
      .prepare('SELECT revision,detail FROM library_assets WHERE asset_id=?')
      .get(assetId),
  )
  if (!row) return json(response, 404, libraryNotFoundBody)
  const prior = Schema.decodeUnknownSync(Schema.optional(ReviewReceiptRow))(
    db
      .prepare(
        'SELECT response FROM asset_review_receipts WHERE asset_id=? AND idempotency_key=?',
      )
      .get(assetId, input.idempotencyKey),
  )
  if (prior) return json(response, 200, JSON.parse(prior.response))
  const existing = Schema.decodeUnknownSync(Schema.optional(ReviewRow))(
    db
      .prepare('SELECT revision,review FROM asset_reviews WHERE asset_id=?')
      .get(assetId),
  )
  const reviewRevision = existing?.revision ?? 0
  if (
    row.revision !== input.expectedAssetRevision ||
    reviewRevision !== input.expectedReviewRevision
  )
    return json(response, 409, {
      outcome: 'rejected',
      reason: 'RevisionConflict',
    })
  const review = {
    revision: reviewRevision + 1,
    decision: input.decision,
    ...(input.rating === undefined ? {} : { rating: input.rating }),
    ...(input.annotation === undefined ? {} : { annotation: input.annotation }),
    updatedAt: new Date().toISOString(),
  }
  const result = { outcome: 'accepted', review }
  const detail = { ...JSON.parse(row.detail), review }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor =
      Number(
        JSON.parse(
          Schema.decodeUnknownSync(StateValueRow)(
            db.prepare("SELECT value FROM state WHERE key='eventCursor'").get(),
          ).value,
        ),
      ) + 1
    db.prepare(
      'INSERT INTO asset_reviews VALUES (?,?,?) ON CONFLICT(asset_id) DO UPDATE SET revision=excluded.revision,review=excluded.review',
    ).run(assetId, review.revision, JSON.stringify(review))
    db.prepare(
      'UPDATE library_assets SET detail=?,updated_at=? WHERE asset_id=?',
    ).run(JSON.stringify(detail), review.updatedAt, assetId)
    db.prepare('INSERT INTO asset_review_receipts VALUES (?,?,?)').run(
      assetId,
      input.idempotencyKey,
      JSON.stringify(result),
    )
    db.prepare("UPDATE state SET value=? WHERE key='eventCursor'").run(
      JSON.stringify(cursor),
    )
    db.prepare("UPDATE state SET value=? WHERE key='snapshotVersion'").run(
      JSON.stringify(
        Number(
          JSON.parse(
            Schema.decodeUnknownSync(StateValueRow)(
              db
                .prepare("SELECT value FROM state WHERE key='snapshotVersion'")
                .get(),
            ).value,
          ),
        ) + 1,
      ),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'AssetReviewUpdated',
      JSON.stringify({ assetId, review }),
    )
    db.exec('COMMIT')
    return json(response, 200, result)
  } catch {
    db.exec('ROLLBACK')
    return json(response, 503, libraryUnavailableBody)
  }
}
function decodedAssetId(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}
const libraryInvalidBody = {
  outcome: 'rejected',
  reason: 'InvalidInput',
  message: 'The service could not read that action.',
}
const libraryNotFoundBody = { outcome: 'rejected', reason: 'AssetNotFound' }
const libraryUnavailableBody = {
  outcome: 'rejected',
  reason: 'LibraryUnavailable',
}
export async function downloadAsset(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
  grants: DownloadGrantConfig | undefined,
  snapshotVersion: () => number,
  localOriginalsRoot?: string,
) {
  const encodedAssetId = /^\/api\/library\/assets\/(.+)\/download$/.exec(
    url.pathname,
  )?.[1]
  if (encodedAssetId === undefined)
    return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
  const assetId = decodedAssetId(encodedAssetId)
  if (localOriginalsRoot !== undefined) {
    const local = Schema.decodeUnknownSync(
      Schema.optional(
        Schema.Struct({
          format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
          availability: Schema.String,
        }),
      ),
    )(
      db
        .prepare(
          'SELECT format,availability FROM library_assets WHERE asset_id=?',
        )
        .get(assetId),
    )
    if (local?.availability === 'availableLocally') {
      const path = join(localOriginalsRoot, `${assetId}.${local.format}`)
      try {
        const size = (await stat(path)).size
        if (size > 64 * 1024 * 1024) throw new Error('original too large')
        const bytes = await readFile(path)
        return response
          .writeHead(200, {
            ...responseHeaders(
              local.format === 'fits'
                ? 'application/fits'
                : 'application/octet-stream',
              'private, no-store',
            ),
            'content-disposition': `attachment; filename="${assetId}.${local.format}"`,
            'content-length': String(bytes.byteLength),
          })
          .end(bytes)
      } catch {
        return json(response, 503, {
          outcome: 'rejected',
          reason: 'DownloadUnavailable',
        })
      }
    }
  }
  if (grants === undefined)
    return json(response, 503, {
      outcome: 'rejected',
      reason: 'DownloadUnavailable',
    })
  const asset = await Effect.runPromise(
    LibraryService.pipe(
      Effect.flatMap((library) => library.download(assetId)),
      Effect.map((asset) => ({ status: 200 as const, asset })),
      Effect.catchTags({
        'Server.LibraryInputInvalid': () =>
          Effect.succeed({ status: 400 as const, reason: 'InvalidInput' }),
        'Server.LibraryAssetNotFound': () =>
          Effect.succeed({ status: 404 as const, reason: 'AssetNotFound' }),
        'Server.LibraryAssetUnavailable': () =>
          Effect.succeed({ status: 409 as const, reason: 'AssetUnavailable' }),
        'Server.LibraryPersistenceUnavailable': () =>
          Effect.succeed({
            status: 503 as const,
            reason: 'DownloadUnavailable',
          }),
      }),
      Effect.provide(sqliteLibraryServiceLayer(db, snapshotVersion)),
    ),
  )
  if ('reason' in asset)
    return json(response, asset.status, {
      outcome: 'rejected',
      reason: asset.reason,
    })
  const now = grants.now?.() ?? new Date()
  const expiresAt = new Date(now.valueOf() + 300_000).toISOString()
  let signedUrl: string
  try {
    signedUrl = await grants.issuer.issue({
      objectKey: asset.asset.objectKey,
      expiresAt,
    })
  } catch {
    return json(response, 503, {
      outcome: 'rejected',
      reason: 'DownloadUnavailable',
    })
  }
  return response
    .writeHead(303, {
      ...responseHeaders('text/plain; charset=utf-8', 'private, no-store'),
      location: signedUrl,
    })
    .end()
}
