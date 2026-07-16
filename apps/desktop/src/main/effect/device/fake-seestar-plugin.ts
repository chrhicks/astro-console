import { Effect } from 'effect'
import type {
  DesktopDiscoveredDeviceV2,
  ConnectRequestV2,
} from '../../../shared/api-v2'
import type {
  DevicePlugin,
  DeviceSession,
  PointToCoordinatesInput,
  PrepareForPointingInput,
} from './device-plugin'
import { toSeestarViewMode } from './device-plugin'
import type { ConnectedRig } from '../rig/rig-model'
import {
  fakeSeestarRuntime,
  type FakeScenarioAfterPoint,
} from './fake-seestar-runtime'

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
    discoverWithSignal: () => Effect.sync(() => [
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
        let parked = false

        const disconnect = Effect.sleep('200 millis').pipe(Effect.asVoid)

        const prepareForPointing = (_input: PrepareForPointingInput) =>
          Effect.gen(function* () {
            yield* Effect.sleep('100 millis')
            parked = false
          })

        const openArm = () =>
          Effect.gen(function* () {
            yield* Effect.sleep('300 millis')
            parked = false
          })

        const parkArm = () =>
          Effect.gen(function* () {
            yield* Effect.sleep('300 millis')
            previewActive = false
            captureActive = false
            parked = true
          })

        const pointToCoordinates = (_input: PointToCoordinatesInput) =>
          Effect.gen(function* () {
            const pointScenario = fakeSeestarRuntime.getActiveScenario()
            yield* Effect.sleep(pointScenario.point.delayMs)
            const pointOutcome = pointScenario.point.outcome
            if (pointOutcome.kind === 'failure') {
              return yield* Effect.fail(new Error(pointOutcome.error))
            }
          })

        const startPreview = () =>
          Effect.gen(function* () {
            const preview = fakeSeestarRuntime.getPreviewStartOutcome()
            yield* Effect.sleep(preview.delayMs)
            if (preview.startOutcome.kind === 'failure') {
              return yield* Effect.fail(new Error(preview.startOutcome.error))
            }
            previewActive = true
          })

        const stopPreview = () =>
          Effect.gen(function* () {
            yield* Effect.sleep('200 millis')
            previewActive = false
            captureActive = false
          })

        const startCapture = () =>
          Effect.gen(function* () {
            const capture = fakeSeestarRuntime.getCaptureStartOutcome()
            yield* Effect.sleep(capture.delayMs)
            if (capture.startOutcome.kind === 'failure') {
              return yield* Effect.fail(new Error(capture.startOutcome.error))
            }
            captureActive = true
          })

        const stopCapture = () =>
          Effect.gen(function* () {
            yield* Effect.sleep('200 millis')
            captureActive = false
          })

        const refresh = Effect.sync(() =>
          fakeSeestarRuntime.refresh(previewActive, captureActive, parked),
        )

        const rig: ConnectedRig = {
          identity: {
            rigId: deviceId,
            pluginKind: 'fake-seestar',
            displayName: outcome.device.displayName ?? 'Seestar (fake)',
            host: outcome.device.host,
          },
          observerLocation: outcome.device.location,
          connect: {
            device: outcome.device,
            preview: connected.preview,
            capture: connected.capture,
            library: connected.library,
          },
          refresh,
          mount: {
            park: () => parkArm(),
          },
          pointing: {
            // prepare owns all readiness steps before slewing: sync time
            // and location, stop any active view, and open the arm if the
            // mount is parked/closed. The app-level pointing workflow no
            // longer calls openArm() directly.
            prepare: (input) =>
              prepareForPointing(input).pipe(
                Effect.andThen(refresh),
                Effect.flatMap((refreshed) =>
                  refreshed.device.mountClosed
                    ? openArm()
                    : Effect.void,
                ),
              ),
            pointToCoordinates: (input) =>
              pointToCoordinates({
                mode: toSeestarViewMode(input.targetType, input.targetName),
                targetName: input.targetName,
                raHours: input.raHours,
                decDeg: input.decDeg,
              }),
            // The fake device surfaces deterministic post-point projection
            // state from the active scenario so the workflow does not need
            // to check pluginKind or reach into the fake runtime directly.
            afterPoint: Effect.sync(() => fakeSeestarRuntime.getAfterPointState()),
          },
          preview: {
            start: () => startPreview(),
            stop: () => stopPreview(),
          },
          capture: {
            start: () => startCapture(),
          },
          captureStop: { mode: 'native', stop: () => stopCapture() },
        }

        const session: DeviceSession = {
          sessionId: crypto.randomUUID(),
          pluginKind: 'fake-seestar',
          deviceId,
          health: { state: 'healthy', lastCheckedAt: new Date().toISOString() },
          disconnect,
          rig,
        }

        return session
      }),
  }
}
