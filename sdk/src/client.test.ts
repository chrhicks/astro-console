import assert from 'node:assert/strict'
import * as net from 'node:net'
import test from 'node:test'
import { SeestarClient } from './client.js'

test('closes the connection when an unterminated frame exceeds the receive limit', async () => {
  const server = net.createServer((socket) => {
    socket.write(Buffer.alloc(64 * 1024 + 1, 120))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  const client = new SeestarClient('127.0.0.1', address.port)
  const closed = new Promise<void>((resolve) => client.onClose(resolve))
  try {
    await client.connect()
    await closed
    assert.equal(client.isConnected(), false)
  } finally {
    client.disconnect()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
