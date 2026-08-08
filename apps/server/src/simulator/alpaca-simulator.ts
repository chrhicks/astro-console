import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fitsToAlpacaImageBytes } from './alpaca-imagebytes.ts'

export const alpacaSimulationScenarios = [
  'ready-rig',
  'optional-device-unavailable',
  'exposure-success',
  'abort-exposure',
  'provider-error',
  'reconciliation-failure',
  'retrieval-failure',
  'retrieval-oversize',
  'restart-no-replay',
  'target-evidence-progression',
  'solve-success-no-solution',
  'focus-quality-degradation',
] as const

export type AlpacaSimulationScenario =
  (typeof alpacaSimulationScenarios)[number]

type CameraPhase = 'idle' | 'exposing' | 'reading'

export type AlpacaScenarioFrame = {
  readonly id: string
  readonly filename: string
  readonly purpose:
    'exposure-success' | 'target-observation' | 'solve-input' | 'focus-quality'
  readonly targetStage?: 'initial' | 'later-observation'
  readonly solveInput?: 'expected-success' | 'expected-no-solution'
  readonly quality?: {
    readonly source: 'ngc7000-frame-quality.csv'
    readonly stars: number
    readonly fwhmPx: number
    readonly roundness: number
    readonly dxPx: number
    readonly dyPx: number
    readonly focusThreshold: 'severely-breached'
    readonly trend:
      'baseline-severe-focus' | 'roundness-degraded-focus-still-severe'
  }
}

type SimulatorState = {
  scenario: AlpacaSimulationScenario
  nowMs: number
  generation: number
  cameraPhase: CameraPhase
  exposureStartedAtMs: number | null
  exposureDurationMs: number
  imageReady: boolean
  frameCursor: number
  lastFrame: AlpacaScenarioFrame | null
  serverTransactionId: number
  commandLog: Array<{
    readonly name: 'startExposure' | 'abortExposure'
    readonly generation: number
    readonly atMs: number
  }>
}

export type AlpacaSimulatorOptions = {
  readonly corpusRoot: string
  readonly frameFilename?: string
  readonly initialScenario?: AlpacaSimulationScenario
  readonly autoAdvanceMsPerRequest?: number
}

