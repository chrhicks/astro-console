import { Effect, Layer, Ref, Schema } from 'effect'
import { GeoService, type GeoLocation } from './geo-service'

const GEOJS_URL = 'https://get.geojs.io/v1/ip/geo.json'

const GeoJsLocation = Schema.Struct({
  latitude: Schema.NumberFromString,
  longitude: Schema.NumberFromString,
})

export const GeoServiceLive = Layer.effect(
  GeoService,
  Effect.gen(function* () {
    // undefined = not yet looked up, null = looked up with no result.
    const cache = yield* Ref.make<GeoLocation | null | undefined>(undefined)

    const lookup = Effect.gen(function* () {
      const cached = yield* Ref.get(cache)
      if (cached !== undefined) return cached

      const result = yield* fetchGeoLocation()
      yield* Ref.set(cache, result)
      return result
    })
    return {
      lookup,
      resolveObserverLocation: (deviceLocation) =>
        deviceLocation
          ? Effect.succeed({ location: deviceLocation, source: 'device' as const })
          : lookup.pipe(
              Effect.map((location) => ({
                location,
                source: location ? 'geoip' as const : undefined,
              })),
            ),
    } satisfies GeoService
  }),
)

function fetchGeoLocation(): Effect.Effect<GeoLocation | null> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise(() => fetch(GEOJS_URL))
    if (!response.ok) return null
    const body: unknown = yield* Effect.tryPromise(() => response.json())
    const parsed = yield* Schema.decodeUnknownEffect(GeoJsLocation)(body)
    return { lat: parsed.latitude, lon: parsed.longitude }
  }).pipe(Effect.catch(() => Effect.succeed<GeoLocation | null>(null)))
}
