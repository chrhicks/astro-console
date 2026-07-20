import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createObserverLocationDraftLifecycle,
  observerLocationDraft,
  observerLocationSource,
  validateObserverLocation,
} from './observer-location'

test('accepts finite manual observer coordinates within latitude and longitude ranges', () => {
  assert.deepEqual(validateObserverLocation('39.755', '-74.2679'), {
    lat: 39.755,
    lon: -74.2679,
  })
})

test('rejects out-of-range manual observer coordinates', () => {
  assert.equal(validateObserverLocation('91', '0'), null)
  assert.equal(validateObserverLocation('0', '-181'), null)
  assert.equal(validateObserverLocation('Infinity', '0'), null)
})

test('rejects blank manual observer coordinates', () => {
  assert.equal(validateObserverLocation('', '0'), null)
  assert.equal(validateObserverLocation('   ', '\t'), null)
})

test('blocks queued draft initialization after input and permits it after a save', () => {
  const lifecycle = createObserverLocationDraftLifecycle()
  const queuedInitialization = () => lifecycle.canInitialize()

  lifecycle.markEdited()
  assert.equal(queuedInitialization(), false)

  lifecycle.markSaved()
  assert.equal(lifecycle.canInitialize(), true)
})

test('formats successful observer coordinates and sources canonically', () => {
  assert.deepEqual(observerLocationDraft({ lat: 39.755, lon: -74.2679 }), {
    lat: '39.755',
    lon: '-74.2679',
  })
  assert.equal(observerLocationSource('configured'), 'Configured')
  assert.equal(observerLocationSource('device'), 'Device')
})
