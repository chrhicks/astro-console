import { Effect, Layer, Schema } from 'effect'
import { GeoService, type GeoLocation } from './geo-service'

const GEOJS_URL = 'https://get.geojs.io/v1/ip/geo.json'

const GeoJsLocation = Schema.Struct({
  latitude: Schema.NumberFromString,
  longitude: Schema.NumberFromString,
})

export const GeoServiceLive = Layer.effect(
  GeoService,
  Effect.gen(function* () {
    const lookup = yield* Effect.cached(fetchGeoLocation())
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
    const response = yield* Effect.tryPromise((signal) =>
      fetch(GEOJS_URL, { signal }),
    )
    if (!response.ok) return null
    const body: unknown = yield* Effect.tryPromise(() => response.json())
    const parsed = yield* Schema.decodeUnknownEffect(GeoJsLocation)(body)
    if (
      !Number.isFinite(parsed.latitude) ||
      !Number.isFinite(parsed.longitude) ||
      parsed.latitude < -90 ||
      parsed.latitude > 90 ||
      parsed.longitude < -180 ||
      parsed.longitude > 180
    ) {
      return null
    }
    return { lat: parsed.latitude, lon: parsed.longitude }
  }).pipe(
    Effect.timeout('2 seconds'),
    Effect.catch(() => Effect.succeed<GeoLocation | null>(null)),
  )
}
