import { Context, Effect, Exit, Layer, Scope } from 'effect'
import type { OriginServerConfig } from '../config/environment-config.ts'
import type { RequestAdmission } from '../auth/identity.ts'
import { makeProductionOriginGraph } from '../app/origin-application.ts'
import { listenOriginHttp } from '../http/effect-origin-http.ts'
import { OriginDatabase } from '../persistence/database.ts'
import { createLocalFixtureAdmission } from '../auth/access-admission.ts'
import type { AdmissionObservation } from '../auth/identity.ts'
import {
  OriginApplicationTelemetry,
  defaultOriginApplicationServicesLayer,
  type OriginApplicationServices,
} from '../app/origin-application-services.ts'

export const originTestConfig = (
  root: string,
  overrides: Partial<OriginServerConfig> = {},
): OriginServerConfig => ({
  runtime: {
    databasePath: `${root}/state.sqlite`,
    release: 'origin-test',
    port: 0,
    host: '127.0.0.1',
    webDistPath: '../web/dist',
    previewRoot: `${root}/previews`,
    originalsRoot: `${root}/originals`,
    ...overrides.runtime,
  },
  admission: { mode: 'development', client: 'owner' },
  fixture: 'm27',
  downloadGrant: undefined,
  preflightProvider: undefined,
  simulation: undefined,
  plateSolve: {
    executable: '/usr/bin/false',
    indexesRoot: `${root}/indexes`,
    timeoutMs: 1_000,
    solverVersion: 'test',
    scaleLowDeg: 20,
    scaleHighDeg: 30,
    searchRadiusDeg: 15,
  },
  ...overrides,
})

export const openOriginTestGraph = async (options: {
  readonly config: OriginServerConfig
  readonly services: Layer.Layer<OriginApplicationServices, unknown, never>
  readonly admission: RequestAdmission
  readonly admissionObservability?: AdmissionObservation
}) => {
  const scope = Effect.runSync(Scope.make('sequential'))
  try {
    const serviceContext = await Effect.runPromise(
      Scope.provide(Layer.build(options.services), scope),
    )
    const telemetry = Context.get(serviceContext, OriginApplicationTelemetry)
    const graph = await telemetry.runPromise(
      Scope.provide(
        makeProductionOriginGraph(options.config).pipe(
          Effect.provide(serviceContext),
        ),
        scope,
      ),
    )
    return {
      config: options.config,
      context: graph.context,
      listen: async (
        port = 0,
        host = options.config.runtime.host,
        admission = options.admission,
      ) => {
        const listenerScope = Effect.runSync(Scope.make('sequential'))
        Effect.runSync(
          Scope.addFinalizer(scope, Scope.close(listenerScope, Exit.void)),
        )
        let bound
        try {
          bound = await telemetry.runPromise(
            Scope.provide(
              listenOriginHttp(graph.application, [
                {
                  name: 'primary',
                  host,
                  port,
                  admission,
                  ...(options.admissionObservability === undefined
                    ? {}
                    : { observation: options.admissionObservability }),
                },
              ]),
              listenerScope,
            ),
          )
        } catch (cause) {
          await Effect.runPromise(Scope.close(scope, Exit.void))
          throw cause
        }
        if (bound.primary === undefined)
          throw new Error('Origin test listener was not bound')
        return {
          port: bound.primary.port,
          close: () => Effect.runPromise(Scope.close(listenerScope, Exit.void)),
        }
      },
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    }
  } catch (cause) {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    throw cause
  }
}

export const originTestDatabase = (
  graph: Awaited<ReturnType<typeof openOriginTestGraph>>,
) => Context.get(graph.context, OriginDatabase).database

export const originMemoryTestConfig = (
  overrides: OriginTestConfigOverrides = {},
) => {
  const root = '/tmp/astro-origin-test'
  return originTestConfig(root, {
    ...overrides,
    fixture: overrides.fixture,
    runtime: {
      ...originTestConfig(root).runtime,
      databasePath: ':memory:',
      ...overrides.runtime,
    },
  })
}

export const originTestConfigForDatabase = (
  databasePath = ':memory:',
  overrides: OriginTestConfigOverrides = {},
) => {
  const root =
    databasePath === ':memory:' ? '/tmp/astro-origin-test' : databasePath
  return originTestConfig(root, {
    ...overrides,
    fixture: overrides.fixture,
    runtime: {
      ...originTestConfig(root).runtime,
      databasePath,
      ...overrides.runtime,
    },
  })
}

export const originTestApplicationServices = <R, E>(
  config: OriginServerConfig,
  override?: Layer.Layer<R, E, never>,
) =>
  override === undefined
    ? defaultOriginApplicationServicesLayer(config)
    : Layer.effectContext(
        Effect.gen(function* () {
          const defaults = yield* Layer.build(
            defaultOriginApplicationServicesLayer(config),
          )
          const overrides = yield* Layer.build(override)
          return Context.merge(defaults, overrides)
        }),
      )

export const openOriginTestApplication = async (
  config: OriginServerConfig = originMemoryTestConfig(),
  services: Layer.Layer<
    OriginApplicationServices,
    unknown,
    never
  > = defaultOriginApplicationServicesLayer(config),
  admission: RequestAdmission = createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
  }),
  admissionObservability?: AdmissionObservation,
) =>
  openOriginTestGraph({
    config,
    services,
    admission,
    ...(admissionObservability === undefined ? {} : { admissionObservability }),
  })

export const openOriginTestApplicationForDatabase = async <R, E>(
  databasePath = ':memory:',
  configOverrides: OriginTestConfigOverrides = {},
  serviceOverrides?: Layer.Layer<R, E, never>,
  admission: RequestAdmission = createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
  }),
  admissionObservability?: AdmissionObservation,
) => {
  const config = originTestConfigForDatabase(databasePath, configOverrides)
  return openOriginTestApplication(
    config,
    originTestApplicationServices(config, serviceOverrides),
    admission,
    admissionObservability,
  )
}

type OriginTestConfigOverrides = Partial<
  Omit<OriginServerConfig, 'runtime'>
> & {
  readonly runtime?: Partial<OriginServerConfig['runtime']>
}
