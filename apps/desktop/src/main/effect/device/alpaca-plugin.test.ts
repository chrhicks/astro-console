import assert from 'node:assert/strict'
import test from 'node:test'
import { toDiscoveredRig } from './alpaca-plugin'

test('maps vendor discovery facts to the desktop device identity', () => {
  const rig = toDiscoveredRig({
    host: '192.0.2.10',
    port: 11111,
    friendlyName: 'Observatory',
    telescopeName: 'Example Mount',
    telescopeDeviceNumber: 2,
    telescopeUniqueId: 'mount-1',
    cameraDeviceNumber: 3,
  })

  assert.equal(rig.pluginKind, 'alpaca-rig')
  assert.equal(rig.deviceId, 'alpaca:telescope:mount-1')
  assert.equal(rig.displayName, 'Example Mount')
  assert.equal(rig.cameraDeviceNumber, 3)
})