export function createAlpacaSimulator(options: AlpacaSimulatorOptions) {
  const frameFilename = options.frameFilename ?? 'm101-good-light.fits'
  const autoAdvanceMsPerRequest = options.autoAdvanceMsPerRequest ?? 0
  const fitsFrames = new Map<string, Promise<Uint8Array>>()
  const state: SimulatorState = {
    scenario: options.initialScenario ?? 'ready-rig',
    nowMs: 0,
    generation: 1,
    cameraPhase: 'idle',
    exposureStartedAtMs: null,
    exposureDurationMs: 0,
    imageReady: false,
    frameCursor: 0,
    lastFrame: null,
    serverTransactionId: 0,
    commandLog: [],
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch((cause: unknown) => {
      if (response.headersSent) {
        response.destroy(cause instanceof Error ? cause : undefined)
        return
      }
      json(response, 500, envelope(undefined, 1280, errorMessage(cause), state))
    })
  })

  return {
    state: () => snapshot(state, frameFilename),
    listen: (port = 0, host = '127.0.0.1') =>
      new Promise<{
        readonly origin: string
        readonly port: number
        readonly close: () => Promise<void>
      }>((resolvePromise, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          const address = server.address()
          if (address === null || typeof address === 'string') {
            reject(new Error('The Alpaca simulator did not bind a TCP port.'))
            return
          }
          resolvePromise({
            origin: `http://${host}:${address.port}`,
            port: address.port,
            close: () =>
              new Promise<void>((resolveClose, rejectClose) =>
                server.close((error) =>
                  error === undefined ? resolveClose() : rejectClose(error),
                ),
              ),
          })
        })
      }),
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://alpaca-simulator.local')
    const path = url.pathname.toLowerCase()
    if (!path.startsWith('/__sim/') && autoAdvanceMsPerRequest > 0)
      advance(state, autoAdvanceMsPerRequest)

    if (request.method === 'GET' && path === '/__sim/state') {
      json(response, 200, snapshot(state, frameFilename))
      return
    }
    if (request.method === 'POST' && path === '/__sim/scenario') {
      const body = await jsonBody(request)
      const scenario =
        typeof body === 'object' && body !== null && 'scenario' in body
          ? body.scenario
          : undefined
      if (!isScenario(scenario)) {
        json(response, 400, { error: 'Unknown simulator scenario.' })
        return
      }
      resetScenario(state, scenario)
      json(response, 200, snapshot(state, frameFilename))
      return
    }
    if (request.method === 'POST' && path === '/__sim/advance') {
      const body = await jsonBody(request)
      const milliseconds =
        typeof body === 'object' && body !== null && 'milliseconds' in body
          ? body.milliseconds
          : undefined
      if (
        typeof milliseconds !== 'number' ||
        !Number.isFinite(milliseconds) ||
        milliseconds < 0
      ) {
        json(response, 400, {
          error: 'milliseconds must be a positive number.',
        })
        return
      }
      advance(state, milliseconds)
      json(response, 200, snapshot(state, frameFilename))
      return
    }
    if (request.method === 'POST' && path === '/__sim/restart') {
      restart(state)
      json(response, 200, snapshot(state, frameFilename))
      return
    }

    if (
      request.method === 'GET' &&
      path === '/management/v1/configureddevices'
    ) {
      const devices = configuredDevices.filter(
        (device) =>
          state.scenario !== 'optional-device-unavailable' ||
          device.DeviceType !== 'Focuser',
      )
      json(response, 200, envelope(devices, 0, '', state))
      return
    }

    const deviceRoute = path.match(
      /^\/api\/v1\/(camera|telescope|focuser|filterwheel)\/(\d+)\/([a-z]+)$/,
    )
    if (deviceRoute === null || deviceRoute[2] !== '0') {
      json(
        response,
        404,
        envelope(undefined, 1025, 'Unknown simulated route.', state),
      )
      return
    }
    const type = deviceRoute[1]
    const property = deviceRoute[3]
    if (
      state.scenario === 'optional-device-unavailable' &&
      type === 'focuser'
    ) {
      json(
        response,
        404,
        envelope(undefined, 1025, 'Focuser unavailable.', state),
      )
      return
    }

    if (type === 'camera' && request.method === 'PUT') {
      if (property === 'startexposure') {
        await startExposure(request, response)
        return
      }
      if (property === 'abortexposure') {
        abortExposure(response)
        return
      }
    }
    if (request.method !== 'GET') {
      json(
        response,
        405,
        envelope(undefined, 1025, 'Method not allowed.', state),
      )
      return
    }

    if (type === 'camera' && property === 'camerastate') {
      if (
        state.scenario === 'reconciliation-failure' &&
        state.commandLog.some((entry) => entry.name === 'startExposure')
      ) {
        json(
          response,
          200,
          envelope(
            undefined,
            1026,
            'Camera state reconciliation failed.',
            state,
          ),
        )
        return
      }
      updateCameraPhase(state)
      json(
        response,
        200,
        envelope(cameraStateNumber(state.cameraPhase), 0, '', state),
      )
      return
    }
    if (type === 'camera' && property === 'imagearray') {
      await imageArray(request, response)
      return
    }

    const value = readOnlyValue(type, property)
    if (value === undefined) {
      json(
        response,
        404,
        envelope(undefined, 1025, 'Unknown simulated property.', state),
      )
      return
    }
    json(response, 200, envelope(value, 0, '', state))
  }

  async function startExposure(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (state.scenario === 'provider-error') {
      json(
        response,
        200,
        envelope(undefined, 1025, 'Simulated camera provider error.', state),
      )
      return
    }
    updateCameraPhase(state)
    if (state.cameraPhase !== 'idle') {
      json(response, 200, envelope(undefined, 1026, 'Camera is busy.', state))
      return
    }
    const body = new URLSearchParams(await textBody(request))
    const durationSeconds = Number(body.get('Duration'))
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      json(
        response,
        200,
        envelope(undefined, 1025, 'Duration must be positive.', state),
      )
      return
    }
    state.cameraPhase = 'exposing'
    state.exposureStartedAtMs = state.nowMs
    state.exposureDurationMs = durationSeconds * 1000
    state.imageReady = false
    state.commandLog.push({
      name: 'startExposure',
      generation: state.generation,
      atMs: state.nowMs,
    })
    json(response, 200, envelope(undefined, 0, '', state))
  }

  function abortExposure(response: ServerResponse) {
    updateCameraPhase(state)
    if (state.cameraPhase === 'idle') {
      json(
        response,
        200,
        envelope(undefined, 1026, 'No exposure is active.', state),
      )
      return
    }
    state.commandLog.push({
      name: 'abortExposure',
      generation: state.generation,
      atMs: state.nowMs,
    })
    clearExposure(state)
    json(response, 200, envelope(undefined, 0, '', state))
  }

  async function imageArray(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (state.scenario === 'retrieval-failure') {
      json(
        response,
        503,
        envelope(undefined, 1280, 'Simulated image retrieval failure.', state),
      )
      return
    }
    if (state.scenario === 'retrieval-oversize') {
      response.writeHead(200, {
        'content-type': 'application/imagebytes',
        'content-length': String(64 * 1024 * 1024 + 1),
      })
      response.end()
      return
    }
    updateCameraPhase(state)
    if (!state.imageReady) {
      json(
        response,
        200,
        envelope(undefined, 1026, 'No image is ready.', state),
      )
      return
    }
    if (
      !request.headers.accept?.toLowerCase().includes('application/imagebytes')
    ) {
      json(
        response,
        406,
        envelope(undefined, 1025, 'This simulator requires ImageBytes.', state),
      )
      return
    }
    const frame = nextScenarioFrame(state, frameFilename)
    if (frame === undefined) {
      json(
        response,
        200,
        envelope(
          undefined,
          1026,
          'Scenario frame sequence is exhausted.',
          state,
        ),
      )
      return
    }
    let fitsFrame = fitsFrames.get(frame.filename)
    if (fitsFrame === undefined) {
      fitsFrame = readFile(join(options.corpusRoot, frame.filename)).then(
        (value) =>
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      )
      fitsFrames.set(frame.filename, fitsFrame)
    }
    const encoded = fitsToAlpacaImageBytes(await fitsFrame, {
      clientTransactionId: clientTransactionId(
        new URL(request.url ?? '/', 'http://local'),
      ),
      serverTransactionId: nextServerTransactionId(state),
    })
    response.writeHead(200, {
      'content-type': 'application/imagebytes',
      'content-length': String(encoded.bytes.byteLength),
      'x-simulator-source': frame.filename,
    })
    state.lastFrame = frame
    state.frameCursor += 1
    state.imageReady = false
    response.end(encoded.bytes)
  }
}

