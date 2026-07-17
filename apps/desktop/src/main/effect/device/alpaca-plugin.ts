import { Effect, Ref } from 'effect'
import { createAlpacaRig, discoverAlpacaRigs } from 'seestar-sdk'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DeviceProjection,
  LiveSessionHealthState,
} from '../../../shared/api-v2'
import type { DevicePlugin, DeviceSession } from './device-plugin'
import { toDesktopRig } from './sdk-rig-bridge'

const DISCOVERY_TIMEOUT_MS = 3000

interface AlpacaDiscoveredRig extends DesktopDiscoveredDeviceV2 {
  readonly port: number
  readonly telescopeDeviceNumber: number
  readonly telescopeUniqueId?: string
  readonly cameraDeviceNumber?: number
  readonly focuserDeviceNumber?: number
  readonly filterWheelDeviceNumber?: number
}

export function createAlpacaPlugin(): DevicePlugin {
  const discovered = Ref.makeUnsafe<Map<string, AlpacaDiscoveredRig>>(new Map())
  const discover = (input: { readonly signal: AbortSignal }) =>
    Effect.tryPromise(() => discoverAlpacaRigs(DISCOVERY_TIMEOUT_MS, input.signal)).pipe(
      Effect.map((configurations) => configurations.map(toDiscoveredRig)),
      Effect.tap((rigs) => Ref.set(discovered, new Map(rigs.map((rig) => [rig.deviceId, rig])))),
    )

  return {
    kind: 'alpaca-rig',
    discover: discover({ signal: new AbortController().signal }),
    discoverWithSignal: discover,
    connect: (input: ConnectRequestV2) => Effect.gen(function* () {
      const target = (yield* Ref.get(discovered)).get(input.deviceId)
      if (!target?.host) return yield* Effect.fail(new Error(`Alpaca rig not found for deviceId ${input.deviceId}`))
      const session = yield* createAlpacaRig({
        rigId: target.deviceId,
        host: target.host,
        port: target.port,
        displayName: target.displayName,
        telescopeDeviceNumber: target.telescopeDeviceNumber,
        cameraDeviceNumber: target.cameraDeviceNumber,
        focuserDeviceNumber: target.focuserDeviceNumber,
        filterWheelDeviceNumber: target.filterWheelDeviceNumber,
        serialNumber: target.telescopeUniqueId,
      }).pipe(Effect.mapError((error) => new Error(`Alpaca connect failed: ${error._tag}`)))
      const snapshot = session.snapshot
      const connectedAt = new Date().toISOString()
      const device: DeviceProjection = {
        pluginKind: 'alpaca-rig',
        deviceId: target.deviceId,
        displayName: session.identity.displayName,
        host: target.host,
        productModel: target.productModel,
        serialNumber: target.telescopeUniqueId,
        firmwareVersion: session.identity.firmwareVersion,
        tracking: snapshot.mount.tracking,
        mountClosed: snapshot.mount.parked,
        connectedAt,
        location: session.observerLocation,
        locationSource: 'device',
        warnings: [...snapshot.warnings],
      }
      const health: LiveSessionHealthState = { state: 'healthy', lastCheckedAt: connectedAt }
      return {
        sessionId: crypto.randomUUID(),
        pluginKind: 'alpaca-rig',
        deviceId: target.deviceId,
        health,
        disconnect: session.disconnect,
        rig: toDesktopRig(session, 'alpaca-rig', device),
      } satisfies DeviceSession
    }),
  }
}

export function toDiscoveredRig(configuration: Awaited<ReturnType<typeof discoverAlpacaRigs>>[number]): AlpacaDiscoveredRig {
  return {
    pluginKind: 'alpaca-rig',
    deviceId: configuration.telescopeUniqueId ? `alpaca:telescope:${configuration.telescopeUniqueId}` : `alpaca:host:${configuration.host}:${configuration.port}`,
    displayName: configuration.telescopeName || configuration.friendlyName || `Alpaca Rig ${configuration.host}`,
    host: configuration.host,
    port: configuration.port,
    telescopeDeviceNumber: configuration.telescopeDeviceNumber,
    telescopeUniqueId: configuration.telescopeUniqueId,
    cameraDeviceNumber: configuration.cameraDeviceNumber,
    focuserDeviceNumber: configuration.focuserDeviceNumber,
    filterWheelDeviceNumber: configuration.filterWheelDeviceNumber,
    productModel: configuration.telescopeName || configuration.productName,
    serialNumber: configuration.telescopeUniqueId,
  }
}
