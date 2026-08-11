import { Context, Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import {
  AcquireCommandService,
  acquireCommandServiceLayer,
  type AcquireCommandServiceOptions,
} from '../../services/acquire-command-service.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
} from './origin-route-shared.ts'

export type AcquireRouteOptions = AcquireCommandServiceOptions

export const makeAcquireRoutes = Effect.fn('OriginHttp.makeAcquireRoutes')(
  function* (options: AcquireRouteOptions = {}) {
    const service = Context.get(
      yield* Layer.build(acquireCommandServiceLayer(options)),
      AcquireCommandService,
    )
    return HttpRouter.add(
      'POST',
      '/api/acquire/commands',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const result = yield* service.execute(raw, identity)
        return json(result.status, result.body)
      }),
    )
  },
)
