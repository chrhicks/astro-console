import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, Schema } from 'effect'
import {
  AlpacaClient,
  AlpacaProtocolError,
  AlpacaRejectedError,
  AlpacaTransportError,
} from './client.js'

test('decodes Alpaca envelopes at the transport boundary', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    Response.json({ Value: true, ErrorNumber: 0 }),
  )
  assert.equal(
    await Effect.runPromise(client.get('/api/v1/telescope/0/tracking', Schema.Boolean)),
    true,
  )
})

test('provides explicit Promise adapters for direct consumers', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    Response.json({ Value: true, ErrorNumber: 0 }),
  )
  assert.equal(
    await client.getPromise('/api/v1/telescope/0/tracking', Schema.Boolean),
    true,
  )
})

test('form encodes Alpaca PUT commands with a client id', async () => {
  let request: RequestInit | undefined
  const client = new AlpacaClient('device', 1111, async (_url, init) => {
    request = init
    return Response.json({ ErrorNumber: 0 })
  })
  await Effect.runPromise(client.put('/api/v1/telescope/0/connected', { Connected: true }))
  const body = new URLSearchParams(String(request?.body))
  assert.equal(body.get('ClientID'), '1')
  assert.equal(body.get('Connected'), 'true')
})

test('classifies malformed provider payloads as protocol failures', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    Response.json({ Value: 'true', ErrorNumber: 0 }),
  )
  await assert.rejects(
    Effect.runPromise(client.get('/api/v1/telescope/0/tracking', Schema.Boolean)),
    AlpacaProtocolError,
  )
})

test('classifies provider error envelopes as rejections', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    Response.json({ ErrorNumber: 1, ErrorMessage: 'rejected' }),
  )
  await assert.rejects(
    Effect.runPromise(client.put('/api/v1/telescope/0/park', {})),
    AlpacaRejectedError,
  )
})

test('classifies request failures as transport errors', async () => {
  const client = new AlpacaClient('device', 1111, async () => {
    throw new Error('offline')
  })
  await assert.rejects(
    Effect.runPromise(client.get('/api/v1/telescope/0/tracking', Schema.Boolean)),
    AlpacaTransportError,
  )
})

test('classifies malformed Alpaca JSON as a protocol failure', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    new Response('{'),
  )
  await assert.rejects(
    Effect.runPromise(client.get('/api/v1/telescope/0/tracking', Schema.Boolean)),
    AlpacaProtocolError,
  )
})

test('classifies non-success HTTP responses as provider rejections', async () => {
  const client = new AlpacaClient('device', 1111, async () =>
    new Response(undefined, { status: 503 }),
  )
  await assert.rejects(
    Effect.runPromise(client.get('/api/v1/telescope/0/tracking', Schema.Boolean)),
    (error: unknown) => error instanceof AlpacaRejectedError && error.status === 503,
  )
})

test('forwards cancellation to the request transport', async () => {
  const controller = new AbortController()
  const client = new AlpacaClient('device', 1111, async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    }),
  )
  const request = Effect.runPromise(client.get('/api/v1/telescope/0/tracking', Schema.Boolean, controller.signal))
  controller.abort()
  await assert.rejects(request, AlpacaTransportError)
})
