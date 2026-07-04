import { Effect } from 'effect'
import type {
  DesktopDiscoveredDeviceV2,
  ConnectRequestV2,
} from '../../../shared/api-v2'
import type { DevicePlugin, LiveDeviceSession } from './device-plugin'
import {
  fakeSeestarRuntime,
  type FakeScenarioAfterPoint,
} from './fake-seestar-runtime'

const FAKE_CAPABILITIES = {
  supportsStacking: true,
  supportsLivePreview: true,
  supportsFilterWheel: true,
  supportsAutofocus: true,
  supportsStorageAccess: true,
} as const

const CONNECTED_IDLE: FakeScenarioAfterPoint = {
  preview: { phase: 'none', source: 'none', active: false },
  capture: { phase: 'idle' },
  library: { scope: 'current_target', assets: [], polling: false },
}

export function createFakeSeestarPlugin(): DevicePlugin {
  return {
    kind: 'fake-seestar',

    discover: Effect.sync(() => [
      ...fakeSeestarRuntime.getActiveScenario().discover,
    ]),

    connect: (input: ConnectRequestV2) =>
      Effect.gen(function* () {
        const scenario = fakeSeestarRuntime.getActiveScenario()
        const deviceId = scenario.discover[0]?.deviceId
        if (input.deviceId !== deviceId) {
          return yield* Effect.fail(
            new Error(`Unknown fake Seestar device: ${input.deviceId}`),
          )
        }

        yield* Effect.sleep(scenario.connect.delayMs)

        const outcome = scenario.connect.outcome
        if (outcome.kind === 'failure') {
          return yield* Effect.fail(new Error(outcome.error))
        }

        const connected = scenario.connected ?? CONNECTED_IDLE
        let previewActive = false
        let captureActive = false
        return {
          sessionId: crypto.randomUUID(),
          pluginKind: 'fake-seestar',
          deviceId,
          host: outcome.device.host,
          productModel: outcome.device.productModel,
          openedAt: new Date().toISOString(),
          capabilities: FAKE_CAPABILITIES,
          disconnect: Effect.sleep('200 millis').pipe(Effect.asVoid),
          pointToCoordinates: () =>
            Effect.gen(function* () {
              const pointScenario = fakeSeestarRuntime.getActiveScenario()
              yield* Effect.sleep(pointScenario.point.delayMs)
              const pointOutcome = pointScenario.point.outcome
              if (pointOutcome.kind === 'failure') {
                return yield* Effect.fail(new Error(pointOutcome.error))
              }
            }),
          startPreview: () =>
            Effect.gen(function* () {
              const preview = fakeSeestarRuntime.getPreviewStartOutcome()
              yield* Effect.sleep(preview.delayMs)
              if (preview.startOutcome.kind === 'failure') {
                return yield* Effect.fail(new Error(preview.startOutcome.error))
              }
              previewActive = true
            }),
          stopPreview: () =>
            Effect.gen(function* () {
              yield* Effect.sleep('200 millis')
              previewActive = false
              captureActive = false
            }),
          startCapture: () =>
            Effect.gen(function* () {
              const capture = fakeSeestarRuntime.getCaptureStartOutcome()
              yield* Effect.sleep(capture.delayMs)
              if (capture.startOutcome.kind === 'failure') {
                return yield* Effect.fail(new Error(capture.startOutcome.error))
              }
              captureActive = true
            }),
          stopCapture: () =>
            Effect.gen(function* () {
              yield* Effect.sleep('200 millis')
              captureActive = false
            }),
          refresh: Effect.sync(() =>
            fakeSeestarRuntime.refresh(previewActive, captureActive),
          ),
          device: outcome.device,
          preview: connected.preview,
          capture: connected.capture,
          library: connected.library,
        } satisfies LiveDeviceSession
      }),
  }
}
