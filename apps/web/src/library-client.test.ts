import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LibraryQuery as LibraryQuerySchema,
  LibraryCursor,
  LibraryQueryId,
  LibraryRouteFailure,
  ReviewAssetFailure,
  ReviewAssetRequest,
  ReviewAssetResponse,
  AssetRevision,
} from '@astro-console/protocol'
import { Effect, Layer } from 'effect'
import {
  LibraryClient,
  LibraryAssetUnavailable,
  LibraryNotFound,
  LibraryTransport,
  LibraryUnavailable,
  layer,
  libraryPagePath,
  type LibraryQuery,
} from './library-client'

const query: LibraryQuery = LibraryQuerySchema.make({
  queryId: LibraryQueryId.make('nightbook'),
  cursor: LibraryCursor.make('20'),
  pageSize: 40,
  role: 'final',
  sort: 'recentlyUpdated',
})

const detail = {
  assetId: 'asset-1',
  revision: 1,
  role: 'final',
  format: 'fits',
  availability: 'published',
  capturedAt: '2026-08-03T00:00:00.000Z',
  comparisonGroupId: 'group-1',
  lineage: {
    sourceAssetIds: ['source-1'],
    runId: 'run-1',
    solveAttemptId: 'solve-1',
  },
  representations: [],
  actions: [],
}

const handoff = {
  sourceAssetId: 'asset-1',
  revision: 1,
  role: 'original',
  format: 'fits',
  availability: 'availableLocally',
  comparisonGroupId: 'group-1',
  lineage: {
    sourceAssetIds: ['source-1'],
    runId: 'run-1',
    solveAttemptId: 'solve-1',
  },
  processing: {
    availability: 'unavailable',
    currentFixtureFacts: [
      'Interactive processing is not available in this workspace.',
    ],
  },
}

const unusedReview = () => Effect.die('unused')

test('encodes bounded Library query parameters', () => {
  assert.equal(
    libraryPagePath(query),
    '/api/library?queryId=nightbook&pageSize=40&sort=recentlyUpdated&cursor=20&role=final',
  )
})

test('decodes a typed Library detail', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* LibraryClient
      return yield* client.detail('asset-1')
    }).pipe(
      Effect.provide(layer),
      Effect.provide(
        Layer.succeed(
          LibraryTransport,
          LibraryTransport.of({
            loadPage: () => Effect.die('unused'),
            loadDetail: () => Effect.succeed(detail),
            loadProcessSourceHandoff: () => Effect.succeed(handoff),
            reviewAsset: unusedReview,
          }),
        ),
      ),
    ),
  )
  assert.equal(result.assetId, 'asset-1')
})

test('keeps detail not-found and unavailable failures distinct', async () => {
  for (const [failure, expected] of [
    [new LibraryNotFound(), 'not-found'],
    [new LibraryUnavailable({ reason: '503 unavailable' }), 'unavailable'],
  ] as const) {
    await assert.rejects(
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* LibraryClient
            return yield* client.detail('asset-1')
          }).pipe(
            Effect.provide(layer),
            Effect.provide(
              Layer.succeed(
                LibraryTransport,
                LibraryTransport.of({
                  loadPage: () => Effect.die('unused'),
                  loadDetail: () => Effect.fail(failure),
                  loadProcessSourceHandoff: () => Effect.die('unused'),
                  reviewAsset: unusedReview,
                }),
              ),
            ),
          ),
        ),
      (error: unknown) =>
        expected === 'not-found'
          ? error instanceof LibraryNotFound
          : error instanceof LibraryUnavailable,
    )
  }
})

test('decodes a direct Process source handoff without a session', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* LibraryClient
      return yield* client.processSourceHandoff('asset-1')
    }).pipe(
      Effect.provide(layer),
      Effect.provide(
        Layer.succeed(
          LibraryTransport,
          LibraryTransport.of({
            loadPage: () => Effect.die('unused'),
            loadDetail: () => Effect.die('unused'),
            loadProcessSourceHandoff: () => Effect.succeed(handoff),
            reviewAsset: unusedReview,
          }),
        ),
      ),
    ),
  )
  assert.deepEqual(result, handoff)
})

test('decodes a durable typed review result for Process source review', async () => {
  const review = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* LibraryClient
      return yield* client.reviewAsset(
        'asset-1',
        ReviewAssetRequest.make({
          expectedAssetRevision: AssetRevision.make(1),
          expectedReviewRevision: AssetRevision.make(0),
          decision: 'accepted',
          idempotencyKey: 'review-process-source',
        }),
      )
    }).pipe(
      Effect.provide(layer),
      Effect.provide(
        Layer.succeed(
          LibraryTransport,
          LibraryTransport.of({
            loadPage: () => Effect.die('unused'),
            loadDetail: () => Effect.die('unused'),
            loadProcessSourceHandoff: () => Effect.die('unused'),
            reviewAsset: () =>
              Effect.succeed(
                ReviewAssetResponse.cases.Accepted.make({
                  review: {
                    revision: AssetRevision.make(1),
                    decision: 'accepted',
                    updatedAt: '2026-08-09T00:00:00.000Z',
                  },
                }),
              ),
          }),
        ),
      ),
    ),
  )
  assert.equal(review.decision, 'accepted')
  assert.equal(review.revision, 1)
})

