import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddManualCatalogTargetRequest,
  ArchiveSiteProfileRequest,
  ConnectRequest,
  CreateQueueFromDraftsRequest,
  DesktopCommandRequest,
  CreateSiteProfileRequest,
  DesktopDiscoveredDevice,
  DuplicateSiteProfileRequest,
  DesktopLogEntry,
  DesktopStatus,
  ReplaceQueueRequest,
  SearchCatalogTargetsRequest,
  SetActiveSiteRequest,
  SeestarDesktopApi,
  StartQueueRunRequest,
  UpdateSiteProfileRequest,
} from '../shared/api'
import type { PlanningSnapshot } from '../shared/planning'
import type { CatalogSearchResult } from '../shared/starter-catalog'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DesktopLogEntryV2,
  DesktopStatus as DesktopStatusV2,
  SeestarDesktopApiV2,
} from '../shared/api-v2'

const api: SeestarDesktopApi = {
  discover: () =>
    ipcRenderer.invoke('seestar:discover') as Promise<
      DesktopDiscoveredDevice[]
    >,
  connect: (input: ConnectRequest) =>
    ipcRenderer.invoke('seestar:connect', input) as Promise<DesktopStatus>,
  disconnect: () =>
    ipcRenderer.invoke('seestar:disconnect') as Promise<DesktopStatus>,
  getStatus: () =>
    ipcRenderer.invoke('seestar:get-status') as Promise<DesktopStatus>,
  getPlanningSnapshot: () =>
    ipcRenderer.invoke(
      'seestar:get-planning-snapshot',
    ) as Promise<PlanningSnapshot>,
  createSiteProfile: (input: CreateSiteProfileRequest) =>
    ipcRenderer.invoke(
      'seestar:create-site-profile',
      input,
    ) as Promise<PlanningSnapshot>,
  updateSiteProfile: (input: UpdateSiteProfileRequest) =>
    ipcRenderer.invoke(
      'seestar:update-site-profile',
      input,
    ) as Promise<PlanningSnapshot>,
  duplicateSiteProfile: (input: DuplicateSiteProfileRequest) =>
    ipcRenderer.invoke(
      'seestar:duplicate-site-profile',
      input,
    ) as Promise<PlanningSnapshot>,
  archiveSiteProfile: (input: ArchiveSiteProfileRequest) =>
    ipcRenderer.invoke(
      'seestar:archive-site-profile',
      input,
    ) as Promise<PlanningSnapshot>,
  setActiveSite: (input: SetActiveSiteRequest) =>
    ipcRenderer.invoke(
      'seestar:set-active-site',
      input,
    ) as Promise<PlanningSnapshot>,
  searchCatalogTargets: (input: SearchCatalogTargetsRequest) =>
    ipcRenderer.invoke('seestar:search-catalog-targets', input) as Promise<
      CatalogSearchResult[]
    >,
  addManualCatalogTarget: (input: AddManualCatalogTargetRequest) =>
    ipcRenderer.invoke(
      'seestar:add-manual-catalog-target',
      input,
    ) as Promise<PlanningSnapshot>,
  replaceQueue: (input: ReplaceQueueRequest) =>
    ipcRenderer.invoke(
      'seestar:replace-queue',
      input,
    ) as Promise<PlanningSnapshot>,
  createQueueFromDrafts: (input: CreateQueueFromDraftsRequest) =>
    ipcRenderer.invoke(
      'seestar:create-queue-from-drafts',
      input,
    ) as Promise<PlanningSnapshot>,
  startQueueRun: (input: StartQueueRunRequest) =>
    ipcRenderer.invoke(
      'seestar:start-queue-run',
      input,
    ) as Promise<DesktopStatus>,
  stopQueueRun: () =>
    ipcRenderer.invoke('seestar:stop-queue-run') as Promise<DesktopStatus>,
  refreshState: () =>
    ipcRenderer.invoke('seestar:refresh-state') as Promise<DesktopStatus>,
  startPreview: () =>
    ipcRenderer.invoke('seestar:start-preview') as Promise<DesktopStatus>,
  stopPreview: () =>
    ipcRenderer.invoke('seestar:stop-preview') as Promise<DesktopStatus>,
  runCommand: (input: DesktopCommandRequest) =>
    ipcRenderer.invoke('seestar:run-command', input) as Promise<DesktopStatus>,
  getLogs: () =>
    ipcRenderer.invoke('seestar:get-logs') as Promise<DesktopLogEntry[]>,
  onLog: (listener) => subscribe('seestar:log', listener),
  onStatus: (listener) => subscribe('seestar:status', listener),
  onPreviewFrame: (listener) => subscribe('seestar:preview-frame', listener),
}

export const apiV2: SeestarDesktopApiV2 = {
  discover: () =>
    ipcRenderer.invoke('seestar:v2:discover') as Promise<
      DesktopDiscoveredDeviceV2[]
    >,
  getStatus: () =>
    ipcRenderer.invoke('seestar:v2:get-status') as Promise<DesktopStatusV2>,
  connect: (input: ConnectRequestV2) =>
    ipcRenderer.invoke('seestar:v2:connect', input) as Promise<DesktopStatusV2>,
  disconnect: () =>
    ipcRenderer.invoke('seestar:v2:disconnect') as Promise<DesktopStatusV2>,
  getLogs: () =>
    ipcRenderer.invoke('seestar:v2:get-logs') as Promise<DesktopLogEntryV2[]>,

  onLog: (listener) => subscribe('seestar:v2:log', listener),
  onStatus: (listener) => subscribe('seestar:v2:status', listener),
}

contextBridge.exposeInMainWorld('seestar', api)
contextBridge.exposeInMainWorld('seestarV2', apiV2)

function subscribe<T>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.off(channel, wrapped)
  }
}
