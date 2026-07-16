import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Schema } from 'effect'
import { resolveSeestarPemPath } from '../config.js'
import { SeestarDevice } from '../device.js'
import { createConsoleLogger, type LogLevel } from '../logging.js'
import type { DeviceState, HorizCoord } from '../types.js'

const DEFAULT_HOST = process.env.SEESTAR_HOST
const DEFAULT_TIMEOUT_MS = 15000
const DEFAULT_OUTPUT_DIR = 'horizon-scan'
const DEFAULT_SAMPLE_COUNT = 12
const DEFAULT_SPEED = 5
const DEFAULT_DURATION_SEC = 3
const DEFAULT_SETTLE_MS = 1500
const DEFAULT_FRAME_TIMEOUT_MS = 10000
const DEFAULT_LOG_LEVEL: LogLevel = 'info'
const DEFAULT_FRAME_PORTS = [4554]

const PositiveInt = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
)
const NonNegativeInt = Schema.Number.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)
const FiniteNumber = Schema.Number.check(Schema.isFinite())

const ScanConfigSchema = Schema.Struct({
  sampleCount: PositiveInt,
  speed: PositiveInt,
  durationSec: PositiveInt,
  settleMs: NonNegativeInt,
  frameTimeoutMs: PositiveInt,
  moveDirectionDeg: FiniteNumber,
  framePorts: Schema.Array(PositiveInt),
})

const PositiveIntFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0)),
)
const NonNegativeIntFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)
const NumberFromString = Schema.NumberFromString.check(Schema.isFinite())

const LogLevelSchema = Schema.Literals([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
])

const CliOptionsSchema = Schema.Struct({
  help: Schema.optional(Schema.Boolean),
  host: Schema.optional(Schema.String),
  pemPath: Schema.optional(Schema.String),
  outputDir: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(PositiveIntFromString),
  logLevel: Schema.optional(LogLevelSchema),
  dryRun: Schema.optional(Schema.Boolean),
  noFrames: Schema.optional(Schema.Boolean),
  noMoveToHorizon: Schema.optional(Schema.Boolean),
  ffmpegPath: Schema.optional(Schema.String),
  sampleCount: Schema.optional(PositiveIntFromString),
  speed: Schema.optional(PositiveIntFromString),
  durationSec: Schema.optional(PositiveIntFromString),
  settleMs: Schema.optional(NonNegativeIntFromString),
  frameTimeoutMs: Schema.optional(PositiveIntFromString),
  moveDirectionDeg: Schema.optional(NumberFromString),
  framePorts: Schema.optional(Schema.String),
})

const HorizCoordSchema = Schema.Struct({
  altitudeDeg: FiniteNumber,
  azimuthDeg: FiniteNumber,
})

const DeviceSnapshotSchema = Schema.Struct({
  productModel: Schema.optional(Schema.String),
  serialNumber: Schema.optional(Schema.String),
  firmwareVersion: Schema.optional(Schema.String),
})

const TelemetrySampleSchema = Schema.Struct({
  index: NonNegativeInt,
  capturedAt: Schema.String,
  horizontal: HorizCoordSchema,
  framePath: Schema.optional(Schema.String),
  frameError: Schema.optional(Schema.String),
  frames: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        port: PositiveInt,
        path: Schema.optional(Schema.String),
        error: Schema.optional(Schema.String),
      }),
    ),
  ),
  compassDirectionDeg: Schema.optional(FiniteNumber),
  balanceAngleDeg: Schema.optional(FiniteNumber),
  mountClosed: Schema.optional(Schema.Boolean),
  raw: Schema.Record(Schema.String, Schema.Unknown),
})

const HorizonScanArtifactSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  createdAt: Schema.String,
  device: DeviceSnapshotSchema,
  scanConfig: ScanConfigSchema,
  scanError: Schema.optional(Schema.String),
  samples: Schema.Array(TelemetrySampleSchema),
})

const CliArgsSchema = Schema.Struct({
  help: Schema.optional(Schema.Boolean),
  host: Schema.optional(Schema.String),
  pemPath: Schema.optional(Schema.String),
  outputDir: Schema.String,
  timeoutMs: PositiveInt,
  logLevel: LogLevelSchema,
  dryRun: Schema.Boolean,
  noFrames: Schema.Boolean,
  noMoveToHorizon: Schema.Boolean,
  ffmpegPath: Schema.String,
  config: ScanConfigSchema,
})

