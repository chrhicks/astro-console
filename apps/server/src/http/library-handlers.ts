import type { ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Schema } from 'effect'
import { LibraryQuery } from '@astro-console/v2-contracts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import { sqliteLibraryServiceLayer } from '../persistence/library-sqlite-repository.ts'
import {
  LibraryInputInvalid,
  LibraryService,
} from '../services/library-service.ts'
import { planWorkspaceProjection } from '../services/runtime-bootstrap.ts'
import { json, responseHeaders } from './response.ts'

export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}

export function workspace(
  response: ServerResponse,
  db: DatabaseSync,
  name: 'plan',
) {
  return json(response, 200, planWorkspaceProjection(db, name))
}

export async function processWorkspace(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
  snapshotVersion: () => number,
) {
  const sourceAssetId = url.searchParams.get('sourceAssetId')
  if (sourceAssetId !== null) {
    const result = await Effect.runPromise(
      LibraryService.pipe(
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
      ),
    )
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
  }
  return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
}
export async function libraryPage(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
  snapshotVersion: () => number,
) {
  const result = await Effect.runPromise(
    decodeLibraryQuery(url).pipe(
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
    ),
  )
  return json(response, result.status, result.body)
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
export async function libraryDetail(
  response: ServerResponse,
  db: DatabaseSync,
  encodedAssetId: string,
  snapshotVersion: () => number,
) {
  const result = await Effect.runPromise(
    LibraryService.pipe(
      Effect.flatMap((library) =>
        library.detail(decodedAssetId(encodedAssetId)),
      ),
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
    ),
  )
  return json(response, result.status, result.body)
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
) {
  if (grants === undefined)
    return json(response, 503, {
      outcome: 'rejected',
      reason: 'DownloadUnavailable',
    })
  const encodedAssetId = /^\/api\/library\/assets\/(.+)\/download$/.exec(
    url.pathname,
  )?.[1]
  if (encodedAssetId === undefined)
    return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
  const asset = await Effect.runPromise(
    LibraryService.pipe(
      Effect.flatMap((library) =>
        library.download(decodedAssetId(encodedAssetId)),
      ),
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
