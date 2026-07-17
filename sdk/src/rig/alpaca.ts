import { Effect, Schema } from 'effect'
import {
  AlpacaClient,
  type AlpacaError,
  AlpacaProtocolError,
  AlpacaRejectedError,
  AlpacaTransportError,
} from '../alpaca/client.js'
import { discoverAlpacaRigs } from '../alpaca/discovery.js'
import { parseAlpacaImageBytes } from '../alpaca/image-bytes.js'
import type {
  RigCamera,
  RigCameraExposureState,
  RigCoordinates,
  RigError,
  RigSession,
} from './contracts.js'
import {
  RigProtocolError,
  RigRejectedError,
  RigTransportError,
} from './contracts.js'

const COMMAND_TIMEOUT_MS = 15000
const MOUNT_POLL_INTERVAL_MS = 1000
const SLEW_TIMEOUT_MS = 120000
const UNPARK_SETTLE_TIMEOUT_MS = 10000

export { discoverAlpacaRigs }

export interface AlpacaRigConfig {
  readonly rigId: string
  readonly host: string
  readonly port: number
  readonly displayName: string
  readonly telescopeDeviceNumber: number
  readonly cameraDeviceNumber?: number
  readonly focuserDeviceNumber?: number
  readonly filterWheelDeviceNumber?: number
  readonly serialNumber?: string
}

interface TelescopeState {
  readonly atPark?: boolean
  readonly canPark: boolean
  readonly canUnpark: boolean
  readonly tracking?: boolean
  readonly siteLatitude?: number
  readonly siteLongitude?: number
  readonly canSlew: boolean
  readonly canSlewAsync: boolean
  readonly driverVersion?: string
  readonly name?: string
}

export function createAlpacaRig(
  input: AlpacaRigConfig,
): Effect.Effect<RigSession, RigError> {
  return Effect.fn('AlpacaRig.connect')(function* () {
    const client = new AlpacaClient(input.host, input.port)
    const telescope = `/api/v1/telescope/${input.telescopeDeviceNumber}`
    const camera =
      input.cameraDeviceNumber === undefined
        ? undefined
        : `/api/v1/camera/${input.cameraDeviceNumber}`
    const focuser =
      input.focuserDeviceNumber === undefined
        ? undefined
        : `/api/v1/focuser/${input.focuserDeviceNumber}`
    const filterWheel =
      input.filterWheelDeviceNumber === undefined
        ? undefined
        : `/api/v1/filterwheel/${input.filterWheelDeviceNumber}`
    const bases = [telescope, camera, focuser, filterWheel].filter(
      (base): base is string => base !== undefined,
    )

    return yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen(function* () {
          const state = yield* connectAndReadState(client, telescope)
          yield* connectComponents(client, bases.slice(1))
          const location =
            state.siteLatitude === undefined ||
            state.siteLongitude === undefined
              ? undefined
              : { lat: state.siteLatitude, lon: state.siteLongitude }
          const mount = buildMount(client, telescope, state)
          const rigCamera = camera ? buildCamera(client, camera) : undefined
          const snapshot = {
            mount: { parked: state.atPark, tracking: state.tracking },
            preview: { active: false, source: 'none' as const },
            capture: {
              active: false,
              mode: camera ? ('external' as const) : undefined,
            },
            warnings: [],
          }

          return {
            identity: {
              rigId: input.rigId,
              provider: 'alpaca',
              displayName: state.name ?? input.displayName,
              host: input.host,
              port: input.port,
              serialNumber: input.serialNumber,
              firmwareVersion: state.driverVersion,
            },
            observerLocation: location,
            snapshot,
            refresh: alpacaError('refresh')(
              readSnapshot(client, telescope, camera),
            ),
            disconnect: alpacaError('disconnect')(disconnectAll(client, bases)),
            mount,
            pointing: mount?.slewToCoordinates
              ? {
                  prepare: (_input, context) =>
                    alpacaError('pointing.prepare')(
                      prepareMountForSlew(
                        client,
                        telescope,
                        state,
                        context?.signal,
                      ),
                    ),
                  pointToCoordinates: mount.slewToCoordinates,
                }
              : undefined,
            camera: rigCamera,
            focuser: focuser
              ? {
                  moveTo: (position) =>
                    command(
                      client,
                      `${focuser}/move`,
                      { Position: position },
                      'focuser.move',
                    ),
                }
              : undefined,
            filterWheel: filterWheel
              ? {
                  setPosition: (position, context) =>
                    command(
                      client,
                      `${filterWheel}/position`,
                      { Position: position },
                      'filterWheel.setPosition',
                      COMMAND_TIMEOUT_MS,
                      context?.signal,
                    ),
                }
              : undefined,
          } satisfies RigSession
        }),
      (_unused, exit) =>
        exit._tag === 'Success'
          ? Effect.void
          : disconnectAll(client, bases).pipe(Effect.ignore),
    )
  })().pipe(alpacaError('connect'))
}

