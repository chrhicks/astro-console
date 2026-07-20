import assert from 'node:assert/strict'
import test from 'node:test'
import { ConfigProvider, Effect } from 'effect'
import { DeviceRegistry, DeviceRegistryLive, dedupeDiscoveredDevices } from './device-registry'

test('native Seestar TCP is disabled unless explicitly configured', async () => {
  const registry = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* DeviceRegistry
    }).pipe(
      Effect.provide(DeviceRegistryLive),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
    ),
  )

  const result = await Effect.runPromiseExit(registry.get('seestar'))

  assert.equal(result._tag, 'Failure')
})

test('native Seestar TCP configuration is decoded from a ConfigProvider', async () => {
  const registry = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* DeviceRegistry
    }).pipe(
      Effect.provide(DeviceRegistryLive),
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({
        SEESTAR_EXPERIMENTAL_NATIVE_TCP: 'true',
        SEESTAR_EXPERIMENTAL_PEM_PATH: '/tmp/seestar.pem',
      }))),
    ),
  )

  const plugin = await Effect.runPromise(registry.get('seestar'))

  assert.equal(plugin.kind, 'seestar')
})

test('prefers the first discovered provenance for one durable device identity', () => {
  const devices = dedupeDiscoveredDevices([
    {
      pluginKind: 'alpaca-rig',
      deviceId: 'alpaca:telescope:3ebae4b6',
      displayName: 'Seestar S30',
      serialNumber: '3ebae4b6',
    },
    {
      pluginKind: 'seestar',
      deviceId: 'seestar:sn:3ebae4b6',
      displayName: 'Seestar S30',
      serialNumber: '3ebae4b6',
    },
  ])

  assert.deepEqual(devices, [
    {
      pluginKind: 'alpaca-rig',
      deviceId: 'alpaca:telescope:3ebae4b6',
      displayName: 'Seestar S30',
      serialNumber: '3ebae4b6',
    },
  ])
})

test('retains devices without a shared durable identity', () => {
  const devices = dedupeDiscoveredDevices([
    { pluginKind: 'alpaca-rig', deviceId: 'alpaca:host:192.0.2.1:11111', displayName: 'Rig' },
    { pluginKind: 'seestar', deviceId: 'seestar:host:192.0.2.1', displayName: 'Seestar' },
  ])

  assert.equal(devices.length, 2)
})
