import { Effect, PubSub, Schema, Stream } from 'effect'
import { SeestarDevice } from '../device.js'
import type {
  ClientConfig,
  DeviceState,
  SeestarViewMode,
  ViewStateResult,
} from '../types.js'
import type {
  RigDeviceTelemetry,
  RigError,
  RigEvent,
  RigObserverLocation,
  RigSession,
  RigSnapshot,
} from './contracts.js'
import { RigProtocolError, RigRejectedError, RigTransportError } from './contracts.js'

const WAIT = {
  waitForCompletion: true,
  timeoutMs: 120000,
  pollIntervalMs: 500,
} as const

const MountState = Schema.Struct({
  close: Schema.optional(Schema.Boolean),
  tracking: Schema.optional(Schema.Boolean),
})

export interface SeestarRigConfig {
  readonly rigId: string
  readonly host: string
  readonly displayName: string
  readonly pemPath: string
  readonly serialNumber?: string
  readonly logger?: ClientConfig['logger']
  readonly deviceFactory?: (config: ClientConfig) => SeestarRigDevice
  readonly keepaliveIntervalMs?: number
}

type SeestarRigDevice = Pick<
  SeestarDevice,
  | 'authenticate'
  | 'connect'
  | 'connectAndAuth'
  | 'disconnect'
  | 'getSnapshot'
  | 'moveToHorizon'
  | 'park'
  | 'preflightCheck'
  | 'setTime'
  | 'setUserLocation'
  | 'setWheelPosition'
  | 'startAutoFocus'
  | 'startStack'
  | 'startView'
  | 'startViewDetailed'
  | 'stopStack'
  | 'stopView'
  | 'subscribeToLifecycleEvents'
  | 'testConnection'
>