type ScanConfig = Schema.Schema.Type<typeof ScanConfigSchema>
type HorizonScanArtifact = Schema.Schema.Type<typeof HorizonScanArtifactSchema>
type CliArgs = Schema.Schema.Type<typeof CliArgsSchema>

interface TelemetrySample {
  index: number
  capturedAt: string
  horizontal: HorizCoord
  framePath?: string
  frameError?: string
  frames?: Record<
    string,
    {
      port: number
      path?: string
      error?: string
    }
  >
  compassDirectionDeg?: number
  balanceAngleDeg?: number
  mountClosed?: boolean
  raw: Record<string, unknown>
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const host = args.host ?? DEFAULT_HOST
  if (!host) {
    throw new Error('Provide --host <ip-or-hostname> or set SEESTAR_HOST')
  }

  const outputDir = path.resolve(args.outputDir)
  const framesDir = path.join(outputDir, 'frames')
  await mkdir(framesDir, { recursive: true })

  if (!args.noFrames) {
    await assertFfmpeg(args.ffmpegPath)
  }

  const device = new SeestarDevice({
    host,
    pemPath: resolveSeestarPemPath({ explicitPath: args.pemPath }),
    timeoutMs: args.timeoutMs,
    logger: createConsoleLogger(args.logLevel),
  })

  const samples: TelemetrySample[] = []
  let deviceSnapshot: HorizonScanArtifact['device'] = {}
  let scanError: string | undefined

  try {
    await device.connectAndAuth()
    const preflight = await device.preflightCheck()
    deviceSnapshot = {
      productModel: preflight.productModel,
      serialNumber: preflight.serialNumber,
      firmwareVersion: preflight.firmwareVersion,
    }

    if (!args.dryRun) {
      if (!args.noMoveToHorizon) {
        await expectAccepted(
          device.moveToHorizon({ waitForCompletion: true, timeoutMs: 30000 }),
          'Device rejected move-to-horizon request',
        )
      }
      await expectAccepted(
        device.startView('scenery', undefined, {
          waitForCompletion: true,
          timeoutMs: 30000,
        }),
        'Device rejected start-scenery request',
      )
      await delay(3000)
    }

    for (let index = 0; index < args.config.sampleCount; index += 1) {
      const sample = await collectSample({
        device,
        host,
        outputDir,
        framesDir,
        index,
        noFrames: args.noFrames || args.dryRun,
        ffmpegPath: args.ffmpegPath,
        frameTimeoutMs: args.config.frameTimeoutMs,
        framePorts: args.config.framePorts,
      })
      samples.push(sample)
      const frameSummary = summarizeFrames(sample)
      console.log(
        `sample ${index + 1}/${args.config.sampleCount}: alt ${sample.horizontal.altitudeDeg.toFixed(3)} deg, az ${sample.horizontal.azimuthDeg.toFixed(3)} deg${frameSummary}`,
      )

      if (!args.dryRun && index < args.config.sampleCount - 1) {
        await expectAccepted(
          device.manualMove({
            directionDeg: args.config.moveDirectionDeg,
            speed: args.config.speed,
            durationSec: args.config.durationSec,
          }),
          'Device rejected manual move request',
        )
        await delay(args.config.settleMs)
      }
    }
  } catch (error) {
    scanError = toErrorMessage(error)
  } finally {
    if (!args.dryRun) {
      try {
        await device.stopView(undefined, {
          waitForCompletion: true,
          timeoutMs: 15000,
        })
      } catch (error) {
        console.warn(`warning: stop view failed: ${toErrorMessage(error)}`)
      }
      try {
        await device.park({ waitForCompletion: true, timeoutMs: 30000 })
      } catch (error) {
        console.warn(`warning: park failed: ${toErrorMessage(error)}`)
      }
    }
    device.disconnect()
  }

