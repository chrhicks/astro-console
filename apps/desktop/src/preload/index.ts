import { contextBridge, ipcRenderer } from "electron";
import type {
  ConnectRequest,
  DesktopDiscoveredDevice,
  DesktopLogEntry,
  DesktopStatus,
  SeestarDesktopApi,
} from "../shared/api";

const api: SeestarDesktopApi = {
  discover: () => ipcRenderer.invoke("seestar:discover") as Promise<DesktopDiscoveredDevice[]>,
  connect: (input: ConnectRequest) => ipcRenderer.invoke("seestar:connect", input) as Promise<DesktopStatus>,
  disconnect: () => ipcRenderer.invoke("seestar:disconnect") as Promise<DesktopStatus>,
  getStatus: () => ipcRenderer.invoke("seestar:get-status") as Promise<DesktopStatus>,
  refreshState: () => ipcRenderer.invoke("seestar:refresh-state") as Promise<DesktopStatus>,
  getLogs: () => ipcRenderer.invoke("seestar:get-logs") as Promise<DesktopLogEntry[]>,
  onLog: (listener) => subscribe("seestar:log", listener),
  onStatus: (listener) => subscribe("seestar:status", listener),
};

contextBridge.exposeInMainWorld("seestar", api);

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.off(channel, wrapped);
  };
}
