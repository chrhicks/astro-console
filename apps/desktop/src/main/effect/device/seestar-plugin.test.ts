import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Effect, Layer } from 'effect'
import type { RigObserverLocation, RigSession, RigSnapshot } from 'seestar-sdk'
import { EventBusLive } from '../event/event-bus'
import { GeoService, type GeoLocation } from '../geo/geo-service'
import { createSeestarPlugin } from './seestar-plugin'

const deviceLocation = { lat: 39.755, lon: -74.2679 }
const geoipLocation = { lat: 40.7128, lon: -74.006 }

test('Seestar plugin synchronizes the valid device observer location before publishing refreshed telemetry', async () => {
  const observed: Array<RigObserverLocation | undefined> = []
  const plugin = createSeestarPlugin({
    discover: async () => [{
      host: '192.0.2.10',
      port: 4720,
      result: { product_model: 'Seestar S30', sn: 's30-1' },
    }],
    pemPath: '/unused.pem',
    createRig: () => Effect.succeed(createRigSession(deviceLocation, observed)),
  })
  const geo = createGeoService(geoipLocation)

  const discovered = await Effect.runPromise(plugin.discover)
  const session = await Effect.runPromise(
    plugin.connect({ pluginKind: 'seestar', deviceId: discovered[0]!.deviceId }).pipe(
      Effect.provide(Layer.succeed(GeoService, geo)),
      Effect.provide(EventBusLive),
    ),
  )

  assert.deepEqual(observed, [deviceLocation])
  assert.equal(session.rig.connect.device.locationSource, 'device')
  assert.deepEqual(session.rig.connect.device.location, deviceLocation)
  assert.equal(session.rig.connect.device.deviceTimeLooksStale, false)
  assert.deepEqual(session.rig.connect.device.warnings, [])
  await Effect.runPromise(session.disconnect)
})

test('Seestar plugin falls back to cached GeoIP observer location before publishing', async () => {
  const observed: Array<RigObserverLocation | undefined> = []
  const plugin = createSeestarPlugin({
    discover: async () => [{
      host: '192.0.2.10',
      port: 4720,
      result: { product_model: 'Seestar S30', sn: 's30-1' },
    }],
    pemPath: '/unused.pem',
    createRig: () => Effect.succeed(createRigSession(undefined, observed)),
  })
  const geo = createGeoService(geoipLocation)

  const discovered = await Effect.runPromise(plugin.discover)
  const session = await Effect.runPromise(
    plugin.connect({ pluginKind: 'seestar', deviceId: discovered[0]!.deviceId }).pipe(
      Effect.provide(Layer.succeed(GeoService, geo)),
      Effect.provide(EventBusLive),
    ),
  )

  assert.deepEqual(observed, [geoipLocation])
  assert.equal(session.rig.connect.device.locationSource, 'geoip')
  assert.deepEqual(session.rig.connect.device.location, geoipLocation)
  await Effect.runPromise(session.disconnect)
})

test('Seestar plugin synchronizes host time when GeoIP has no observer location', async () => {
  const observed: Array<RigObserverLocation | undefined> = []
  const plugin = createSeestarPlugin({
    discover: async () => [{
      host: '192.0.2.10',
      port: 4720,
      result: { product_model: 'Seestar S30', sn: 's30-1' },
    }],
    pemPath: '/unused.pem',
    createRig: () => Effect.succeed(createRigSession(undefined, observed)),
  })
  const geo = createGeoService(null)

  const discovered = await Effect.runPromise(plugin.discover)
  const session = await Effect.runPromise(
    plugin.connect({ pluginKind: 'seestar', deviceId: discovered[0]!.deviceId }).pipe(
      Effect.provide(Layer.succeed(GeoService, geo)),
      Effect.provide(EventBusLive),
    ),
  )

  assert.deepEqual(observed, [undefined])
  assert.equal(session.rig.connect.device.location, undefined)
  assert.equal(session.rig.connect.device.deviceTimeLooksStale, false)
  await Effect.runPromise(session.disconnect)
})

function createRigSession(
  observerLocation: RigObserverLocation | undefined,
  observed: Array<RigObserverLocation | undefined>,
): RigSession {
  const snapshot: RigSnapshot = {
    mount: {},
    preview: { active: false, source: 'none' },
    capture: { active: false },
    telemetry: {
      deviceTime: { year: 2020, mon: 6, day: 29, hour: 7, min: 36, sec: 53 },
      deviceTimeLooksStale: true,
    },
    warnings: ['Device clock appears stale'],
  }
  const refreshed: RigSnapshot = {
    ...snapshot,
    telemetry: {
      deviceTime: { year: 2026, mon: 7, day: 17, hour: 12, min: 0, sec: 0 },
      deviceTimeLooksStale: false,
    },
    warnings: [],
  }
  return {
    identity: {
      rigId: 'seestar:sn:s30-1',
      provider: 'seestar',
      displayName: 'Seestar S30',
      host: '192.0.2.10',
    },
    observerLocation,
    snapshot,
    refresh: Effect.succeed(refreshed),
    disconnect: Effect.void,
    synchronizeObserver: (input) => {
      observed.push(input.observerLocation)
      return Effect.succeed({ observerLocation: input.observerLocation, snapshot: refreshed })
    },
  }
}

function createGeoService(fallback: GeoLocation | null) {
  return {
    lookup: Effect.succeed(fallback),
    resolveObserverLocation: (location?: GeoLocation) =>
      Effect.succeed(
        location
          ? { location, source: 'device' as const }
          : { location: fallback, source: fallback ? 'geoip' as const : undefined },
      ),
  }
}
