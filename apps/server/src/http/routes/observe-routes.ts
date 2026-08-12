import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { OriginDatabase } from '../../persistence/database.ts'
import { RunSqliteRepository } from '../../persistence/run-sqlite-repository.ts'
import { StateSqliteRepository } from '../../persistence/state-sqlite-repository.ts'
import {
  PreflightCommandOutcome,
  PreflightCommandService,
} from '../../services/preflight-command-service.ts'
import { ProjectionPublication } from '../../services/projection-publication.ts'
import {
  observeCommandFromRequest,
  observeInvalidResponse,
  observeServiceResponse,
} from '../command-handlers.ts'
import { readObserveLiveFrameReview } from '../library-handlers.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
  tracedHttpRoute,
} from './origin-route-shared.ts'

const apiNotFound = {
  outcome: 'rejected',
  reason: 'InvalidInput',
  message: 'The service could not read that action.',
} as const

export const observeRouteCompatibilityResponse = (
  method: string,
  requestPath: string,
) =>
  method === 'HEAD' && requestPath === '/api/observe/live-frame'
    ? json(404, apiNotFound)
    : undefined

export const makeObserveRoutes = Effect.fn('OriginHttp.makeObserveRoutes')(
  function* () {
    const { database } = yield* OriginDatabase
    const runRepository = yield* RunSqliteRepository
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication
    const preflightService = yield* PreflightCommandService

    const commands = HttpRouter.add(
      'POST',
      '/api/observe/commands',
      tracedHttpRoute(
        {
          method: 'POST',
          route: '/api/observe/commands',
          workspace: 'observe',
        },
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const identity = yield* OriginRequestIdentity
          const raw = yield* requestJson(request)
          const result = yield* observeCommandFromRequest(
            Promise.resolve(raw),
            runRepository,
            repository,
            identity,
            (_type, cursor) => publication.publish(cursor),
          ).pipe(
            Effect.catchTags({
              'Server.ObserveCommandInputInvalid': () =>
                observeInvalidResponse(repository, identity),
              'Server.ObserveServiceUnavailable': () =>
                observeServiceResponse(
                  'ObserveServiceUnavailable',
                  'The Observe command service is temporarily unavailable.',
                ),
            }),
          )
          return json(result.status, result.body)
        }),
      ),
    )

    const preflight = HttpRouter.add(
      'POST',
      '/api/observe/preflight',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const outcome = yield* preflightService.execute(raw, identity)
        return PreflightCommandOutcome.match(outcome, {
          ReadOnly: ({ response }) => json(403, response),
          Refreshed: ({ response }) => json(200, response),
          Rejected: ({ response }) => json(409, response),
          Unavailable: ({ response }) => json(503, response),
        })
      }),
    )

    const liveFrame = HttpRouter.add(
      'GET',
      '/api/observe/live-frame',
      Effect.gen(function* () {
        const identity = yield* OriginRequestIdentity
        const review = yield* readObserveLiveFrameReview(
          database,
          () => repository.state().snapshotVersion,
          repository
            .bootstrapSnapshot(identity)
            .pipe(
              Effect.map((snapshot) => snapshot.observe?.acquire?.liveFrame),
            ),
        )
        return json(200, review)
      }),
    )

    return Layer.mergeAll(commands, preflight, liveFrame)
  },
)
