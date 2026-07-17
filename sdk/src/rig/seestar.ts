import { Effect, PubSub, Schema, Stream } from 'effect'
import { SeestarDevice } from '../device.js'
import type {
  ClientConfig,
  DeviceState,
  SeestarViewMode,
  ViewStateResult,
} from '../types.js'
import type { RigError, RigEvent, RigSession, RigSnapshot } from './contracts.js'
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
          events = yield* PubSub.dropping<RigEvent>(16)
          unsubscribe = device.subscribeToLifecycleEvents((event) => {
            if (event.type !== 'capture.failed') return
            publish({ type: event.type, message: event.error })
          })
          scheduleKeepalive()
          const initialSnapshot = {
            mount: { parked: preflight.mountClosed, tracking: preflight.tracking },
            preview: { active: false, source: 'none' as const },
            capture: { active: false },
            warnings,
          }
          const snapshot = () => snapshotEffect(device, warnings)

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
            observerLocation: preflight.location,
            snapshot: initialSnapshot,
            refresh: snapshot(),
            disconnect: deviceEffect('disconnect', stop),
            events: Stream.fromPubSub(events),
            mount: {
              park: (context) => action('mount.park', deviceEffect(
                'mount.park',
                () => device.park({ ...WAIT, timeoutMs: 60000, signal: context?.signal }),
              ).pipe(Effect.flatMap((accepted) =>
                accepted ? Effect.void : Effect.fail(rejected('mount.park', 'Device rejected park request')),
              ))),
            },
            pointing: {
              prepare: (pointing, context) => action('pointing.prepare', Effect.gen(function* () {
                if (!(yield* deviceEffect('pointing.prepare.setTime', () => device.setTime()))) {
                  return yield* Effect.fail(rejected('pointing.prepare', 'Device rejected set-time request'))
                }
                if (!(yield* deviceEffect('pointing.prepare.setUserLocation', () => device.setUserLocation(pointing.lat, pointing.lon)))) {
                  return yield* Effect.fail(rejected('pointing.prepare', 'Device rejected set-user-location request'))
                }
                const current = yield* snapshotEffect(device, warnings)
                if (current.preview.active && !(yield* deviceEffect(
                  'pointing.prepare.stopView',
                  () => device.stopView(undefined, { ...WAIT, timeoutMs: 30000, signal: context?.signal }),
                ))) return yield* Effect.fail(rejected('pointing.prepare', 'Device rejected stop-view request'))
                const next = yield* snapshotEffect(device, warnings)
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
                const current = yield* snapshotEffect(device, warnings)
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
            filterWheel: {
              setPosition: (position, context) => action('filterWheel.setPosition', deviceEffect(
                'filterWheel.setPosition',
                () => device.setWheelPosition(position, { ...WAIT, signal: context?.signal }),
              ).pipe(Effect.flatMap((set) =>
                set ? Effect.void : Effect.fail(rejected('filterWheel.setPosition', 'Device rejected filter wheel request')),
              ))),
            },
          } satisfies RigSession
        }),
        (_unused, exit) =>
          exit._tag === 'Success' ? Effect.void : deviceEffect('disconnect', stop).pipe(Effect.ignore),
      )
    })()
}

function action(operation: string, run: Effect.Effect<void, RigError>) {
  return Effect.fn(`SeestarRig.${operation}`)(function* () {
    yield* run
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

function snapshotEffect(device: SeestarRigDevice, warnings: readonly string[]): Effect.Effect<RigSnapshot, RigError> {
  return deviceEffect('refresh', () => device.getSnapshot()).pipe(
    Effect.flatMap((snapshot) => toSnapshot(snapshot, warnings)),
  )
}

function toSnapshot(snapshot: { readonly deviceState: DeviceState | null; readonly viewState: ViewStateResult | null }, warnings: readonly string[]): Effect.Effect<RigSnapshot, RigProtocolError> {
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
      warnings: mount?.close === false ? warnings.filter((warning) => warning !== 'Mount is currently parked/closed') : warnings,
    }
  }))
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
