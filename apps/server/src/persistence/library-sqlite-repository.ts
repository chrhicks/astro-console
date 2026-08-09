import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer, Schema } from 'effect'
import {
  AssetReview,
  FrameInspection,
  LibraryAssetDetail,
  LibraryPage,
  ProcessSourceHandoff,
} from '@astro-console/v2-contracts'
import {
  LibraryAssetNotFound,
  LibraryAssetUnavailable,
  LibraryInputInvalid,
  LibraryPersistenceUnavailable,
  libraryPersistenceLayer,
  libraryServiceLayer,
} from '../services/library-service.ts'

type LibraryRole =
  | 'original'
  | 'linearMaster'
  | 'intermediate'
  | 'final'
  | 'preview'
  | 'diagnostic'
type LibrarySort = 'capturedAtDescending' | 'sharpestFirst' | 'recentlyUpdated'

const LibraryRole = Schema.Literals([
  'original',
  'linearMaster',
  'intermediate',
  'final',
  'preview',
  'diagnostic',
])
const LibraryAssetRow = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  role: LibraryRole,
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  comparison_group_id: Schema.String,
  detail: Schema.String,
})
const LibraryDetail = Schema.Struct({
  assetId: Schema.String,
  revision: Schema.Int,
  role: LibraryRole,
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  checksum: Schema.optionalKey(Schema.String),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  capturedAt: Schema.String,
  comparisonGroupId: Schema.String,
  equipment: Schema.optionalKey(
    Schema.Struct({
      rigId: Schema.String,
      cameraDeviceId: Schema.String,
    }),
  ),
  lineage: Schema.Struct({
    sourceAssetIds: Schema.Array(Schema.String),
    runId: Schema.optionalKey(Schema.String),
    solveAttemptId: Schema.optionalKey(Schema.String),
    sequenceId: Schema.optionalKey(Schema.String),
    acquisitionId: Schema.optionalKey(Schema.String),
    processingSessionId: Schema.optionalKey(Schema.String),
    processingOutputId: Schema.optionalKey(Schema.String),
    operationIds: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  capture: Schema.optionalKey(
    Schema.Struct({
      frameId: Schema.String,
      exposureSeconds: Schema.Number,
      filter: Schema.String,
      binning: Schema.Int,
      frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
    }),
  ),
  provenance: Schema.optionalKey(
    Schema.Struct({
      source: Schema.Literal('alpaca-imagearray'),
      checksum: Schema.String,
      fitsHeader: Schema.optionalKey(
        Schema.Struct({
          SIMPLE: Schema.optionalKey(Schema.Boolean),
          BITPIX: Schema.optionalKey(Schema.Number),
          NAXIS: Schema.optionalKey(Schema.Number),
          NAXIS1: Schema.optionalKey(Schema.Number),
          NAXIS2: Schema.optionalKey(Schema.Number),
          EXPTIME: Schema.optionalKey(Schema.Number),
          'DATE-OBS': Schema.optionalKey(Schema.String),
          INSTRUME: Schema.optionalKey(Schema.String),
          FILTER: Schema.optionalKey(Schema.String),
        }),
      ),
      imageBytesHeader: Schema.optionalKey(
        Schema.Struct({
          headerVersion: Schema.Number,
          dataStart: Schema.Number,
          imageElementType: Schema.Number,
          transmissionElementType: Schema.Number,
          rank: Schema.Number,
        }),
      ),
    }),
  ),
  inspection: Schema.optionalKey(FrameInspection),
  review: Schema.optionalKey(AssetReview),
  representations: Schema.Array(
    Schema.Struct({ label: Schema.String, state: Schema.String }),
  ),
})
const DownloadAssetRow = Schema.Struct({
  asset_id: Schema.String,
  role: LibraryRole,
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  state: Schema.String,
  object_key: Schema.String,
})

export const sqliteLibraryServiceLayer = (
  db: DatabaseSync,
  readSnapshotVersion: () => number,
) =>
  libraryServiceLayer.pipe(
    Layer.provide(
      libraryPersistenceLayer({
        page: Effect.fnUntraced(function* (query) {
          const order = {
            capturedAtDescending: 'captured_at DESC, asset_id ASC',
            sharpestFirst: 'sharpness DESC, asset_id ASC',
            recentlyUpdated: 'updated_at DESC, asset_id ASC',
          } satisfies Record<LibrarySort, string>
          const cursor = Number(query.cursor ?? '0')
          const filter = query.role === undefined ? '' : 'WHERE role=?'
          const bindings =
            query.role === undefined
              ? [query.pageSize + 1, cursor]
              : [query.role, query.pageSize + 1, cursor]
          const rowsRaw = yield* Effect.try({
            try: () =>
              db
                .prepare(
                  `SELECT asset_id,revision,role,format,availability,comparison_group_id,detail FROM library_assets ${filter} ORDER BY ${order[query.sort]} LIMIT ? OFFSET ?`,
                )
                .all(...bindings),
            catch: () => new LibraryPersistenceUnavailable(),
          })
          const rows = yield* Schema.decodeUnknownEffect(
            Schema.Array(LibraryAssetRow),
          )(rowsRaw).pipe(
            Effect.mapError(() => new LibraryPersistenceUnavailable()),
          )
          const snapshotVersion = yield* Effect.try({
            try: readSnapshotVersion,
            catch: () => new LibraryPersistenceUnavailable(),
          })
          const results = yield* Effect.forEach(
            rows.slice(0, query.pageSize),
            projectLibraryRow,
          )
          return yield* Schema.decodeUnknownEffect(LibraryPage)({
            queryId: query.queryId,
            querySnapshotVersion: snapshotVersion,
            results,
            ...(rows.length > query.pageSize
              ? { nextCursor: String(cursor + query.pageSize) }
              : {}),
            catalogChanged: false,
          }).pipe(Effect.mapError(() => new LibraryPersistenceUnavailable()))
        }),
        detail: Effect.fnUntraced(function* (assetId) {
          const detail = yield* libraryStoredDetail(db, assetId)
          const publication = yield* libraryPublication(db, assetId)
          return yield* Schema.decodeUnknownEffect(LibraryAssetDetail)({
            ...detail,
            actions: libraryActions(detail.availability, publication),
          }).pipe(Effect.mapError(() => new LibraryPersistenceUnavailable()))
        }),
        processSource: Effect.fnUntraced(function* (assetId) {
          const detail = yield* libraryStoredDetail(db, assetId, false)
          if (detail.availability !== 'availableLocally')
            return yield* Effect.fail(
              new LibraryAssetUnavailable({ reason: 'AssetUnavailable' }),
            )
          return yield* Schema.decodeUnknownEffect(ProcessSourceHandoff)({
            sourceAssetId: detail.assetId,
            revision: detail.revision,
            role: detail.role,
            format: detail.format,
            availability: detail.availability,
            comparisonGroupId: detail.comparisonGroupId,
            lineage: detail.lineage,
            processing: {
              availability: 'unavailable',
              currentFixtureFacts: [
                'Interactive processing is not available in this workspace.',
              ],
            },
          }).pipe(Effect.mapError(() => new LibraryPersistenceUnavailable()))
        }),
        download: Effect.fn('Server.LibraryService.download')(
          function* (assetId) {
            yield* libraryAssetId(assetId)
            const publication = yield* libraryPublication(db, assetId)
            if (publication === undefined) {
              const known = yield* libraryKnownAsset(db, assetId)
              if (!known) return yield* Effect.fail(new LibraryAssetNotFound())
              return yield* Effect.fail(
                new LibraryAssetUnavailable({
                  reason: 'PublicationUnavailable',
                }),
              )
            }
            if (
              publication.availability !== 'published' ||
              publication.state !== 'published' ||
              publication.object_key === ''
            )
              return yield* Effect.fail(
                new LibraryAssetUnavailable({ reason: 'AssetUnavailable' }),
              )
            return { objectKey: publication.object_key }
          },
        ),
      }),
    ),
  )

const projectLibraryRow = Effect.fn('Server.LibraryService.projectLibraryRow')(
  function* (asset: typeof LibraryAssetRow.Type) {
    const detailRaw = yield* Effect.try({
      try: () => JSON.parse(asset.detail) as unknown,
      catch: () => new LibraryPersistenceUnavailable(),
    })
    const detail = yield* Schema.decodeUnknownEffect(LibraryDetail)(
      detailRaw,
    ).pipe(Effect.mapError(() => new LibraryPersistenceUnavailable()))
    return {
      assetId: asset.asset_id,
      revision: asset.revision,
      role: asset.role,
      format: asset.format,
      availability: asset.availability,
      comparisonGroupId: asset.comparison_group_id,
      review: {
        decision: detail.review?.decision ?? 'unreviewed',
        ...(detail.review?.rating === undefined
          ? {}
          : { rating: detail.review.rating }),
      },
    }
  },
)

const libraryAssetId = (assetId: string, requireStableId = true) =>
  Schema.decodeUnknownEffect(LibraryAssetDetail.fields.assetId)(assetId).pipe(
    Effect.flatMap((id) =>
      !requireStableId ||
      /^asset-(?:m27-\d{3}|process-[0-9a-f-]+|source-[a-z0-9-]+|capture-[a-z0-9-]+)$/.test(
        id,
      )
        ? Effect.succeed(id)
        : Effect.fail(new LibraryInputInvalid()),
    ),
    Effect.mapError(() => new LibraryInputInvalid()),
  )
const libraryStoredDetail = (
  db: DatabaseSync,
  assetId: string,
  requireStableId = true,
) =>
  Effect.gen(function* () {
    yield* libraryAssetId(assetId, requireStableId)
    const raw = yield* Effect.try({
      try: () =>
        db
          .prepare(
            'SELECT asset_id,detail FROM library_assets WHERE asset_id=?',
          )
          .get(assetId),
      catch: () => new LibraryPersistenceUnavailable(),
    })
    const row = yield* Schema.decodeUnknownEffect(
      Schema.optional(
        Schema.Struct({ asset_id: Schema.String, detail: Schema.String }),
      ),
    )(raw).pipe(Effect.mapError(() => new LibraryPersistenceUnavailable()))
    if (row === undefined) return yield* Effect.fail(new LibraryAssetNotFound())
    const parsed = yield* Effect.try({
      try: () => JSON.parse(row.detail),
      catch: () => new LibraryPersistenceUnavailable(),
    })
    return yield* Schema.decodeUnknownEffect(LibraryDetail)(parsed).pipe(
      Effect.mapError(() => new LibraryPersistenceUnavailable()),
    )
  })
const libraryPublication = (db: DatabaseSync, assetId: string) =>
  Effect.try({
    try: () =>
      db
        .prepare(
          'SELECT library_assets.asset_id,library_assets.role,library_assets.format,library_assets.availability,asset_publications.state,asset_publications.object_key FROM library_assets JOIN asset_publications ON asset_publications.asset_id=library_assets.asset_id WHERE library_assets.asset_id=?',
        )
        .get(assetId),
    catch: () => new LibraryPersistenceUnavailable(),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.optional(DownloadAssetRow)),
    ),
    Effect.mapError(() => new LibraryPersistenceUnavailable()),
  )
const libraryKnownAsset = (db: DatabaseSync, assetId: string) =>
  Effect.try({
    try: () =>
      db
        .prepare('SELECT asset_id FROM library_assets WHERE asset_id=?')
        .get(assetId),
    catch: () => new LibraryPersistenceUnavailable(),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.optional(Schema.Struct({ asset_id: Schema.String })),
      ),
    ),
    Effect.map((asset) => asset !== undefined),
    Effect.mapError(() => new LibraryPersistenceUnavailable()),
  )
