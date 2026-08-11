import { Schema } from 'effect'
import { NonNegativeNumber } from './primitives.js'

export const PointingVector = Schema.Struct({
  rightAscensionArcsec: Schema.Finite,
  declinationArcsec: Schema.Finite,
  convention: Schema.Literals(['mountRaDec', 'imageAxis']),
})

export const CaptureMetric = Schema.TaggedUnion({
  Known: { value: NonNegativeNumber },
  Unknown: { reason: Schema.NonEmptyString },
})
