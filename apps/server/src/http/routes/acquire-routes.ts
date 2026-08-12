import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import {
  AcquireCommandService,
  AcquireCommandOutcome,
} from '../../services/acquire-command-service.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
} from './origin-route-shared.ts'

export const makeAcquireRoutes = Effect.fn('OriginHttp.makeAcquireRoutes')(
  function* () {
    const service = yield* AcquireCommandService
    return HttpRouter.add(
      'POST',
      '/api/acquire/commands',
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const identity = yield* OriginRequestIdentity
        const raw = yield* requestJson(request)
        const outcome = yield* service.execute(raw, identity)
        return AcquireCommandOutcome.match(outcome, {
          ReadOnly: ({ response }) => json(403, response),
          AcquireAccepted: ({ response }) => json(200, response),
          AcquireRejected: ({ response }) => json(409, response),
          AcquireUnavailable: ({ response }) => json(503, response),
          CameraAccepted: ({ response }) => json(202, response),
          CameraRejected: ({ response }) => json(409, response),
          CameraUnavailable: ({ response }) => json(503, response),
        })
      }),
    )
  },
)
