import { resolveSeestarPemPath } from '../config.js'
import { SeestarDevice } from '../device.js'
import { createConsoleLogger } from '../logging.js'
import type { DevelopmentSmokeTestOptions } from '../types.js'
import {
  DEFAULT_HOST,
  asLogLevel,
  asNumber,
  asString,
  parseArgs,
} from './live-session.js'

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    process.exit(0)
  }

  const logLevel = asLogLevel(asString(options.logLevel) ?? 'info')
  if (!logLevel) {
    console.error(`Invalid --log-level: ${String(options.logLevel)}`)
    process.exit(1)
  }

  const mode = asMode(asString(options.mode) ?? 'scenery')
  if (!mode) {
    console.error(`Invalid --mode: ${String(options.mode)}`)
    process.exit(1)
  }

  const openArm = asOpenArm(asString(options.openArm) ?? 'if_needed')
  if (!openArm) {
    console.error(`Invalid --open-arm: ${String(options.openArm)}`)
    process.exit(1)
  }

  const timeoutMs = asNumber(asString(options.timeoutMs))
  if (options.timeoutMs !== undefined && timeoutMs === undefined) {
    console.error(`Invalid --timeout-ms: ${String(options.timeoutMs)}`)
    process.exit(1)
  }

  const parkAtEnd = asBoolean(asString(options.parkAtEnd))
  if (options.parkAtEnd !== undefined && parkAtEnd === undefined) {
    console.error(`Invalid --park-at-end: ${String(options.parkAtEnd)}`)
    process.exit(1)
  }

  const json = options.json === true

  const device = new SeestarDevice({
    host: asString(options.host) ?? DEFAULT_HOST,
    pemPath: resolveSeestarPemPath({ explicitPath: asString(options.pemPath) }),
    timeoutMs,
    logger: createConsoleLogger(logLevel),
  })

  const smokeOptions: DevelopmentSmokeTestOptions = {
    mode,
    openArm,
    parkAtEnd,
  }

  device
    .developmentSmokeTest(smokeOptions)
    .then((report) => {
      if (json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        printReport(report)
      }
      process.exit(report.ok ? 0 : 1)
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
    .finally(() => {
      device.disconnect()
    })
}

function asBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function asMode(
  value: string,
): DevelopmentSmokeTestOptions['mode'] | undefined {
  if (
    value === 'scenery' ||
    value === 'moon' ||
    value === 'sun' ||
    value === 'planet'
  ) {
    return value
  }
  return undefined
}

function asOpenArm(
  value: string,
): DevelopmentSmokeTestOptions['openArm'] | undefined {
  if (value === 'if_needed' || value === 'always' || value === 'never') {
    return value
  }
  return undefined
}

function printReport(report: {
  ok: boolean
  resolvedHost: string
  warnings: string[]
  steps: Array<{
    name: string
    ok: boolean
    summary: string
    skipped?: boolean
    error?: string
  }>
}): void {
  console.log(`Development smoke ${report.ok ? 'passed' : 'failed'}.`)
  console.log(`- host: ${report.resolvedHost}`)
  for (const step of report.steps) {
    const suffix = step.skipped ? ' (skipped)' : ''
    console.log(
      `- ${step.name}: ${step.ok ? 'ok' : 'failed'}${suffix} - ${step.summary}`,
    )
    if (step.error) {
      console.log(`  error: ${step.error}`)
    }
  }
  if (report.warnings.length > 0) {
    console.log('Warnings:')
    for (const warning of report.warnings) {
      console.log(`- ${warning}`)
    }
  }
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/dev-smoke.js [options]

Options:
  --host <host>              Device host or mDNS name (default: ${DEFAULT_HOST})
  --pem-path <path>          PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --mode <mode>              scenery | moon | sun | planet (default: scenery)
  --open-arm <mode>          if_needed | always | never (default: if_needed)
  --park-at-end <bool>       true | false (default: true)
  --timeout-ms <n>           Base SDK RPC timeout in ms
  --log-level <level>        trace | debug | info | warn | error (default: info)
  --json                     Print full JSON report
  --help                     Show this help
`)
}

main()