const configuredDevices = [
  {
    DeviceName: 'ASI2600MC Pro (simulated)',
    DeviceNumber: 0,
    DeviceType: 'Camera',
    UniqueID: 'sim-camera-asi2600mc-pro',
  },
  {
    DeviceName: 'AM5N (simulated)',
    DeviceNumber: 0,
    DeviceType: 'Telescope',
    UniqueID: 'sim-telescope-am5n',
  },
  {
    DeviceName: 'EAFN (simulated)',
    DeviceNumber: 0,
    DeviceType: 'Focuser',
    UniqueID: 'sim-focuser-eafn',
  },
  {
    DeviceName: 'Filter wheel (simulated)',
    DeviceNumber: 0,
    DeviceType: 'FilterWheel',
    UniqueID: 'sim-filterwheel-0',
  },
] as const

function readOnlyValue(type: string | undefined, property: string | undefined) {
  const values: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    camera: {
      connected: true,
      name: 'ASI2600MC Pro (simulated)',
      canabortexposure: true,
      canstopexposure: false,
    },
    telescope: {
      connected: true,
      name: 'AM5N (simulated)',
      atpark: false,
      slewing: false,
      canpark: true,
    },
    focuser: {
      connected: true,
      name: 'EAFN (simulated)',
      ismoving: false,
      absolute: true,
    },
    filterwheel: {
      connected: true,
      name: 'Filter wheel (simulated)',
      position: 0,
    },
  }
  return type === undefined || property === undefined
    ? undefined
    : values[type]?.[property]
}

function envelope(
  value: unknown,
  errorNumber: number,
  error: string,
  state: SimulatorState,
) {
  return {
    Value: value,
    ClientTransactionID: 0,
    ServerTransactionID: nextServerTransactionId(state),
    ErrorNumber: errorNumber,
    ErrorMessage: error,
  }
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  })
  response.end(body)
}

function nextServerTransactionId(state: SimulatorState) {
  state.serverTransactionId += 1
  return state.serverTransactionId
}

function updateCameraPhase(state: SimulatorState) {
  if (state.exposureStartedAtMs === null) return
  const elapsed = state.nowMs - state.exposureStartedAtMs
  if (elapsed < state.exposureDurationMs) {
    state.cameraPhase = 'exposing'
    return
  }
  if (elapsed < state.exposureDurationMs + 1000) {
    state.cameraPhase = 'reading'
    return
  }
  state.cameraPhase = 'idle'
  state.exposureStartedAtMs = null
  state.imageReady = true
}

function advance(state: SimulatorState, milliseconds: number) {
  state.nowMs += milliseconds
  updateCameraPhase(state)
}

