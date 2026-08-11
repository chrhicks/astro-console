import { Effect, Layer } from 'effect'
import { RefreshPreflightResponse } from '@astro-console/protocol'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { OriginDatabase } from '../../persistence/database.ts'
import { RunSqliteRepository } from '../../persistence/run-sqlite-repository.ts'
import { StateSqliteRepository } from '../../persistence/state-sqlite-repository.ts'
import {
  ReadOnlyPreflightProvider,
  preflightPersistenceLayer,
  refreshPreflight,
  type ReadOnlyPreflightProviderShape,
} from '../../services/preflight-service.ts'
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
} from './origin-route-shared.ts'

export type ObserveRouteOptions = {
  readonly preflightProvider?: ReadOnlyPreflightProviderShape
}

export const makeObserveRoutes = Effect.fn('OriginHttp.makeObserveRoutes')(
  function* (options: ObserveRouteOptions = {}) {
    const { database } = yield* OriginDatabase
    const runRepository = yield* RunSqliteRepository
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication

    const commands = HttpRouter.add(
      'POST',
      '/api/observe/commands',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const result = yield* observeCommandFromRequest(
          Promise.resolve(raw),
          runRepository,
          repository,
          identity,
          (_type, cursor) => Effect.runSync(publication.publish(cursor)),
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
    )

    const preflight = HttpRouter.add(
      'POST',
      '/api/observe/preflight',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        if (identity.capability !== 'controlCapable')
          return json(
            403,
            RefreshPreflightResponse.cases.Rejected.make({
              summary: 'This client is read-only and cannot refresh preflight.',
            }),
          )
        const raw = yield* requestJson(request)
        const persistence = preflightPersistenceLayer({
          activeRun: () => repository.state().run,
          persist: (snapshot) =>
            Effect.try({
              try: () => repository.persistPreflight(snapshot),
              catch: (cause) => cause,
            }),
        })
        const result = yield* refreshPreflight(raw).pipe(
          Effect.provide(persistence),
          options.preflightProvider === undefined
            ? (effect) => effect
            : (effect) =>
                effect.pipe(
                  Effect.provideService(
                    ReadOnlyPreflightProvider,
                    options.preflightProvider,
                  ),
                ),
        )
        const response = 'response' in result ? result.response : result
        if ('response' in result) yield* publication.publish(result.cursor)
        return RefreshPreflightResponse.match(response, {
          Refreshed: (body) => json(200, body),
          Rejected: (body) => json(409, body),
          Unavailable: (body) => json(503, body),
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
