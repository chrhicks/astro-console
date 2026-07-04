import { app } from 'electron'
import { Effect, Ref } from 'effect'
import {
  resolveSeestarPemPath,
  SeestarDevice,
  discoverSeestars,
  createConsoleLogger,
} from '../../../../../../sdk/dist/index.js'
import type {
  DeviceState,
  ViewStateResult,
} from '../../../../../../sdk/dist/index.js'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
} from '../../../shared/api-v2'
import type {
  DevicePlugin,
  DeviceSessionRefresh,
  LiveDeviceSession,
} from './device-plugin'
import { EventBus } from '../event/event-bus.js'

const SEESTAR_CAPABILITIES = {
  supportsStacking: true,
  supportsLivePreview: true,
  supportsFilterWheel: true,
  supportsAutofocus: true,
  supportsStorageAccess: true,
} as const

const DEFAULT_GOTO_WAIT = {
  waitForCompletion: true,
  timeoutMs: 120000,
  pollIntervalMs: 500,
} as const

function toSeestarDeviceId(device: { host: string; serialNumber?: string }) {
  return device.serialNumber
    ? `seestar:sn:${device.serialNumber}`
    : `seestar:host:${device.host}`
}

export function createSeestarPlugin(): DevicePlugin {
  const discoveredRef = Ref.unsafeMake<Map<string, DesktopDiscoveredDeviceV2>>(
    new Map(),
  )
  const discover = Effect.gen(function* () {
    const discovered: Awaited<ReturnType<typeof discoverSeestars>> =
      yield* Effect.tryPromise(() => discoverSeestars({ timeoutMs: 2500 }))

    const mapped: DesktopDiscoveredDeviceV2[] = discovered.map((device) => {
      const productModel =
        typeof device.result.product_model === 'string'
          ? device.result.product_model
          : 'Seestar'
      const serialNumber =
        typeof device.result.sn === 'string' ? device.result.sn : undefined

      return {
        pluginKind: 'seestar',
        deviceId: toSeestarDeviceId({
          host: device.host,
          serialNumber,
        }),
        displayName: productModel,
        host: device.host,
        productModel,
        serialNumber,
      }
    })

    yield* Ref.set(
      discoveredRef,
      new Map(mapped.map((device) => [device.deviceId, device])),
    )

    return mapped
  })

  return {
    kind: 'seestar',
    discover,

    connect: (input: ConnectRequestV2) =>
      Effect.gen(function* () {
        const bus = yield* EventBus

        const discovered = yield* Ref.get(discoveredRef)
        const target = discovered.get(input.deviceId)

        if (!target) {
          return yield* Effect.fail(
            new Error(
              `Seestar device not found for deviceId ${input.deviceId}`,
            ),
          )
        }

        const host = target.host
        if (!host) {
          return yield* Effect.fail(
            new Error(
              `Discovered Seestar target ${target.deviceId} has no host`,
            ),
          )
        }

        const device = new SeestarDevice({
          host,
          pemPath: resolveSeestarPemPath({
            fallbackCandidates: [
              app.isPackaged
                ? `${process.resourcesPath}/seestar_3.1.2_fw_7.32_interop.pem`
                : `${app.getAppPath()}/seestar_3.1.2_fw_7.32_interop.pem`,
            ],
          }),
          discoveryTimeoutMs: 2500,
          logger: createConsoleLogger('debug'),
        })

        yield* bus.publish('session.connect.step.started', {
          step: 'device.connect',
          host,
          deviceId: input.deviceId,
        })

        yield* Effect.tryPromise({
          try: () => device.connect(),
          catch: (error) =>
            new Error(
              `device.connect failed for ${host}: ${toErrorMessage(error)}`,
            ),
        }).pipe(
          Effect.catchAll((error) =>
            bus
              .publish('session.connect.step.failed', {
                step: 'device.connect',
                host,
                deviceId: input.deviceId,
                error: toErrorMessage(error),
              })
              .pipe(Effect.zipRight(Effect.fail(error))),
          ),
        )

        yield* bus.publish('session.connect.step.succeeded', {
          step: 'device.connect',
          host,
          deviceId: target.deviceId,
        })

        return yield* Effect.gen(function* () {
          yield* bus.publish('session.authenticate.step.started', {
            step: 'device.authenticate',
            host,
            deviceId: input.deviceId,
          })

          const authenticated = yield* Effect.tryPromise({
            try: () => device.authenticate(),
            catch: (error) =>
              new Error(
                `device.authenticate failed for ${host}: ${toErrorMessage(error)}`,
              ),
          }).pipe(
            Effect.catchAll((error) =>
              bus
                .publish('session.authenticate.step.failed', {
                  step: 'device.authenticate',
                  host,
                  deviceId: input.deviceId,
                  error: toErrorMessage(error),
                })
                .pipe(Effect.zipRight(Effect.fail(error))),
            ),
          )

          yield* bus.publish('session.authenticate.step.succeeded', {
            step: 'device.authenticate',
            host,
            deviceId: target.deviceId,
          })

          if (!authenticated) {
            return yield* Effect.fail(
              new Error(
                'Authentication failed. Verify the PEM key and device firmware.',
              ),
            )
          }

          yield* bus.publish('session.preflightCheck.step.started', {
            step: 'device.preflightCheck',
            host,
            deviceId: input.deviceId,
          })

          const summary = yield* Effect.tryPromise({
            try: () => device.preflightCheck(),
            catch: (error) =>
              new Error(
                `device.preflightCheck failed for ${host}: ${toErrorMessage(error)}`,
              ),
          }).pipe(
            Effect.catchAll((error) =>
              bus
                .publish('session.preflightCheck.step.failed', {
                  step: 'device.preflightCheck',
                  host,
                  deviceId: input.deviceId,
                  error: toErrorMessage(error),
                })
                .pipe(Effect.zipRight(Effect.fail(error))),
            ),
          )

          yield* bus.publish('session.preflightCheck.step.succeeded', {
            step: 'device.preflightCheck',
            host,
            deviceId: target.deviceId,
          })

          return {
            sessionId: crypto.randomUUID(),
            pluginKind: 'seestar',
            deviceId: target.deviceId,
            host,
            productModel: target.productModel,
            openedAt: new Date().toISOString(),
            capabilities: SEESTAR_CAPABILITIES,
            disconnect: Effect.sync(() => {
              device.disconnect()
            }),
            pointToCoordinates: ({ raHours, decDeg }) =>
              Effect.tryPromise({
                try: async () => {
                  const ok = await device.goto(raHours, decDeg, DEFAULT_GOTO_WAIT)
                  if (!ok) {
                    throw new Error(
                      `Device rejected goto request for ${raHours}, ${decDeg}`,
                    )
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.goto failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              }),
            startPreview: () =>
              Effect.tryPromise({
                try: async () => {
                  const ok = await device.startView('scenery', undefined, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected start-view request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.startView failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              }),
            stopPreview: () =>
              Effect.tryPromise({
                try: async () => {
                  const ok = await device.stopView(undefined, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected stop-view request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.stopView failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              }),
            startCapture: () =>
              Effect.tryPromise({
                try: async () => {
                  const ok = await device.startStack(true, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected start-stack request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.startStack failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              }),
            stopCapture: () =>
              Effect.tryPromise({
                try: async () => {
                  const ok = await device.stopStack({
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected stop-stack request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.stopStack failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              }),
            refresh: Effect.tryPromise({
              try: async () => {
                const [deviceState, viewState] = await Promise.all([
                  device.getDeviceState(),
                  device.getViewState(),
                ])
                return mapSeestarRefresh(deviceState, viewState)
              },
              catch: (error) =>
                new Error(
                  `device.refresh failed for ${host}: ${toErrorMessage(error)}`,
                ),
            }),
            device: {
              pluginKind: 'seestar',
              deviceId: target.deviceId,
              displayName: target.displayName,
              host,
              productModel: summary.productModel ?? target.productModel,
              serialNumber: summary.serialNumber ?? target.serialNumber,
              firmwareVersion: summary.firmwareVersion,
              batteryPercent: summary.batteryPercent,
              deviceTempC: summary.deviceTempC,
              batteryTempC: summary.batteryTempC,
              tracking: summary.tracking,
              mountClosed: summary.mountClosed,
              connectedAt: new Date().toISOString(),
              location: summary.location,
              deviceTime: summary.deviceTime,
              deviceTimeLooksStale: summary.deviceTimeLooksStale,
              viewMode: summary.viewMode,
              viewStage: summary.viewStage,
              viewState: summary.viewState,
              storageFreeMb: summary.storageFreeMb,
              storageTotalMb: summary.storageTotalMb,
              warnings: summary.warnings,
            },
            preview: { phase: 'none', source: 'none', active: false },
            capture: { phase: 'idle' },
            library: { scope: 'current_target', assets: [], polling: false },
          } satisfies LiveDeviceSession
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              device.disconnect()
            }).pipe(Effect.zipRight(Effect.fail(error))),
          ),
        )
      }),
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function mapSeestarRefresh(
  deviceState: DeviceState | null,
  viewState: ViewStateResult | null,
): DeviceSessionRefresh {
  const mount =
    deviceState &&
    typeof deviceState.mount === 'object' &&
    deviceState.mount !== null
      ? (deviceState.mount as Record<string, unknown>)
      : undefined
  const tracking =
    mount && typeof mount.tracking === 'boolean' ? mount.tracking : undefined
  const view = viewState?.View
  const viewMode = view && typeof view.mode === 'string' ? view.mode : undefined
  const viewStage =
    view && typeof view.stage === 'string' ? view.stage : undefined
  const viewStateName =
    view && typeof view.state === 'string' ? view.state : undefined
  const viewActive =
    Boolean(viewMode) && viewMode !== 'none' && viewStateName !== 'cancel'
  const stacking = viewStage === 'Stack' && viewStateName !== 'cancel'
  return {
    device: { viewMode, viewStage, viewState: viewStateName, tracking },
    preview: viewActive
      ? { phase: 'active', source: 'rtsp', active: true }
      : { phase: 'none', source: 'none', active: false },
    capture: stacking ? { phase: 'capturing' } : { phase: 'idle' },
  }
}
