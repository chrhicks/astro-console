import { contextBridge, ipcRenderer } from 'electron'
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
  browseTargets: (query?: CatalogQuery) =>
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
  parkMount: () =>
    ipcRenderer.invoke('seestar:v2:park') as Promise<DesktopStatusV2>,

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
