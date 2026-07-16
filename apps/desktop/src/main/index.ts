import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  attachIpcV2LogListener,
  attachIpcV2StatusListener,
  registerIpcV2Handlers,
} from './effect/ipc/ipc-v2'
import { registerIpcV2DevHandlers } from './effect/ipc/ipc-v2-dev'
import { appRuntime } from './effect/runtime/app-runtime'
import { runDisconnect } from './effect/workflows/session-workflows'

const rendererDevUrl = process.env.VITE_DEV_SERVER_URL
const inspectPort = process.env.ELECTRON_INSPECT_PORT
const gracefulShutdownDeadlineMs = 5000
if (inspectPort) {
  app.commandLine.appendSwitch('remote-debugging-port', inspectPort)
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a1220',
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 14, y: 14 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const rendererFile = path.join(__dirname, '../renderer/index.html')
  const allowedNavigationUrl = rendererDevUrl
    ? new URL(rendererDevUrl).href
    : pathToFileURL(rendererFile).href
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== allowedNavigationUrl) event.preventDefault()
  })

  const devOrigin = rendererDevUrl ? new URL(rendererDevUrl).origin : null
  const devSocketOrigin = devOrigin?.replace(/^http/, 'ws')
  const csp = devOrigin
    ? `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${devOrigin} ${devSocketOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  registerIpcV2Handlers(window.webContents)
  if (!app.isPackaged) registerIpcV2DevHandlers(window.webContents)
  attachIpcV2StatusListener(window.webContents)
  attachIpcV2LogListener(window.webContents)

  if (rendererDevUrl) {
    void window.loadURL(rendererDevUrl)
  } else {
    void window.loadFile(rendererFile)
  }

  return window
}

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let quitting = false

app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  const disconnect = appRuntime.runPromise(runDisconnect).catch(() => undefined)
  const deadline = new Promise<void>((resolve) => {
    setTimeout(resolve, gracefulShutdownDeadlineMs)
  })
  void Promise.race([disconnect, deadline])
    .then(() => appRuntime.dispose())
    .catch(() => undefined)
    .then(() => app.exit())
})
