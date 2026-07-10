import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAlpacaImageBytes } from './image-bytes'

test('parses a bounded mono16 ImageBytes frame', () => {
  const data = new Uint8Array(48)
  const view = new DataView(data.buffer)
  ;[1, 0, 1, 1, 44, 8, 8, 2, 2, 1, 0].forEach((value, index) =>
    view.setInt32(index * 4, value, true),
  )
  data.set([1, 0, 2, 0], 44)

  const frame = parseAlpacaImageBytes(data)
  assert.equal(frame.width, 2)
  assert.equal(frame.height, 1)
  assert.equal(frame.pixelFormat, 'mono16')
  assert.deepEqual([...frame.data], [1, 0, 2, 0])
})

test('returns an honest unknown frame for malformed geometry', () => {
  const data = new Uint8Array(44)
  const frame = parseAlpacaImageBytes(data)
  assert.equal(frame.width, 0)
  assert.equal(frame.pixelFormat, 'unknown')
  assert.equal(frame.data, data)
})
