import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverSeestars } from './discovery.js'

test('rejects an already-cancelled Seestar discovery', async () => {
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    discoverSeestars({ signal: controller.signal }),
    /Discovery aborted/,
  )
})
