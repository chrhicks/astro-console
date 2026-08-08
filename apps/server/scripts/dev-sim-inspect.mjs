import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import {
  createDevSimInspectState,
  devSimInspectFixture,
  observeOutputLines,
  parseDevSimInspectArguments,
} from './dev-sim-inspect-config.mjs'
import {
  collectSelectableScenarioSequence,
  verifyScenarioCorpus,
} from './simulation-corpus-verifier.mjs'
import { alpacaSimulationScenarios } from '../src/simulator/alpaca-simulator.ts'

const appRoot = resolve(import.meta.dirname, '..')
const webRoot = resolve(appRoot, '../web')
const { scenario, client, path } = parseDevSimInspectArguments(
  process.argv.slice(2),
)
const { database, originalsRoot, previewRoot, profile } =
  createDevSimInspectState(appRoot, client, scenario)
const corpusRoot = resolve(
  process.env.ASTRO_SIM_CORPUS_OUTPUT_ROOT ??
    resolve(appRoot, '../../.tmp/alpaca-simulation-corpus'),
)
const cdpPort = inspectPort(process.env.ASTRO_INSPECT_CDP_PORT ?? '9223')
const chrome =
  process.env.ASTRO_SERVER_CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome')
const chromeDisplayArgs =
  process.platform === 'linux' && !process.env.DISPLAY ? ['--headless=new'] : []

mkdirSync(originalsRoot, { recursive: true })
mkdirSync(previewRoot, { recursive: true })
mkdirSync(profile, { recursive: true })
await assertPortAvailable(cdpPort)

const children = new Set()
let simulator
let origin
let web
let browser
let stopping = false
let verifyingCorpus = false

const stop = (exitCode) => {
  if (stopping) return
  stopping = true
  clearTimeout(startupTimeout)
  if (exitCode !== undefined) process.exitCode = exitCode
  for (const child of [...children].reverse()) child.kill('SIGTERM')
  const force = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
  }, 1_500)
  force.unref()
}

const startupTimeout = setTimeout(() => {
  process.stderr.write(
    'Simulation inspector startup timed out before the browser was ready.\n',
  )
  stop(1)
}, 30_000)
startupTimeout.unref()

process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))

simulator = startChild(
  'Alpaca simulator',
  process.execPath,
  [
    '--experimental-strip-types',
    './scripts/alpaca-simulator.ts',
    '--port=0',
    `--scenario=${scenario}`,
  ],
  appRoot,
  (text) => {
    const match = text.match(/Alpaca simulator: (http:\/\/127\.0\.0\.1:(\d+))/)
    if (match !== null && !verifyingCorpus) {
      verifyingCorpus = true
      void verifyCorpusAndStartOrigin(match[1], match[2]).catch((cause) => {
        process.stderr.write(
          `Simulation corpus verification failed: ${errorMessage(cause)}\n`,
        )
        stop(1)
      })
    }
  },
  { ASTRO_SIM_CORPUS_OUTPUT_ROOT: corpusRoot },
)

async function verifyCorpusAndStartOrigin(simulatorOrigin, simulatorPort) {
  const sequence = await collectSelectableScenarioSequence({
    simulatorOrigin,
    scenarios: alpacaSimulationScenarios,
    launchScenario: scenario,
  })
  const verified = await verifyScenarioCorpus({ corpusRoot, sequence })
  process.stdout.write(
    `Verified simulation corpus: ${verified.length} files.\n`,
  )
  startOrigin(simulatorOrigin, simulatorPort)
}

