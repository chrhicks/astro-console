import { app } from 'electron'
import { Effect, Ref } from 'effect'
import {
  resolveSeestarPemPath,
  SeestarDevice,
  discoverSeestars,
  createConsoleLogger,
} from '../../../../../../sdk/dist/index.js'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
} from '../../../shared/api-v2'
import type { DevicePlugin, LiveDeviceSession } from './device-plugin'
import { EventBus } from '../event/event-bus.js'

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
          throw new Error(
            `Seestar device not found for deviceId ${input.deviceId}`,
          )
        }

        const host = target.host
        if (!host) {
          throw new Error(
            `Discovered Seestar target ${target.deviceId} has no host`,
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
          logger: createConsoleLogger('debug')
        })

        yield* bus.publish('session.connect.step.started', {
          step: 'device.connect',
          host,
          deviceId: input.deviceId,
        })

        yield* Effect.tryPromise({
          try: () => device.connect(),
          catch: (error) =>
            new Error(`device.connect failed for ${host}: ${toErrorMessage(error)}`)
        }).pipe(
          Effect.catchAll((error) =>
            bus.publish('session.connect.step.failed', {
              step: 'device.connect',
              host,
              deviceId: input.deviceId,
              error: toErrorMessage(error),
            }).pipe(Effect.zipRight(Effect.fail(error)))
          )
        )

        yield* bus.publish('session.connect.step.succeeded', {
          step: 'device.connect',
          host,
          deviceId: target.deviceId,
        })


        yield* bus.publish('session.authenticate.step.started', {
          step: 'device.authenticate',
          host,
          deviceId: input.deviceId,
        })

        const authenticated = yield* Effect.tryPromise({
          try: () => device.authenticate(),
          catch: (error) =>
            new Error(`device.authenticate failed for ${host}: ${toErrorMessage(error)}`)
         }).pipe(
          Effect.catchAll((error) => 
            bus.publish('session.authenticate.step.failed', {
              step: 'device.authenticate',
              host,
              deviceId: input.deviceId,
              error: toErrorMessage(error),
            }).pipe(Effect.zipRight(Effect.fail(error)))
          )
        )

        yield* bus.publish('session.authenticate.step.succeeded', {
          step: 'device.authenticate',
          host,
          deviceId: target.deviceId,
        })

        if (!authenticated) {
          device.disconnect()
          throw new Error(
            'Authentication failed. Verify the PEM key and device firmware.',
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
            new Error(`device.preflightCheck failed for ${host}: ${toErrorMessage(error)}`)
        }).pipe(
          Effect.catchAll((error) =>
            bus.publish('session.preflightCheck.step.failed', {
              step: 'device.preflightCheck',
              host,
              deviceId: input.deviceId,
              error: toErrorMessage(error),
            }).pipe(Effect.zipRight(Effect.fail(error)))
          )
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
          disconnect: Effect.sync(() => {
            device.disconnect()
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
          },
        } satisfies LiveDeviceSession
      }),
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}