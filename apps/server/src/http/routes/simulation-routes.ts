import { Effect, Schema } from 'effect'
import {
  DevelopmentSimulationControlFailure,
  DevelopmentSimulationProjection,
  DevelopmentSimulationUnavailable,
} from '@astro-console/protocol'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import type { LocalIdentity } from '../../auth/identity.ts'
import {
  controlDevelopmentSimulation,
  DevelopmentSimulationControlRejected,
  readDevelopmentSimulation,
  type DevelopmentSimulationConfig,
} from '../development-simulation.ts'
import {
  json,
  OriginRequestIdentity,
  requestJson,
} from './origin-route-shared.ts'

const readSimulation = Effect.fn('OriginHttp.readSimulation')(function* (
  config: DevelopmentSimulationConfig,
) {
  return yield* Effect.tryPromise({
    try: () => readDevelopmentSimulation(config),
    catch: (cause) => cause,
  })
})

const controlSimulation = Effect.fn('OriginHttp.controlSimulation')(function* (
  config: DevelopmentSimulationConfig,
  identity: LocalIdentity,
  raw: unknown,
) {
  return yield* Effect.tryPromise({
    try: () => controlDevelopmentSimulation(config, identity, raw),
    catch: (cause) => cause,
  })
})

export const makeSimulationRoutes = (config?: DevelopmentSimulationConfig) =>
  config === undefined
    ? []
    : [
        HttpRouter.add(
          'GET',
          '/api/simulation',
          readSimulation(config).pipe(
            Effect.match({
              onFailure: () =>
                json(
                  503,
                  DevelopmentSimulationUnavailable.make({
                    mode: 'alpaca',
                    notice: 'SIMULATION · NOT LIVE HARDWARE',
                    state: 'unavailable',
                    launchScenario: config.launchScenario,
                    message: 'The development simulator is unavailable.',
                  }),
                ),
              onSuccess: (projection) =>
                json(
                  200,
                  Schema.encodeSync(DevelopmentSimulationProjection)(
                    projection,
                  ),
                ),
            }),
          ),
        ),
        HttpRouter.add(
          'POST',
          '/api/simulation',
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            const identity = yield* OriginRequestIdentity
            const raw = yield* requestJson(request)
            const result = yield* controlSimulation(config, identity, raw).pipe(
              Effect.match({
                onFailure: (cause) => {
                  const rejected =
                    cause instanceof DevelopmentSimulationControlRejected
                      ? cause
                      : undefined
                  return {
                    status: rejected?.status ?? 503,
                    body: DevelopmentSimulationControlFailure.make({
                      outcome: 'rejected',
                      reason:
                        rejected?.status === 403
                          ? 'ControlRequired'
                          : rejected?.status === 400
                            ? 'InvalidInput'
                            : 'SimulatorUnavailable',
                      message:
                        rejected?.message ??
                        'The development simulator is unavailable.',
                    }),
                  }
                },
                onSuccess: (projection) => ({
                  status: 200,
                  body: Schema.encodeSync(DevelopmentSimulationProjection)(
                    projection,
                  ),
                }),
              }),
            )
            return json(result.status, result.body)
          }),
        ),
      ]
