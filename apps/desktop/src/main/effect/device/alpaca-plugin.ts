import { Effect, Exit, Ref, Schema } from 'effect'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DeviceProjection,
  LiveSessionHealthState,
} from '../../../shared/api-v2'
import type { DevicePlugin, DeviceSession } from './device-plugin'
import type {
  ConnectedRig,
  RigCamera,
  RigCameraExposureState,
  RigCoordinates,
  RigFocuser,
  RigFilterWheel,
  RigFrameResult,
  RigOperationContext,
  RigPointingInput,
  RigPointingPrepareInput,
  RigSessionRefresh,
} from '../rig/rig-model'
import { EventBus } from '../event/event-bus.js'
import { AlpacaClient } from './alpaca/client.js'
import { parseAlpacaImageBytes } from './alpaca/image-bytes.js'
import {
  discoverAlpacaRigs,
  type DiscoveredAlpacaConfiguration,
} from './alpaca/discovery.js'

const DISCOVERY_TIMEOUT_MS = 3000
// Real hardware can take longer than the 3s probe to acknowledge device commands.
const COMMAND_TIMEOUT_MS = 15000
const MOUNT_POLL_INTERVAL_MS = 1000
const SLEW_TIMEOUT_MS = 120000
const UNPARK_SETTLE_TIMEOUT_MS = 10000

// Initial telescope state read at connect time. Groups the properties that
// populate the device projection and gate mount/pointing capabilities.
interface TelescopeState {
  atPark: boolean | undefined
  canPark: boolean
  canUnpark: boolean
  tracking: boolean | undefined
  siteLatitude: number | undefined
  siteLongitude: number | undefined
  canSlew: boolean
  canSlewAsync: boolean
  driverVersion: string | undefined
  name: string | undefined
}

interface MountState {
  atPark: boolean
  slewing: boolean
}

interface AlpacaDiscoveredRig extends DesktopDiscoveredDeviceV2 {
  port: number
  telescopeDeviceNumber: number
  telescopeUniqueId?: string
  cameraDeviceNumber?: number
  focuserDeviceNumber?: number
  filterWheelDeviceNumber?: number
}

