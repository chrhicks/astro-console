import type { LogLevel } from '../logging.js'
import {
  DEFAULT_HOST,
  asLogLevel,
  asNumber,
  asString,
  openLiveDevice,
  parseArgs,
  readSnapshot,
  resetDeviceState,
  startHeartbeat,
  toErrorMessage,
} from './live-session.js'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }

  const logLevel = asLogLevel(asString(args.logLevel) ?? 'info')
  if (!logLevel) {
    console.error(`Invalid --log-level: ${String(args.logLevel)}`)
    process.exit(1)
  }

  const timeoutMs = asNumber(asString(args.timeoutMs))
  if (args.timeoutMs !== undefined && timeoutMs === undefined) {
    console.error(`Invalid --timeout-ms: ${String(args.timeoutMs)}`)
    process.exit(1)
  }

  const json = args.json === true
  const device = await openLiveDevice({
    host: asString(args.host),
    pemPath: asString(args.pemPath),
    timeoutMs,
    logLevel,
  })
  const stopHeartbeat = startHeartbeat(device)

  try {
    const before = await readSnapshot(device)
    const reset = await resetDeviceState(device)
    const after = await readSnapshot(device)
    const report = { before, reset, after }

    if (json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('Baseline reset completed.')
      console.log(`- stop view: ${reset.stopView}`)
      console.log(`- park: ${reset.park}`)
      console.log(`- before mount: ${JSON.stringify(before.mount)}`)
      console.log(`- after mount: ${JSON.stringify(after.mount)}`)
      console.log(`- after view: ${JSON.stringify(after.view)}`)
      console.log(`- after equ: ${JSON.stringify(after.equ)}`)
    }
  } finally {
    stopHeartbeat()
    await resetDeviceState(device)
    device.disconnect()
  }
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/baseline-reset.js [options]

Options:
  --host <host>              Device host or mDNS name (default: ${DEFAULT_HOST})
  --pem-path <path>          PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --timeout-ms <n>           Base SDK RPC timeout in ms
  --log-level <level>        trace | debug | info | warn | error (default: info)
  --json                     Print full JSON report
  --help                     Show this help

This script stops any active view, parks the arm, reports the before/after state,
then repeats the reset in finally before disconnecting.
`)
}

void main().catch((error) => {
  console.error(toErrorMessage(error))
  process.exit(1)
})
