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
const profile = resolve(
  appRoot,
  `.astro-local-web/inspect-chrome-profile-${requestedClient}`,
)
const database = resolve(
  appRoot,
  `.astro-local-web/inspect-state-${requestedClient}.sqlite`,
)
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(profile, { recursive: true })
const server = spawn(
  process.execPath,
  ['--experimental-strip-types', 'src/server.ts'],
  {
    cwd: appRoot,
    env: {
      ...process.env,
      ASTRO_LOCAL_WEB_CLIENT: requestedClient,
      ASTRO_LOCAL_WEB_FIXTURE: 'm27',
      ASTRO_LOCAL_WEB_DB: database,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  },
)
let browser
const stop = () => {
  if (browser) browser.kill()
  server.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
server.stdout.on('data', (chunk) => {
  const text = chunk.toString()
  process.stdout.write(text)
  const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/)
  if (!match || browser) return
  const url = match[0]
  browser = spawn(
    chrome,
    [
      `--remote-debugging-port=9223`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ],
    { stdio: 'inherit' },
  )
  browser.on('exit', () => {
    browser = undefined
  })
  process.stdout.write(
    `Inspector ready for ${requestedClient}: agent-browser connect 9223\n`,
  )
})
server.stderr.pipe(process.stderr)
server.on('exit', (code) => process.exit(code ?? 0))
