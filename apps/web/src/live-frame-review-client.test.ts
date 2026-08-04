import assert from 'node:assert/strict'
import test from 'node:test'
import { loadLiveFrameReview } from './live-frame-review-client'

test('loads only the current Library-backed frame review', async () => {
  const review = await loadLiveFrameReview(async (input) => {
    assert.equal(input, '/api/observe/live-frame')
    return new Response(
      JSON.stringify({
        _tag: 'Unavailable',
        reason: 'LibraryAssetNotFound',
        message: 'The current frame has not materialized in Library yet.',
      }),
      { status: 200 },
    )
  })
  assert.equal(review._tag, 'Unavailable')
  if (review._tag === 'Unavailable')
    assert.equal(review.reason, 'LibraryAssetNotFound')
})

test('rejects a failed current-frame review request', async () => {
  await assert.rejects(() =>
    loadLiveFrameReview(async () => new Response('', { status: 503 })),
  )
})
