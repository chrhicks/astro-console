import { Schema } from 'effect'
import { AssetRevision, NonNegativeInt } from './primitives.js'

export const FrameInspection = Schema.TaggedUnion({
  Available: {
    preview: Schema.Struct({
      format: Schema.Literal('png'),
      checksum: Schema.NonEmptyString,
      provenance: Schema.Struct({
        algorithm: Schema.Literals([
          'deterministic-fixture-v1',
          'bounded-pixel-preview-v1',
        ]),
        sourceChecksum: Schema.NonEmptyString,
      }),
    }),
    metrics: Schema.Struct({
      clippingPercent: NonNegativeInt,
      framing: Schema.Literals(['inFrame', 'attention']),
      sharpness: NonNegativeInt,
      shape: NonNegativeInt,
      driftArcsec: NonNegativeInt,
    }),
    rationale: Schema.Struct({
      decision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
      summary: Schema.NonEmptyString,
    }),
  },
  Unavailable: { summary: Schema.NonEmptyString },
  Failed: {
    summary: Schema.NonEmptyString,
    diagnosticRef: Schema.NonEmptyString,
  },
})

export type FrameInspection = typeof FrameInspection.Type

export const AssetReview = Schema.Struct({
  revision: AssetRevision,
  decision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
  rating: Schema.optionalKey(NonNegativeInt),
  annotation: Schema.optionalKey(Schema.NonEmptyString),
  updatedAt: Schema.NonEmptyString,
})

export const ReviewAssetRequest = Schema.Struct({
  expectedAssetRevision: AssetRevision,
  expectedReviewRevision: AssetRevision,
  decision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
  rating: Schema.optionalKey(NonNegativeInt),
  annotation: Schema.optionalKey(Schema.NonEmptyString),
  idempotencyKey: Schema.NonEmptyString,
})