function connectComponents(client: AlpacaClient, bases: readonly string[]) {
  return Effect.forEach(bases, (base) => ensureConnected(client, base), {
    concurrency: 1,
  })
}

function connectAndReadState(client: AlpacaClient, base: string) {
  return Effect.gen(function* () {
    yield* ensureConnected(client, base)
    const atPark = yield* optional(client.get(`${base}/atpark`, Schema.Boolean))
    const canPark = yield* optional(
      client.get(`${base}/canpark`, Schema.Boolean),
      false,
    )
    const canUnpark = yield* client.get(`${base}/canunpark`, Schema.Boolean)
    const tracking = yield* optional(
      client.get(`${base}/tracking`, Schema.Boolean),
    )
    const siteLatitude = yield* optional(
      client.get(`${base}/sitelatitude`, Schema.Number),
    )
    const siteLongitude = yield* optional(
      client.get(`${base}/sitelongitude`, Schema.Number),
    )
    const canSlew = yield* optional(
      client.get(`${base}/canslew`, Schema.Boolean),
      false,
    )
    const canSlewAsync = yield* optional(
      client.get(`${base}/canslewasync`, Schema.Boolean),
      false,
    )
    const driverVersion = yield* optional(
      client.get(`${base}/driverversion`, Schema.String),
    )
    const name = yield* optional(client.get(`${base}/name`, Schema.String))
    return {
      atPark,
      canPark,
      canUnpark,
      tracking,
      siteLatitude,
      siteLongitude,
      canSlew,
      canSlewAsync,
      driverVersion,
      name,
    } satisfies TelescopeState
  })
}

function ensureConnected(
  client: AlpacaClient,
  base: string,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    if (yield* client.get(`${base}/connected`, Schema.Boolean, signal)) return
    yield* client.put(
      `${base}/connected`,
      { Connected: true },
      COMMAND_TIMEOUT_MS,
      signal,
    )
  })
}

function disconnectAll(client: AlpacaClient, bases: readonly string[]) {
  return Effect.gen(function* () {
    let failure: AlpacaError | undefined
    for (const base of bases) {
      yield* client.put(`${base}/connected`, { Connected: false }).pipe(
        Effect.catch((error) => {
          failure ??= error
          return Effect.void
        }),
      )
    }
    if (failure) return yield* Effect.fail(failure)
  })
}

