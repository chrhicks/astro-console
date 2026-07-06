import { resolveSeestarPemPath } from '../config.js'
import { SeestarDevice } from '../device.js'
import { createConsoleLogger, type LogLevel } from '../logging.js'
import type { DeviceState, EquCoord, ViewStateResult } from '../types.js'

export const DEFAULT_HOST = process.env.SEESTAR_HOST ?? '192.168.4.29'

export type CliArgs = Record<string, string | boolean | undefined>

export type LiveSessionOptions = {
  host?: string
  pemPath?: string
  timeoutMs?: number
  logLevel: LogLevel
}

export type DeviceSnapshot = {
  mount?: unknown
  equ?: EquCoord | null
  view?: Record<string, unknown>
}

export async function openLiveDevice(
  options: LiveSessionOptions,
): Promise<SeestarDevice> {
  const device = new SeestarDevice({
    host: options.host ?? DEFAULT_HOST,
    pemPath: resolveSeestarPemPath({ explicitPath: options.pemPath }),
    timeoutMs: options.timeoutMs,
    logger: createConsoleLogger(options.logLevel),
  })

  await device.connect()
  const authenticated = await device.authenticate()
  if (!authenticated) {
    device.disconnect()
    throw new Error('Authentication failed')
  }

  return device
}

export function startHeartbeat(
  device: SeestarDevice,
  intervalMs = 3000,
): () => void {
  let running = false
  const handle = setInterval(() => {
    void tick()
  }, intervalMs)

  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      try {
        await device.testConnection()
        return
      } catch {
        await device.connectAndAuth()
      }
    } catch {
      return
    } finally {
      running = false
    }
  }

  return () => {
    clearInterval(handle)
  }
}

export async function resetDeviceState(device: SeestarDevice): Promise<{
  stopView: string
  park: string
}> {
  const stopView = await attempt('stopped', async () => {
    const ok = await device.stopView(undefined, {
      waitForCompletion: true,
      timeoutMs: 30000,
      pollIntervalMs: 500,
    })
    if (!ok) throw new Error('Device rejected stop-view request')
  })

  const park = await attempt('parked', async () => {
    const ok = await device.park({
      waitForCompletion: true,
      timeoutMs: 60000,
      pollIntervalMs: 500,
    })
    if (!ok) throw new Error('Device rejected park request')
  })

  return { stopView, park }
}

export async function readSnapshot(device: SeestarDevice): Promise<DeviceSnapshot> {
  const [deviceState, equ, viewState] = await Promise.all([
    device.getDeviceState(['mount']),
    device.getEquCoord(),
    device.getViewState(),
  ])

  return {
    mount: readMount(deviceState),
    equ,
    view: readView(viewState),
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg === '--json') {
      out.json = true
      continue
    }
    if (!arg.startsWith('--')) continue
    out[toCamelCase(arg.slice(2))] = argv[i + 1]
    i += 1
  }
  return out
}

export function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function asLogLevel(value: string | undefined): LogLevel | undefined {
  if (!value) return undefined
  if (
    value === 'trace' ||
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error'
  ) {
    return value
  }
  return undefined
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

async function attempt(
  success: string,
  run: () => Promise<void>,
): Promise<string> {
  try {
    await run()
    return success
  } catch (error) {
    return `failed: ${toErrorMessage(error)}`
  }
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function readMount(deviceState: DeviceState | null): unknown {
  if (!deviceState || typeof deviceState.mount !== 'object' || deviceState.mount === null) {
    return undefined
  }
  return deviceState.mount
}

function readView(viewState: ViewStateResult | null): Record<string, unknown> | undefined {
  if (!viewState?.View || typeof viewState.View !== 'object') return undefined
  return viewState.View
}
