import { Context, Effect, Layer, ManagedRuntime, Schema, Scope } from 'effect'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import { configuredDownloadGrantIssuer } from '../config/download-grant-config.ts'
import {
  originServerConfig,
  type OriginServerConfig,
  type PreflightProviderConfig,
} from '../config/environment-config.ts'
import { alpacaPreflightProvider } from '../providers/alpaca-preflight-provider.ts'
import { alpacaCameraProvider } from '../providers/alpaca-camera-provider.ts'
import type { ReadOnlyPreflightProviderShape } from '../services/preflight-service.ts'
import type { CameraProviderShape } from '../services/camera-command-service.ts'
import { RunExecutionContext } from '../services/run-domain.ts'
import {
  createOriginTelemetry,
  defaultOriginTelemetry,
  type OriginTelemetry,
} from '../observability/origin-telemetry.ts'
import { recordOperationalEvent } from '../observability/operational-telemetry.ts'
import { tracedStartup } from '../observability/startup-telemetry.ts'
import {
  recordAdmissionDecision,
  recordJwksRefresh,
} from '../observability/admission-telemetry.ts'
import { runExecutable } from './executable.ts'
import {
  createLocalOwnerAdmission,
  createRemoteDesktopAdmission,
  createRemoteReadOnlyAdmission,
} from './origin-admission.ts'
import { makeProductionOriginApplication } from './origin-application.ts'
import { listenOriginHttp } from '../http/effect-origin-http.ts'
import {
  absentCameraProviderSelectionLayer,
  absentPolarMeasurementProviderSelectionLayer,
  absentTargetAcquisitionProviderSelectionLayer,
  configuredCameraProviderSelectionLayer,
} from '../services/acquire-command-service.ts'
import {
  absentReadOnlyPreflightProviderSelectionLayer,
  configuredReadOnlyPreflightProviderSelectionLayer,
} from '../services/preflight-command-service.ts'
import {
  absentLibraryDownloadGrantLayer,
  configuredLibraryDownloadGrantLayer,
  configuredLibraryRepresentationStorageLayer,
} from '../services/library-representation-service.ts'
import {
  configuredOriginCapturedFrameStorageLayer,
  configuredOriginConfiguredTargetProviderLayer,
  configuredOriginFrameInspectionStorageLayer,
  configuredOriginPlateSolveWorkerLayer,
  configuredOriginRunExecutionLayer,
  absentOriginConfiguredTargetProviderLayer,
  absentOriginRunExecutionLayer,
  originProcessWorkBehaviorLayer,
  originTelemetryServicesLayer,
} from './origin-application-services.ts'

export type OriginRuntimeAdapters = {
  readonly preflightProvider: (
    config: PreflightProviderConfig,
  ) => ReadOnlyPreflightProviderShape
  readonly cameraProvider: (
    config: PreflightProviderConfig,
  ) => CameraProviderShape
  readonly downloadGrantIssuer: (
    config: OriginServerConfig['downloadGrant'],
  ) => DownloadGrantIssuer | undefined
}

export const productionOriginAdapters: OriginRuntimeAdapters = {
  preflightProvider: alpacaPreflightProvider,
  cameraProvider: alpacaCameraProvider,
  downloadGrantIssuer: configuredDownloadGrantIssuer,
}

export type BoundOriginRuntime = {
  readonly primary: { readonly port: number }
  readonly localOwner?: { readonly port: number }
  readonly remoteDesktop?: { readonly port: number }
}

export interface OriginRuntimeShape {
  readonly listen: () => Effect.Effect<BoundOriginRuntime, OriginRuntimeFailure>
}

export class OriginRuntime extends Context.Service<
  OriginRuntime,
  OriginRuntimeShape
>()('@astro-console/server/OriginRuntime') {}

export class OriginRuntimeFailure extends Schema.TaggedErrorClass<OriginRuntimeFailure>()(
  'Server.OriginRuntimeFailure',
  {
    operation: Schema.Literals(['create', 'listen']),
    message: Schema.String,
  },
) {}

const failure = (
  operation: 'create' | 'listen',
  cause: unknown,
): OriginRuntimeFailure =>
  new OriginRuntimeFailure({
    operation,
    message: cause instanceof Error ? cause.message : 'Origin runtime failed',
  })