function startOrigin(simulatorOrigin, simulatorPort) {
  if (origin !== undefined || stopping) return
  origin = startChild(
    'Astro Console origin',
    process.execPath,
    ['--experimental-strip-types', './src/server.ts'],
    appRoot,
    (text) => {
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (match !== null) startWeb(match[0])
    },
    {
      ASTRO_ADMISSION_MODE: 'development',
      ASTRO_SERVER_BIND: '127.0.0.1',
      ASTRO_SERVER_PORT: '0',
      ASTRO_SERVER_CLIENT: client,
      ASTRO_SERVER_FIXTURE: devSimInspectFixture,
      ASTRO_SERVER_DB: database,
      ASTRO_ORIGINALS_ROOT: originalsRoot,
      ASTRO_PREVIEW_ROOT: previewRoot,
      ASTRO_PREFLIGHT_PROVIDER: 'alpaca',
      ASTRO_PREFLIGHT_ALPACA_RIG_ID: 'simulated-am5n',
      ASTRO_PREFLIGHT_ALPACA_HOST: '127.0.0.1',
      ASTRO_PREFLIGHT_ALPACA_PORT: simulatorPort,
      ASTRO_PREFLIGHT_ALPACA_CAMERA_DEVICE_NUMBER: '0',
      ASTRO_PREFLIGHT_ALPACA_CAMERA_UNIQUE_ID: 'sim-camera-asi2600mc-pro',
      ASTRO_PREFLIGHT_ALPACA_TELESCOPE_DEVICE_NUMBER: '0',
      ASTRO_PREFLIGHT_ALPACA_TELESCOPE_UNIQUE_ID: 'sim-telescope-am5n',
      ASTRO_PREFLIGHT_ALPACA_FOCUSER_DEVICE_NUMBER: '0',
      ASTRO_PREFLIGHT_ALPACA_FOCUSER_UNIQUE_ID: 'sim-focuser-eafn',
      ASTRO_PREFLIGHT_ALPACA_FILTER_WHEEL_DEVICE_NUMBER: '0',
      ASTRO_PREFLIGHT_ALPACA_FILTER_WHEEL_UNIQUE_ID: 'sim-filterwheel-0',
      ASTRO_SIMULATION_MODE: 'alpaca',
      ASTRO_SIMULATOR_ORIGIN: simulatorOrigin,
      ASTRO_SIMULATOR_SCENARIO: scenario,
    },
  )
}

function startWeb(serverOrigin) {
  if (web !== undefined || stopping) return
  web = startChild(
    'Vite',
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--force'],
    webRoot,
    (text) => {
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/)
      if (match !== null) openBrowser(match[0])
    },
    { ASTRO_SERVER_ORIGIN: serverOrigin },
  )
}

function openBrowser(webOrigin) {
  if (browser !== undefined || stopping) return
  clearTimeout(startupTimeout)
  browser = spawn(
    chrome,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      ...chromeDisplayArgs,
      `${webOrigin}${path}`,
    ],
    { stdio: 'inherit' },
  )
  children.add(browser)
  browser.once('error', (error) => {
    process.stderr.write(`Chrome failed: ${error.message}\n`)
    stop(1)
  })
  browser.once('exit', () => {
    children.delete(browser)
    browser = undefined
  })
  process.stdout.write(
    `Simulation inspector ready (${scenario}, ${client}): agent-browser connect ${cdpPort}\n`,
  )
}

function startChild(
  label,
  command,
  arguments_,
  cwd,
  onOutput,
  environment = {},
) {
  const child = spawn(command, arguments_, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  children.add(child)
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })
  observeOutputLines(child.stdout, onOutput)
  child.stderr.pipe(process.stderr)
  child.once('error', (error) => {
    process.stderr.write(`${label} failed: ${error.message}\n`)
    stop(1)
  })
  child.once('exit', (code, signal) => {
    children.delete(child)
    if (!stopping) {
      process.stderr.write(
        `${label} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).\n`,
      )
      stop(
        signal === 'SIGINT' || signal === 'SIGTERM'
          ? 0
          : code === 0
            ? 1
            : (code ?? 1),
      )
    }
  })
  return child
}

function assertPortAvailable(port) {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', () =>
      reject(
        new Error(
          `CDP port ${port} is already in use. Stop the previous inspect runner first.`,
        ),
      ),
    )
    probe.listen(port, '127.0.0.1', () =>
      probe.close((error) =>
        error === undefined ? resolvePromise() : reject(error),
      ),
    )
  })
}

function inspectPort(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65_535)
    throw new Error('ASTRO_INSPECT_CDP_PORT must be an integer from 1 to 65535')
  return Number(value)
}

function errorMessage(cause) {
  return cause instanceof Error ? cause.message : 'Unknown error.'
}
