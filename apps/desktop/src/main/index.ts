import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import {
  attachIpcV2LogListener,
  attachIpcV2StatusListener,
  registerIpcV2Handlers,
} from './effect/ipc/ipc-v2'
import { registerIpcV2DevHandlers } from './effect/ipc/ipc-v2-dev'

const rendererDevUrl = process.env.VITE_DEV_SERVER_URL
const inspectPort = process.env.ELECTRON_INSPECT_PORT
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
    },
  })

  attachIpcV2StatusListener(window.webContents)
  attachIpcV2LogListener(window.webContents)

  if (rendererDevUrl) {
    void window.loadURL(rendererDevUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.whenReady().then(() => {
  registerIpcV2Handlers()
  if (!app.isPackaged) {
    registerIpcV2DevHandlers()
  }
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