  const artifact: HorizonScanArtifact = Schema.decodeUnknownSync(
    HorizonScanArtifactSchema,
  )({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    device: deviceSnapshot,
    scanConfig: args.config,
    scanError,
    samples,
  })
  const scanPath = path.join(outputDir, 'scan.json')
  await writeFile(scanPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(`wrote ${scanPath}`)
  if (scanError) throw new Error(scanError)
}

async function collectSample(input: {
  device: SeestarDevice
  host: string
  outputDir: string
  framesDir: string
  index: number
  noFrames: boolean
  ffmpegPath: string
  frameTimeoutMs: number
  framePorts: readonly number[]
}): Promise<TelemetrySample> {
  const horizontal = await input.device.getHorizCoord()
  if (!horizontal)
    throw new Error('Device did not return horizontal coordinates')

  const state = (await input.device.getDeviceState()) ?? {}
  const raw = readSampleRaw(state)
  const sample: TelemetrySample = {
    index: input.index,
    capturedAt: new Date().toISOString(),
    horizontal,
    compassDirectionDeg: readNestedNumber(state, [
      'compass_sensor',
      'data',
      'direction',
    ]),
    balanceAngleDeg: readNestedNumber(state, [
      'balance_sensor',
      'data',
      'angle',
    ]),
    mountClosed: readNestedBoolean(state, ['mount', 'close']),
    raw,
  }

  if (!input.noFrames) {
    sample.frames = {}
    for (const port of input.framePorts) {
      const key = cameraKeyForPort(port)
      const fileName = `${String(input.index).padStart(3, '0')}_${key}_az-${formatCoord(horizontal.azimuthDeg)}_alt-${formatCoord(horizontal.altitudeDeg)}.jpg`
      const absoluteFramePath = path.join(input.framesDir, fileName)
      const frame: NonNullable<TelemetrySample['frames']>[string] = { port }
      try {
        await captureRtspFrame({
          host: input.host,
          port,
          outputPath: absoluteFramePath,
          ffmpegPath: input.ffmpegPath,
          timeoutMs: input.frameTimeoutMs,
        })
        frame.path = path.relative(input.outputDir, absoluteFramePath)
      } catch (error) {
        frame.error = toErrorMessage(error)
      }
      sample.frames[key] = frame
    }

    const primaryKey = cameraKeyForPort(input.framePorts[0])
    const primaryFrame = sample.frames[primaryKey]
    if (primaryFrame?.path) {
      sample.framePath = primaryFrame.path
    }
    if (primaryFrame?.error) {
      sample.frameError = primaryFrame.error
    }
  }

  return Schema.decodeUnknownSync(TelemetrySampleSchema)(sample)
}

function captureRtspFrame(input: {
  host: string
  port: number
  outputPath: string
  ffmpegPath: string
  timeoutMs: number
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const rtspUrl = `rtsp://${input.host}:${input.port}/stream`
    const child = spawn(input.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-rtsp_transport',
      'tcp',
      '-fflags',
      'nobuffer',
      '-flags',
      'low_delay',
      '-i',
      rtspUrl,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-y',
      input.outputPath,
    ])
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`ffmpeg timed out after ${input.timeoutMs} ms`))
    }, input.timeoutMs)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          stderr.trim() ||
            `ffmpeg exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}`,
        ),
      )
    })
  })
}

async function assertFfmpeg(ffmpegPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-version'], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${ffmpegPath} -version exited with code ${code}`))
    })
  })
}

function parseArgs(argv: string[]): CliArgs {
  const values: Record<string, unknown> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      values.help = true
      continue
    }
    if (arg === '--dry-run') {
      values.dryRun = true
      continue
    }
    if (arg === '--no-frames') {
      values.noFrames = true
      continue
    }
    if (arg === '--no-move-to-horizon') {
      values.noMoveToHorizon = true
      continue
    }
    if (!arg.startsWith('--')) continue
    if (argv[index + 1] === undefined) {
      throw new Error(`${arg} requires a value`)
    }
    values[toCamelCase(arg.slice(2))] = argv[index + 1]
    index += 1
  }

  const options = Schema.decodeUnknownSync(CliOptionsSchema)(values)
  const config = {
    sampleCount: options.sampleCount ?? DEFAULT_SAMPLE_COUNT,
    speed: options.speed ?? DEFAULT_SPEED,
    durationSec: options.durationSec ?? DEFAULT_DURATION_SEC,
    settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
    frameTimeoutMs: options.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS,
    moveDirectionDeg: options.moveDirectionDeg ?? 0,
    framePorts: parseFramePorts(options.framePorts),
  }

  return Schema.decodeUnknownSync(CliArgsSchema)({
    help: options.help,
    host: options.host,
    pemPath: options.pemPath,
    outputDir: options.outputDir ?? DEFAULT_OUTPUT_DIR,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    logLevel: options.logLevel ?? DEFAULT_LOG_LEVEL,
    dryRun: options.dryRun ?? false,
    noFrames: options.noFrames ?? false,
    noMoveToHorizon: options.noMoveToHorizon ?? false,
    ffmpegPath: options.ffmpegPath ?? 'ffmpeg',
    config: Schema.decodeUnknownSync(ScanConfigSchema)(config),
  })
}

