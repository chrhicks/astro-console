import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'effect'
import { AlpacaClient } from './client'

test('decodes Alpaca envelopes at the transport boundary', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    Response.json({ Value: true, ErrorNumber: 0 }),
  )
  assert.equal(
    await client.get('/api/v1/telescope/0/tracking', Schema.Boolean),
    true,
  )
})

test('form encodes Alpaca PUT commands with a client id', async () => {
  let request: RequestInit | undefined
  const client = new AlpacaClient('device', 1111, async (_url, init) => {
    request = init
    return Response.json({ ErrorNumber: 0 })
  })
  await client.put('/api/v1/telescope/0/connected', { Connected: true })
  const body = new URLSearchParams(String(request?.body))
  assert.equal(body.get('ClientID'), '1')
  assert.equal(body.get('Connected'), 'true')
})
