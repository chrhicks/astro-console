import { Context, Effect, Layer } from 'effect'
import type {
  DevicePluginKind,
  DesktopDiscoveredDeviceV2,
} from '../../../shared/api-v2'
import type { DevicePlugin } from './device-plugin'
import { createFakeSeestarPlugin } from './fake-seestar-plugin'
import { createSeestarPlugin } from './seestar-plugin'

export interface DeviceRegistry {
  readonly discoverAll: Effect.Effect<DesktopDiscoveredDeviceV2[], unknown>
  readonly get: (kind: DevicePluginKind) => Effect.Effect<DevicePlugin, unknown>
}

export const DeviceRegistry =
  Context.GenericTag<DeviceRegistry>('DeviceRegistry')

export const DeviceRegistryLive = Layer.sync(DeviceRegistry, () => {
  const fakeSeestar = createFakeSeestarPlugin()
  const seestar = createSeestarPlugin()

  const plugins = new Map<DevicePluginKind, DevicePlugin>([
    [fakeSeestar.kind, fakeSeestar],
    [seestar.kind, seestar],
  ])

  return {
    discoverAll: Effect.all(
      [...plugins.values()].map((plugin) => plugin.discover),
    ).pipe(Effect.map((discovered) => discovered.flat())),
    get: (kind) => {
      const plugin = plugins.get(kind)
      if (!plugin) {
        return Effect.fail(new Error(`Unknown device plugin kind: ${kind}`))
      }
      return Effect.succeed(plugin)
    },
  }
})
