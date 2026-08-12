import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { OriginDatabase } from '../../persistence/database.ts'
import { RunSqliteRepository } from '../../persistence/run-sqlite-repository.ts'
import { StateSqliteRepository } from '../../persistence/state-sqlite-repository.ts'
import { ProjectionPublication } from '../../services/projection-publication.ts'
import { planWorkspaceProjection } from '../../services/runtime-bootstrap.ts'
import { tracedPlanWorkspaceRead } from '../../observability/plan-telemetry.ts'
import {
  planCommandFromRequest,
  planInvalidResponse,
  planServiceResponse,
} from '../command-handlers.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
  tracedHttpRoute,
} from './origin-route-shared.ts'

export const makePlanRoutes = Effect.fn('OriginHttp.makePlanRoutes')(
  function* () {
    const { database } = yield* OriginDatabase
    const runRepository = yield* RunSqliteRepository
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication

    const workspace = HttpRouter.add(
      'GET',
      '/api/workspaces/plan',
      tracedHttpRoute(
        {
          method: 'GET',
          route: '/api/workspaces/plan',
          workspace: 'plan',
        },
        Effect.sync(() => json(200, planWorkspaceProjection(database))),
        (_response, effect) => tracedPlanWorkspaceRead(effect),
      ),
    )
    const commands = HttpRouter.add(
      'POST',
      '/api/plan/commands',
      tracedHttpRoute(
        {
          method: 'POST',
          route: '/api/plan/commands',
          workspace: 'plan',
        },
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const identity = yield* OriginRequestIdentity
          const raw = yield* requestJson(request)
          const result = yield* planCommandFromRequest(
            Promise.resolve(raw),
            runRepository,
            repository,
            identity,
            (_type, cursor) => publication.publish(cursor),
          ).pipe(
            Effect.catchTags({
              'Server.PlanCommandInputInvalid': () =>
                planInvalidResponse(repository, identity),
              'Server.PlanServiceUnavailable': () =>
                planServiceResponse(
                  'PlanServiceUnavailable',
                  'The Plan service is temporarily unavailable.',
                ),
            }),
          )
          return json(result.status, result.body)
        }),
      ),
    )

    return Layer.merge(workspace, commands)
  },
)
