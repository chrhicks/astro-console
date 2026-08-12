import { Context, Effect, Exit, Scope } from 'effect'
import type { OriginServerConfig } from '../config/environment-config.ts'
import type { RequestAdmission } from '../auth/identity.ts'
import {
  makeProductionOriginGraph,
  type OriginApplicationDependencies,
} from '../app/origin-application.ts'
import { listenOriginHttp } from '../http/effect-origin-http.ts'
import { OriginDatabase } from '../persistence/database.ts'
import { createLocalFixtureAdmission } from '../auth/access-admission.ts'
import type { ReadOnlyPreflightProviderShape } from '../services/preflight-service.ts'
import type { CameraProviderShape } from '../services/camera-command-service.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import type { DevelopmentSimulationConfig } from '../http/development-simulation.ts'
import type { PolarMeasurementProviderShape } from '../services/polar-service.ts'
import type { TargetAcquisitionProviderShape } from '../services/target-acquisition-service.ts'
import type { CapturedFrameStorage } from '../services/captured-frame-intake.ts'
import type { FrameInspectionStorage } from '../services/frame-inspection.ts'
import type { PlateSolveWorkerConfig } from '../workers/plate-solve-worker.ts'
import type { OriginTelemetry } from '../observability/origin-telemetry.ts'
import type { AdmissionObservation } from '../auth/identity.ts'
import type { RunExecutionContext } from '../services/run-domain.ts'
import type { PreflightProviderConfig } from '../config/environment-config.ts'
import { recordOperationalEvent } from '../observability/operational-telemetry.ts'

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
  readonly dependencies?: OriginApplicationDependencies
  readonly admission: RequestAdmission
  readonly telemetry?: OriginTelemetry
  readonly admissionObservability?: AdmissionObservation
}) => {
  const runPromise = options.telemetry?.runPromise ?? Effect.runPromise
  const scope = Effect.runSync(Scope.make('sequential'))
  try {
    const graph = await runPromise(
      Scope.provide(
        makeProductionOriginGraph(options.config, options.dependencies ?? {}),
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
          bound = await runPromise(
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

type OriginTestApplicationOptions = {
  readonly fixture?: OriginServerConfig['fixture']
  readonly webDistPath?: string
  readonly previewRoot?: string
  readonly preflightProvider?: ReadOnlyPreflightProviderShape
  readonly cameraProvider?: CameraProviderShape
  readonly simulation?: DevelopmentSimulationConfig
  readonly capturedFrameStorage?: CapturedFrameStorage
  readonly frameInspectionStorage?: FrameInspectionStorage
  readonly plateSolveWorker?: PlateSolveWorkerConfig
  readonly polarMeasurementProvider?: PolarMeasurementProviderShape
  readonly targetAcquisitionProvider?: TargetAcquisitionProviderShape
  readonly configuredTargetProvider?: PreflightProviderConfig
  readonly runExecutionContext?: typeof RunExecutionContext.Type
  readonly runExecutorProviderOrigin?: string
  readonly telemetry?: OriginTelemetry
  readonly admissionObservability?: AdmissionObservation
  readonly processWorkRoot?: string
  readonly processFailBuildStage?: 'align'
  readonly processWorkAutoRun?: boolean
  readonly observeProjectionPublication?: (
    event: 'connect' | 'disconnect' | 'publish' | 'writeFailure',
  ) => void
}

/** Raw compatibility boot while the old integration evidence moves to services. */
export const openOriginTestApplication = async (
  databasePath = ':memory:',
  admission: RequestAdmission = createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
  }),
  _unused?: unknown,
  downloadGrant?: {
    readonly issuer: DownloadGrantIssuer
    readonly now?: () => Date
  },
  options: OriginTestApplicationOptions = {},
) => {
  const root =
    databasePath === ':memory:' ? '/tmp/astro-origin-test' : databasePath
  const previewRoot =
    options.frameInspectionStorage?.previewsRoot ?? options.previewRoot
  const originalsRoot =
    options.frameInspectionStorage?.originalsRoot ??
    options.capturedFrameStorage?.originalsRoot
  const config = originTestConfig(root, {
    runtime: {
      ...originTestConfig(root).runtime,
      databasePath,
      ...(options.webDistPath === undefined
        ? {}
        : { webDistPath: options.webDistPath }),
      ...(previewRoot === undefined ? {} : { previewRoot }),
      ...(originalsRoot === undefined ? {} : { originalsRoot }),
    },
    fixture: options.fixture,
    simulation: options.simulation,
  })
  const graph = await openOriginTestGraph({
    config,
    admission,
    dependencies: {
      ...(options.preflightProvider === undefined
        ? {}
        : { preflightProvider: options.preflightProvider }),
      ...(options.cameraProvider === undefined
        ? {}
        : { cameraProvider: options.cameraProvider }),
      ...(downloadGrant === undefined
        ? {}
        : {
            downloadGrantIssuer: downloadGrant.issuer,
            ...(downloadGrant.now === undefined
              ? {}
              : { downloadGrantNow: downloadGrant.now }),
          }),
      ...(options.polarMeasurementProvider === undefined
        ? {}
        : { polarMeasurementProvider: options.polarMeasurementProvider }),
      ...(options.targetAcquisitionProvider === undefined
        ? {}
        : { targetAcquisitionProvider: options.targetAcquisitionProvider }),
      ...(options.configuredTargetProvider === undefined
        ? {}
        : { configuredTargetProvider: options.configuredTargetProvider }),
      ...(options.capturedFrameStorage === undefined
        ? {}
        : { capturedFrameStorage: options.capturedFrameStorage }),
      ...(options.frameInspectionStorage === undefined
        ? {}
        : { frameInspectionStorage: options.frameInspectionStorage }),
      ...(options.plateSolveWorker === undefined
        ? {}
        : { plateSolveWorker: options.plateSolveWorker }),
      ...(options.runExecutionContext === undefined
        ? {}
        : { runExecutionContext: options.runExecutionContext }),
      ...(options.runExecutorProviderOrigin === undefined
        ? {}
        : {
            runExecutorProviderOrigin: options.runExecutorProviderOrigin,
          }),
      ...(options.observeProjectionPublication === undefined &&
      options.telemetry === undefined
        ? {}
        : {
            observeProjectionPublication: (event) => {
              options.observeProjectionPublication?.(event)
              options.telemetry?.runSync(
                recordOperationalEvent({
                  scope: 'projection',
                  operation: `sse.${event}`,
                  outcome: event === 'writeFailure' ? 'unavailable' : 'success',
                }),
              )
            },
          }),
      ...(options.processWorkRoot === undefined
        ? {}
        : { processWorkRoot: options.processWorkRoot }),
      ...(options.processWorkAutoRun === undefined
        ? {}
        : { processWorkAutoRun: options.processWorkAutoRun }),
      ...(options.processFailBuildStage === undefined
        ? {}
        : { processFailBuildStage: options.processFailBuildStage }),
    },
    ...(options.telemetry === undefined
      ? {}
      : { telemetry: options.telemetry }),
    ...(options.admissionObservability === undefined
      ? {}
      : { admissionObservability: options.admissionObservability }),
  })
  return graph
}
