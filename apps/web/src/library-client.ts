import { Context, Effect, Layer, ManagedRuntime, Schema } from 'effect'
import {
  LibraryAssetDetail as LibraryAssetDetailSchema,
  LibraryPage as LibraryPageSchema,
  LibraryQuery as LibraryQuerySchema,
  ProcessSourceHandoff as ProcessSourceHandoffSchema,
  AssetReview,
  ReviewAssetFailure,
  ReviewAssetRequest,
  ReviewAssetResponse,
} from '@astro-console/protocol'

export type LibraryAssetDetail = Schema.Schema.Type<
  typeof LibraryAssetDetailSchema
>
export type LibraryPage = Schema.Schema.Type<typeof LibraryPageSchema>
export type LibraryQuery = Schema.Schema.Type<typeof LibraryQuerySchema>
export type ProcessSourceHandoff = Schema.Schema.Type<
  typeof ProcessSourceHandoffSchema
>
export type ReviewRequest = Schema.Schema.Type<typeof ReviewAssetRequest>

export class LibraryNotFound extends Schema.TaggedErrorClass<LibraryNotFound>()(
  'Web.LibraryNotFound',
  {},
) {}

export class LibraryUnavailable extends Schema.TaggedErrorClass<LibraryUnavailable>()(
  'Web.LibraryUnavailable',
  { reason: Schema.NonEmptyString },
) {}

export class LibraryAssetUnavailable extends Schema.TaggedErrorClass<LibraryAssetUnavailable>()(
  'Web.LibraryAssetUnavailable',
  {},
) {}

export interface LibraryTransportShape {
  readonly loadPage: (
    query: LibraryQuery,
  ) => Effect.Effect<unknown, LibraryUnavailable>
  readonly loadDetail: (
    assetId: string,
  ) => Effect.Effect<unknown, LibraryNotFound | LibraryUnavailable>
  readonly loadProcessSourceHandoff: (
    assetId: string,
  ) => Effect.Effect<
    unknown,
    LibraryNotFound | LibraryAssetUnavailable | LibraryUnavailable
  >
  readonly reviewAsset?: (
    assetId: string,
    request: ReviewRequest,
  ) => Effect.Effect<unknown, LibraryUnavailable>
}

export class LibraryTransport extends Context.Service<
  LibraryTransport,
  LibraryTransportShape
>()('@astro-console/web/LibraryTransport') {}

export interface LibraryClientShape {
  readonly page: (
    query: LibraryQuery,
  ) => Effect.Effect<LibraryPage, LibraryUnavailable>
  readonly detail: (
    assetId: string,
  ) => Effect.Effect<LibraryAssetDetail, LibraryNotFound | LibraryUnavailable>
  readonly processSourceHandoff: (
    assetId: string,
  ) => Effect.Effect<
    ProcessSourceHandoff,
    LibraryNotFound | LibraryAssetUnavailable | LibraryUnavailable
  >
  readonly reviewAsset: (
    assetId: string,
    request: ReviewRequest,
  ) => Effect.Effect<typeof AssetReview.Type, LibraryUnavailable>
}

export class LibraryClient extends Context.Service<
  LibraryClient,
  LibraryClientShape
>()('@astro-console/web/LibraryClient') {}