export function createSeestarRig(input: SeestarRigConfig): Effect.Effect<RigSession, RigError> {
  return Effect.fn('SeestarRig.connect')(function* () {
      const config: ClientConfig = {
        host: input.host,
        pemPath: input.pemPath,
        logger: input.logger,
      }
      const device = input.deviceFactory?.(config) ?? new SeestarDevice(config)
      let stopped = false
      let keepalive: ReturnType<typeof setTimeout> | undefined
      let keepaliveInFlight: Promise<void> | undefined
      let unsubscribe: (() => void) | undefined
      let events: PubSub.PubSub<RigEvent> | undefined
      let lastViewMode: SeestarViewMode = 'star'
      let warnings: readonly string[] = []
      const stop = async () => {
        stopped = true
        if (keepalive) clearTimeout(keepalive)
        unsubscribe?.()
        unsubscribe = undefined
        device.disconnect()
        await keepaliveInFlight?.catch(() => {})
        if (events) await Effect.runPromise(PubSub.shutdown(events))
      }
      const publish = (event: RigEvent) => {
        if (!events) return
        Effect.runFork(PubSub.publish(events, event))
      }
      const runKeepalive = async () => {
        if (stopped) return
        try {
          await device.testConnection()
          if (stopped) return
          publish({ type: 'status.changed', health: 'healthy' })
        } catch {
          if (stopped) return
          publish({ type: 'status.changed', health: 'stale' })
          publish({ type: 'status.changed', health: 'recovering' })
          try {
            const authenticated = await device.connectAndAuth()
            if (stopped) return
            publish(
              authenticated
                ? { type: 'status.changed', health: 'healthy' }
                : {
                    type: 'status.changed',
                    health: 'failed',
                    message: 'Authentication failed after reconnect',
                  },
            )
          } catch (cause) {
            if (stopped) return
            publish({
              type: 'status.changed',
              health: 'failed',
              message: errorMessage(cause),
            })
          }
        } finally {
          if (!stopped) scheduleKeepalive()
        }
      }
      const scheduleKeepalive = () => {
        if (stopped) return
        keepalive = setTimeout(() => {
          keepalive = undefined
          keepaliveInFlight = runKeepalive()
          void keepaliveInFlight.finally(() => {
            keepaliveInFlight = undefined
          })
        }, input.keepaliveIntervalMs ?? 3000)
      }

      return yield* Effect.acquireUseRelease(
        Effect.void,
        () => Effect.gen(function* () {
          yield* deviceEffect('connect', () => device.connect())
          const authenticated = yield* deviceEffect('authenticate', () => device.authenticate())
          if (!authenticated) {
            return yield* Effect.fail(
              new RigRejectedError({
                provider: 'seestar',
                operation: 'authenticate',
                message: 'Authentication failed. Verify the PEM key and device firmware.',
              }),
            )
          }
          const preflight = yield* deviceEffect('preflight', () =>
            device.preflightCheck(),
          )
          warnings = preflight.warnings
          let observerLocation = toObserverLocation(preflight.location)
          events = yield* PubSub.dropping<RigEvent>(16)
          unsubscribe = device.subscribeToLifecycleEvents((event) => {
            if (event.type !== 'capture.failed') return
            publish({ type: event.type, message: event.error })
          })
          scheduleKeepalive()
          let telemetry = toTelemetry(preflight)
          const initialSnapshot = toPreflightSnapshot(preflight, warnings, telemetry)
          const snapshot = () => snapshotEffect(device, warnings, telemetry)
          const synchronizeObserver = (
            operation: 'observer.synchronize' | 'pointing.prepare',
            input: RigObserverLocation | undefined,
          ) =>
            Effect.gen(function* () {
              if (!(yield* deviceEffect(`${operation}.setTime`, () => device.setTime()))) {
                return yield* Effect.fail(rejected(operation, 'Device rejected set-time request'))
              }
              if (input && !(yield* deviceEffect(
                `${operation}.setUserLocation`,
                () => device.setUserLocation(input.lat, input.lon),
              ))) {
                return yield* Effect.fail(rejected(operation, 'Device rejected set-user-location request'))
              }
              const refreshedPreflight = yield* deviceEffect(
                `${operation}.preflight`,
                () => device.preflightCheck(),
              )
              warnings = refreshedPreflight.warnings
              telemetry = toTelemetry(refreshedPreflight)
              observerLocation = toObserverLocation(refreshedPreflight.location) ?? input
              return {
                observerLocation,
                snapshot: toPreflightSnapshot(refreshedPreflight, warnings, telemetry),
              }
            })

          return {
            identity: {
              rigId: input.rigId,
              provider: 'seestar',
              displayName: input.displayName,
              host: input.host,
              model: preflight.productModel,
              serialNumber: preflight.serialNumber ?? input.serialNumber,
              firmwareVersion: preflight.firmwareVersion,
            },
            get observerLocation() {
              return observerLocation
            },
            snapshot: initialSnapshot,
            refresh: Effect.suspend(snapshot),
            disconnect: deviceEffect('disconnect', stop),
            synchronizeObserver: (input) => action(
              'observer.synchronize',
              synchronizeObserver('observer.synchronize', input.observerLocation),
            ),
            events: Stream.fromPubSub(events),
            mount: {
              park: (context) => action('mount.park', deviceEffect(
                'mount.park',
                () => device.park({ ...WAIT, timeoutMs: 60000, signal: context?.signal }),
              ).pipe(Effect.flatMap((accepted) =>
                accepted ? Effect.void : Effect.fail(rejected('mount.park', 'Device rejected park request')),
              ))),
              unpark: (context) => action('mount.unpark', Effect.gen(function* () {
                const current = yield* snapshotEffect(device, warnings, telemetry)
                if (current.mount.parked !== true) return
                if (!(yield* deviceEffect(
                  'mount.unpark.moveToHorizon',
                  () => device.moveToHorizon({ ...WAIT, timeoutMs: 60000, signal: context?.signal }),
                ))) return yield* Effect.fail(rejected('mount.unpark', 'Device rejected move-to-horizon request'))
              })),
            },
            pointing: {
              prepare: (pointing, context) => action('pointing.prepare', Effect.gen(function* () {
                yield* synchronizeObserver('pointing.prepare', pointing)
                const current = yield* snapshotEffect(device, warnings, telemetry)
                if (current.preview.active && !(yield* deviceEffect(
                  'pointing.prepare.stopView',
                  () => device.stopView(undefined, { ...WAIT, timeoutMs: 30000, signal: context?.signal }),
                ))) return yield* Effect.fail(rejected('pointing.prepare', 'Device rejected stop-view request'))
                const next = yield* snapshotEffect(device, warnings, telemetry)
                if (next.mount.parked && !(yield* deviceEffect(
                  'pointing.prepare.moveToHorizon',
                  () => device.moveToHorizon({ ...WAIT, timeoutMs: 60000, signal: context?.signal }),
                ))) return yield* Effect.fail(rejected('pointing.prepare', 'Device rejected move-to-horizon request'))
              })),
              pointToCoordinates: (pointing, context) =>
                action('pointing.pointToCoordinates', Effect.gen(function* () {
                  lastViewMode = toViewMode(pointing.targetType, pointing.targetName)
                  const started = yield* deviceEffect('pointing.pointToCoordinates.startView', () => device.startViewDetailed(
                    {
                      mode: lastViewMode,
                      targetName: pointing.targetName,
                      targetRaDec: [pointing.raHours, pointing.decDeg],
                    },
                    { ...WAIT, signal: context?.signal },
                  ))
                  if (!started) return yield* Effect.fail(rejected('pointing.pointToCoordinates', 'Device rejected start-view request'))
                  const stopped = yield* deviceEffect('pointing.pointToCoordinates.stopView', () => device.stopView(undefined, {
                    ...WAIT,
                    timeoutMs: 30000,
                    signal: context?.signal,
                  }))
                  if (!stopped) return yield* Effect.fail(rejected('pointing.pointToCoordinates', 'Device rejected stop-view request'))
                })),
            },
            preview: {
              start: (context) => action('preview.start', deviceEffect('preview.start', () => device.startView(lastViewMode, undefined, {
                  ...WAIT,
                  timeoutMs: 30000,
                  signal: context?.signal,
                })).pipe(Effect.flatMap((started) =>
                  started ? Effect.void : Effect.fail(rejected('preview.start', 'Device rejected start-view request')),
                ))),
              stop: (context) => action('preview.stop', deviceEffect('preview.stop', () => device.stopView(undefined, {
                  ...WAIT,
                  timeoutMs: 30000,
                  signal: context?.signal,
                })).pipe(Effect.flatMap((stopped) =>
                  stopped ? Effect.void : Effect.fail(rejected('preview.stop', 'Device rejected stop-view request')),
                ))),
            },
            nativeCapture: {
              start: (context) => action('capture.start', Effect.gen(function* () {
                const current = yield* snapshotEffect(device, warnings, telemetry)
                if (!current.preview.active && !(yield* deviceEffect('capture.start.startView', () => device.startView(lastViewMode, undefined, { ...WAIT, timeoutMs: 30000, signal: context?.signal })))) return yield* Effect.fail(rejected('capture.start', 'Device rejected start-view request before stacking'))
                if (!(yield* deviceEffect('capture.start.startStack', () => device.startStack(true, { ...WAIT, timeoutMs: 30000, signal: context?.signal })))) return yield* Effect.fail(rejected('capture.start', 'Device rejected start-stack request'))
              })),
              stop: (context) => action('capture.stop', deviceEffect(
                'capture.stop',
                () => device.stopStack({ ...WAIT, timeoutMs: 30000, signal: context?.signal }),
              ).pipe(Effect.flatMap((stopped) =>
                stopped ? Effect.void : Effect.fail(rejected('capture.stop', 'Device rejected stop-stack request')),
              ))),
            },
            autofocus: {
              run: (context) => action('autofocus.run', deviceEffect(
                'autofocus.run',
                () => device.startAutoFocus({ ...WAIT, timeoutMs: 60000, signal: context?.signal }),
              ).pipe(Effect.flatMap((started) =>
                started ? Effect.void : Effect.fail(rejected('autofocus.run', 'Device rejected autofocus request')),
              ))),
            },
            // Native TCP has no readable, truthful selected-filter state.
          } satisfies RigSession
        }),
        (_unused, exit) =>
          exit._tag === 'Success' ? Effect.void : deviceEffect('disconnect', stop).pipe(Effect.ignore),
      )
    })()
}

