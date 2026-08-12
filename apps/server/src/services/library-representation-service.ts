import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Data, Effect, Layer, Match, Option, Result } from 'effect'
import { FrameInspection } from '@astro-console/protocol'
import type { LocalIdentity } from '../auth/identity.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import { LibraryService } from './library-service.ts'

const previewLimitBytes = 64 * 1024
const previewRefreshMs = 1_000
const previewConcurrentLimit = 2
const downloadLimitBytes = 64 * 1024 * 1024

export type LibraryRepresentationStorageSelectionShape =
  | { readonly _tag: 'Absent' }
  | {
      readonly _tag: 'Configured'
      readonly originalsRoot: string
      readonly previewsRoot: string
    }

export class LibraryRepresentationStorageSelection extends Context.Service<
  LibraryRepresentationStorageSelection,
  LibraryRepresentationStorageSelectionShape
>()('@astro-console/server/LibraryRepresentationStorageSelection') {}

export const absentLibraryRepresentationStorageLayer = Layer.succeed(
  LibraryRepresentationStorageSelection,
  LibraryRepresentationStorageSelection.of({ _tag: 'Absent' }),
)

export const configuredLibraryRepresentationStorageLayer = (config: {
  readonly originalsRoot: string
  readonly previewsRoot: string
}) =>
  Layer.succeed(
    LibraryRepresentationStorageSelection,
    LibraryRepresentationStorageSelection.of({
      _tag: 'Configured',
      ...config,
    }),
  )

export type LibraryDownloadGrantSelectionShape =
  | { readonly _tag: 'Absent' }
  | {
      readonly _tag: 'Configured'
      readonly issuer: DownloadGrantIssuer
      readonly now: () => Date
    }

export class LibraryDownloadGrantSelection extends Context.Service<
  LibraryDownloadGrantSelection,
  LibraryDownloadGrantSelectionShape
>()('@astro-console/server/LibraryDownloadGrantSelection') {}

export const absentLibraryDownloadGrantLayer = Layer.succeed(
  LibraryDownloadGrantSelection,
  LibraryDownloadGrantSelection.of({ _tag: 'Absent' }),
)

export const configuredLibraryDownloadGrantLayer = (
  issuer: DownloadGrantIssuer,
  now: () => Date = () => new Date(),
) =>
  Layer.succeed(
    LibraryDownloadGrantSelection,
    LibraryDownloadGrantSelection.of({ _tag: 'Configured', issuer, now }),
  )

export type LibraryPreviewOutcome = Data.TaggedEnum<{
  Available: { readonly bytes: Uint8Array }
  InvalidInput: { readonly value?: never }
  RefreshLimited: { readonly value?: never }
  Busy: { readonly value?: never }
  TooLarge: { readonly value?: never }
  Unavailable: { readonly value?: never }
}>

export const LibraryPreviewOutcome = Data.taggedEnum<LibraryPreviewOutcome>()

export type LibraryDownloadOutcome = Data.TaggedEnum<{
  Local: {
    readonly assetId: string
    readonly format: string
    readonly bytes: Uint8Array
  }
  Redirect: { readonly location: string }
  InvalidInput: { readonly value?: never }
  AssetNotFound: { readonly value?: never }
  AssetUnavailable: { readonly value?: never }
  Unavailable: { readonly value?: never }
}>

export const LibraryDownloadOutcome = Data.taggedEnum<LibraryDownloadOutcome>()

export interface LibraryRepresentationServiceShape {
  readonly preview: (
    assetId: string,
    identity: LocalIdentity,
  ) => Effect.Effect<LibraryPreviewOutcome>
  readonly download: (assetId: string) => Effect.Effect<LibraryDownloadOutcome>
}

export class LibraryRepresentationService extends Context.Service<
  LibraryRepresentationService,
  LibraryRepresentationServiceShape
>()('@astro-console/server/LibraryRepresentationService') {}

