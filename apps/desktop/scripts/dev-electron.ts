import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { watch } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(scriptDir, '..')
const mainEntry = path.join(appDir, 'dist/main/index.js')
const sdkEntry = path.resolve(appDir, '../../sdk/dist/index.js')
const mainDistDir = path.join(appDir, 'dist/main')
const sdkDistDir = path.resolve(appDir, '../../sdk/dist')

const rendererDevUrl =
  process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'
const inspectPort = process.env.ELECTRON_INSPECT_PORT
const pollIntervalMs = 250
const restartDebounceMs = 300
const startupStabilizationMs = 1000
const forceKillMs = 2000

let current: ChildProcess | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFile(file: string): Promise<void> {
  for (;;) {
    try {
      await access(file)
      return
    } catch {
      await sleep(pollIntervalMs)
    }
  }
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function waitForTcp(host: string, port: number): Promise<void> {
  for (;;) {
    if (await canConnect(host, port)) return
    await sleep(pollIntervalMs)
  }
}

async function waitForReady(): Promise<void> {
  const { hostname, port } = new URL(rendererDevUrl)
  console.log('[dev-electron] waiting for build artifacts and vite dev server')
  await Promise.all([
    waitForFile(mainEntry),
    waitForFile(sdkEntry),
    waitForTcp(hostname, Number(port)),
  ])
}

function startElectron(): void {
  const env = {
    ...process.env,
    VITE_DEV_SERVER_URL: rendererDevUrl,
    ...(inspectPort ? { ELECTRON_INSPECT_PORT: inspectPort } : {}),
  }
  const child = spawn('electron', [mainEntry], { stdio: 'inherit', env })
  child.on('exit', (code, signal) => {
    // Ignore exits from a process being replaced during restart.
    if (child !== current) return
    console.log(
      `[dev-electron] electron exited (code=${code} signal=${signal})`,
    )
    process.exit(code ?? 0)
  })
  child.on('error', (error) => {
    console.error('[dev-electron] failed to start electron:', error.message)
    process.exit(1)
  })
  current = child
  console.log(
    `[dev-electron] started electron (inspect=${inspectPort ?? 'off'})`,
  )
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill('SIGKILL'), forceKillMs)
    child.once('exit', () => {
      clearTimeout(force)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function restartElectron(): Promise<void> {
  if (!current) return
  const old = current
  current = null
  console.log('[dev-electron] dist change detected, restarting electron')
  await killChild(old)
  startElectron()
}

function watchDist(): void {
  // Suppress the initial watch-mode artifact writes that land right after
  // Electron starts. Extend the window while writes keep arriving so a slow
  // settle does not restart; once dist goes quiet the window closes and real
  // changes restart as normal.
  let stableAt = Date.now() + startupStabilizationMs
  let timer: NodeJS.Timeout | null = null
  const schedule = () => {
    const now = Date.now()
    if (now < stableAt) {
      stableAt = now + startupStabilizationMs
      return
    }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void restartElectron()
    }, restartDebounceMs)
  }
  watch(mainDistDir, { recursive: true }, schedule)
  watch(sdkDistDir, { recursive: true }, schedule)
  console.log('[dev-electron] watching main and sdk dist for changes')
}

function shutdown(): void {
  if (current) current.kill('SIGTERM')
  process.exit(0)
}

async function main(): Promise<void> {
  await waitForReady()
  startElectron()
  watchDist()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch((error) => {
  console.error('[dev-electron]', error)
  process.exit(1)
})
