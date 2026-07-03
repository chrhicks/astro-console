import { app, BrowserWindow, ipcMain, WebContents } from 'electron'
import { Effect } from 'effect'
import path from 'node:path'
import { SeestarDesktopService } from './legacy/seestar-service'
import type {
  AddManualCatalogTargetRequest,
  ArchiveSiteProfileRequest,
  ConnectRequest,
  CreateQueueFromDraftsRequest,
  CreateSiteProfileRequest,
  DesktopCommandRequest,
  DuplicateSiteProfileRequest,
  ReplaceQueueRequest,
  SearchCatalogTargetsRequest,
  SetActiveSiteRequest,
  StartQueueRunRequest,
  UpdateSiteProfileRequest,
} from '../shared/legacy/api'
import {
  attachIpcV2LogListener,
  attachIpcV2StatusListener,
  registerIpcV2Handlers,
} from './effect/ipc/ipc-v2'
import { EventBus } from './effect/event/event-bus'
import { appRuntime } from './effect/runtime/app-runtime'

const service = new SeestarDesktopService()
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

  service.attachRenderer(window.webContents)
  attachIpcV2StatusListener(window.webContents)
  attachIpcV2LogListener(window.webContents)

  if (rendererDevUrl) {
    void window.loadURL(rendererDevUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function registerIpcHandlers(): void {
  ipcMain.handle('seestar:discover', () => service.discover())
  ipcMain.handle('seestar:connect', (_event, input: ConnectRequest) =>
    service.connect(input),
  )
  ipcMain.handle('seestar:disconnect', () => service.disconnect())
  ipcMain.handle('seestar:get-status', () => service.getStatus())
  ipcMain.handle('seestar:get-planning-snapshot', () =>
    service.getPlanningSnapshot(),
  )
  ipcMain.handle(
    'seestar:create-site-profile',
    (_event, input: CreateSiteProfileRequest) =>
      notifyObserverContextChanged(service.createSiteProfile(input)),
  )
  ipcMain.handle(
    'seestar:update-site-profile',
    (_event, input: UpdateSiteProfileRequest) =>
      notifyObserverContextChanged(service.updateSiteProfile(input)),
  )
  ipcMain.handle(
    'seestar:duplicate-site-profile',
    (_event, input: DuplicateSiteProfileRequest) =>
      notifyObserverContextChanged(service.duplicateSiteProfile(input)),
  )
  ipcMain.handle(
    'seestar:archive-site-profile',
    (_event, input: ArchiveSiteProfileRequest) =>
      notifyObserverContextChanged(service.archiveSiteProfile(input)),
  )
  ipcMain.handle(
    'seestar:set-active-site',
    (_event, input: SetActiveSiteRequest) =>
      notifyObserverContextChanged(service.setActiveSite(input)),
  )
  ipcMain.handle(
    'seestar:search-catalog-targets',
    (_event, input: SearchCatalogTargetsRequest) =>
      service.searchCatalogTargets(input),
  )
  ipcMain.handle(
    'seestar:add-manual-catalog-target',
    (_event, input: AddManualCatalogTargetRequest) =>
      service.addManualCatalogTarget(input),
  )
  ipcMain.handle(
    'seestar:replace-queue',
    (_event, input: ReplaceQueueRequest) => service.replaceQueue(input),
  )
  ipcMain.handle(
    'seestar:create-queue-from-drafts',
    (_event, input: CreateQueueFromDraftsRequest) =>
      service.createQueueFromDrafts(input),
  )
  ipcMain.handle(
    'seestar:start-queue-run',
    (_event, input: StartQueueRunRequest) => service.startQueueRun(input),
  )
  ipcMain.handle('seestar:stop-queue-run', () => service.stopQueueRun())
  ipcMain.handle('seestar:refresh-state', () => service.refreshState())
  ipcMain.handle('seestar:start-preview', () => service.startPreview())
  ipcMain.handle('seestar:stop-preview', () => service.stopPreview())
  ipcMain.handle(
    'seestar:run-command',
    (_event, input: DesktopCommandRequest) => service.runCommand(input),
  )
  ipcMain.handle('seestar:get-logs', () => service.getLogs())
}

// Legacy site mutations drive the V2 observer context (active site / lat-lon /
// horizon). Publish a V2 event so the status stream repushes a snapshot with
// the refreshed observerContext, which invalidates the renderer browse query.
async function notifyObserverContextChanged<T>(
  work: Promise<T>,
): Promise<T> {
  const result = await work
  void appRuntime.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus
      yield* bus.publish('observer.context.changed', {})
    }),
  )
  return result
}

app.whenReady().then(() => {
  registerIpcHandlers()
  registerIpcV2Handlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('before-quit', () => {
  service.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
