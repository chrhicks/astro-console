import type { SeestarPushEvent } from '../types.js'
import type { DeviceSnapshot } from './live-session.js'
import {
  DEFAULT_HOST,
  asLogLevel,
  asNumber,
  asString,
  openLiveDevice,
  parseArgs,
  readSnapshot,
  resetDeviceState,
  sleep,
  startHeartbeat,
  toErrorMessage,
} from './live-session.js'

type ContextSyncDiagnostic = {
  timeSynced: boolean
  locationSynced: boolean
  location?: { lat: number; lon: number }
  error?: string
}

type DetailedStateSnapshot = {
  deviceState: unknown
  equ: unknown
  viewState: unknown
  appState: unknown
  setting: unknown
  userLocation: unknown
  deviceTime: unknown
}

type GotoDiagnostic = {
  observed: boolean
  completed?: boolean
  event?: SeestarPushEvent
  error?: string
  stateAtEvent?: DetailedStateSnapshot
}

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

  const targetRa = asNumber(asString(args.targetRa))
  const targetDec = asNumber(asString(args.targetDec))
  if (targetRa === undefined || targetDec === undefined) {
    console.error('Both --target-ra and --target-dec are required')
    process.exit(1)
  }

  const observeMs = asNumber(asString(args.observeMs)) ?? 15000
  const targetName = asString(args.targetName) ?? 'validation-target'
  const json = args.json === true
  const device = await openLiveDevice({
    host: asString(args.host),
    pemPath: asString(args.pemPath),
    timeoutMs,
    logLevel,
  })
  const stopHeartbeat = startHeartbeat(device)

  try {
    const resetBefore = await resetDeviceState(device)
    const parkedBaseline = await readSnapshot(device)
    const parkedDetailedState = await readDetailedState(device)

    const contextSync = await syncContext(device)
    const openArm = await device.moveToHorizon({
      waitForCompletion: true,
      timeoutMs: 60000,
      pollIntervalMs: 500,
    })
    const preparedBaseline = await readSnapshot(device)
    const preparedDetailedState = await readDetailedState(device)

    const gotoDiagnosticPromise = observeGotoEvent(device, observeMs)
    const commandAccepted = await device.startViewDetailed({
      mode: 'star',
      targetName,
      targetRaDec: [targetRa, targetDec],
    })
    const postCommandDetailedState = await readDetailedState(device)
    const samples = await observe(device, observeMs)
    const gotoDiagnostic = await gotoDiagnosticPromise

    const report = {
      target: { name: targetName, ra: targetRa, dec: targetDec },
      resetBefore,
      contextSync,
      openArm,
      parkedBaseline,
      parkedDetailedState,
      preparedBaseline,
      preparedDetailedState,
      commandAccepted,
      postCommandDetailedState,
      gotoDiagnostic,
      samples,
      movementObserved: hasMeaningfulMotion(preparedBaseline, samples),
    }

    if (json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    console.log('Slew check completed.')
    console.log(`- open arm accepted: ${report.openArm}`)
    console.log(`- time synced: ${report.contextSync.timeSynced}`)
    console.log(`- location synced: ${report.contextSync.locationSynced}`)
    if (report.contextSync.error) {
      console.log(`- context sync error: ${report.contextSync.error}`)
    }
    console.log(`- target command accepted: ${report.commandAccepted}`)
    console.log(`- goto event observed: ${report.gotoDiagnostic.observed}`)
    if (typeof report.gotoDiagnostic.completed === 'boolean') {
      console.log(`- goto event completed: ${report.gotoDiagnostic.completed}`)
    }
    if (report.gotoDiagnostic.error) {
      console.log(`- goto event error: ${report.gotoDiagnostic.error}`)
    }
    console.log(`- movement observed: ${report.movementObserved}`)
    console.log(`- samples: ${report.samples.length}`)
    const last = report.samples.at(-1)
    if (last) {
      console.log(`- last equ: ${JSON.stringify(last.snapshot.equ)}`)
      console.log(`- last mount: ${JSON.stringify(last.snapshot.mount)}`)
      console.log(`- last view: ${JSON.stringify(last.snapshot.view)}`)
    }
  } finally {
    stopHeartbeat()
    await resetDeviceState(device)
    device.disconnect()
  }
}

async function syncContext(
  device: Awaited<ReturnType<typeof openLiveDevice>>,
): Promise<ContextSyncDiagnostic> {
  const diagnostic: ContextSyncDiagnostic = {
    timeSynced: false,
    locationSynced: false,
  }

  try {
    diagnostic.timeSynced = await device.setTime()

    const locationResponse = await device.rawClient.sendSync('get_user_location', '')
    const location = readLocationFromResult(locationResponse.result)
    if (!location) {
      return {
        ...diagnostic,
        error: 'Could not read current device location for sync',
      }
    }

    diagnostic.location = location
    diagnostic.locationSynced = await device.setUserLocation(
      location.lat,
      location.lon,
    )
    return diagnostic
  } catch (error) {
    return {
      ...diagnostic,
      error: toErrorMessage(error),
    }
  }
}

