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
} from '../shared/legacy/api'
import type { PlanningSnapshot } from '../shared/legacy/planning'
import type { CatalogSearchResult } from '../shared/legacy/starter-catalog'
import type {
  CatalogPage,
  CatalogQuery,
  ConnectRequestV2,
  DeepSkyTarget,
  DesktopDiscoveredDeviceV2,
  DesktopLogEntryV2,
  DesktopStatus as DesktopStatusV2,
  FakeRuntimeSnapshot,
  PointToTargetRequest,
  SeestarDesktopApiV2,
  SeestarDevFakeApi,
  SolarSystemTarget,
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
  browseTargets: (query: CatalogQuery) =>
    ipcRenderer.invoke('seestar:v2:browse-targets', query) as Promise<
      CatalogPage
    >,
  getTargetById: (targetId: string) =>
    ipcRenderer.invoke('seestar:v2:get-target-by-id', targetId) as Promise<
      DeepSkyTarget | SolarSystemTarget | null
    >,
  pointToTarget: (input: PointToTargetRequest) =>
    ipcRenderer.invoke(
      'seestar:v2:point-to-target',
      input,
    ) as Promise<DesktopStatusV2>,
  startPreview: () =>
    ipcRenderer.invoke('seestar:v2:start-preview') as Promise<DesktopStatusV2>,
  stopPreview: () =>
    ipcRenderer.invoke('seestar:v2:stop-preview') as Promise<DesktopStatusV2>,
  startCapture: () =>
    ipcRenderer.invoke('seestar:v2:start-capture') as Promise<DesktopStatusV2>,
  stopCapture: () =>
    ipcRenderer.invoke('seestar:v2:stop-capture') as Promise<DesktopStatusV2>,

  onLog: (listener) => subscribe('seestar:v2:log', listener),
  onStatus: (listener) => subscribe('seestar:v2:status', listener),
}

// Dev-only control surface for the fake Seestar scenario runtime. Not used by
// product UI; exposed for manual testing and agent-browser scenario loops.
export const seestarDevFake: SeestarDevFakeApi = {
  listScenarios: () =>
    ipcRenderer.invoke('seestar:dev:fake:list-scenarios') as Promise<
      FakeRuntimeSnapshot
    >,
  loadScenario: (scenarioId: string) =>
    ipcRenderer.invoke(
      'seestar:dev:fake:load-scenario',
      scenarioId,
    ) as Promise<FakeRuntimeSnapshot>,
  reset: () =>
    ipcRenderer.invoke('seestar:dev:fake:reset') as Promise<FakeRuntimeSnapshot>,
}

const exposeDevFakeApi = Boolean(
  process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_INSPECT_PORT,
)

contextBridge.exposeInMainWorld('seestar', api)
contextBridge.exposeInMainWorld('seestarV2', apiV2)
if (exposeDevFakeApi) {
  contextBridge.exposeInMainWorld('seestarDevFake', seestarDevFake)
}

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