const libraryActions = (
  availability: (typeof LibraryDetail.Type)['availability'],
  publication: typeof DownloadAssetRow.Type | undefined,
) => [
  availability === 'availableLocally' ||
  (publication?.state === 'published' &&
    publication.object_key !== '' &&
    availability === 'published')
    ? { _tag: 'Eligible' as const, action: 'download' as const }
    : {
        _tag: 'Unavailable' as const,
        action: 'download' as const,
        reason:
          publication === undefined
            ? 'PublicationUnavailable'
            : 'AssetNotPublished',
      },
  availability === 'availableLocally'
    ? { _tag: 'Eligible' as const, action: 'openInProcess' as const }
    : {
        _tag: 'Unavailable' as const,
        action: 'openInProcess' as const,
        reason: 'AssetNotAvailableLocally' as const,
      },
]

export function seedLibrary(db: DatabaseSync) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
  const roles: ReadonlyArray<LibraryRole> = [
    'original',
    'preview',
    'intermediate',
    'linearMaster',
    'final',
    'diagnostic',
  ]
  for (let index = 1; index <= 144; index += 1) {
    const role = roles[index % roles.length] ?? 'original'
    const assetId = `asset-m27-${String(index).padStart(3, '0')}`
    const capturedAt = new Date(
      Date.UTC(2026, 6, 23, 3, 0, 0) - index * 180_000,
    ).toISOString()
    const availability =
      index % 13 === 0 ? 'temporarilyUnavailable' : 'availableLocally'
    const detail = {
      assetId,
      revision: 1,
      role,
      format:
        role === 'original' ? 'cameraRaw' : role === 'final' ? 'tiff' : 'fits',
      availability,
      capturedAt,
      comparisonGroupId: `m27-stack-${Math.ceil(index / 12)}`,
      lineage: {
        sourceAssetIds:
          index === 1
            ? [assetId]
            : [`asset-m27-${String(Math.max(1, index - 1)).padStart(3, '0')}`],
        runId: 'run-m27-001',
        solveAttemptId: 'solve-m27-001',
      },
      representations: [
        {
          label:
            availability === 'availableLocally'
              ? 'Local original retained'
              : 'Local original temporarily unavailable',
          state:
            availability === 'availableLocally'
              ? 'available'
              : 'temporarilyUnavailable',
        },
      ],
    }
    insert.run(
      assetId,
      1,
      role,
      detail.format,
      availability,
      detail.comparisonGroupId,
      capturedAt,
      new Date(Date.parse(capturedAt) + 60_000).toISOString(),
      1000 - index,
      JSON.stringify(detail),
    )
  }
}

export function installPublishedLibraryFixture(database: DatabaseSync) {
  const assetId = 'asset-m27-001'
  const publishedRepresentation = {
    label: 'Published delivery available',
    state: 'published',
  }
  const raw: unknown = database
    .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
    .get(assetId)
  const detail = Schema.decodeUnknownSync(
    Schema.Struct({ detail: Schema.String }),
  )(raw)
  const libraryDetail = Schema.decodeUnknownSync(LibraryDetail)(
    JSON.parse(detail.detail),
  )
  database
    .prepare(
      'UPDATE library_assets SET availability=?,detail=? WHERE asset_id=?',
    )
    .run(
      'published',
      JSON.stringify({
        ...libraryDetail,
        availability: 'published',
        representations: [
          ...libraryDetail.representations.filter(
            (representation) =>
              representation.label !== publishedRepresentation.label ||
              representation.state !== publishedRepresentation.state,
          ),
          publishedRepresentation,
        ],
      }),
      assetId,
    )
  database
    .prepare(
      'INSERT OR IGNORE INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)',
    )
    .run(
      assetId,
      'fixture-m27-001',
      'published',
      '2026-07-25T00:00:00.000Z',
      'published/run-m27-001/previews/asset-m27-001-fixture.fits',
    )
}