test('decodes typed review failures and rejects malformed responses', async () => {
  for (const [response, expected] of [
    [
      ReviewAssetResponse.cases.Rejected.make({
        failure: ReviewAssetFailure.cases.RevisionConflict.make({}),
      }),
      'The Library review changed. Reload and retry.',
    ],
    [{ _tag: 'Accepted' }, 'Review was not accepted.'],
  ] as const) {
    await assert.rejects(
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const client = yield* LibraryClient
            return yield* client.reviewAsset(
              'asset-1',
              ReviewAssetRequest.make({
                expectedAssetRevision: AssetRevision.make(1),
                expectedReviewRevision: AssetRevision.make(0),
                decision: 'accepted',
                idempotencyKey: 'review-process-source',
              }),
            )
          }).pipe(
            Effect.provide(layer),
            Effect.provide(
              Layer.succeed(
                LibraryTransport,
                LibraryTransport.of({
                  loadPage: () => Effect.die('unused'),
                  loadDetail: () => Effect.die('unused'),
                  loadProcessSourceHandoff: () => Effect.die('unused'),
                  reviewAsset: () => Effect.succeed(response),
                }),
              ),
            ),
          ),
        ),
      (error: unknown) =>
        error instanceof LibraryUnavailable && error.reason === expected,
    )
  }
})

test('keeps Process source route failures unavailable', async () => {
  await assert.rejects(
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return yield* client.processSourceHandoff('asset-1')
        }).pipe(
          Effect.provide(layer),
          Effect.provide(
            Layer.succeed(
              LibraryTransport,
              LibraryTransport.of({
                loadPage: () => Effect.die('unused'),
                loadDetail: () => Effect.die('unused'),
                loadProcessSourceHandoff: () =>
                  Effect.fail(new LibraryNotFound()),
                reviewAsset: unusedReview,
              }),
            ),
          ),
        ),
      ),
    (error: unknown) => error instanceof LibraryNotFound,
  )
})

test('keeps a not-local Process source distinct from missing and service failures', async () => {
  await assert.rejects(
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return yield* client.processSourceHandoff('asset-1')
        }).pipe(
          Effect.provide(layer),
          Effect.provide(
            Layer.succeed(
              LibraryTransport,
              LibraryTransport.of({
                loadPage: () => Effect.die('unused'),
                loadDetail: () => Effect.die('unused'),
                loadProcessSourceHandoff: () =>
                  Effect.fail(new LibraryAssetUnavailable()),
                reviewAsset: unusedReview,
              }),
            ),
          ),
        ),
      ),
    (error: unknown) => error instanceof LibraryAssetUnavailable,
  )
})

test('maps every Library route failure for detail and Process source', async () => {
  const cases: ReadonlyArray<{
    failure: typeof LibraryRouteFailure.Type
    detail: 'not-found' | 'unavailable'
    process: 'not-found' | 'not-local' | 'unavailable'
  }> = [
    {
      failure: LibraryRouteFailure.cases.InvalidInput.make({
        message: 'Invalid Library input.',
      }),
      detail: 'unavailable',
      process: 'unavailable',
    },
    {
      failure: LibraryRouteFailure.cases.AssetNotFound.make({}),
      detail: 'not-found',
      process: 'not-found',
    },
    {
      failure: LibraryRouteFailure.cases.AssetUnavailable.make({
        message: 'Asset is not local.',
      }),
      detail: 'unavailable',
      process: 'not-local',
    },
    {
      failure: LibraryRouteFailure.cases.LibraryUnavailable.make({}),
      detail: 'unavailable',
      process: 'unavailable',
    },
  ]

  for (const routeCase of cases) {
    const provideFailure = Layer.succeed(
      LibraryTransport,
      LibraryTransport.of({
        loadPage: () => Effect.die('unused'),
        loadDetail: () => Effect.succeed(routeCase.failure),
        loadProcessSourceHandoff: () => Effect.succeed(routeCase.failure),
        reviewAsset: unusedReview,
      }),
    )
    const run = (operation: 'detail' | 'process') =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return operation === 'detail'
            ? yield* client.detail('asset-1')
            : yield* client.processSourceHandoff('asset-1')
        }).pipe(Effect.provide(layer), Effect.provide(provideFailure)),
      )
    await assert.rejects(
      () => run('detail'),
      (error: unknown) =>
        routeCase.detail === 'not-found'
          ? error instanceof LibraryNotFound
          : error instanceof LibraryUnavailable,
    )
    await assert.rejects(
      () => run('process'),
      (error: unknown) =>
        routeCase.process === 'not-found'
          ? error instanceof LibraryNotFound
          : routeCase.process === 'not-local'
            ? error instanceof LibraryAssetUnavailable
            : error instanceof LibraryUnavailable,
    )
  }
})

test('decodes Library route failures and rejects malformed page responses', async () => {
  await assert.rejects(
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return yield* client.detail('missing')
        }).pipe(
          Effect.provide(layer),
          Effect.provide(
            Layer.succeed(
              LibraryTransport,
              LibraryTransport.of({
                loadPage: () => Effect.die('unused'),
                loadDetail: () =>
                  Effect.succeed(
                    LibraryRouteFailure.cases.AssetNotFound.make({}),
                  ),
                loadProcessSourceHandoff: () => Effect.die('unused'),
                reviewAsset: unusedReview,
              }),
            ),
          ),
        ),
      ),
    (error: unknown) => error instanceof LibraryNotFound,
  )

  await assert.rejects(
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const client = yield* LibraryClient
          return yield* client.page(query)
        }).pipe(
          Effect.provide(layer),
          Effect.provide(
            Layer.succeed(
              LibraryTransport,
              LibraryTransport.of({
                loadPage: () => Effect.succeed({ results: [] }),
                loadDetail: () => Effect.die('unused'),
                loadProcessSourceHandoff: () => Effect.die('unused'),
                reviewAsset: unusedReview,
              }),
            ),
          ),
        ),
      ),
    (error: unknown) => error instanceof LibraryUnavailable,
  )
})
