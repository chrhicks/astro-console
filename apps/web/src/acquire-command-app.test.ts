import assert from 'node:assert/strict'
import test from 'node:test'
import { Schema } from 'effect'
import {
  AcquireCommandResponse,
  BootstrapSnapshot,
  LibraryQuery,
  LibraryQueryId,
} from '@astro-console/protocol'
import { startLibraryClientOperation, submitAcquireIntent } from './App'
import { bootstrapFixtures } from './testing/bootstrap-fixtures'

const intent = {
  _tag: 'AbortAcquire',
  expectedLeaseRevision: 1,
  expectedRunRevision: 1,
  expectedAcquireRevision: 1,
  idempotencyKey: 'validated-acquire-request',
}
const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)(
  bootstrapFixtures.fresh,
)

test('validates Acquire request and response JSON in the App browser path', async () => {
  const originalFetch = globalThis.fetch
  let submitted: unknown
  try {
    globalThis.fetch = async (_input, init) => {
      submitted = JSON.parse(String(init?.body))
      return Response.json(
        AcquireCommandResponse.cases.Accepted.make({
          snapshot,
        }),
        { status: 202 },
      )
    }
    await submitAcquireIntent(intent)
    assert.deepEqual(submitted, { intent })

    globalThis.fetch = async () => Response.json({ _tag: 'Accepted' })
    await assert.rejects(() => submitAcquireIntent(intent))

    globalThis.fetch = async () =>
      Response.json(
        AcquireCommandResponse.cases.Rejected.make({
          summary: 'Acquire revision changed.',
          snapshot,
        }),
        { status: 409 },
      )
    await assert.rejects(
      () => submitAcquireIntent(intent),
      /Acquire revision changed/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects malformed Acquire intents before transport', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  try {
    globalThis.fetch = async () => {
      called = true
      return Response.json({})
    }
    await assert.rejects(() => submitAcquireIntent({ _tag: 'AbortAcquire' }))
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('disposing a Library operation interrupts its browser request', async () => {
  const originalFetch = globalThis.fetch
  let requestSignal: AbortSignal | undefined
  let markStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  try {
    globalThis.fetch = async (_input, init) => {
      requestSignal = init?.signal ?? undefined
      markStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        if (requestSignal === undefined) {
          reject(new Error('The Library request has no cancellation signal.'))
          return
        }
        requestSignal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        )
      })
    }
    const operation = startLibraryClientOperation((client) =>
      client.page(
        LibraryQuery.make({
          queryId: LibraryQueryId.make('cancellation-proof'),
          pageSize: 40,
          sort: 'capturedAtDescending',
        }),
      ),
    )
    await started
    const rejected = assert.rejects(() => operation.promise)
    await operation.dispose()
    await rejected
    assert.equal(requestSignal?.aborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
