import { app } from 'electron'
import { Effect, Fiber, Ref, Stream } from 'effect'
import {
  createSeestarRig,
  discoverSeestars,
  resolveSeestarPemPath,
  type RigEvent,
} from 'seestar-sdk'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DeviceProjection,
  LiveSessionHealthState,
} from '../../../shared/api-v2'
import type { DevicePlugin, DeviceSession } from './device-plugin'
import { EventBus } from '../event/event-bus.js'
import { toDesktopRig } from './sdk-rig-bridge'

export function createSeestarPlugin(): DevicePlugin {
  const discovered = Ref.makeUnsafe<Map<string, DesktopDiscoveredDeviceV2>>(new Map())
  const discover = (input: { readonly signal: AbortSignal }) =>
    Effect.tryPromise(() => discoverSeestars({ timeoutMs: 2500, signal: input.signal })).pipe(
      Effect.map((devices) => devices.map(toDiscoveredDevice)),
      Effect.tap((devices) => Ref.set(discovered, new Map(devices.map((device) => [device.deviceId, device])))),
    )

  return {
    kind: 'seestar',
    discover: discover({ signal: new AbortController().signal }),
    discoverWithSignal: discover,
    connect: (input: ConnectRequestV2) => Effect.gen(function* () {
      const bus = yield* EventBus
      const target = (yield* Ref.get(discovered)).get(input.deviceId)
      if (!target?.host) return yield* Effect.fail(new Error(`Seestar device not found for deviceId ${input.deviceId}`))
      const session = yield* createSeestarRig({
        rigId: target.deviceId,
        host: target.host,
        displayName: target.displayName,
        serialNumber: target.serialNumber,
        pemPath: resolveSeestarPemPath({
          fallbackCandidates: [
            app.isPackaged
              ? `${process.resourcesPath}/seestar_3.1.2_fw_7.32_interop.pem`
              : `${app.getAppPath()}/seestar_3.1.2_fw_7.32_interop.pem`,
          ],
        }),
      })
      const snapshot = session.snapshot
      const connectedAt = new Date().toISOString()
      const device: DeviceProjection = {
        pluginKind: 'seestar',
        deviceId: target.deviceId,
        displayName: session.identity.displayName,
        host: target.host,
        productModel: session.identity.model ?? target.productModel,
        serialNumber: session.identity.serialNumber ?? target.serialNumber,
        firmwareVersion: session.identity.firmwareVersion,
        tracking: snapshot.mount.tracking,
        mountClosed: snapshot.mount.parked,
        connectedAt,
        location: session.observerLocation,
        locationSource: 'device',
        warnings: [...snapshot.warnings],
      }
      const health: LiveSessionHealthState = { state: 'healthy', lastCheckedAt: connectedAt }
      const sessionId = crypto.randomUUID()
      const eventFiber = session.events
        ? yield* session.events.pipe(
            Stream.runForEach((event) => handleSessionEvent(event, health, bus, sessionId, target)),
            Effect.forkDetach,
          )
        : undefined
      return {
        sessionId,
        pluginKind: 'seestar',
        deviceId: target.deviceId,
        health,
        disconnect: eventFiber
          ? session.disconnect.pipe(Effect.ensuring(Fiber.interrupt(eventFiber)))
          : session.disconnect,
        rig: toDesktopRig(session, 'seestar', device),
      } satisfies DeviceSession
    }),
  }
}

function handleSessionEvent(
  event: RigEvent,
  health: LiveSessionHealthState,
  bus: EventBus,
  sessionId: string,
  target: DesktopDiscoveredDeviceV2,
) {
  if (event.type === 'capture.failed') {
    return bus.publish(
      'seestar.capture.stack.failed',
      { error: event.message ?? 'Capture failed', deviceId: target.deviceId },
      { sessionId, host: target.host },
    )
  }
  if (!event.health) return Effect.void
  const previous = health.state
  health.state = event.health
  health.lastCheckedAt = new Date().toISOString()
  health.lastError = event.message
  if (event.health === 'stale') {
    return bus.publish('session.keepalive.stale', { deviceId: target.deviceId, host: target.host }, { sessionId, host: target.host })
  }
  if (event.health === 'healthy' && previous !== 'healthy') {
    return bus.publish('session.keepalive.recovered', { deviceId: target.deviceId, host: target.host }, { sessionId, host: target.host })
  }
  if (event.health === 'failed') {
    return bus.publish('session.keepalive.failed', { deviceId: target.deviceId, host: target.host, error: event.message ?? 'Keepalive failed' }, { sessionId, host: target.host })
  }
  return Effect.void
}

function toDiscoveredDevice(device: Awaited<ReturnType<typeof discoverSeestars>>[number]): DesktopDiscoveredDeviceV2 {
  const productModel = typeof device.result.product_model === 'string' ? device.result.product_model : 'Seestar'
  const serialNumber = typeof device.result.sn === 'string' ? device.result.sn : undefined
  return {
    pluginKind: 'seestar',
    deviceId: serialNumber ? `seestar:sn:${serialNumber}` : `seestar:host:${device.host}`,
    displayName: productModel,
    host: device.host,
    productModel,
    serialNumber,
  }
}
