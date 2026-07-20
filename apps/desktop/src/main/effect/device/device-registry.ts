import { Config, Context, Effect, Layer, Option } from 'effect'
import type {
  DevicePluginKind,
  DesktopDiscoveredDeviceV2,
} from '../../../shared/api-v2'
import type { DevicePlugin } from './device-plugin'
import { createAlpacaPlugin } from './alpaca-plugin'
import { createFakeSeestarPlugin } from './fake-seestar-plugin'
import { createSeestarPlugin } from './seestar-plugin'

export interface DeviceRegistry {
  readonly discoverAll: (signal: AbortSignal) => Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly get: (kind: DevicePluginKind) => Effect.Effect<DevicePlugin, unknown>
}

export const DeviceRegistry =
  Context.Service<DeviceRegistry>('DeviceRegistry')

const NativeSeestarConfig = Config.all({
  enabled: Config.boolean('SEESTAR_EXPERIMENTAL_NATIVE_TCP').pipe(
    Config.withDefault(false),
  ),
  pemPath: Config.option(Config.string('SEESTAR_EXPERIMENTAL_PEM_PATH')),
})

export const DeviceRegistryLive = Layer.effect(
  DeviceRegistry,
  Effect.gen(function* () {
    const nativeSeestar = yield* NativeSeestarConfig
    const fakeSeestar = createFakeSeestarPlugin()
    const seestar = nativeSeestar.enabled
      ? createSeestarPlugin({ pemPath: Option.getOrUndefined(nativeSeestar.pemPath) })
      : undefined
    const alpaca = createAlpacaPlugin()

    const plugins = new Map<DevicePluginKind, DevicePlugin>([
      [fakeSeestar.kind, fakeSeestar],
      [alpaca.kind, alpaca],
      ...(seestar ? [[seestar.kind, seestar] as const] : []),
    ])

    return DeviceRegistry.of({
      discoverAll: (signal) => Effect.all(
        [...plugins.values()].map((plugin) => plugin.discoverWithSignal({ signal })),
      ).pipe(Effect.map((discovered) => dedupeDiscoveredDevices(discovered.flat()))),
      get: (kind) => {
        const plugin = plugins.get(kind)
        if (!plugin) {
          return Effect.fail(new Error(`Unknown device plugin kind: ${kind}`))
        }
        return Effect.succeed(plugin)
      },
    })
  }),
)

export function dedupeDiscoveredDevices(
  devices: readonly DesktopDiscoveredDeviceV2[],
): DesktopDiscoveredDeviceV2[] {
  const identities = new Set<string>()
  return devices.filter((device) => {
    const identity = device.serialNumber
      ? `serial:${device.serialNumber}`
      : `${device.pluginKind}:${device.deviceId}`
    if (identities.has(identity)) return false
    identities.add(identity)
    return true
  })
}
