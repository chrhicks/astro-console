import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveObserverAuthority } from './geo-service'

test('configured observer location takes precedence over device and GeoIP', () => {
  assert.deepEqual(
    resolveObserverAuthority({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 5, lon: 6 }),
    { location: { lat: 1, lon: 2 }, source: 'configured' },
  )
})

test('observer authority ignores device coordinates and falls back to GeoIP', () => {
  assert.deepEqual(
    resolveObserverAuthority(null, { lat: 3, lon: 4 }, { lat: 5, lon: 6 }),
    { location: { lat: 5, lon: 6 }, source: 'geoip' },
  )
  assert.deepEqual(
    resolveObserverAuthority(null, undefined, { lat: 5, lon: 6 }),
    { location: { lat: 5, lon: 6 }, source: 'geoip' },
  )
  assert.deepEqual(resolveObserverAuthority(null, undefined, null), { location: null, source: undefined })
})
