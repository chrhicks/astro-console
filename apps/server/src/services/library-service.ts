import { Context, Effect, Layer, Schema } from 'effect'
import {
  LibraryAssetDetail,
  LibraryPage,
  LibraryQuery,
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

export type LibraryServiceShape = LibraryPersistenceShape
export class LibraryService extends Context.Service<
  LibraryService,
  LibraryServiceShape
>()('Server.LibraryService') {}

export const libraryServiceLayer = Layer.effect(
  LibraryService,
  Effect.gen(function* () {
    const persistence = yield* LibraryPersistence
    return LibraryService.of(persistence)
  }),
)
