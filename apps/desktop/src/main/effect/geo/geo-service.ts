import { Context, Effect } from 'effect'

export interface GeoLocation {
  readonly lat: number
  readonly lon: number
}

export interface GeoService {
  // Resolves to a coarse IP-based location, or null when the lookup fails or
  // yields no usable coordinates. Results are cached for the app session so
  // repeated status projections do not re-hit GeoJS.
  readonly lookup: Effect.Effect<GeoLocation | null>
  readonly resolveObserverLocation: (
    deviceLocation?: GeoLocation,
  ) => Effect.Effect<{
    readonly location: GeoLocation | null
    readonly source: 'device' | 'geoip' | undefined
  }>
}

export const GeoService = Context.GenericTag<GeoService>('GeoService')