export const libraryRepresentationServiceLayer = Layer.effect(
  LibraryRepresentationService,
  Effect.gen(function* () {
    const library = yield* LibraryService
    const storage = yield* LibraryRepresentationStorageSelection
    const grants = yield* LibraryDownloadGrantSelection
    const configuredStorage = Match.value(storage).pipe(
      Match.when({ _tag: 'Configured' }, (configured) => configured),
      Match.orElse(() => undefined),
    )
    const configuredGrants = Match.value(grants).pipe(
      Match.when({ _tag: 'Configured' }, (configured) => configured),
      Match.orElse(() => undefined),
    )
    let activePreviews = 0
    const lastDelivered = new Map<string, number>()

    const preview = Effect.fn('LibraryRepresentationService.preview')(
      function* (assetId: string, identity: LocalIdentity) {
        if (!/^[A-Za-z0-9-]+$/.test(assetId))
          return LibraryPreviewOutcome.InvalidInput({})
        if (configuredStorage === undefined)
          return LibraryPreviewOutcome.Unavailable({})

        const now = Date.now()
        const admission = yield* Effect.sync(() => {
          if (
            (lastDelivered.get(identity.clientId) ?? 0) + previewRefreshMs >
            now
          )
            return 'refreshLimited' as const
          if (activePreviews >= previewConcurrentLimit) return 'busy' as const
          activePreviews += 1
          return 'accepted' as const
        })
        if (admission === 'refreshLimited')
          return LibraryPreviewOutcome.RefreshLimited({})
        if (admission === 'busy') return LibraryPreviewOutcome.Busy({})

        return yield* Effect.gen(function* () {
          const detail = yield* library.detail(assetId).pipe(Effect.option)
          if (
            Option.isNone(detail) ||
            detail.value.inspection === undefined ||
            !FrameInspection.guards.Available(detail.value.inspection)
          )
            return LibraryPreviewOutcome.Unavailable({})
          const path = join(configuredStorage.previewsRoot, `${assetId}.png`)
          const result = yield* Effect.tryPromise({
            try: async () => {
              const metadata = await stat(path)
              if (metadata.size > previewLimitBytes) return undefined
              return await readFile(path)
            },
            catch: (cause) => cause,
          }).pipe(Effect.option)
          if (Option.isNone(result))
            return LibraryPreviewOutcome.Unavailable({})
          if (result.value === undefined)
            return LibraryPreviewOutcome.TooLarge({})
          lastDelivered.set(identity.clientId, now)
          return LibraryPreviewOutcome.Available({ bytes: result.value })
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              activePreviews -= 1
            }),
          ),
        )
      },
    )

    const download = Effect.fn('LibraryRepresentationService.download')(
      function* (assetId: string) {
        if (configuredStorage !== undefined) {
          const representation = yield* library
            .representation(assetId)
            .pipe(Effect.result)
          if (Result.isFailure(representation)) {
            if (configuredGrants === undefined)
              return LibraryDownloadOutcome.Unavailable({})
            return Match.value(representation.failure).pipe(
              Match.when({ _tag: 'Server.LibraryInputInvalid' }, () =>
                LibraryDownloadOutcome.InvalidInput({}),
              ),
              Match.when({ _tag: 'Server.LibraryAssetNotFound' }, () =>
                LibraryDownloadOutcome.AssetNotFound({}),
              ),
              Match.orElse(() => LibraryDownloadOutcome.Unavailable({})),
            )
          }
          if (representation.success.availability === 'availableLocally') {
            const path = join(
              configuredStorage.originalsRoot,
              `${assetId}.${representation.success.format}`,
            )
            const bytes = yield* Effect.tryPromise({
              try: async () => {
                const metadata = await stat(path)
                if (metadata.size > downloadLimitBytes)
                  throw new Error('original too large')
                return await readFile(path)
              },
              catch: (cause) => cause,
            }).pipe(Effect.option)
            return Option.match(bytes, {
              onSome: (value) =>
                LibraryDownloadOutcome.Local({
                  assetId,
                  format: representation.success.format,
                  bytes: value,
                }),
              onNone: () => LibraryDownloadOutcome.Unavailable({}),
            })
          }
        }

        if (configuredGrants === undefined)
          return LibraryDownloadOutcome.Unavailable({})
        const published = yield* library.download(assetId).pipe(Effect.result)
        if (Result.isFailure(published)) {
          return Match.value(published.failure).pipe(
            Match.when({ _tag: 'Server.LibraryInputInvalid' }, () =>
              LibraryDownloadOutcome.InvalidInput({}),
            ),
            Match.when({ _tag: 'Server.LibraryAssetNotFound' }, () =>
              LibraryDownloadOutcome.AssetNotFound({}),
            ),
            Match.when({ _tag: 'Server.LibraryAssetUnavailable' }, () =>
              LibraryDownloadOutcome.AssetUnavailable({}),
            ),
            Match.orElse(() => LibraryDownloadOutcome.Unavailable({})),
          )
        }
        const expiresAt = new Date(
          configuredGrants.now().valueOf() + 300_000,
        ).toISOString()
        const location = yield* Effect.tryPromise({
          try: () =>
            configuredGrants.issuer.issue({
              objectKey: published.success.objectKey,
              expiresAt,
            }),
          catch: (cause) => cause,
        }).pipe(Effect.option)
        return Option.match(location, {
          onSome: (value) =>
            LibraryDownloadOutcome.Redirect({ location: value }),
          onNone: () => LibraryDownloadOutcome.Unavailable({}),
        })
      },
    )

    return LibraryRepresentationService.of({ preview, download })
  }),
)

export const libraryPreviewHeaders = {
  maxBytes: previewLimitBytes,
  refreshMs: previewRefreshMs,
  concurrentLimit: previewConcurrentLimit,
} as const