export const originRuntimeLayer = (
  config: OriginServerConfig,
  adapters: OriginRuntimeAdapters,
  telemetry: OriginTelemetry = defaultOriginTelemetry,
) =>
  Layer.effect(
    OriginRuntime,
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await telemetry.runPromise(
            recordOperationalEvent({
              scope: 'startup',
              operation: 'shutdown',
              outcome: 'stopped',
            }),
          )
          await telemetry.dispose()
        }),
      )

      const preflightConfig = config.preflightProvider
      const preflightProvider =
        preflightConfig === undefined
          ? undefined
          : adapters.preflightProvider(preflightConfig)
      const cameraProvider =
        preflightConfig?.devices.camera === undefined
          ? undefined
          : adapters.cameraProvider(preflightConfig)
      const issuer = adapters.downloadGrantIssuer(config.downloadGrant)
      const runContext =
        cameraProvider === undefined ||
        preflightConfig?.devices.camera?.uniqueId === undefined
          ? undefined
          : RunExecutionContext.make({
              rigId: preflightConfig.rigId,
              cameraDeviceId: preflightConfig.devices.camera.uniqueId,
              ...(preflightConfig.devices.telescope?.uniqueId === undefined
                ? {}
                : {
                    mountDeviceId: preflightConfig.devices.telescope.uniqueId,
                    ...(preflightConfig.site === undefined
                      ? config.simulation === undefined
                        ? {}
                        : {
                            latitudeDegrees: 39.755,
                            longitudeDegrees: -74.2677777778,
                            elevationMeters: 0,
                          }
                      : preflightConfig.site),
                  }),
              completionBehavior: 'hold',
              unsafeBehavior: 'pauseAndPark',
            })
      const configuredTarget =
        config.simulation === undefined &&
        preflightConfig?.site !== undefined &&
        preflightConfig.devices.camera?.uniqueId !== undefined &&
        preflightConfig.devices.telescope?.uniqueId !== undefined
          ? preflightConfig
          : undefined
      const applicationServices = Layer.mergeAll(
        preflightProvider === undefined
          ? absentReadOnlyPreflightProviderSelectionLayer
          : configuredReadOnlyPreflightProviderSelectionLayer(
              preflightProvider,
            ),
        cameraProvider === undefined
          ? absentCameraProviderSelectionLayer
          : configuredCameraProviderSelectionLayer(cameraProvider),
        absentPolarMeasurementProviderSelectionLayer,
        absentTargetAcquisitionProviderSelectionLayer,
        configuredOriginCapturedFrameStorageLayer({
          originalsRoot: config.runtime.originalsRoot,
        }),
        configuredOriginFrameInspectionStorageLayer({
          originalsRoot: config.runtime.originalsRoot,
          previewsRoot: config.runtime.previewRoot,
        }),
        configuredOriginPlateSolveWorkerLayer({
          originalsRoot: config.runtime.originalsRoot,
          executable: config.plateSolve.executable,
          indexesRoot: config.plateSolve.indexesRoot,
          timeoutMs: config.plateSolve.timeoutMs,
          solverVersion: config.plateSolve.solverVersion,
          scaleLowDeg: config.plateSolve.scaleLowDeg,
          scaleHighDeg: config.plateSolve.scaleHighDeg,
          searchRadiusDeg: config.plateSolve.searchRadiusDeg,
        }),
        configuredTarget === undefined
          ? absentOriginConfiguredTargetProviderLayer
          : configuredOriginConfiguredTargetProviderLayer(configuredTarget),
        runContext === undefined || preflightConfig === undefined
          ? absentOriginRunExecutionLayer
          : configuredOriginRunExecutionLayer(
              runContext,
              new URL(`http://${preflightConfig.host}:${preflightConfig.port}`)
                .origin,
            ),
        configuredLibraryRepresentationStorageLayer({
          originalsRoot: config.runtime.originalsRoot,
          previewsRoot: config.runtime.previewRoot,
        }),
        issuer === undefined
          ? absentLibraryDownloadGrantLayer
          : configuredLibraryDownloadGrantLayer(issuer),
        originProcessWorkBehaviorLayer({ autoRun: true }),
        originTelemetryServicesLayer(telemetry),
      )
      const application = yield* tracedStartup(
        'service.create',
        makeProductionOriginApplication(config).pipe(
          Effect.provide(applicationServices),
        ),
      ).pipe(Effect.mapError((cause) => failure('create', cause)))
      const scope = yield* Effect.scope
      let listening: Promise<BoundOriginRuntime> | undefined

      const listen = Effect.fn('OriginRuntime.listen')(function* () {
        const listenPromise =
          listening ??
          (listening = telemetry.runPromise(
            tracedStartup(
              'listener.bind',
              Effect.gen(function* () {
                const observation = {
                  admission: (
                    reason: Parameters<typeof recordAdmissionDecision>[0],
                  ) => telemetry.runSync(recordAdmissionDecision(reason)),
                  jwks: (outcome: Parameters<typeof recordJwksRefresh>[0]) =>
                    telemetry.runSync(recordJwksRefresh(outcome)),
                }
                const bindings = [
                  {
                    name: 'primary',
                    host: config.runtime.host,
                    port: config.runtime.port,
                    admission: createRemoteReadOnlyAdmission(config),
                    observation,
                  },
                  ...(config.admission.mode === 'development'
                    ? []
                    : [
                        {
                          name: 'localOwner',
                          host: config.runtime.host,
                          port: config.runtime.localOwnerPort ?? 0,
                          admission: createLocalOwnerAdmission(),
                          observation,
                        },
                        ...(config.runtime.remoteDesktopPort === undefined
                          ? []
                          : [
                              {
                                name: 'remoteDesktop',
                                host: config.runtime.host,
                                port: config.runtime.remoteDesktopPort,
                                admission: createRemoteDesktopAdmission(config),
                                observation,
                              },
                            ]),
                      ]),
                ] as const
                const bound = yield* Scope.provide(
                  listenOriginHttp(application, bindings),
                  scope,
                )
                if (bound.primary === undefined)
                  return yield* Effect.die(
                    new Error('Origin primary listener was not bound'),
                  )
                return {
                  primary: bound.primary,
                  ...(bound.localOwner === undefined
                    ? {}
                    : { localOwner: bound.localOwner }),
                  ...(bound.remoteDesktop === undefined
                    ? {}
                    : { remoteDesktop: bound.remoteDesktop }),
                }
              }),
            ),
          ))
        return yield* Effect.tryPromise({
          try: () => listenPromise,
          catch: (cause) => failure('listen', cause),
        })
      })

      return OriginRuntime.of({ listen })
    }),
  )

