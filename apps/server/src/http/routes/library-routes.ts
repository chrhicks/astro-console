import { Effect, Layer, Option, Schema } from 'effect'
import {
  LibraryDetailResponse,
  LibraryPageResponse,
  LibraryQuery,
  LibraryRouteFailure,
  ProcessSourceHandoffResponse,
  ReviewAssetFailure,
  ReviewAssetRequest,
  ReviewAssetResponse,
} from '@astro-console/protocol'
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/unstable/http'
import {
  LibraryInputInvalid,
  LibraryService,
} from '../../services/library-service.ts'
import {
  LibraryReviewAuthorization,
  LibraryReviewOutcome,
  LibraryReviewService,
} from '../../services/library-review-service.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
} from './origin-route-shared.ts'
import {
  LibraryDownloadOutcome,
  libraryPreviewHeaders,
  LibraryPreviewOutcome,
  LibraryRepresentationService,
} from '../../services/library-representation-service.ts'
import { responseHeaders } from '../response.ts'
import type { LocalIdentity } from '../../auth/identity.ts'

const invalidInput = LibraryRouteFailure.cases.InvalidInput.make({
  message: 'The service could not read that action.',
})
const assetNotFound = LibraryRouteFailure.cases.AssetNotFound.make({})
const libraryUnavailable = LibraryRouteFailure.cases.LibraryUnavailable.make({})
const apiNotFound = {
  outcome: 'rejected',
  reason: 'InvalidInput',
  message: 'The service could not read that action.',
} as const

const decodedAssetId = (value: string | undefined) => {
  try {
    return value === undefined ? '' : decodeURIComponent(value)
  } catch {
    return ''
  }
}

const requestAssetId = (
  request: HttpServerRequest.HttpServerRequest,
  suffix = '',
) => {
  const path = new URL(request.url, 'http://local').pathname
  return new RegExp(
    `^/api/library/assets/([^/]+)${suffix.replace('/', '\\/')}$`,
  ).exec(path)?.[1]
}

export const makeLibraryRouteCompatibility = Effect.fn(
  'OriginHttp.makeLibraryRouteCompatibility',
)(function* () {
  const reviews = yield* LibraryReviewService
  return Effect.fn('OriginHttp.libraryRouteCompatibility')(function* (
    method: string,
    requestPath: string,
    identity: LocalIdentity,
  ) {
    const libraryGetPath =
      requestPath === '/api/library' ||
      /^\/api\/library\/assets\/[^/]+(?:\/(?:preview|download|process-source))?$/.test(
        requestPath,
      )
    if (method === 'HEAD' && libraryGetPath) return json(404, apiNotFound)
    if (!requestPath.startsWith('/api/library/assets/')) return undefined
    const review = method === 'POST' && requestPath.endsWith('/review')
    if (method !== 'GET' && !review) return undefined
    const suffix = [
      '/preview',
      '/download',
      '/process-source',
      ...(review ? ['/review'] : []),
    ].find((value) => requestPath.endsWith(value))
    const encoded = requestPath.slice(
      '/api/library/assets/'.length,
      suffix === undefined ? undefined : -suffix.length,
    )
    const decoded = decodedAssetId(encoded)
    if (/^[A-Za-z0-9-]+$/.test(decoded)) return undefined
    if (review) {
      const authorization = yield* reviews.authorize(identity)
      return LibraryReviewAuthorization.match(authorization, {
        ReadOnly: ({ response }) => json(403, response),
        Authorized: () =>
          json(
            400,
            ReviewAssetResponse.cases.Rejected.make({
              failure: ReviewAssetFailure.cases.InvalidInput.make({
                message: 'The service could not read that review action.',
              }),
            }),
          ),
      })
    }
    return suffix === '/preview' || suffix === '/download'
      ? json(400, { outcome: 'rejected', reason: 'InvalidInput' })
      : json(400, invalidInput)
  })
})

