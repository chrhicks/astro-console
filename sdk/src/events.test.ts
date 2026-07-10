import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeSeestarPushEvent, toSeestarLifecycleEvent } from './events.js'

test('decodes known progress fields without preserving unknown vendor fields', () => {
  const event = decodeSeestarPushEvent({
    Event: 'Stack',
    state: 'working',
    stacked_frame: 3,
    percent: '42',
    lapse_ms: 1200,
    vendor_secret: 'drop me',
  })
  assert.equal(event?.Event, 'Stack')
  assert.equal(event?.stacked_frame, 3)
  assert.equal(event?.percent, 42)
  assert.equal(event?.lapse_ms, 1200)
  assert.equal(Reflect.has(event ?? {}, 'vendor_secret'), false)
  assert.equal(decodeSeestarPushEvent({ Event: 2 }), undefined)
})

test('normalizes stack failures into lifecycle events', () => {
  assert.deepEqual(
    toSeestarLifecycleEvent({
      Event: 'Stack',
      state: 'fail',
      error: 'no stars',
    }),
    { type: 'capture.failed', error: 'no stars' },
  )
  assert.deepEqual(toSeestarLifecycleEvent({ Event: 'Stack', code: 5 }), {
    type: 'capture.failed',
    error: 'Stack reported code 5',
  })
  assert.equal(
    toSeestarLifecycleEvent({ Event: 'AutoGoto', state: 'fail' }),
    undefined,
  )
})
