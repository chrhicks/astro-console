import { Context, Effect, Layer, ManagedRuntime, Schema } from 'effect'
import {
  LibraryAssetDetail as LibraryAssetDetailSchema,
  LibraryPage as LibraryPageSchema,
  LibraryQuery as LibraryQuerySchema,
  ProcessSourceHandoff as ProcessSourceHandoffSchema,
} from '@astro-console/v2-contracts'

export type LibraryAssetDetail = Schema.Schema.Type<
  typeof LibraryAssetDetailSchema
>
export type LibraryPage = Schema.Schema.Type<typeof LibraryPageSchema>
export type LibraryQuery = Schema.Schema.Type<typeof LibraryQuerySchema>
export type ProcessSourceHandoff = Schema.Schema.Type<
  typeof ProcessSourceHandoffSchema
>

export class LibraryNotFound extends Schema.TaggedErrorClass<LibraryNotFound>()(
  'Web.LibraryNotFound',
  {},
) {}

export class LibraryUnavailable extends Schema.TaggedErrorClass<LibraryUnavailable>()(
  'Web.LibraryUnavailable',
  { reason: Schema.NonEmptyString },
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
  ) => Effect.Effect<unknown, LibraryNotFound | LibraryUnavailable>
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
  ) => Effect.Effect<ProcessSourceHandoff, LibraryNotFound | LibraryUnavailable>
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
              error instanceof LibraryNotFound
                ? error
                : new LibraryUnavailable({
                    reason: 'The Process source handoff could not be read.',
                  }),
            ),
          )
        },
      ),
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
): Effect.Effect<unknown, LibraryNotFound | LibraryUnavailable> =>
  Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, { signal })
      if (response.status === 404 && detail) throw new LibraryNotFound()
      if (!response.ok)
        throw new LibraryUnavailable({
          reason: 'The Library service is unavailable.',
        })
      return response.json()
    },
    catch: (error) =>
      error instanceof LibraryNotFound || error instanceof LibraryUnavailable
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
          error instanceof LibraryNotFound
            ? new LibraryUnavailable({
                reason: 'The Library service is unavailable.',
              })
            : error,
        ),
      ),
    loadDetail: (assetId) =>
      load(`/api/library/assets/${encodeURIComponent(assetId)}`, true),
    loadProcessSourceHandoff: (assetId) =>
      load(
        `/api/workspaces/process?sourceAssetId=${encodeURIComponent(assetId)}`,
        true,
      ),
  }),
)

export const createLibraryRuntime = () =>
  ManagedRuntime.make(layer.pipe(Layer.provide(browserLibraryTransportLayer)))
