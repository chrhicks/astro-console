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
import {
  recordAdmissionDecision,
  recordJwksRefresh,
} from '../observability/admission-telemetry.ts'
import { recordOperationalEvent } from '../observability/operational-telemetry.ts'
import { tracedStartup } from '../observability/startup-telemetry.ts'
import { runExecutable } from './executable.ts'
import {
  createLocalOwnerAdmission,
  createLocalWebService,
  createRemoteDesktopAdmission,
  createRemoteReadOnlyAdmission,
} from './origin-service.ts'

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

      const admissionObservability = {
        admission: (reason: Parameters<typeof recordAdmissionDecision>[0]) =>
          telemetry.runSync(recordAdmissionDecision(reason)),
        jwks: (outcome: Parameters<typeof recordJwksRefresh>[0]) =>
          telemetry.runSync(recordJwksRefresh(outcome)),
      }
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
      const origin = yield* Effect.try({
        try: () =>
          telemetry.runSync(
            tracedStartup(
              'service.create',
              Effect.sync(() =>
                createLocalWebService(
                  config.runtime.databasePath,
                  createRemoteReadOnlyAdmission(config),
                  undefined,
                  issuer === undefined ? undefined : { issuer },
                  {
                    ...(config.fixture === undefined
                      ? {}
                      : { fixture: config.fixture }),
                    ...(preflightProvider === undefined
                      ? {}
                      : { preflightProvider }),
                    ...(cameraProvider === undefined
                      ? {}
                      : {
                          cameraProvider,
                          runExecutorProviderOrigin: new URL(
                            `http://${preflightConfig?.host}:${preflightConfig?.port}`,
                          ).origin,
                          ...(preflightConfig?.devices.camera?.uniqueId ===
                          undefined
                            ? {}
                            : {
                                runExecutionContext: RunExecutionContext.make({
                                  rigId: preflightConfig.rigId,
                                  cameraDeviceId:
                                    preflightConfig.devices.camera.uniqueId,
                                  ...(preflightConfig.devices.telescope
                                    ?.uniqueId === undefined
                                    ? {}
                                    : {
                                        mountDeviceId:
                                          preflightConfig.devices.telescope
                                            .uniqueId,
                                        ...(preflightConfig.site === undefined
                                          ? config.simulation === undefined
                                            ? {}
                                            : {
                                                latitudeDegrees: 39.755,
                                                longitudeDegrees:
                                                  -74.2677777778,
                                                elevationMeters: 0,
                                              }
                                          : preflightConfig.site),
                                      }),
                                  completionBehavior: 'hold',
                                  unsafeBehavior: 'pauseAndPark',
                                }),
                              }),
                        }),
                    webDistPath: config.runtime.webDistPath,
                    previewRoot: config.runtime.previewRoot,
                    capturedFrameStorage: {
                      originalsRoot: config.runtime.originalsRoot,
                    },
                    frameInspectionStorage: {
                      originalsRoot: config.runtime.originalsRoot,
                      previewsRoot: config.runtime.previewRoot,
                    },
                    plateSolveWorker: {
                      originalsRoot: config.runtime.originalsRoot,
                      executable: config.plateSolve.executable,
                      indexesRoot: config.plateSolve.indexesRoot,
                      timeoutMs: config.plateSolve.timeoutMs,
                      solverVersion: config.plateSolve.solverVersion,
                      scaleLowDeg: config.plateSolve.scaleLowDeg,
                      scaleHighDeg: config.plateSolve.scaleHighDeg,
                      searchRadiusDeg: config.plateSolve.searchRadiusDeg,
                    },
                    ...(config.simulation === undefined &&
                    preflightConfig?.site !== undefined &&
                    preflightConfig.devices.camera?.uniqueId !== undefined &&
                    preflightConfig.devices.telescope?.uniqueId !== undefined
                      ? { configuredTargetProvider: preflightConfig }
                      : {}),
                    ...(config.simulation === undefined
                      ? {}
                      : { simulation: config.simulation }),
                    telemetry,
                    admissionObservability,
                  },
                ),
              ),
            ),
          ),
        catch: (cause) => failure('create', cause),
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => origin.close()))
      const scope = yield* Effect.scope
      let listening: Promise<BoundOriginRuntime> | undefined

      const bind = async (
        port: number,
        admission?: Parameters<typeof origin.listen>[2],
      ) => {
        const listener = await telemetry.runPromise(
          tracedStartup(
            'listener.bind',
            Effect.promise(() =>
              origin.listen(port, config.runtime.host, admission),
            ),
          ),
        )
        Effect.runSync(
          Scope.addFinalizer(
            scope,
            Effect.promise(() => listener.close()),
          ),
        )
        return listener
      }

      const listen = Effect.fn('OriginRuntime.listen')(function* () {
        const listenPromise =
          listening ??
          (listening = (async () => {
            const primary = await bind(config.runtime.port)
            if (config.admission.mode === 'development') return { primary }
            const localOwnerPort = config.runtime.localOwnerPort
            if (localOwnerPort === undefined)
              throw new Error(
                'Production origin requires ASTRO_LOCAL_OWNER_PORT',
              )
            const localOwner = await bind(
              localOwnerPort,
              createLocalOwnerAdmission(),
            )
            const remoteDesktop =
              config.runtime.remoteDesktopPort === undefined
                ? undefined
                : await bind(
                    config.runtime.remoteDesktopPort,
                    createRemoteDesktopAdmission(config),
                  )
            return {
              primary,
              localOwner,
              ...(remoteDesktop === undefined ? {} : { remoteDesktop }),
            }
          })())
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