function printHelp(): void {
  console.log(`Usage: npm run map:horizon -- [options]

Telemetry-only Seestar horizon scan. Starts Scenery view, samples horizontal
coordinates, saves one RTSP frame per sample, and writes scan.json.

Options:
  --host <host>                 Seestar host/IP; defaults to SEESTAR_HOST
  --pem-path <path>             PEM key path
  --output-dir <path>           Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --sample-count <n>            Number of samples (default: ${DEFAULT_SAMPLE_COUNT})
  --speed <n>                   Manual move speed tier (default: ${DEFAULT_SPEED})
  --duration-sec <n>            Integer seconds per move (default: ${DEFAULT_DURATION_SEC})
  --settle-ms <n>               Delay after each move (default: ${DEFAULT_SETTLE_MS})
  --move-direction-deg <n>      Manual move direction (default: 0, azimuth positive)
  --frame-timeout-ms <n>        Per-frame ffmpeg timeout (default: ${DEFAULT_FRAME_TIMEOUT_MS})
  --frame-ports <ports>         Comma-separated RTSP ports to capture (default: ${DEFAULT_FRAME_PORTS.join(',')})
  --ffmpeg-path <path>          ffmpeg executable (default: ffmpeg)
  --no-frames                  Record telemetry only, skip RTSP captures
  --no-move-to-horizon         Start the sweep from the current mount position
  --dry-run                    Connect and sample without moving or capturing frames
  --log-level <level>           trace|debug|info|warn|error (default: ${DEFAULT_LOG_LEVEL})
  --timeout-ms <n>              Device RPC timeout (default: ${DEFAULT_TIMEOUT_MS})
`)
}

async function expectAccepted(
  promise: Promise<boolean>,
  message: string,
): Promise<void> {
  if (!(await promise)) throw new Error(message)
}

function readSampleRaw(state: DeviceState): Record<string, unknown> {
  return {
    mount: state.mount,
    balance_sensor: state.balance_sensor,
    compass_sensor: state.compass_sensor,
    focuser: state.focuser,
    setting: state.setting,
    camera: state.camera,
    second_camera: state.second_camera,
  }
}

function parseFramePorts(value: string | undefined): readonly number[] {
  if (!value) return DEFAULT_FRAME_PORTS
  return Schema.decodeUnknownSync(Schema.Array(PositiveIntFromString))(
    value.split(',').map((part) => part.trim()),
  )
}

function cameraKeyForPort(port: number): string {
  if (port === 4554) return 'main'
  if (port === 4555) return 'second'
  return `port${port}`
}

function summarizeFrames(sample: TelemetrySample): string {
  if (!sample.frames) {
    return `${sample.framePath ? `, frame ${sample.framePath}` : ''}${sample.frameError ? `, frame failed: ${sample.frameError}` : ''}`
  }
  const parts = Object.entries(sample.frames).map(([key, frame]) =>
    frame.path
      ? `${key} ${frame.path}`
      : `${key} failed: ${frame.error ?? 'unknown error'}`,
  )
  return parts.length > 0 ? `, frames ${parts.join('; ')}` : ''
}

function readNestedNumber(
  value: unknown,
  pathParts: string[],
): number | undefined {
  const found = readNested(value, pathParts)
  return typeof found === 'number' ? found : undefined
}

function readNestedBoolean(
  value: unknown,
  pathParts: string[],
): boolean | undefined {
  const found = readNested(value, pathParts)
  return typeof found === 'boolean' ? found : undefined
}

function readNested(value: unknown, pathParts: string[]): unknown {
  let current = value
  for (const part of pathParts) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function formatCoord(value: number): string {
  return value.toFixed(3).replace('-', 'm').replace('.', 'p')
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
