import assert from 'node:assert/strict'
import test from 'node:test'
import { Result, Schema } from 'effect'
import { ObserverLocationRequestSchema } from '../profile/observer-location-schema'

test('IPC observer-location schema rejects non-finite and out-of-range coordinates', () => {
  const decode = Schema.decodeUnknownResult(ObserverLocationRequestSchema)

  assert.equal(Result.isFailure(decode({ location: { lat: Infinity, lon: 0 } })), true)
  assert.equal(Result.isFailure(decode({ location: { lat: 0, lon: -181 } })), true)
  assert.equal(Result.isSuccess(decode({ location: { lat: 39.755, lon: -74.2679 } })), true)
})
