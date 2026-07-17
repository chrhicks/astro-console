import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverAlpacaRigs } from './discovery.js'

test('cancels Alpaca discovery while its UDP scan is active', async () => {
  const controller = new AbortController()
  const discovery = discoverAlpacaRigs(10_000, controller.signal)
  controller.abort()

  await assert.rejects(discovery, /Alpaca discovery aborted/)
})