export const startOrigin = () =>
  runExecutable('origin server', async () => {
    const telemetry = createOriginTelemetry()
    let runtime:
      | ManagedRuntime.ManagedRuntime<OriginRuntime, OriginRuntimeFailure>
      | undefined
    try {
      await telemetry.initialize()
      const config = await telemetry.runPromise(
        tracedStartup('config.decode', originServerConfig),
      )
      runtime = ManagedRuntime.make(
        originRuntimeLayer(config, productionOriginAdapters, telemetry),
      )
      const bound = await runtime.runPromise(
        Effect.flatMap(OriginRuntime, (origin) => origin.listen()),
      )
      if (config.admission.mode === 'development')
        console.log(
          `Astro Console ${config.runtime.release}: http://127.0.0.1:${bound.primary.port}`,
        )
      else
        console.log(
          `Astro Console ${config.runtime.release}: remote phone http://${config.runtime.host}:${bound.primary.port};${bound.remoteDesktop === undefined ? '' : ` remote desktop http://${config.runtime.host}:${bound.remoteDesktop.port};`} local owner http://${config.runtime.host}:${bound.localOwner?.port}`,
        )
      installOriginShutdown(runtime)
    } catch (cause) {
      if (runtime === undefined) await telemetry.dispose()
      else await runtime.dispose()
      throw cause
    }
  })

function installOriginShutdown(
  runtime: ManagedRuntime.ManagedRuntime<OriginRuntime, OriginRuntimeFailure>,
) {
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await runtime.dispose()
  }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
}