export const layer = Layer.effect(
  LibraryClient,
  Effect.gen(function* () {
    const transport = yield* LibraryTransport
    return LibraryClient.of({
      page: Effect.fn('LibraryClient.page')(function* (query: LibraryQuery) {
        const decodedQuery = yield* Schema.decodeUnknownEffect(
          LibraryQuerySchema,
        )(query).pipe(
          Effect.mapError(
            () =>
              new LibraryUnavailable({
                reason: 'The Library query is invalid.',
              }),
          ),
        )
        return yield* transport.loadPage(decodedQuery).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(LibraryPageSchema)),
          Effect.mapError(
            () =>
              new LibraryUnavailable({
                reason: 'The Library page could not be read.',
              }),
          ),
        )
      }),
      detail: Effect.fn('LibraryClient.detail')(function* (assetId: string) {
        return yield* transport.loadDetail(assetId).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(LibraryAssetDetailSchema)),
          Effect.mapError((error) =>
            error instanceof LibraryNotFound
              ? error
              : new LibraryUnavailable({
                  reason: 'The Library detail could not be read.',
                }),
          ),
        )
      }),
      processSourceHandoff: Effect.fn('LibraryClient.processSourceHandoff')(
        function* (assetId: string) {
          return yield* transport.loadProcessSourceHandoff(assetId).pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(ProcessSourceHandoffSchema),
            ),
            Effect.mapError((error) =>
              error instanceof LibraryNotFound ||
              error instanceof LibraryAssetUnavailable
                ? error
                : new LibraryUnavailable({
                    reason: 'The Process source handoff could not be read.',
                  }),
            ),
          )
        },
      ),
      reviewAsset: Effect.fn('LibraryClient.reviewAsset')(function* (
        assetId: string,
        request: ReviewRequest,
      ) {
        const input = yield* Schema.decodeUnknownEffect(ReviewAssetRequest)(
          request,
        ).pipe(
          Effect.mapError(
            () =>
              new LibraryUnavailable({ reason: 'Review input is invalid.' }),
          ),
        )
        if (transport.reviewAsset === undefined)
          return yield* Effect.fail(
            new LibraryUnavailable({ reason: 'Review is unavailable.' }),
          )
        const response = yield* transport.reviewAsset(assetId, input)
        const decoded = yield* Schema.decodeUnknownEffect(ReviewAssetResponse)(
          response,
        ).pipe(
          Effect.mapError(
            () =>
              new LibraryUnavailable({ reason: 'Review was not accepted.' }),
          ),
        )
        if (decoded._tag === 'Accepted') return decoded.review
        return yield* Effect.fail(
          new LibraryUnavailable({ reason: reviewFailure(decoded.failure) }),
        )
      }),
    })
  }),
)

export function libraryPagePath(query: LibraryQuery) {
  const search = new URLSearchParams({
    queryId: query.queryId,
    pageSize: String(query.pageSize),
    sort: query.sort,
  })
  if (query.cursor !== undefined) search.set('cursor', query.cursor)
  if (query.role !== undefined) search.set('role', query.role)
  return `/api/library?${search}`
}

const load = (
  url: string,
  detail = false,
  sourceHandoff = false,
): Effect.Effect<
  unknown,
  LibraryNotFound | LibraryAssetUnavailable | LibraryUnavailable
> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { signal })
      if (response.status === 404 && detail) throw new LibraryNotFound()
      if (response.status === 409 && sourceHandoff)
        throw new LibraryAssetUnavailable()
      if (!response.ok)
        throw new LibraryUnavailable({
          reason: 'The Library service is unavailable.',
        })
      return response.json()
    },
    catch: (error) =>
      error instanceof LibraryNotFound ||
      error instanceof LibraryAssetUnavailable ||
      error instanceof LibraryUnavailable
        ? error
        : new LibraryUnavailable({
            reason: 'The Library service is unavailable.',
          }),
  })

export const browserLibraryTransportLayer = Layer.succeed(
  LibraryTransport,
  LibraryTransport.of({
    loadPage: (query) =>
      load(libraryPagePath(query)).pipe(
        Effect.mapError((error) =>
          error instanceof LibraryNotFound ||
          error instanceof LibraryAssetUnavailable
            ? new LibraryUnavailable({
                reason: 'The Library service is unavailable.',
              })
            : error,
        ),
      ),
    loadDetail: (assetId) =>
      load(`/api/library/assets/${encodeURIComponent(assetId)}`, true).pipe(
        Effect.mapError((error) =>
          error instanceof LibraryAssetUnavailable
            ? new LibraryUnavailable({
                reason: 'The Library service is unavailable.',
              })
            : error,
        ),
      ),
    loadProcessSourceHandoff: (assetId) =>
      load(
        `/api/library/assets/${encodeURIComponent(assetId)}/process-source`,
        true,
        true,
      ),
    reviewAsset: (assetId, request) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(
            `/api/library/assets/${encodeURIComponent(assetId)}/review`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(request),
              signal,
            },
          )
          return response.json()
        },
        catch: (error) =>
          error instanceof LibraryUnavailable
            ? error
            : new LibraryUnavailable({
                reason: 'The review service is unavailable.',
              }),
      }),
  }),
)

export const createLibraryRuntime = () =>
  ManagedRuntime.make(layer.pipe(Layer.provide(browserLibraryTransportLayer)))

const reviewFailure = (failure: typeof ReviewAssetFailure.Type) =>
  ReviewAssetFailure.match(failure, {
    InvalidInput: ({ message }) => message,
    ClientReadOnly: () => 'This client cannot review Library assets.',
    AssetNotFound: () => 'The Library asset was not found.',
    RevisionConflict: () => 'The Library review changed. Reload and retry.',
    LibraryUnavailable: () => 'The Library review service is unavailable.',
  })
