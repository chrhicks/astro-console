import { Effect } from 'effect'
import type {
  DesktopDiscoveredDeviceV2,
  ConnectRequestV2,
} from '../../../shared/api-v2'
import type { DevicePlugin, LiveDeviceSession } from './device-plugin'

const FAKE_HOST = '192.168.1.100'
const FAKE_DEVICE_ID = 'fake-seestar-s30'
const FAKE_MODEL = 'Seestar S30 (fake)'
const FAKE_SERIAL_NUMBER = 'FAKE-S30-001'
const FAKE_CAPABILITIES = {
  supportsStacking: true,
  supportsLivePreview: true,
  supportsFilterWheel: true,
  supportsAutofocus: true,
  supportsStorageAccess: true,
} as const

export function createFakeSeestarPlugin(): DevicePlugin {
  return {
    kind: 'fake-seestar',

    discover: Effect.succeed<DesktopDiscoveredDeviceV2[]>([
      {
        pluginKind: 'fake-seestar',
        deviceId: FAKE_DEVICE_ID,
        displayName: FAKE_MODEL,
        host: FAKE_HOST,
        productModel: FAKE_MODEL,
        serialNumber: FAKE_SERIAL_NUMBER,
      },
    ]),

    connect: (input: ConnectRequestV2) =>
      Effect.gen(function* () {
        if (input.deviceId !== FAKE_DEVICE_ID) {
          throw new Error(`Unknown fake Seestar device: ${input.deviceId}`)
        }

        yield* Effect.sleep('500 millis')

        return {
          sessionId: crypto.randomUUID(),
          pluginKind: 'fake-seestar',
          deviceId: FAKE_DEVICE_ID,
          host: FAKE_HOST,
          productModel: FAKE_MODEL,
          openedAt: new Date().toISOString(),
          capabilities: FAKE_CAPABILITIES,
          disconnect: Effect.sleep('200 millis').pipe(Effect.asVoid),
          pointToCoordinates: () => Effect.sleep('750 millis').pipe(Effect.asVoid),
          device: {
            pluginKind: 'fake-seestar',
            deviceId: FAKE_DEVICE_ID,
            displayName: FAKE_MODEL,
            host: FAKE_HOST,
            productModel: FAKE_MODEL,
            serialNumber: FAKE_SERIAL_NUMBER,
            connectedAt: new Date().toISOString(),
          },
        } satisfies LiveDeviceSession
      }),
  }
}