const decodeLibraryQuery = (request: HttpServerRequest.HttpServerRequest) => {
  const url = new URL(request.url, 'http://local')
  const allowed = new Set(['queryId', 'cursor', 'pageSize', 'role', 'sort'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
    return Effect.fail(new LibraryInputInvalid())
  const cursor = url.searchParams.get('cursor')
  const pageSize = url.searchParams.get('pageSize') ?? '40'
  if (cursor !== null && !/^\d+$/.test(cursor))
    return Effect.fail(new LibraryInputInvalid())
  if (!/^\d+$/.test(pageSize)) return Effect.fail(new LibraryInputInvalid())
  return Schema.decodeUnknownEffect(LibraryQuery)({
    queryId: url.searchParams.get('queryId') ?? 'library-m27',
    ...(cursor === null ? {} : { cursor }),
    pageSize: Number(pageSize),
    ...(url.searchParams.get('role') === null
      ? {}
      : { role: url.searchParams.get('role') }),
    sort: url.searchParams.get('sort') ?? 'capturedAtDescending',
  }).pipe(Effect.mapError(() => new LibraryInputInvalid()))
}

export const makeLibraryRoutes = Effect.fn('OriginHttp.makeLibraryRoutes')(
  function* () {
    const library = yield* LibraryService
    const reviews = yield* LibraryReviewService
    const representations = yield* LibraryRepresentationService

    const page = HttpRouter.add(
      'GET',
      '/api/library',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const result = yield* decodeLibraryQuery(request).pipe(
          Effect.flatMap(library.page),
          Effect.map((body) => ({ status: 200, body })),
          Effect.catchTags({
            'Server.LibraryInputInvalid': () =>
              Effect.succeed({ status: 400, body: invalidInput }),
            'Server.LibraryPersistenceUnavailable': () =>
              Effect.succeed({ status: 503, body: libraryUnavailable }),
          }),
        )
        return json(
          result.status,
          Schema.encodeSync(LibraryPageResponse)(result.body),
        )
      }),
    )

    const detail = HttpRouter.add(
      'GET',
      '/api/library/assets/:assetId',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const result = yield* library
          .detail(decodedAssetId(requestAssetId(request)))
          .pipe(
            Effect.map((body) => ({ status: 200, body })),
            Effect.catchTags({
              'Server.LibraryInputInvalid': () =>
                Effect.succeed({ status: 400, body: invalidInput }),
              'Server.LibraryAssetNotFound': () =>
                Effect.succeed({ status: 404, body: assetNotFound }),
              'Server.LibraryPersistenceUnavailable': () =>
                Effect.succeed({ status: 503, body: libraryUnavailable }),
            }),
          )
        return json(
          result.status,
          Schema.encodeSync(LibraryDetailResponse)(result.body),
        )
      }),
    )

    const processSource = HttpRouter.add(
      'GET',
      '/api/library/assets/:assetId/process-source',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const result = yield* library
          .processSource(
            decodedAssetId(requestAssetId(request, '/process-source')),
          )
          .pipe(
            Effect.map((body) => ({ status: 200, body })),
            Effect.catchTags({
              'Server.LibraryInputInvalid': () =>
                Effect.succeed({ status: 400, body: invalidInput }),
              'Server.LibraryAssetNotFound': () =>
                Effect.succeed({ status: 404, body: assetNotFound }),
              'Server.LibraryAssetUnavailable': () =>
                Effect.succeed({
                  status: 409,
                  body: LibraryRouteFailure.cases.AssetUnavailable.make({
                    message:
                      'This asset is temporarily unavailable and cannot open in Process.',
                  }),
                }),
              'Server.LibraryPersistenceUnavailable': () =>
                Effect.succeed({ status: 503, body: libraryUnavailable }),
            }),
          )
        return json(
          result.status,
          Schema.encodeSync(ProcessSourceHandoffResponse)(result.body),
        )
      }),
    )

    const review = HttpRouter.add(
      'POST',
      '/api/library/assets/:assetId/review',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const authorization = yield* reviews.authorize(identity)
        return yield* LibraryReviewAuthorization.match(authorization, {
          ReadOnly: ({ response }) => Effect.succeed(json(403, response)),
          Authorized: () =>
            Effect.gen(function* () {
              const raw = yield* requestJson(request)
              const input = yield* Schema.decodeUnknownEffect(
                ReviewAssetRequest,
              )(raw).pipe(Effect.option)
              if (Option.isNone(input))
                return json(
                  400,
                  ReviewAssetResponse.cases.Rejected.make({
                    failure: ReviewAssetFailure.cases.InvalidInput.make({
                      message: 'The service could not read that review action.',
                    }),
                  }),
                )
              const outcome = yield* reviews.review(
                decodedAssetId(requestAssetId(request, '/review')),
                input.value,
                identity,
              )
              return LibraryReviewOutcome.match(outcome, {
                ReadOnly: ({ response }) => json(403, response),
                Accepted: ({ response }) => json(200, response),
                NotFound: ({ response }) => json(404, response),
                Conflict: ({ response }) => json(409, response),
                Unavailable: ({ response }) => json(503, response),
              })
            }),
        })
      }),
    )

    const preview = HttpRouter.add(
      'GET',
      '/api/library/assets/:assetId/preview',
      Effect.gen(function* () {
        const identity = yield* OriginRequestIdentity
        const request = yield* HttpServerRequest.HttpServerRequest
        const outcome = yield* representations.preview(
          decodedAssetId(requestAssetId(request, '/preview')),
          identity,
        )
        return LibraryPreviewOutcome.$match(outcome, {
          Available: ({ bytes }) =>
            HttpServerResponse.uint8Array(bytes, {
              headers: {
                ...responseHeaders('image/png', 'private, no-store'),
                'content-length': String(bytes.byteLength),
                'x-astro-preview-max-bytes': String(
                  libraryPreviewHeaders.maxBytes,
                ),
                'x-astro-preview-refresh-ms': String(
                  libraryPreviewHeaders.refreshMs,
                ),
                'x-astro-preview-concurrent-limit': String(
                  libraryPreviewHeaders.concurrentLimit,
                ),
              },
            }),
          InvalidInput: () =>
            json(400, { outcome: 'rejected', reason: 'InvalidInput' }),
          RefreshLimited: () =>
            json(429, {
              outcome: 'rejected',
              reason: 'PreviewRefreshLimited',
            }),
          Busy: () => json(429, { outcome: 'rejected', reason: 'PreviewBusy' }),
          TooLarge: () =>
            json(413, { outcome: 'rejected', reason: 'PreviewTooLarge' }),
          Unavailable: () =>
            json(409, { outcome: 'rejected', reason: 'PreviewUnavailable' }),
        })
      }),
    )

    const download = HttpRouter.add(
      'GET',
      '/api/library/assets/:assetId/download',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const outcome = yield* representations.download(
          decodedAssetId(requestAssetId(request, '/download')),
        )
        return LibraryDownloadOutcome.$match(outcome, {
          Local: ({ assetId, format, bytes }) =>
            HttpServerResponse.uint8Array(bytes, {
              headers: {
                ...responseHeaders(
                  format === 'fits'
                    ? 'application/fits'
                    : 'application/octet-stream',
                  'private, no-store',
                ),
                'content-disposition': `attachment; filename="${assetId}.${format}"`,
                'content-length': String(bytes.byteLength),
              },
            }),
          Redirect: ({ location }) =>
            HttpServerResponse.empty({
              status: 303,
              headers: {
                ...responseHeaders(
                  'text/plain; charset=utf-8',
                  'private, no-store',
                ),
                location,
              },
            }),
          InvalidInput: () =>
            json(400, { outcome: 'rejected', reason: 'InvalidInput' }),
          AssetNotFound: () =>
            json(404, { outcome: 'rejected', reason: 'AssetNotFound' }),
          AssetUnavailable: () =>
            json(409, { outcome: 'rejected', reason: 'AssetUnavailable' }),
          Unavailable: () =>
            json(503, { outcome: 'rejected', reason: 'DownloadUnavailable' }),
        })
      }),
    )

    return Layer.mergeAll(
      page,
      detail,
      processSource,
      review,
      preview,
      download,
    )
  },
)
