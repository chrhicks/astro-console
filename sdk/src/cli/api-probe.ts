import { SeestarAuth } from '../auth.js'
import { SeestarClient } from '../client.js'
import { resolveSeestarPemPath } from '../config.js'
import { discoverSeestars } from '../discovery.js'
import { createConsoleLogger, type LogLevel } from '../logging.js'

const DEFAULT_HOST = process.env.SEESTAR_HOST
const DEFAULT_METHODS = [
  { method: 'test_connection', params: '' },
  { method: 'get_device_state', params: '' },
  { method: 'scope_get_equ_coord', params: '' },
  { method: 'scope_get_horiz_coord', params: '' },
  { method: 'get_view_state', params: '' },
  { method: 'get_setting', params: '' },
  { method: 'pi_get_info', params: '' },
  { method: 'pi_get_time', params: '' },
  { method: 'get_user_location', params: '' },
  { method: 'get_merid_setting', params: '' },
  { method: 'iscope_get_app_state', params: '' },
  { method: 'get_view_plan', params: '' },
  { method: 'get_enabled_plan', params: '' },
  { method: 'list_plan', params: '' },
  { method: 'get_stack_info', params: '' },
  { method: 'get_solve_result', params: '' },
] as const

type ProbeArgs = {
  help?: boolean
  host?: string
  pemPath?: string
  timeoutMs?: number
  logLevel: LogLevel
  json: boolean
  discover: boolean
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const pemPath = resolveSeestarPemPath({ explicitPath: args.pemPath })
  const timeoutMs = args.timeoutMs ?? 10000
  const logger = createConsoleLogger(args.logLevel)
  const discoveredDevices =
    !args.discover || args.host
      ? []
      : await discoverSeestars({ timeoutMs: Math.min(timeoutMs, 5000), logger })
  const host = args.host ?? discoveredDevices[0]?.host ?? DEFAULT_HOST

  if (!host) {
    throw new Error('No Seestar devices discovered on the local network')
  }

  const client = new SeestarClient(host, 4700, timeoutMs, {
    logger,
    traceProtocol: false,
  })
  const auth = new SeestarAuth(client, pemPath, host, logger)

  try {
    await client.connect()
    const authenticated = await auth.authenticate()
    if (!authenticated) {
      throw new Error('Authentication failed')
    }

    const results = [] as Array<{
      method: string
      params: unknown
      ok: boolean
      supported: boolean
      code?: number
      error?: string
      resultPreview?: unknown
    }>

    for (const probe of DEFAULT_METHODS) {
      try {
        const response = await client.sendSync(
          probe.method,
          probe.params,
          timeoutMs,
        )
        results.push({
          method: probe.method,
          params: probe.params,
          ok: response.code === 0,
          supported: response.code !== 103,
          code: response.code,
          error: response.error,
          resultPreview: summarizeResult(response.result),
        })
      } catch (error) {
        results.push({
          method: probe.method,
          params: probe.params,
          ok: false,
          supported: false,
          error: toErrorMessage(error),
        })
      }
    }

    if (args.json) {
      console.log(
        JSON.stringify(
          { host, discoveredDevices, authenticated, results },
          null,
          2,
        ),
      )
      return
    }

    console.log(`API probe completed for ${host}.`)
    if (discoveredDevices.length > 0) {
      console.log(
        `- discovered: ${discoveredDevices.map((device) => device.host).join(', ')}`,
      )
    }
    console.log(`- authenticated: ${authenticated ? 'yes' : 'no'}`)
    for (const result of results) {
      const status = result.supported
        ? result.ok
          ? 'ok'
          : 'error'
        : 'unsupported'
      console.log(
        `- ${result.method}: ${status}${result.code !== undefined ? ` (code ${result.code})` : ''}`,
      )
      if (result.error) {
        console.log(`  error: ${result.error}`)
      }
      if (result.resultPreview !== undefined) {
        console.log(`  result: ${JSON.stringify(result.resultPreview)}`)
      }
    }
  } finally {
    client.disconnect()
  }
}

function parseArgs(argv: string[]): ProbeArgs {
  const out: ProbeArgs = {
    discover: true,
    json: false,
    logLevel: 'info',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg === '--json') {
      out.json = true
      continue
    }
    if (arg === '--no-discover') {
      out.discover = false
      continue
    }
    if (!arg.startsWith('--')) {
      continue
    }

    const key = arg.slice(2)
    const value = argv[index + 1]
    index += 1

    if (key === 'host') {
      out.host = value
      out.discover = false
    }
    if (key === 'pem-path') out.pemPath = value
    if (key === 'timeout-ms') out.timeoutMs = asNumber(value)
    if (key === 'log-level') out.logLevel = asLogLevel(value) ?? 'info'
  }

  return out
}

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asLogLevel(value: string | undefined): LogLevel | undefined {
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

function summarizeResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: value.slice(0, 2),
    }
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return {
      type: 'object',
      keys: Object.keys(record).slice(0, 12),
      sample: sliceObject(record, 6),
    }
  }

  return value
}

function sliceObject(
  record: Record<string, unknown>,
  limit: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).slice(0, limit)) {
    out[key] = record[key]
  }
  return out
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/api-probe.js [options]

Options:
  --host <host>              Device host or mDNS name (skip discovery)
  --pem-path <path>          PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --timeout-ms <n>           RPC timeout in ms (default: 10000)
  --log-level <level>        trace | debug | info | warn | error (default: info)
  --no-discover              Require --host instead of running UDP discovery
  --json                     Print full JSON report
  --help                     Show this help

This probe discovers the current device IP by default and only sends read-only or inspection-style RPCs.
`)
}

void main().catch((error) => {
  console.error(toErrorMessage(error))
  process.exit(1)
})