function buildMount(
  client: AlpacaClient,
  base: string,
  state: TelescopeState,
): RigSession['mount'] {
  const canSlew = state.canSlew || state.canSlewAsync
  if (!state.canPark && !state.canUnpark && !canSlew) return undefined
  const slewToCoordinates = canSlew
    ? (input: RigCoordinates, context?: { readonly signal?: AbortSignal }) =>
        alpacaError('mount.slew')(
          Effect.fn('AlpacaRig.mount.slew')(function* () {
            yield* prepareMountForSlew(client, base, state, context?.signal)
            const endpoint = state.canSlewAsync
              ? 'slewtocoordinatesasync'
              : 'slewtocoordinates'
            yield* client.put(
              `${base}/${endpoint}`,
              { RightAscension: input.raHours, Declination: input.decDeg },
              COMMAND_TIMEOUT_MS,
              context?.signal,
            )
            if (state.canSlewAsync) {
              yield* pollMount(
                client,
                base,
                (next) => !next.atPark && !next.slewing,
                SLEW_TIMEOUT_MS,
                context?.signal,
                'mount.slew',
              )
            }
          })(),
        )
    : undefined
  return {
    park: state.canPark
      ? (context) =>
          alpacaError('mount.park')(
            Effect.fn('AlpacaRig.mount.park')(function* () {
              if (
                yield* client.get(
                  `${base}/atpark`,
                  Schema.Boolean,
                  context?.signal,
                )
              )
                return
              yield* client.put(
                `${base}/park`,
                {},
                COMMAND_TIMEOUT_MS,
                context?.signal,
              )
              yield* poll(
                () =>
                  client.get(`${base}/atpark`, Schema.Boolean, context?.signal),
                SLEW_TIMEOUT_MS,
                context?.signal,
                'mount.park',
              )
            })(),
          )
      : undefined,
    unpark: state.canUnpark
      ? (context) =>
          alpacaError('mount.unpark')(
            Effect.fn('AlpacaRig.mount.unpark')(function* () {
              if (
                !(yield* client.get(
                  `${base}/atpark`,
                  Schema.Boolean,
                  context?.signal,
                ))
              )
                return
              yield* client.put(
                `${base}/unpark`,
                {},
                COMMAND_TIMEOUT_MS,
                context?.signal,
              )
              yield* pollMount(
                client,
                base,
                (next) => !next.atPark && !next.slewing,
                UNPARK_SETTLE_TIMEOUT_MS,
                context?.signal,
                'mount.unpark',
              )
            })(),
          )
      : undefined,
    slewToCoordinates,
    stopMotion: canSlew
      ? (context) =>
          alpacaError('mount.stopMotion')(
            Effect.fn('AlpacaRig.mount.stopMotion')(function* () {
              if ((yield* readMount(client, base, context?.signal)).atPark)
                return
              yield* client.put(
                `${base}/abortslew`,
                {},
                COMMAND_TIMEOUT_MS,
                context?.signal,
              )
            })(),
          )
      : undefined,
  }
}

function prepareMountForSlew(
  client: AlpacaClient,
  base: string,
  state: TelescopeState,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const current = yield* readMount(client, base, signal)
    if (current.atPark) {
      if (!state.canUnpark) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation: 'mount.slew',
            message: 'Mount is parked and cannot unpark; no slew was sent.',
          }),
        )
      }
      yield* client.put(`${base}/unpark`, {}, COMMAND_TIMEOUT_MS, signal)
    }
    yield* pollMount(
      client,
      base,
      (next) => !next.atPark && !next.slewing,
      UNPARK_SETTLE_TIMEOUT_MS,
      signal,
      'mount.slew',
    ).pipe(
      Effect.catch((error) =>
        signal?.aborted
          ? Effect.fail(error)
          : Effect.fail(
              new AlpacaRejectedError({
                operation: 'mount.slew',
                message: current.atPark
                  ? 'Mount did not settle after unpark; no slew was sent.'
                  : 'Mount did not settle before slew; no slew was sent.',
              }),
            ),
      ),
    )
  })
}

function buildCamera(client: AlpacaClient, base: string): RigCamera {
  return {
    startExposure: (input, context) =>
      command(
        client,
        `${base}/startexposure`,
        { Duration: input.durationSec, Light: input.light ?? true },
        'camera.startExposure',
        input.durationSec * 1000 + COMMAND_TIMEOUT_MS,
        context?.signal,
      ),
    startDarkExposure: (input, context) =>
      command(
        client,
        `${base}/startexposure`,
        { Duration: input.durationSec, Light: false },
        'camera.startDarkExposure',
        input.durationSec * 1000 + COMMAND_TIMEOUT_MS,
        context?.signal,
      ),
    stopExposure: (context) =>
      command(
        client,
        `${base}/stopexposure`,
        {},
        'camera.stopExposure',
        COMMAND_TIMEOUT_MS,
        context?.signal,
      ),
    getExposureState: (context) =>
      alpacaError('camera.getExposureState')(
        Effect.fn('AlpacaRig.camera.getExposureState')(function* () {
          const state = yield* client.get(
            `${base}/camerastate`,
            Schema.Number,
            context?.signal,
          )
          const imageReady = yield* client.get(
            `${base}/imageready`,
            Schema.Boolean,
            context?.signal,
          )
          const lastExposureDurationSec = yield* optional(
            client.get(
              `${base}/lastexposureduration`,
              Schema.Number,
              context?.signal,
            ),
          )
          if (imageReady)
            return {
              state: 'ready' as const,
              imageReady,
              lastExposureDurationSec,
            }
          if (state === 1 || state === 2)
            return {
              state: 'exposing' as const,
              imageReady,
              lastExposureDurationSec,
            }
          if (state === 3)
            return {
              state: 'reading' as const,
              imageReady,
              lastExposureDurationSec,
            }
          if (state === 4)
            return {
              state: 'error' as const,
              imageReady,
              lastExposureDurationSec,
              lastError: 'Camera reported error state',
            }
          return { state: 'idle' as const, imageReady, lastExposureDurationSec }
        })(),
      ),
    getLatestFrame: (context) =>
      alpacaError('camera.getLatestFrame')(
        client
          .getImageBytes(`${base}/imagearray`, context?.signal)
          .pipe(Effect.map(parseAlpacaImageBytes)),
      ),
  }
}