function restart(state: SimulatorState) {
  state.generation += 1
  state.cameraPhase = 'idle'
  state.exposureStartedAtMs = null
  state.exposureDurationMs = 0
  state.imageReady = false
}

function resetScenario(
  state: SimulatorState,
  scenario: AlpacaSimulationScenario,
) {
  state.scenario = scenario
  state.nowMs = 0
  state.generation = 1
  state.serverTransactionId = 0
  state.commandLog = []
  state.frameCursor = 0
  state.lastFrame = null
  clearExposure(state)
}

function clearExposure(state: SimulatorState) {
  state.cameraPhase = 'idle'
  state.exposureStartedAtMs = null
  state.exposureDurationMs = 0
  state.imageReady = false
}

function cameraStateNumber(phase: CameraPhase) {
  return phase === 'idle' ? 0 : phase === 'exposing' ? 2 : 3
}

function isScenario(value: unknown): value is AlpacaSimulationScenario {
  return alpacaSimulationScenarios.some((scenario) => scenario === value)
}

function snapshot(
  state: SimulatorState,
  frameFilename = 'm101-good-light.fits',
) {
  updateCameraPhase(state)
  const sequence = scenarioFrames(state.scenario, frameFilename)
  return {
    scenario: state.scenario,
    nowMs: state.nowMs,
    generation: state.generation,
    cameraPhase: state.cameraPhase,
    imageReady: state.imageReady,
    evidence: {
      sequenceLength: sequence.length,
      framesServed: state.frameCursor,
      sequence,
      lastFrame: state.lastFrame,
      nextFrame: sequence[state.frameCursor] ?? null,
    },
    serverTransactionId: state.serverTransactionId,
    commandLog: [...state.commandLog],
  }
}

function nextScenarioFrame(state: SimulatorState, frameFilename: string) {
  return scenarioFrames(state.scenario, frameFilename)[state.frameCursor]
}

function scenarioFrames(
  scenario: AlpacaSimulationScenario,
  frameFilename: string,
): ReadonlyArray<AlpacaScenarioFrame> {
  if (scenario === 'solve-success-no-solution')
    return [
      {
        id: 'm101-good-light',
        filename: 'm101-good-light.fits',
        purpose: 'solve-input',
        solveInput: 'expected-success',
      },
      {
        id: 'm101-clouded-light',
        filename: 'm101-clouded-light.fits',
        purpose: 'solve-input',
        solveInput: 'expected-no-solution',
      },
    ]
  if (scenario === 'target-evidence-progression')
    return [
      {
        id: 'ngc7000-first-light',
        filename: 'ngc7000-first-light.fits',
        purpose: 'target-observation',
        targetStage: 'initial',
      },
      {
        id: 'ngc7000-dithered-light',
        filename: 'ngc7000-dithered-light.fits',
        purpose: 'target-observation',
        targetStage: 'later-observation',
      },
    ]
  if (scenario === 'focus-quality-degradation')
    return [
      {
        id: 'ngc7000-first-light',
        filename: 'ngc7000-first-light.fits',
        purpose: 'focus-quality',
        quality: {
          source: 'ngc7000-frame-quality.csv',
          stars: 165,
          fwhmPx: 29.8566,
          roundness: 0.929328,
          dxPx: 0,
          dyPx: 0,
          focusThreshold: 'severely-breached',
          trend: 'baseline-severe-focus',
        },
      },
      {
        id: 'ngc7000-dithered-light',
        filename: 'ngc7000-dithered-light.fits',
        purpose: 'focus-quality',
        quality: {
          source: 'ngc7000-frame-quality.csv',
          stars: 160,
          fwhmPx: 29.042,
          roundness: 0.913864,
          dxPx: -10.15,
          dyPx: -22.77,
          focusThreshold: 'severely-breached',
          trend: 'roundness-degraded-focus-still-severe',
        },
      },
    ]
  return [
    {
      id: 'default-exposure-frame',
      filename: frameFilename,
      purpose: 'exposure-success',
    },
  ]
}

function clientTransactionId(url: URL) {
  for (const [key, value] of url.searchParams)
    if (key.toLowerCase() === 'clienttransactionid') {
      const parsed = Number(value)
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
    }
  return 0
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const body = await textBody(request)
  return body.length === 0 ? {} : JSON.parse(body)
}

async function textBody(request: IncomingMessage) {
  const chunks: Array<Buffer> = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > 64 * 1024)
      throw new Error('Simulator request body is too large.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Unknown simulator failure.'
}
