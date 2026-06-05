import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { SeestarDesktopService } from './seestar-service'
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
} from '../shared/api'

const service = new SeestarDesktopService()
const rendererDevUrl = process.env.VITE_DEV_SERVER_URL

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0a1220',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  service.attachRenderer(window.webContents)

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
      service.createSiteProfile(input),
  )
  ipcMain.handle(
    'seestar:update-site-profile',
    (_event, input: UpdateSiteProfileRequest) =>
      service.updateSiteProfile(input),
  )
  ipcMain.handle(
    'seestar:duplicate-site-profile',
    (_event, input: DuplicateSiteProfileRequest) =>
      service.duplicateSiteProfile(input),
  )
  ipcMain.handle(
    'seestar:archive-site-profile',
    (_event, input: ArchiveSiteProfileRequest) =>
      service.archiveSiteProfile(input),
  )
  ipcMain.handle(
    'seestar:set-active-site',
    (_event, input: SetActiveSiteRequest) => service.setActiveSite(input),
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

app.whenReady().then(() => {
  registerIpcHandlers()
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
