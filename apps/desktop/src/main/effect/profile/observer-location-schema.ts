import { Schema } from 'effect'

export const ObserverLocationSchema = Schema.Struct({
  lat: Schema.Number.check(
    Schema.isFinite(),
    Schema.isBetween({ minimum: -90, maximum: 90 }),
  ),
  lon: Schema.Number.check(
    Schema.isFinite(),
    Schema.isBetween({ minimum: -180, maximum: 180 }),
  ),
})

export const ObserverLocationRequestSchema = Schema.Struct({
  location: Schema.NullOr(ObserverLocationSchema),
})
