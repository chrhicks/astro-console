import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const requestedClient =
  process.argv
    .find((argument) => argument.startsWith('--client='))
    ?.slice('--client='.length) ?? 'owner'
if (!['owner', 'friend', 'phone'].includes(requestedClient))
  throw new Error('--client must be owner, friend, or phone')
const requestedPath =
  process.argv
    .find((argument) => argument.startsWith('--path='))
    ?.slice('--path='.length) ?? '/'
if (!requestedPath.startsWith('/')) throw new Error('--path must start with /')
const scenario =
  process.argv
    .find((argument) => argument.startsWith('--scenario='))
    ?.slice('--scenario='.length) ?? 'm27'
if (
  ![
    'm27',
    'polar',
    'target-deep-sky',
    'target-lunar',
    'target-correction',
    'target-verification',
    'live-frame',
    'live-frame-library',
    'managed-capture',
    'acquire-recovery',
    'plan-draft',
    'library-published',
  ].includes(scenario)
)
  throw new Error(
    '--scenario must be m27, polar, target-deep-sky, target-lunar, target-correction, target-verification, live-frame, live-frame-library, managed-capture, acquire-recovery, plan-draft, or library-published',
  )
const scenarioSuffix = scenario === 'm27' ? '' : `-${scenario}`
const profile = resolve(
  appRoot,
  `.astro-server/inspect-chrome-profile-${requestedClient}${scenarioSuffix}`,
)
const database = resolve(
  appRoot,
  `.astro-server/inspect-state-${requestedClient}${scenarioSuffix}.sqlite`,
)
const chrome =
  process.env.ASTRO_SERVER_CHROME ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome')
mkdirSync(profile, { recursive: true })
const server = spawn(
  process.execPath,
  ['--experimental-strip-types', './src/server.ts'],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      ASTRO_SERVER_CLIENT: requestedClient,
      ASTRO_SERVER_FIXTURE: scenario,
      ASTRO_SERVER_DB: database,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
)
let browser
let web
let serverOrigin
let webOrigin
let stopped = false
const stop = () => {
  if (stopped) return
  stopped = true
  if (browser) browser.kill()
  server.kill()
  web?.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  process.stdout.write(text)
  const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/)
  if (!match) return
  serverOrigin = match[0]
  startWeb()
})
function startWeb() {
  if (web) return
  web = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--force'],
    {
      cwd: resolve(appRoot, '../web'),
      env: {
        ...process.env,
        ASTRO_SERVER_ORIGIN: serverOrigin,
      },
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  )
  web.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    process.stdout.write(text)
    const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/)
    if (!match) return
    webOrigin = match[0]
    openBrowser()
  })
  web.stderr.pipe(process.stderr)
  web.on('exit', (code) => {
    if (!stopped) {
      stop()
      process.exitCode = code ?? 1
    }
  })
}
function openBrowser() {
  if (!serverOrigin || !webOrigin || browser) return
  const url = `${webOrigin}${requestedPath}`
  browser = spawn(
    chrome,
    [
      `--remote-debugging-port=9223`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      url,
    ],
    { stdio: 'inherit' },
  )
  browser.on('exit', () => {
    browser = undefined
  })
  process.stdout.write(
    `Inspector ready for ${requestedClient} (${scenario}): agent-browser connect 9223\n`,
  )
}
server.stderr.pipe(process.stderr)
server.on('exit', (code) => {
  if (!stopped) {
    stop()
    process.exitCode = code ?? 1
  }
})
