import { Context, Effect, Layer, Schema } from 'effect'
import {
  AssetId,
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
  ObserveLiveFrameReview,
  ProcessSourceHandoff,
} from '@astro-console/protocol'

export const LibraryRepresentationFacts = Schema.Struct({
  format: LibraryAssetDetail.fields.format,
  availability: LibraryAssetDetail.fields.availability,
})

export class LibraryInputInvalid extends Schema.TaggedErrorClass<LibraryInputInvalid>()(
  'Server.LibraryInputInvalid',
  {},
) {}
export class LibraryAssetNotFound extends Schema.TaggedErrorClass<LibraryAssetNotFound>()(
  'Server.LibraryAssetNotFound',
  {},
) {}
export class LibraryAssetUnavailable extends Schema.TaggedErrorClass<LibraryAssetUnavailable>()(
  'Server.LibraryAssetUnavailable',
  { reason: Schema.Literals(['AssetUnavailable', 'PublicationUnavailable']) },
) {}
export class LibraryPersistenceUnavailable extends Schema.TaggedErrorClass<LibraryPersistenceUnavailable>()(
  'Server.LibraryPersistenceUnavailable',
  {},
) {}

export interface LibraryPersistenceShape {
  readonly page: (
    query: typeof LibraryQuery.Type,
  ) => Effect.Effect<typeof LibraryPage.Type, LibraryPersistenceUnavailable>
  readonly detail: (
    assetId: string,
  ) => Effect.Effect<
    typeof LibraryAssetDetail.Type,
    LibraryInputInvalid | LibraryAssetNotFound | LibraryPersistenceUnavailable
  >
  readonly representation: (
    assetId: string,
  ) => Effect.Effect<
    typeof LibraryRepresentationFacts.Type,
    LibraryInputInvalid | LibraryAssetNotFound | LibraryPersistenceUnavailable
  >
  readonly processSource: (
    assetId: string,
  ) => Effect.Effect<
    typeof ProcessSourceHandoff.Type,
    | LibraryInputInvalid
    | LibraryAssetNotFound
    | LibraryAssetUnavailable
    | LibraryPersistenceUnavailable
  >
  readonly download: (
    assetId: string,
  ) => Effect.Effect<
    { readonly objectKey: string },
    | LibraryInputInvalid
    | LibraryAssetNotFound
    | LibraryAssetUnavailable
    | LibraryPersistenceUnavailable
  >
}
export class LibraryPersistence extends Context.Service<
  LibraryPersistence,
  LibraryPersistenceShape
>()('@astro-console/server/LibraryPersistence') {}
export const libraryPersistenceLayer = (
  implementation: LibraryPersistenceShape,
) => Layer.succeed(LibraryPersistence, LibraryPersistence.of(implementation))

export type ObserveLiveFrame =
  | {
      readonly sourceFrameAssetId: typeof AssetId.Type
      readonly capturedAtEpochMs: number
      readonly disposition: 'accepted' | 'rejected'
    }
  | undefined

export type LibraryServiceShape = LibraryPersistenceShape & {
  readonly liveFrameReview: (
    currentFrame: Effect.Effect<ObserveLiveFrame, unknown>,
  ) => Effect.Effect<typeof ObserveLiveFrameReview.Type, unknown>
}
export class LibraryService extends Context.Service<
  LibraryService,
  LibraryServiceShape
>()('Server.LibraryService') {}

export const libraryServiceLayer = Layer.effect(
  LibraryService,
  Effect.gen(function* () {
    const persistence = yield* LibraryPersistence
    return LibraryService.of({
      ...persistence,
      liveFrameReview: readObserveLiveFrameReview(persistence),
    })
  }),
)

const readObserveLiveFrameReview = (library: LibraryPersistenceShape) =>
  Effect.fn('Library.readObserveLiveFrameReview')(function* (
    currentFrame: Effect.Effect<ObserveLiveFrame, unknown>,
  ) {
    const frame = yield* currentFrame
    if (frame === undefined)
      return ObserveLiveFrameReview.cases.Unavailable.make({
        reason: 'NoCurrentFrame',
        message: 'No current captured frame is available for review.',
      })

    return yield* library.detail(frame.sourceFrameAssetId).pipe(
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
    )
  })
