import { Context, Effect, Layer, Match, Schema } from 'effect'
import {
  AssetReview,
  AssetRevision,
  ReviewAssetFailure,
  ReviewAssetRequest,
  ReviewAssetResponse,
} from '@astro-console/protocol'
import type { LocalIdentity } from '../auth/identity.ts'
import { OriginDatabase } from '../persistence/database.ts'
import { ProjectionPublication } from './projection-publication.ts'

const ReviewAssetRow = Schema.Struct({
  revision: Schema.Int,
  detail: Schema.String,
})
const ReviewReceiptRow = Schema.Struct({ response: Schema.String })
const ReviewRow = Schema.Struct({ revision: Schema.Int, review: Schema.String })
const StateValueRow = Schema.Struct({ value: Schema.String })

export const LibraryReviewOutcome = Schema.TaggedUnion({
  ReadOnly: { response: ReviewAssetResponse },
  Accepted: { response: ReviewAssetResponse },
  NotFound: { response: ReviewAssetResponse },
  Conflict: { response: ReviewAssetResponse },
  Unavailable: { response: ReviewAssetResponse },
})

export interface LibraryReviewServiceShape {
  readonly review: (
    assetId: string,
    input: typeof ReviewAssetRequest.Type,
    identity: LocalIdentity,
  ) => Effect.Effect<typeof LibraryReviewOutcome.Type>
}

export class LibraryReviewService extends Context.Service<
  LibraryReviewService,
  LibraryReviewServiceShape
>()('@astro-console/server/LibraryReviewService') {}

const rejected = (failure: typeof ReviewAssetFailure.Type) =>
  ReviewAssetResponse.cases.Rejected.make({ failure })

export const libraryReviewServiceLayer = Layer.effect(
  LibraryReviewService,
  Effect.gen(function* () {
    const { database } = yield* OriginDatabase
    const publication = yield* ProjectionPublication

    const review = Effect.fn('LibraryReviewService.review')(function* (
      assetId: string,
      input: typeof ReviewAssetRequest.Type,
      identity: LocalIdentity,
    ) {
      if (identity.role !== 'owner' || identity.capability !== 'controlCapable')
        return LibraryReviewOutcome.cases.ReadOnly.make({
          response: rejected(ReviewAssetFailure.cases.ClientReadOnly.make({})),
        })

      const stored = yield* Effect.try({
        try: () => {
          const row = Schema.decodeUnknownSync(Schema.optional(ReviewAssetRow))(
            database
              .prepare(
                'SELECT revision,detail FROM library_assets WHERE asset_id=?',
              )
              .get(assetId),
          )
          if (row === undefined) return { _tag: 'NotFound' as const }

          const prior = Schema.decodeUnknownSync(
            Schema.optional(ReviewReceiptRow),
          )(
            database
              .prepare(
                'SELECT response FROM asset_review_receipts WHERE asset_id=? AND idempotency_key=?',
              )
              .get(assetId, input.idempotencyKey),
          )
          if (prior !== undefined)
            return {
              _tag: 'Replay' as const,
              response: Schema.decodeUnknownSync(ReviewAssetResponse)(
                JSON.parse(prior.response),
              ),
            }

          const existing = Schema.decodeUnknownSync(Schema.optional(ReviewRow))(
            database
              .prepare(
                'SELECT revision,review FROM asset_reviews WHERE asset_id=?',
              )
              .get(assetId),
          )
          const reviewRevision = existing?.revision ?? 0
          if (
            row.revision !== input.expectedAssetRevision ||
            reviewRevision !== input.expectedReviewRevision
          )
            return { _tag: 'Conflict' as const }

          const assetReview = AssetReview.make({
            revision: AssetRevision.make(reviewRevision + 1),
            decision: input.decision,
            ...(input.rating === undefined ? {} : { rating: input.rating }),
            ...(input.annotation === undefined
              ? {}
              : { annotation: input.annotation }),
            updatedAt: new Date().toISOString(),
          })
          const response = ReviewAssetResponse.cases.Accepted.make({
            review: assetReview,
          })
          const detail = { ...JSON.parse(row.detail), review: assetReview }

          database.exec('BEGIN IMMEDIATE')
          try {
            const cursor =
              Number(
                JSON.parse(
                  Schema.decodeUnknownSync(StateValueRow)(
                    database
                      .prepare(
                        "SELECT value FROM state WHERE key='eventCursor'",
                      )
                      .get(),
                  ).value,
                ),
              ) + 1
            database
              .prepare(
                'INSERT INTO asset_reviews VALUES (?,?,?) ON CONFLICT(asset_id) DO UPDATE SET revision=excluded.revision,review=excluded.review',
              )
              .run(assetId, assetReview.revision, JSON.stringify(assetReview))
            database
              .prepare(
                'UPDATE library_assets SET detail=?,updated_at=? WHERE asset_id=?',
              )
              .run(JSON.stringify(detail), assetReview.updatedAt, assetId)
            database
              .prepare('INSERT INTO asset_review_receipts VALUES (?,?,?)')
              .run(assetId, input.idempotencyKey, JSON.stringify(response))
            database
              .prepare("UPDATE state SET value=? WHERE key='eventCursor'")
              .run(JSON.stringify(cursor))
            database
              .prepare("UPDATE state SET value=? WHERE key='snapshotVersion'")
              .run(
                JSON.stringify(
                  Number(
                    JSON.parse(
                      Schema.decodeUnknownSync(StateValueRow)(
                        database
                          .prepare(
                            "SELECT value FROM state WHERE key='snapshotVersion'",
                          )
                          .get(),
                      ).value,
                    ),
                  ) + 1,
                ),
              )
            database
              .prepare('INSERT INTO events VALUES (?,?,?)')
              .run(
                cursor,
                'AssetReviewUpdated',
                JSON.stringify({ assetId, review: assetReview }),
              )
            database.exec('COMMIT')
            return { _tag: 'Accepted' as const, response, cursor }
          } catch (error) {
            database.exec('ROLLBACK')
            throw error
          }
        },
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

      if (stored === undefined)
        return LibraryReviewOutcome.cases.Unavailable.make({
          response: rejected(
            ReviewAssetFailure.cases.LibraryUnavailable.make({}),
          ),
        })
      return yield* Match.value(stored).pipe(
        Match.when({ _tag: 'NotFound' }, () =>
          Effect.succeed(
            LibraryReviewOutcome.cases.NotFound.make({
              response: rejected(
                ReviewAssetFailure.cases.AssetNotFound.make({}),
              ),
            }),
          ),
        ),
        Match.when({ _tag: 'Conflict' }, () =>
          Effect.succeed(
            LibraryReviewOutcome.cases.Conflict.make({
              response: rejected(
                ReviewAssetFailure.cases.RevisionConflict.make({}),
              ),
            }),
          ),
        ),
        Match.when({ _tag: 'Replay' }, ({ response }) =>
          Effect.succeed(
            LibraryReviewOutcome.cases.Accepted.make({ response }),
          ),
        ),
        Match.when({ _tag: 'Accepted' }, ({ response, cursor }) =>
          publication
            .publish(cursor)
            .pipe(
              Effect.as(LibraryReviewOutcome.cases.Accepted.make({ response })),
            ),
        ),
        Match.exhaustive,
      )
    })

    return LibraryReviewService.of({ review })
  }),
)
