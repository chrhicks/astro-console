import * as dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { Effect, Ref, Schema } from 'effect'
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
  RigFramePixelFormat,
  RigFrameResult,
  RigPointingInput,
  RigSessionRefresh,
} from '../rig/rig-model'
import { EventBus } from '../event/event-bus.js'

const DISCOVERY_PORT = 32227
const DISCOVERY_TIMEOUT_MS = 3000
const PROBE_TIMEOUT_MS = 3000
// Real hardware can take longer than the 3s probe to acknowledge device commands.
const COMMAND_TIMEOUT_MS = 15000
const SLEW_POLL_INTERVAL_MS = 500
const SLEW_TIMEOUT_MS = 120000
// Alpaca requires a ClientID on PUT requests; any stable integer is fine.
const ALPACA_CLIENT_ID = 1
// Full-resolution frames can be tens of MB; allow a generous download window.
const IMAGE_FETCH_TIMEOUT_MS = 60000

// Standard Alpaca response envelope for GET responses. Value is typed
// per-endpoint at the call site; ErrorNumber/ErrorMessage are always present
// per the Alpaca spec.
const AlpacaEnvelope = Schema.Struct({
  Value: Schema.Unknown,
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

// Alpaca PUT responses omit Value on success for some drivers (e.g. the
// .63 host). The put path only inspects the error fields, so Value is not
// required here.
const AlpacaPutResponse = Schema.Struct({
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

const AlpacaConfiguredDevice = Schema.Struct({
  DeviceName: Schema.String,
  DeviceType: Schema.String,
  DeviceNumber: Schema.Number,
  UniqueID: Schema.optional(Schema.String),
})

const ConfiguredDevicesResponse = Schema.Struct({
  Value: Schema.Array(AlpacaConfiguredDevice),
  ErrorNumber: Schema.Number,
  ErrorMessage: Schema.optional(Schema.String),
})

const AlpacaDiscoveryResponse = Schema.Struct({
  AlpacaPort: Schema.Number,
  FriendlyName: Schema.optional(Schema.String),
  ProductName: Schema.optional(Schema.String),
})

interface AlpacaDiscoveredHost {
  host: string
  port: number
  friendlyName?: string
  productName?: string
}

// Internal discovered-rig shape: extends the public discovered device with the
// Alpaca port and configured component device numbers needed for connect.
interface AlpacaDiscoveredRig extends DesktopDiscoveredDeviceV2 {
  port: number
  telescopeDeviceNumber: number
  telescopeUniqueId?: string
  cameraDeviceNumber?: number
  cameraUniqueId?: string
  focuserDeviceNumber?: number
  focuserUniqueId?: string
  filterWheelDeviceNumber?: number
  filterWheelUniqueId?: string
}

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

export function createAlpacaPlugin(): DevicePlugin {
  const discoveredRef = Ref.unsafeMake<Map<string, AlpacaDiscoveredRig>>(
    new Map(),
  )

  const discover = Effect.gen(function* () {
    const hosts = yield* Effect.promise(() =>
      discoverAlpacaHosts(DISCOVERY_TIMEOUT_MS),
    )
    const probed = yield* Effect.forEach(
      hosts,
      (host) => Effect.promise(() => probeAlpacaHost(host)),
      { concurrency: 'unbounded' },
    )
    const rigs = probed.filter(
      (rig): rig is AlpacaDiscoveredRig => rig !== null,
    )
    yield* Ref.set(
      discoveredRef,
      new Map(rigs.map((rig) => [rig.deviceId, rig])),
    )
    return rigs
  })

  return {
    kind: 'alpaca-rig',
    discover,

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
        const cameraBase = target.cameraDeviceNumber !== undefined
          ? `/api/v1/camera/${target.cameraDeviceNumber}`
          : undefined
        const focuserBase = target.focuserDeviceNumber !== undefined
          ? `/api/v1/focuser/${target.focuserDeviceNumber}`
          : undefined
        const filterWheelBase = target.filterWheelDeviceNumber !== undefined
          ? `/api/v1/filterwheel/${target.filterWheelDeviceNumber}`
          : undefined

        yield* bus.publish('session.connect.step.started', {
          step: 'device.connect',
          host,
          deviceId: input.deviceId,
        })

        const state = yield* Effect.tryPromise({
          try: () => connectAndReadState(client, base),
          catch: (error) =>
            new Error(
              `Alpaca connect failed for ${host}: ${toErrorMessage(error)}`,
            ),
        })

        // Connect generic component devices present on the host so their
        // command surfaces can issue calls immediately after connect.
        yield* Effect.tryPromise({
          try: () =>
            Promise.all(
              [cameraBase, focuserBase, filterWheelBase]
                .filter((b): b is string => b !== undefined)
                .map((b) => ensureDeviceConnected(client, b)),
            ),
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
        const capabilities = {
          supportsStacking: false,
          supportsLivePreview: false,
          supportsFilterWheel: filterWheelBase !== undefined,
          supportsAutofocus: focuserBase !== undefined,
          supportsStorageAccess: false,
        }
        const warnings: string[] = []

        const location =
          state.siteLatitude !== undefined && state.siteLongitude !== undefined
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

        const disconnect = Effect.promise(() =>
          Promise.all(
            [base, cameraBase, focuserBase, filterWheelBase]
              .filter((b): b is string => b !== undefined)
              .map((b) =>
                client.put(`${b}/connected`, { Connected: false }).catch(() => {}),
              ),
          ).then(() => {}),
        )

        const refresh = Effect.tryPromise({
          try: async (): Promise<RigSessionRefresh> => {
            const [atPark, tracking] = await Promise.all([
              client.get(`${base}/atpark`, Schema.Boolean),
              client.get(`${base}/tracking`, Schema.Boolean),
            ])
            return {
              device: { tracking, mountClosed: atPark, warnings },
              preview: { phase: 'none', source: 'none', active: false },
              capture: { phase: 'idle', mode: cameraBase ? 'external' : undefined },
            }
          },
          catch: (error) =>
            new Error(
              `Alpaca refresh failed for ${host}: ${toErrorMessage(error)}`,
            ),
        })

        const mount = buildMount(client, base, state)
        const slewToCoordinates = buildSlewToCoordinates(client, base, state)
        const camera = cameraBase ? buildCamera(client, cameraBase) : undefined
        const focuser = focuserBase ? buildFocuser(client, focuserBase) : undefined
        const filterWheel = filterWheelBase
          ? buildFilterWheel(client, filterWheelBase)
          : undefined

        const pointing = slewToCoordinates
          ? {
              prepare: () =>
                Effect.tryPromise({
                  try: async () => {
                    // Minimal readiness: unpark if parked so the mount can slew.
                    const atPark = await client.get(
                      `${base}/atpark`,
                      Schema.Boolean,
                    )
                    if (atPark && state.canUnpark) {
                      await client.put(`${base}/unpark`, {})
                    }
                  },
                  catch: (error) =>
                    new Error(
                      `Alpaca prepare failed for ${host}: ${toErrorMessage(error)}`,
                    ),
                }),
              // Ignore the vendor-specific mode string; Alpaca slew is RA/Dec only.
              pointToCoordinates: (input: RigPointingInput) =>
                slewToCoordinates({
                  raHours: input.raHours,
                  decDeg: input.decDeg,
                }),
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
          connection: { disconnect },
          observerLocation: location,
          capabilities,
          connect: {
            device,
            preview: { phase: 'none', source: 'none', active: false },
            capture: { phase: 'idle', mode: cameraBase ? 'external' : undefined },
            library: {
              scope: 'current_target',
              assets: [],
              polling: false,
            },
          },
          refresh,
          mount,
          pointing,
          camera,
          focuser,
          filterWheel,
        }

        // Alpaca composes the rig directly from Alpaca client calls, so it
        // does not need the plugin-internal compatibility fields on the
        // session. The connect-time projections and capabilities live on the
        // rig; the public session carries only identifying metadata, health,
        // disconnect, and the rig.
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
  }
}

// Minimal Alpaca HTTP client: unwraps the standard Value/ErrorNumber envelope
// via Schema and form-encodes PUT bodies. The plugin is the only consumer.
class AlpacaClient {
  private readonly baseUrl: string

  constructor(host: string, port: number) {
    this.baseUrl = `http://${host}:${port}`
  }

  async get<T>(path: string, value: Schema.Schema<T>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`Alpaca GET ${path} failed: HTTP ${res.status}`)
    }
    const body = Schema.decodeUnknownSync(AlpacaEnvelope)(await res.json())
    if (body.ErrorNumber !== 0) {
      throw new Error(
        `Alpaca GET ${path} failed: ${body.ErrorMessage ?? `error ${body.ErrorNumber}`}`,
      )
    }
    return Schema.decodeUnknownSync(value)(body.Value)
  }

  async put(
    path: string,
    body: Record<string, string | number | boolean>,
    timeoutMs: number = COMMAND_TIMEOUT_MS,
  ): Promise<void> {
    const form = new URLSearchParams()
    form.set('ClientID', String(ALPACA_CLIENT_ID))
    for (const [key, value] of Object.entries(body)) {
      form.set(key, String(value))
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) {
      throw new Error(`Alpaca PUT ${path} failed: HTTP ${res.status}`)
    }
    const json = Schema.decodeUnknownSync(AlpacaPutResponse)(await res.json())
    if (json.ErrorNumber !== 0) {
      throw new Error(
        `Alpaca PUT ${path} failed: ${json.ErrorMessage ?? `error ${json.ErrorNumber}`}`,
      )
    }
  }

  // Fetches a finished camera frame via the Alpaca ImageBytes transport:
  // GET imagearray with Accept: application/imagebytes. Avoids imagearrayvariant,
  // which is the path associated with full-resolution out-of-memory failures on
  // some ASCOM Remote drivers. Returns the raw binary payload; the caller parses
  // the ImageBytes header.
  async getImageBytes(path: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/imagebytes' },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      throw new Error(`Alpaca GET ${path} failed: HTTP ${res.status}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }
}

async function ensureDeviceConnected(
  client: AlpacaClient,
  base: string,
): Promise<void> {
  const connected = await client.get(`${base}/connected`, Schema.Boolean)
  if (!connected) {
    await client.put(`${base}/connected`, { Connected: true })
  }
}

async function connectAndReadState(
  client: AlpacaClient,
  base: string,
): Promise<TelescopeState> {
  await ensureDeviceConnected(client, base)
  const [
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
  ] = await Promise.all([
    client.get(`${base}/atpark`, Schema.Boolean).catch(() => undefined),
    client.get(`${base}/canpark`, Schema.Boolean).catch(() => false),
    client.get(`${base}/canunpark`, Schema.Boolean).catch(() => false),
    client.get(`${base}/tracking`, Schema.Boolean).catch(() => undefined),
    client.get(`${base}/sitelatitude`, Schema.Number).catch(() => undefined),
    client.get(`${base}/sitelongitude`, Schema.Number).catch(() => undefined),
    client.get(`${base}/canslew`, Schema.Boolean).catch(() => false),
    client.get(`${base}/canslewasync`, Schema.Boolean).catch(() => false),
    client.get(`${base}/driverversion`, Schema.String).catch(() => undefined),
    client.get(`${base}/name`, Schema.String).catch(() => undefined),
  ])
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
  // RigMount requires park; only expose the mount seam when the telescope
  // can park. Slew and stop are added when the telescope supports them.
  if (!state.canPark) return undefined
  const canSlewAtAll = state.canSlew || state.canSlewAsync
  return {
    park: () =>
      Effect.tryPromise({
        try: async () => {
          await client.put(`${base}/park`, {})
          await pollUntil(
            () => client.get(`${base}/atpark`, Schema.Boolean),
            true,
            SLEW_TIMEOUT_MS,
            SLEW_POLL_INTERVAL_MS,
          )
        },
        catch: (error) =>
          new Error(`Alpaca park failed: ${toErrorMessage(error)}`),
      }),
    slewToCoordinates: canSlewAtAll
      ? buildSlewToCoordinates(client, base, state)
      : undefined,
    stopMotion: canSlewAtAll
      ? () =>
          Effect.tryPromise({
            try: () => client.put(`${base}/abortslew`, {}),
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
): ((input: RigCoordinates) => Effect.Effect<void, unknown>) | undefined {
  if (!state.canSlew && !state.canSlewAsync) return undefined
  return (input: RigCoordinates) =>
    Effect.tryPromise({
      try: async () => {
        if (state.canSlewAsync) {
          await client.put(`${base}/slewtocoordinatesasync`, {
            RightAscension: input.raHours,
            Declination: input.decDeg,
          })
          await pollUntil(
            () => client.get(`${base}/slewing`, Schema.Boolean),
            false,
            SLEW_TIMEOUT_MS,
            SLEW_POLL_INTERVAL_MS,
          )
        } else {
          await client.put(`${base}/slewtocoordinates`, {
            RightAscension: input.raHours,
            Declination: input.decDeg,
          })
        }
      },
      catch: (error) =>
        new Error(`Alpaca slew failed: ${toErrorMessage(error)}`),
    })
}

function buildCamera(client: AlpacaClient, base: string): RigCamera {
  return {
    startExposure: (input) =>
      Effect.tryPromise({
        try: () =>
          client.put(
            `${base}/startexposure`,
            { Duration: input.durationSec, Light: true },
            // Some drivers block startexposure until the exposure completes;
            // allow the full duration plus a command-ack margin.
            input.durationSec * 1000 + COMMAND_TIMEOUT_MS,
          ),
        catch: (error) =>
          new Error(
            `Alpaca camera startExposure failed: ${toErrorMessage(error)}`,
          ),
      }),
    stopExposure: () =>
      Effect.tryPromise({
        try: () => client.put(`${base}/stopexposure`, {}),
        catch: (error) =>
          new Error(
            `Alpaca camera stopExposure failed: ${toErrorMessage(error)}`,
          ),
      }),
    getExposureState: () =>
      Effect.tryPromise({
        try: async (): Promise<RigCameraExposureState> => {
          const [state, imageReady, lastExposureDurationSec] =
            await Promise.all([
              client.get(`${base}/camerastate`, Schema.Number),
              client.get(`${base}/imageready`, Schema.Boolean),
              client
                .get(`${base}/lastexposureduration`, Schema.Number)
                .catch(() => undefined),
            ])
          return mapAlpacaCameraState(state, imageReady, lastExposureDurationSec)
        },
        catch: (error) =>
          new Error(
            `Alpaca camera getExposureState failed: ${toErrorMessage(error)}`,
          ),
      }),
    getLatestFrame: () =>
      Effect.tryPromise({
        try: async (): Promise<RigFrameResult> => {
          const data = await client.getImageBytes(`${base}/imagearray`)
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
function parseAlpacaImageBytes(data: Uint8Array): RigFrameResult {
  const capturedAt = new Date().toISOString()
  if (data.length < 44) {
    return unknownImageBytesFrame(data, capturedAt)
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const metadataVersion = view.getInt32(0, true)
  const errorNumber = view.getInt32(4, true)
  const dataStart = view.getInt32(16, true)
  const imageElementType = view.getInt32(20, true)
  const transmissionElementType = view.getInt32(24, true)
  const rank = view.getInt32(28, true)
  const dimension1 = view.getInt32(32, true)
  const dimension2 = view.getInt32(36, true)
  const dimension3 = view.getInt32(40, true)

  if (
    metadataVersion !== 1 ||
    errorNumber !== 0 ||
    (rank !== 2 && rank !== 3) ||
    dimension1 <= 0 ||
    dimension2 <= 0 ||
    (rank === 3 && dimension3 <= 0) ||
    dataStart < 44 ||
    dataStart > data.length
  ) {
    return unknownImageBytesFrame(data, capturedAt)
  }

  const planes = rank === 3 ? dimension3 : 1
  const bytesPerElement = alpacaElementSize(transmissionElementType)
  if (bytesPerElement === 0) {
    return unknownImageBytesFrame(data, capturedAt)
  }
  const pixelBytes = bytesPerElement * dimension1 * dimension2 * planes
  if (dataStart + pixelBytes > data.length) {
    return unknownImageBytesFrame(data, capturedAt)
  }

  return {
    transfer: 'image-bytes',
    width: dimension1,
    height: dimension2,
    pixelFormat: mapAlpacaPixelFormat(transmissionElementType, rank),
    data: data.subarray(dataStart, dataStart + pixelBytes),
    imageBytes: {
      imageElementType,
      transmissionElementType,
      rank,
      planes: rank === 3 ? planes : undefined,
    },
    metadata: { capturedAt },
  }
}

function unknownImageBytesFrame(
  data: Uint8Array,
  capturedAt: string,
): RigFrameResult {
  return {
    transfer: 'image-bytes',
    width: 0,
    height: 0,
    pixelFormat: 'unknown',
    data,
    metadata: { capturedAt },
  }
}

// ASCOM Alpaca ImageBytes element-type codes mapped to byte widths. Returns 0
// for unsupported codes so the parser falls back to an unknown frame.
function alpacaElementSize(elementType: number): number {
  switch (elementType) {
    case 1: return 2 // Int16
    case 2: return 4 // Int32
    case 3: return 8 // Double (Float64)
    case 4: return 4 // Single (Float32)
    case 5: return 8 // UInt64
    case 6: return 1 // Byte
    case 7: return 8 // Int64
    case 8: return 2 // UInt16
    case 9: return 4 // UInt32
    default: return 0
  }
}

function mapAlpacaPixelFormat(
  elementType: number,
  rank: number,
): RigFramePixelFormat {
  switch (elementType) {
    case 1: // Int16
    case 8: // UInt16
      return rank === 3 ? 'rgb48' : 'mono16'
    case 6: // Byte
      return rank === 3 ? 'rgb24' : 'mono8'
    default:
      return 'unknown'
  }
}

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
  expected: boolean,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await read()) === expected) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Polling did not converge within ${timeoutMs}ms`)
}

async function probeAlpacaHost(
  host: AlpacaDiscoveredHost,
): Promise<AlpacaDiscoveredRig | null> {
  try {
    const res = await fetch(
      `http://${host.host}:${host.port}/management/v1/configureddevices`,
      { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const body = Schema.decodeUnknownSync(ConfiguredDevicesResponse)(
      await res.json(),
    )
    if (body.ErrorNumber !== 0) return null
    const telescope = body.Value.find((d) => d.DeviceType === 'Telescope')
    if (!telescope) return null
    const camera = body.Value.find((d) => d.DeviceType === 'Camera')
    const focuser = body.Value.find((d) => d.DeviceType === 'Focuser')
    const filterWheel = body.Value.find((d) => d.DeviceType === 'FilterWheel')
    const deviceId = telescope.UniqueID
      ? `alpaca:telescope:${telescope.UniqueID}`
      : `alpaca:host:${host.host}:${host.port}`
    return {
      pluginKind: 'alpaca-rig',
      deviceId,
      displayName:
        telescope.DeviceName || host.friendlyName || `Alpaca Rig ${host.host}`,
      host: host.host,
      port: host.port,
      telescopeDeviceNumber: telescope.DeviceNumber,
      telescopeUniqueId: telescope.UniqueID || undefined,
      cameraDeviceNumber: camera?.DeviceNumber,
      cameraUniqueId: camera?.UniqueID || undefined,
      focuserDeviceNumber: focuser?.DeviceNumber,
      focuserUniqueId: focuser?.UniqueID || undefined,
      filterWheelDeviceNumber: filterWheel?.DeviceNumber,
      filterWheelUniqueId: filterWheel?.UniqueID || undefined,
      productModel: telescope.DeviceName || host.productName,
      serialNumber: telescope.UniqueID || undefined,
    }
  } catch {
    return null
  }
}

function discoverAlpacaHosts(
  timeoutMs: number,
): Promise<AlpacaDiscoveredHost[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    const hosts = new Map<string, AlpacaDiscoveredHost>()
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      socket.close()
      resolve([...hosts.values()])
    }

    const timer = setTimeout(finish, timeoutMs)
    socket.on('error', () => {
      clearTimeout(timer)
      finish()
    })
    socket.on('message', (msg, rinfo) => {
      try {
        const parsed = Schema.decodeUnknownSync(AlpacaDiscoveryResponse)(
          JSON.parse(msg.toString('utf8')) as unknown,
        )
        const key = `${rinfo.address}:${parsed.AlpacaPort}`
        if (hosts.has(key)) return
        hosts.set(key, {
          host: rinfo.address,
          port: parsed.AlpacaPort,
          friendlyName: parsed.FriendlyName,
          productName: parsed.ProductName,
        })
      } catch {
        // Ignore non-Alpaca or malformed UDP packets.
      }
    })

    socket.bind(() => {
      socket.setBroadcast(true)
      const payload = Buffer.from('alpacadiscovery1')
      for (const target of resolveBroadcastTargets()) {
        socket.send(payload, DISCOVERY_PORT, target, () => {})
      }
    })
  })
}

function resolveBroadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255'])
  for (const entries of Object.values(networkInterfaces())) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      const broadcast = computeBroadcast(entry.address, entry.netmask)
      if (broadcast) targets.add(broadcast)
    }
  }
  return [...targets]
}

function computeBroadcast(address: string, netmask: string): string | null {
  const a = address.split('.').map(Number)
  const m = netmask.split('.').map(Number)
  if (a.length !== 4 || m.length !== 4) return null
  if (a.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
  if (m.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null
  return a.map((octet, i) => (octet & m[i]) | (~m[i] & 255)).join('.')
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