export function createAlpacaPlugin(): DevicePlugin {
  const discoveredRef = Ref.makeUnsafe<Map<string, AlpacaDiscoveredRig>>(
    new Map(),
  )

  const discover = (input: { signal: AbortSignal }) => Effect.gen(function* () {
    const configurations = yield* Effect.tryPromise(() =>
      discoverAlpacaRigs(DISCOVERY_TIMEOUT_MS, input.signal),
    ).pipe(
      Effect.mapError(
        (error) => new Error(`Alpaca discovery failed: ${toErrorMessage(error)}`),
      ),
    )
    const rigs = configurations.map(toDiscoveredRig)
    yield* Ref.set(
      discoveredRef,
      new Map(rigs.map((rig) => [rig.deviceId, rig])),
    )
    return rigs
  })

  return {
    kind: 'alpaca-rig',
    discover: discover({ signal: new AbortController().signal }),
    discoverWithSignal: discover,

    connect: (input: ConnectRequestV2) =>
      Effect.gen(function* () {
        const bus = yield* EventBus

        const target = (yield* Ref.get(discoveredRef)).get(input.deviceId)
        if (!target) {
          return yield* Effect.fail(
            new Error(`Alpaca rig not found for deviceId ${input.deviceId}`),
          )
        }

        const host = target.host
        if (!host) {
          return yield* Effect.fail(
            new Error(
              `Discovered Alpaca target ${target.deviceId} has no host`,
            ),
          )
        }

        const client = new AlpacaClient(host, target.port)
        const base = `/api/v1/telescope/${target.telescopeDeviceNumber}`
        const cameraBase =
          target.cameraDeviceNumber !== undefined
            ? `/api/v1/camera/${target.cameraDeviceNumber}`
            : undefined
        const focuserBase =
          target.focuserDeviceNumber !== undefined
            ? `/api/v1/focuser/${target.focuserDeviceNumber}`
            : undefined
        const filterWheelBase =
          target.filterWheelDeviceNumber !== undefined
            ? `/api/v1/filterwheel/${target.filterWheelDeviceNumber}`
            : undefined

        yield* bus.publish('session.connect.step.started', {
          step: 'device.connect',
          host,
          deviceId: input.deviceId,
        })

        // All bases that need cleanup on failure: the telescope plus every
        // component base. Registered before any network connect so a
        // timeout-after-physical-success is still cleaned up.
        const allBases = [
          base,
          cameraBase,
          focuserBase,
          filterWheelBase,
        ].filter((b): b is string => b !== undefined)
        const componentBases = allBases.filter((b) => b !== base)

        // Use acquireUseRelease so the rollback finalizer is uninterruptible.
        // The acquire is a non-failing no-op (just enters the supervised
        // scope). The use phase performs telescope connectAndReadState,
        // component connects, and session construction. The release
        // disconnects all bases on failure/interruption; on success, ownership
        // transfers to the session's disconnect and the release is a no-op.
        const session = yield* Effect.acquireUseRelease(
          // Acquire: non-failing, just enters the supervised scope
          Effect.void,
          // Use: telescope connect + component connects + session construction
          () =>
            Effect.gen(function* () {
              const state = yield* Effect.tryPromise({
                try: (signal) => connectAndReadState(client, base, signal),
                catch: (error) =>
                  new Error(
                    `Alpaca connect failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })

              yield* Effect.tryPromise({
                try: async (signal) => {
                  for (const b of componentBases) {
                    await ensureDeviceConnected(client, b, signal)
                  }
                },
                catch: (error) =>
                  new Error(
                    `Alpaca component connect failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })

              yield* bus.publish('session.connect.step.succeeded', {
                step: 'device.connect',
                host,
                deviceId: target.deviceId,
              })

              const sessionId = crypto.randomUUID()
              const connectedAt = new Date().toISOString()
              const warnings: string[] = []

              const location =
                state.siteLatitude !== undefined &&
                state.siteLongitude !== undefined
                  ? { lat: state.siteLatitude, lon: state.siteLongitude }
                  : undefined

              const device: DeviceProjection = {
                pluginKind: 'alpaca-rig',
                deviceId: target.deviceId,
                displayName: state.name ?? target.displayName,
                host,
                productModel: target.productModel,
                serialNumber: target.telescopeUniqueId ?? target.serialNumber,
                firmwareVersion: state.driverVersion,
                tracking: state.tracking,
                mountClosed: state.atPark,
                connectedAt,
                location,
                locationSource: 'device',
                warnings,
              }

              const health: LiveSessionHealthState = {
                state: 'healthy',
                lastCheckedAt: connectedAt,
              }

              // Aggregate cleanup: disconnect each component and collect
              // failures instead of swallowing all errors. The session
              // lifecycle (SessionManager clear) still runs even if disconnect
              // throws, so ownership remains safe.
              const disconnect = Effect.tryPromise({
                try: async () => {
                  const errors: string[] = []
                  for (const b of allBases) {
                    try {
                      await client.put(`${b}/connected`, { Connected: false })
                    } catch (error) {
                      errors.push(toErrorMessage(error))
                    }
                  }
                  if (errors.length > 0) {
                    throw new Error(
                      `Alpaca disconnect failed for ${host}: ${errors.join('; ')}`,
                    )
                  }
                },
                catch: (error) =>
                  error instanceof Error
                    ? error
                    : new Error(
                        `Alpaca disconnect failed for ${host}: ${toErrorMessage(error)}`,
                      ),
              })

              const refresh = Effect.tryPromise({
                try: async (): Promise<RigSessionRefresh> => {
                  const atPark = await client.get(`${base}/atpark`, Schema.Boolean)
                  const tracking = await client.get(
                    `${base}/tracking`,
                    Schema.Boolean,
                  )
                  return {
                    device: { tracking, mountClosed: atPark, warnings },
                    preview: {
                      phase: 'none',
                      source: 'none',
                      active: false,
                    },
                    capture: {
                      phase: 'idle',
                      mode: cameraBase ? 'external' : undefined,
                    },
                  }
                },
                catch: (error) =>
                  new Error(
                    `Alpaca refresh failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })

              const mount = buildMount(client, base, state)
              const slewToCoordinates = buildSlewToCoordinates(
                client,
                base,
                state,
              )
              const camera = cameraBase
                ? buildCamera(client, cameraBase)
                : undefined
              const focuser = focuserBase
                ? buildFocuser(client, focuserBase)
                : undefined
              const filterWheel = filterWheelBase
                ? buildFilterWheel(client, filterWheelBase)
                : undefined
              const captureRig = camera
                ? {
                    camera,
                    captureStop: {
                      mode: 'external' as const,
                      stop: camera.stopExposure,
                    },
                  }
                : {}

              const pointing = slewToCoordinates
                ? {
                    prepare: (
                      _input: RigPointingPrepareInput,
                      context?: RigOperationContext,
                    ) =>
                      Effect.tryPromise({
                        try: () =>
                          prepareMountForSlew(client, base, state, context),
                        catch: (error) =>
                          new Error(
                            `Alpaca prepare failed for ${host}: ${toErrorMessage(error)}`,
                          ),
                      }),
                    // Ignore the vendor-specific mode string; Alpaca slew is RA/Dec only.
                    pointToCoordinates: (
                      input: RigPointingInput,
                      context?: RigOperationContext,
                    ) =>
                      slewToCoordinates(
                        {
                          raHours: input.raHours,
                          decDeg: input.decDeg,
                        },
                        context,
                      ),
                  }
                : undefined

              const rig: ConnectedRig = {
                identity: {
                  rigId: target.deviceId,
                  pluginKind: 'alpaca-rig',
                  displayName: device.displayName ?? target.displayName,
                  host,
                  port: target.port,
                },
                observerLocation: location,
                connect: {
                  device,
                  preview: { phase: 'none', source: 'none', active: false },
                  capture: {
                    phase: 'idle',
                    mode: cameraBase ? 'external' : undefined,
                  },
                  library: {
                    scope: 'current_target',
                    assets: [],
                    polling: false,
                  },
                },
                refresh,
                mount,
                pointing,
                ...captureRig,
                focuser,
                filterWheel,
              }

              // Alpaca composes the rig directly from Alpaca client calls,
              // so it does not need the plugin-internal compatibility fields
              // on the session. The connect-time projections and
              // capabilities live on the rig; the public session carries only
              // identifying metadata, health, disconnect, and the rig.
              const session: DeviceSession = {
                sessionId,
                pluginKind: 'alpaca-rig',
                deviceId: target.deviceId,
                rig,
                health,
                disconnect,
              }

              return session
            }),
          // Release: on failure, disconnect all bases. On success, ownership
          // has transferred to the session's disconnect — no rollback. The
          // release must not fail (its error type is never) so it catches
          // cleanup errors internally and logs them rather than swallowing
          // them silently. The primary error from the use phase is preserved
          // by Effect's acquireUseRelease semantics.
          (_acquired, exit) => {
            if (Exit.isSuccess(exit)) return Effect.void
            return Effect.promise(async () => {
              const errors: string[] = []
              for (const b of allBases) {
                try {
                  await client.put(`${b}/connected`, { Connected: false })
                } catch (error) {
                  errors.push(toErrorMessage(error))
                }
              }
              // Log cleanup errors so they are not swallowed silently.
              // The primary error from the use phase is preserved by
              // acquireUseRelease; we cannot augment it from the release.
              if (errors.length > 0) {
                // eslint-disable-next-line no-console
                console.error(
                  `Alpaca cleanup failed for ${host}: ${errors.join('; ')}`,
                )
              }
            }).pipe(Effect.catch(() => Effect.void))
          },
        )

        return session
      }),
  }
}

export function toDiscoveredRig(
  configuration: DiscoveredAlpacaConfiguration,
): AlpacaDiscoveredRig {
  return {
    pluginKind: 'alpaca-rig',
    deviceId: configuration.telescopeUniqueId
      ? `alpaca:telescope:${configuration.telescopeUniqueId}`
      : `alpaca:host:${configuration.host}:${configuration.port}`,
    displayName:
      configuration.telescopeName ||
      configuration.friendlyName ||
      `Alpaca Rig ${configuration.host}`,
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

async function ensureDeviceConnected(
  client: AlpacaClient,
  base: string,
  signal?: AbortSignal,
): Promise<void> {
  const connected = await client.get(
    `${base}/connected`,
    Schema.Boolean,
    signal,
  )
  if (!connected) {
    await client.put(
      `${base}/connected`,
      { Connected: true },
      COMMAND_TIMEOUT_MS,
      signal,
    )
  }
}

async function connectAndReadState(
  client: AlpacaClient,
  base: string,
  signal?: AbortSignal,
): Promise<TelescopeState> {
  await ensureDeviceConnected(client, base, signal)
  const atPark = await client
    .get(`${base}/atpark`, Schema.Boolean, signal)
    .catch(() => undefined)
  const canPark = await client
    .get(`${base}/canpark`, Schema.Boolean, signal)
    .catch(() => false)
  const canUnpark = await client
    .get(`${base}/canunpark`, Schema.Boolean, signal)
  const tracking = await client
    .get(`${base}/tracking`, Schema.Boolean, signal)
    .catch(() => undefined)
  const siteLatitude = await client
    .get(`${base}/sitelatitude`, Schema.Number, signal)
    .catch(() => undefined)
  const siteLongitude = await client
    .get(`${base}/sitelongitude`, Schema.Number, signal)
    .catch(() => undefined)
  const canSlew = await client
    .get(`${base}/canslew`, Schema.Boolean, signal)
    .catch(() => false)
  const canSlewAsync = await client
    .get(`${base}/canslewasync`, Schema.Boolean, signal)
    .catch(() => false)
  const driverVersion = await client
    .get(`${base}/driverversion`, Schema.String, signal)
    .catch(() => undefined)
  const name = await client
    .get(`${base}/name`, Schema.String, signal)
    .catch(() => undefined)
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
  }
}

function buildMount(
  client: AlpacaClient,
  base: string,
  state: TelescopeState,
): ConnectedRig['mount'] | undefined {
  const canSlewAtAll = state.canSlew || state.canSlewAsync
  if (!state.canPark && !state.canUnpark && !canSlewAtAll) return undefined
  return {
    park: state.canPark
      ? (context) =>
          Effect.tryPromise({
            try: async () => {
              const atPark = await client.get(
                `${base}/atpark`,
                Schema.Boolean,
                context?.signal,
              )
              if (atPark) return
              await client.put(
                `${base}/park`,
                {},
                COMMAND_TIMEOUT_MS,
                context?.signal,
              )
              await pollUntil(
                () =>
                  client.get(`${base}/atpark`, Schema.Boolean, context?.signal),
                SLEW_TIMEOUT_MS,
                MOUNT_POLL_INTERVAL_MS,
                context?.signal,
              )
            },
            catch: (error) =>
              new Error(`Alpaca park failed: ${toErrorMessage(error)}`),
          })
      : undefined,
    unpark: state.canUnpark
      ? (context) =>
          Effect.tryPromise({
            try: async () => {
              const atPark = await client.get(
                `${base}/atpark`,
                Schema.Boolean,
                context?.signal,
              )
              if (!atPark) return
              await client.put(
                `${base}/unpark`,
                {},
                COMMAND_TIMEOUT_MS,
                context?.signal,
              )
              await pollUntil(
                async () => {
                  const mountState = await readMountState(client, base, context)
                  return !mountState.atPark && !mountState.slewing
                },
                UNPARK_SETTLE_TIMEOUT_MS,
                MOUNT_POLL_INTERVAL_MS,
                context?.signal,
              )
            },
            catch: (error) =>
              new Error(`Alpaca unpark failed: ${toErrorMessage(error)}`),
          })
      : undefined,
    slewToCoordinates: canSlewAtAll
      ? buildSlewToCoordinates(client, base, state)
      : undefined,
    stopMotion: canSlewAtAll
      ? (context) =>
          Effect.tryPromise({
            try: async () => {
              const mountState = await readMountState(client, base, context)
              if (mountState.atPark) return
              await client.put(
                `${base}/abortslew`,
                {},
                COMMAND_TIMEOUT_MS,
                context?.signal,
              )
            },
            catch: (error) =>
              new Error(`Alpaca stop failed: ${toErrorMessage(error)}`),
          })
      : undefined,
  }
}

function buildSlewToCoordinates(
  client: AlpacaClient,
  base: string,
  state: TelescopeState,
):
  | ((
      input: RigCoordinates,
      context?: RigOperationContext,
    ) => Effect.Effect<void, unknown>)
  | undefined {
  if (!state.canSlew && !state.canSlewAsync) return undefined
  return (input: RigCoordinates, context?: RigOperationContext) =>
    Effect.tryPromise({
      try: async () => {
        await prepareMountForSlew(client, base, state, context)
        if (state.canSlewAsync) {
          await client.put(
            `${base}/slewtocoordinatesasync`,
            { RightAscension: input.raHours, Declination: input.decDeg },
            COMMAND_TIMEOUT_MS,
            context?.signal,
          )
          await pollUntil(
            async () => {
              const mountState = await readMountState(client, base, context)
              return !mountState.atPark && !mountState.slewing
            },
            SLEW_TIMEOUT_MS,
            MOUNT_POLL_INTERVAL_MS,
            context?.signal,
          )
        } else {
          await client.put(
            `${base}/slewtocoordinates`,
            { RightAscension: input.raHours, Declination: input.decDeg },
            COMMAND_TIMEOUT_MS,
            context?.signal,
          )
        }
      },
      catch: (error) =>
        new Error(`Alpaca slew failed: ${toErrorMessage(error)}`),
    })
}

async function prepareMountForSlew(
  client: AlpacaClient,
  base: string,
  state: TelescopeState,
  context?: RigOperationContext,
): Promise<void> {
  const mountState = await readMountState(client, base, context)
  if (mountState.atPark) {
    if (!state.canUnpark) {
      throw new Error('Mount is parked and cannot unpark; no slew was sent.')
    }
    await client.put(`${base}/unpark`, {}, COMMAND_TIMEOUT_MS, context?.signal)
  }
  try {
    await pollUntil(
      async () => {
        const next = await readMountState(client, base, context)
        return !next.atPark && !next.slewing
      },
      UNPARK_SETTLE_TIMEOUT_MS,
      MOUNT_POLL_INTERVAL_MS,
      context?.signal,
    )
  } catch (error) {
    if (context?.signal?.aborted) throw error
    throw new Error(
      mountState.atPark
        ? 'Mount did not settle after unpark; no slew was sent.'
        : 'Mount did not settle before slew; no slew was sent.',
    )
  }
}

async function readMountState(
  client: AlpacaClient,
  base: string,
  context?: RigOperationContext,
): Promise<MountState> {
  const atPark = await client.get(
    `${base}/atpark`,
    Schema.Boolean,
    context?.signal,
  )
  const slewing = await client.get(
    `${base}/slewing`,
    Schema.Boolean,
    context?.signal,
  )
  return { atPark, slewing }
}

function buildCamera(client: AlpacaClient, base: string): RigCamera {
  return {
    startExposure: (input, context) =>
      Effect.tryPromise({
        try: () =>
          client.put(
            `${base}/startexposure`,
            { Duration: input.durationSec, Light: input.light ?? true },
            // Some drivers block startexposure until the exposure completes;
            // allow the full duration plus a command-ack margin.
            input.durationSec * 1000 + COMMAND_TIMEOUT_MS,
            context?.signal,
          ),
        catch: (error) =>
          new Error(
            `Alpaca camera startExposure failed: ${toErrorMessage(error)}`,
          ),
      }),
    startDarkExposure: (input, context) =>
      Effect.tryPromise({
        try: () =>
          client.put(
            `${base}/startexposure`,
            { Duration: input.durationSec, Light: false },
            input.durationSec * 1000 + COMMAND_TIMEOUT_MS,
            context?.signal,
          ),
        catch: (error) =>
          new Error(
            `Alpaca camera startDarkExposure failed: ${toErrorMessage(error)}`,
          ),
      }),
    stopExposure: (context) =>
      Effect.tryPromise({
        try: () =>
          client.put(
            `${base}/stopexposure`,
            {},
            COMMAND_TIMEOUT_MS,
            context?.signal,
          ),
        catch: (error) =>
          new Error(
            `Alpaca camera stopExposure failed: ${toErrorMessage(error)}`,
          ),
      }),
    getExposureState: (context) =>
      Effect.tryPromise({
        try: async (): Promise<RigCameraExposureState> => {
          const state = await client.get(
            `${base}/camerastate`,
            Schema.Number,
            context?.signal,
          )
          const imageReady = await client.get(
            `${base}/imageready`,
            Schema.Boolean,
            context?.signal,
          )
          const lastExposureDurationSec = await client
            .get(
              `${base}/lastexposureduration`,
              Schema.Number,
              context?.signal,
            )
            .catch(() => undefined)
          return mapAlpacaCameraState(
            state,
            imageReady,
            lastExposureDurationSec,
          )
        },
        catch: (error) =>
          new Error(
            `Alpaca camera getExposureState failed: ${toErrorMessage(error)}`,
          ),
      }),
    getLatestFrame: (context) =>
      Effect.tryPromise({
        try: async (): Promise<RigFrameResult> => {
          const data = await client.getImageBytes(
            `${base}/imagearray`,
            context?.signal,
          )
          return parseAlpacaImageBytes(data)
        },
        catch: (error) =>
          new Error(
            `Alpaca camera getLatestFrame failed: ${toErrorMessage(error)}`,
          ),
      }),
  }
}

// Alpaca CameraState enum: 0=idle, 1=waiting, 2=exposing, 3=reading, 4=error.
// `imageready` is the canonical completion signal and takes precedence over
// camerastate: a ready image means the exposure is done regardless of the
// state machine's current position.
function mapAlpacaCameraState(
  state: number,
  imageReady: boolean,
  lastExposureDurationSec?: number,
): RigCameraExposureState {
  if (imageReady) {
    return { state: 'ready', imageReady: true, lastExposureDurationSec }
  }
  switch (state) {
    case 1: // cameraWaiting
    case 2: // cameraExposing
      return { state: 'exposing', imageReady: false, lastExposureDurationSec }
    case 3: // cameraReading
      return { state: 'reading', imageReady: false, lastExposureDurationSec }
    case 4: // cameraError
      return {
        state: 'error',
        imageReady: false,
        lastExposureDurationSec,
        lastError: 'Camera reported error state',
      }
    default: // 0 = cameraIdle or unknown
      return { state: 'idle', imageReady: false, lastExposureDurationSec }
  }
}

// Parses the Alpaca application/imagebytes v1 payload. The header is a
// little-endian int32 sequence: MetadataVersion, ErrorNumber,
// ClientTransactionID, ServerTransactionID, DataStart, ImageElementType,
// TransmissionElementType, Rank, Dimension1 (NumX), Dimension2 (NumY),
// Dimension3 (ColourPlane, rank 3 only). Pixel data starts at DataStart and
// is the ASCOM image array serialised in row-major order, so the last
// declared dimension varies fastest (height for rank 2, colour plane for
// rank 3). Returns a faithful descriptor plus the trimmed pixel subarray
// when the header is understood; otherwise returns an unknown frame so the
// storage layer can fail honestly instead of writing a misleading file.
function buildFocuser(client: AlpacaClient, base: string): RigFocuser {
  return {
    moveTo: (position) =>
      Effect.tryPromise({
        try: () => client.put(`${base}/move`, { Position: position }),
        catch: (error) =>
          new Error(`Alpaca focuser move failed: ${toErrorMessage(error)}`),
      }),
  }
}

function buildFilterWheel(client: AlpacaClient, base: string): RigFilterWheel {
  return {
    setPosition: (position) =>
      Effect.tryPromise({
        try: () => client.put(`${base}/position`, { Position: position }),
        catch: (error) =>
          new Error(
            `Alpaca filter wheel setPosition failed: ${toErrorMessage(error)}`,
          ),
      }),
  }
}

async function pollUntil(
  read: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Operation aborted')
    if (await read()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Polling did not converge within ${timeoutMs}ms`)
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