function action<A>(operation: string, run: Effect.Effect<A, RigError>) {
  return Effect.fn(`SeestarRig.${operation}`)(function* () {
    return yield* run
  })()
}

function rejected(operation: string, message: string): RigRejectedError {
  return new RigRejectedError({ provider: 'seestar', operation, message })
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

function deviceEffect<A>(operation: string, run: () => Promise<A>): Effect.Effect<A, RigTransportError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new RigTransportError({
      provider: 'seestar',
      operation,
      message: errorMessage(cause),
      cause,
    }),
  })
}

function snapshotEffect(
  device: SeestarRigDevice,
  warnings: readonly string[],
  telemetry: RigDeviceTelemetry,
): Effect.Effect<RigSnapshot, RigError> {
  return deviceEffect('refresh', () => device.getSnapshot()).pipe(
    Effect.flatMap((snapshot) => toSnapshot(snapshot, warnings, telemetry)),
  )
}

function toSnapshot(
  snapshot: { readonly deviceState: DeviceState | null; readonly viewState: ViewStateResult | null },
  warnings: readonly string[],
  telemetry: RigDeviceTelemetry,
): Effect.Effect<RigSnapshot, RigProtocolError> {
  const mount: Effect.Effect<typeof MountState.Type | undefined, RigProtocolError> = snapshot.deviceState
    ? decodeMountState(snapshot.deviceState.mount)
    : Effect.succeed(undefined)
  return mount.pipe(Effect.map((mount) => {
  const view = snapshot.viewState?.View
  const mode = view && typeof view.mode === 'string' ? view.mode : undefined
  const stage = view && typeof view.stage === 'string' ? view.stage : undefined
  const state = view && typeof view.state === 'string' ? view.state : undefined
  const active = Boolean(mode) && mode !== 'none' && state !== 'cancel'
  const capture = stage === 'Stack' && state !== 'cancel'
    return {
      mount: { parked: mount?.close, tracking: mount?.tracking },
      preview: { active, source: active ? 'native' as const : 'none' as const },
      capture: { active: capture, mode: capture ? 'native' as const : undefined },
      telemetry,
      warnings: mount?.close === false ? warnings.filter((warning) => warning !== 'Mount is currently parked/closed') : warnings,
    }
  }))
}

