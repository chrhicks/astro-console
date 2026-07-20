import { Effect, Layer, Schema } from 'effect'
import { GeoService, resolveObserverAuthority, type GeoLocation } from './geo-service'
import { ObserverProfile } from '../profile/observer-profile'

const GEOJS_URL = 'https://get.geojs.io/v1/ip/geo.json'

const GeoJsLocation = Schema.Struct({
  latitude: Schema.NumberFromString,
  longitude: Schema.NumberFromString,
})

export const GeoServiceLive = Layer.effect(
  GeoService,
  Effect.gen(function* () {
    const lookup = yield* Effect.cached(fetchGeoLocation())
    const profile = yield* ObserverProfile
    return {
      lookup,
      resolveObserverLocation: (deviceLocation) => Effect.gen(function* () {
        const configured = yield* profile.get
        const location = yield* lookup
        return resolveObserverAuthority(configured, deviceLocation, location)
      }),
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
