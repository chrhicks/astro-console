export interface SiteAzimuthRange {
  startDeg: number
  endDeg: number
  label?: string
}

export type ObserverContextSource = 'device' | 'site' | 'geoip' | 'none'

export interface ObserverContext {
  lat: number
  lon: number
  minAltitudeDeg?: number
  blockedAzimuthRanges?: SiteAzimuthRange[]
  source: Exclude<ObserverContextSource, 'none'>
}