function command(
  client: AlpacaClient,
  path: string,
  body: Record<string, string | number | boolean>,
  operation: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
  signal?: AbortSignal,
) {
  return alpacaError(operation)(
    Effect.fn(`AlpacaRig.${operation}`)(function* () {
      yield* client.put(path, body, timeoutMs, signal)
    })(),
  )
}

function alpacaError(operation: string) {
  return <A>(effect: Effect.Effect<A, AlpacaError>) =>
    effect.pipe(
      Effect.mapError((cause): RigError => {
        if (cause instanceof AlpacaProtocolError) {
          return new RigProtocolError({
            provider: 'alpaca',
            operation,
            message: cause.message,
          })
        }
        if (cause instanceof AlpacaRejectedError) {
          return new RigRejectedError({
            provider: 'alpaca',
            operation,
            message: cause.message,
          })
        }
        return new RigTransportError({
          provider: 'alpaca',
          operation,
          message: cause.message,
          cause,
        })
      }),
    )
}

function readSnapshot(
  client: AlpacaClient,
  telescope: string,
  camera: string | undefined,
  signal?: AbortSignal,
) {
  return Effect.gen(function* () {
    const parked = yield* client.get(
      `${telescope}/atpark`,
      Schema.Boolean,
      signal,
    )
    const tracking = yield* client.get(
      `${telescope}/tracking`,
      Schema.Boolean,
      signal,
    )
    return {
      mount: { parked, tracking },
      preview: { active: false, source: 'none' as const },
      capture: {
        active: false,
        mode: camera ? ('external' as const) : undefined,
      },
      warnings: [],
    }
  })
}

function readMount(client: AlpacaClient, base: string, signal?: AbortSignal) {
  return Effect.gen(function* () {
    const atPark = yield* client.get(`${base}/atpark`, Schema.Boolean, signal)
    const slewing = yield* client.get(`${base}/slewing`, Schema.Boolean, signal)
    return { atPark, slewing }
  })
}

function pollMount(
  client: AlpacaClient,
  base: string,
  complete: (state: {
    readonly atPark: boolean
    readonly slewing: boolean
  }) => boolean,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  operation: string,
) {
  return poll(
    () => readMount(client, base, signal).pipe(Effect.map(complete)),
    timeoutMs,
    signal,
    operation,
  )
}

function poll(
  read: () => Effect.Effect<boolean, AlpacaError>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  operation: string,
): Effect.Effect<void, AlpacaError> {
  const deadline = Date.now() + timeoutMs
  const loop = (): Effect.Effect<void, AlpacaError> =>
    Effect.gen(function* () {
      if (signal?.aborted) {
        return yield* Effect.fail(
          new AlpacaTransportError({
            operation,
            message: 'Operation aborted',
            cause: signal.reason,
          }),
        )
      }
      if (Date.now() >= deadline) {
        return yield* Effect.fail(
          new AlpacaRejectedError({
            operation,
            message: `Polling did not converge within ${timeoutMs}ms`,
          }),
        )
      }
      if (yield* read()) return
      yield* Effect.sleep(MOUNT_POLL_INTERVAL_MS)
      return yield* loop()
    })
  return loop()
}

function optional<A>(
  effect: Effect.Effect<A, AlpacaError>,
): Effect.Effect<A | undefined, AlpacaTransportError | AlpacaProtocolError>
function optional<A>(
  effect: Effect.Effect<A, AlpacaError>,
  fallback: A,
): Effect.Effect<A, AlpacaTransportError | AlpacaProtocolError>
function optional<A>(
  effect: Effect.Effect<A, AlpacaError>,
  fallback?: A,
): Effect.Effect<A | undefined, AlpacaTransportError | AlpacaProtocolError> {
  return effect.pipe(
    Effect.catchTag('AlpacaRejectedError', () => Effect.succeed(fallback)),
  )
}