async function observeGotoEvent(
  device: Awaited<ReturnType<typeof openLiveDevice>>,
  timeoutMs: number,
): Promise<GotoDiagnostic> {
  try {
    const event = await device.rawClient.waitForPushEvent(
      (pushEvent) =>
        (pushEvent.Event === 'AutoGoto' || pushEvent.Event === 'ScopeGoto') &&
        (pushEvent.state === 'complete' || pushEvent.state === 'fail'),
      { timeoutMs },
    )

    return {
      observed: true,
      completed: event.state === 'complete',
      event,
      error: event.state === 'complete' ? undefined : toErrorMessage(event.error),
      stateAtEvent: await readDetailedState(device),
    }
  } catch (error) {
    return {
      observed: false,
      error: toErrorMessage(error),
    }
  }
}

async function observe(
  device: Awaited<ReturnType<typeof openLiveDevice>>,
  observeMs: number,
): Promise<Array<{ elapsedMs: number; snapshot: DeviceSnapshot }>> {
  const startedAt = Date.now()
  const samples: Array<{ elapsedMs: number; snapshot: DeviceSnapshot }> = []

  while (Date.now() - startedAt < observeMs) {
    samples.push({
      elapsedMs: Date.now() - startedAt,
      snapshot: await readSnapshot(device),
    })
    await sleep(1000)
  }

  return samples
}

function hasMeaningfulMotion(
  start: DeviceSnapshot,
  samples: Array<{ elapsedMs: number; snapshot: DeviceSnapshot }>,
): boolean {
  const startEqu = start.equ
  if (!startEqu) return false
  return samples.some(({ snapshot }) => {
    if (!snapshot.equ) return false
    const raDelta = Math.abs(snapshot.equ.ra - startEqu.ra)
    const wrappedRaDelta = Math.min(raDelta, 24 - raDelta)
    const decDelta = Math.abs(snapshot.equ.dec - startEqu.dec)
    return wrappedRaDelta >= 0.05 || decDelta >= 0.5
  })
}

function readLocationFromResult(
  result: unknown,
): { lat: number; lon: number } | undefined {
  if (!Array.isArray(result) || result.length < 2) return undefined
  const lon = typeof result[0] === 'number' ? result[0] : Number(result[0])
  const lat = typeof result[1] === 'number' ? result[1] : Number(result[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  return { lat, lon }
}

async function readDetailedState(
  device: Awaited<ReturnType<typeof openLiveDevice>>,
): Promise<DetailedStateSnapshot> {
  const [deviceState, equ, viewState, appState, setting, userLocation, deviceTime] =
    await Promise.all([
      device.getDeviceState(),
      device.getEquCoord(),
      device.getViewState(),
      device.rawClient.sendSync('iscope_get_app_state', ''),
      device.rawClient.sendSync('get_setting', ''),
      device.rawClient.sendSync('get_user_location', ''),
      device.rawClient.sendSync('pi_get_time', ''),
    ])

  return {
    deviceState,
    equ,
    viewState,
    appState: appState.result,
    setting: setting.result,
    userLocation: userLocation.result,
    deviceTime: deviceTime.result,
  }
}

function printHelp(): void {
  console.log(`Usage: node dist/cli/slew-check.js [options]

Options:
  --host <host>              Device host or mDNS name (default: ${DEFAULT_HOST})
  --pem-path <path>          PEM path (overrides $SEESTAR_PEM_PATH/$SEESTAR_PEM)
  --target-ra <hours>        Target RA in hours
  --target-dec <deg>         Target Dec in degrees
  --target-name <name>       Target name label (default: validation-target)
  --observe-ms <n>           Polling window after the command (default: 15000)
  --timeout-ms <n>           Base SDK RPC timeout in ms
  --log-level <level>        trace | debug | info | warn | error (default: info)
  --json                     Print full JSON report
  --help                     Show this help

Sequence:
  1. Reset to a parked baseline.
  2. Sync device time and reapply the current device location.
  3. Open the arm with scope_move_to_horizon and wait for completion.
  4. Start a target-aware star view with target_ra_dec.
  5. Observe goto progress and capture state snapshots.
  6. Reset again in finally before disconnecting.
`)
}

void main().catch((error) => {
  console.error(toErrorMessage(error))
  process.exit(1)
})
