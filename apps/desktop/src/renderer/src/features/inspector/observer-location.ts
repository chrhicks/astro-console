export interface ObserverLocationInput {
  readonly lat: number
  readonly lon: number
}

export function createObserverLocationDraftLifecycle() {
  let edited = false

  return {
    canInitialize: () => !edited,
    markEdited: () => {
      edited = true
    },
    markSaved: () => {
      edited = false
    },
  }
}

export function validateObserverLocation(
  lat: string,
  lon: string,
): ObserverLocationInput | null {
  if (!lat.trim() || !lon.trim()) return null
  const parsedLat = Number(lat)
  const parsedLon = Number(lon)
  if (
    !Number.isFinite(parsedLat) ||
    !Number.isFinite(parsedLon) ||
    parsedLat < -90 ||
    parsedLat > 90 ||
    parsedLon < -180 ||
    parsedLon > 180
  ) {
    return null
  }
  return { lat: parsedLat, lon: parsedLon }
}

export function observerLocationDraft(location: ObserverLocationInput) {
  return {
    lat: location.lat.toString(),
    lon: location.lon.toString(),
  }
}

export function observerLocationSource(
  source: 'configured' | 'device' | 'geoip' | undefined,
) {
  if (source === 'configured') return 'Configured'
  if (source === 'device') return 'Device'
  if (source === 'geoip') return 'GeoIP'
  return 'Not configured'
}
