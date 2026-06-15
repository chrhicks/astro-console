import { app } from 'electron'
import { Effect, Ref } from 'effect'
import {
  resolveSeestarPemPath,
  SeestarDevice,
  discoverSeestars,
} from '../../../../../../sdk/dist/index.js'
import type { ConnectRequestV2, DesktopDiscoveredDeviceV2 } from '../../../shared/api-v2'
import type { DevicePlugin, LiveDeviceSession } from './device-plugin'

function toSeestarDeviceId(device: {
  host: string
  serialNumber?: string
}) {
  return device.serialNumber
    ? `seestar:sn:${device.serialNumber}`
    : `seestar:host:${device.host}`
}

export function createSeestarPlugin(): DevicePlugin {
  const discoveredRef = Ref.unsafeMake<Map<string, DesktopDiscoveredDeviceV2>>(new Map())
  const discover = Effect.gen(function* () {
    const discovered: Awaited<ReturnType<typeof discoverSeestars>> = yield* Effect.tryPromise(() =>
      discoverSeestars({ timeoutMs: 2500 }),
    )

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
        const discovered = yield* Ref.get(discoveredRef)
        const target = discovered.get(input.deviceId)

        if (!target) {
          throw new Error(
            `Seestar device not found for deviceId ${input.deviceId}`
          )
        }

        const host = target.host
        if (!host) {
          throw new Error(`Discovered Seestar target ${target.deviceId} has no host`)
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
        })

        yield* Effect.tryPromise(() => device.connect())

        const authenticated = yield* Effect.tryPromise(() => device.authenticate())
        if (!authenticated) {
          device.disconnect()
          throw new Error(
            'Authentication failed. Verify the PEM key and device firmware.'
          )
        }

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
        } satisfies LiveDeviceSession
      }),
  }
}