function toTelemetry(preflight: {
  readonly batteryPercent?: number
  readonly deviceTempC?: number
  readonly batteryTempC?: number
  readonly storageFreeMb?: number
  readonly storageTotalMb?: number
  readonly deviceTime?: RigDeviceTelemetry['deviceTime']
  readonly deviceTimeLooksStale?: boolean
}): RigDeviceTelemetry {
  return {
    batteryPercent: preflight.batteryPercent,
    deviceTempC: preflight.deviceTempC,
    batteryTempC: preflight.batteryTempC,
    storageFreeMb: preflight.storageFreeMb,
    storageTotalMb: preflight.storageTotalMb,
    deviceTime: preflight.deviceTime,
    deviceTimeLooksStale: preflight.deviceTimeLooksStale,
  }
}

function toPreflightSnapshot(
  preflight: {
    readonly mountClosed?: boolean
    readonly tracking?: boolean
  },
  warnings: readonly string[],
  telemetry: RigDeviceTelemetry,
): RigSnapshot {
  return {
    mount: { parked: preflight.mountClosed, tracking: preflight.tracking },
    preview: { active: false, source: 'none' },
    capture: { active: false },
    telemetry,
    warnings,
  }
}

function toObserverLocation(
  location: { readonly lat: number; readonly lon: number } | undefined,
): RigObserverLocation | undefined {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return undefined
  if (location.lat < -90 || location.lat > 90 || location.lon < -180 || location.lon > 180) return undefined
  return location
}

function decodeMountState(value: unknown): Effect.Effect<typeof MountState.Type, RigProtocolError> {
  return Schema.decodeUnknownEffect(MountState)(value).pipe(
    Effect.mapError((cause) => new RigProtocolError({
      provider: 'seestar',
      operation: 'refresh',
      message: `Device returned an invalid mount state: ${errorMessage(cause)}`,
    })),
  )
}

function toViewMode(targetType: string, targetName?: string): SeestarViewMode {
  if (targetType === 'dso') return 'star'
  if (targetType === 'sun') return 'sun'
  if (targetType === 'moon') return 'moon'
  if (targetName === 'Uranus' || targetName === 'Neptune') return 'star'
  return 'planet'
}
