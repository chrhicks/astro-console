import { contextBridge, ipcRenderer } from 'electron'
import { Schema } from 'effect'
import type {
  CatalogPage,
  CatalogQuery,
  ConnectRequestV2,
  ConfigureExternalSequenceRequest,
  DesktopDiscoveredDeviceV2,
  DesktopLogEntryV2,
  DesktopStatus as DesktopStatusV2,
  FakeRuntimeSnapshot,
  PointToTargetRequest,
  SeestarDesktopApiV2,
  SeestarDevFakeApi,
  SetExposureDurationRequest,
  TargetDetails,
} from '../shared/api-v2'
import {
  DesktopDiscoveredDeviceSchema,
  DesktopLogEntrySchema,
  DesktopStatusSchema,
  CatalogPageSchema,
  FakeRuntimeSnapshotSchema,
  TargetDetailsSchema,
} from '../shared/ipc-schema'

export const apiV2: SeestarDesktopApiV2 = {
  discover: () => invoke('seestar:v2:discover', Schema.Array(DesktopDiscoveredDeviceSchema)),
  getStatus: () => invoke('seestar:v2:get-status', DesktopStatusSchema),
  connect: (input: ConnectRequestV2) =>
    invoke('seestar:v2:connect', DesktopStatusSchema, input),
  disconnect: () =>
    invoke('seestar:v2:disconnect', DesktopStatusSchema),
  getLogs: () =>
    invoke('seestar:v2:get-logs', Schema.Array(DesktopLogEntrySchema)),
  browseTargets: (query?: CatalogQuery) =>
    invoke('seestar:v2:browse-targets', CatalogPageSchema, query),
  getTargetById: (targetId: string) =>
    invoke(
      'seestar:v2:get-target-by-id',
      Schema.NullOr(TargetDetailsSchema),
      targetId,
    ),
  pointToTarget: (input: PointToTargetRequest) =>
    invoke('seestar:v2:point-to-target', DesktopStatusSchema, input),
  startPreview: () =>
    invoke('seestar:v2:start-preview', DesktopStatusSchema),
  stopPreview: () =>
    invoke('seestar:v2:stop-preview', DesktopStatusSchema),
  startCapture: () =>
    invoke('seestar:v2:start-capture', DesktopStatusSchema),
  stopCapture: () =>
    invoke('seestar:v2:stop-capture', DesktopStatusSchema),
  parkMount: () =>
    invoke('seestar:v2:park', DesktopStatusSchema),
  setExposureDuration: (input: SetExposureDurationRequest) =>
    invoke('seestar:v2:set-exposure-duration', DesktopStatusSchema, input),
  configureExternalSequence: (input: ConfigureExternalSequenceRequest) =>
    invoke('seestar:v2:configure-external-sequence', DesktopStatusSchema, input),
  startExternalSequence: () => invoke('seestar:v2:start-external-sequence', DesktopStatusSchema),
  continueExternalSequence: () => invoke('seestar:v2:continue-external-sequence', DesktopStatusSchema),
  finishExternalSequence: () => invoke('seestar:v2:finish-external-sequence', DesktopStatusSchema),
  openSavedAsset: (assetId: string) =>
    invoke('seestar:v2:open-saved-asset', Schema.Undefined, assetId),
  revealSavedAsset: (assetId: string) =>
    invoke('seestar:v2:reveal-saved-asset', Schema.Undefined, assetId),
  getSavedAssetPreview: (assetId: string) =>
    invoke(
      'seestar:v2:get-saved-asset-preview',
      Schema.NullOr(Schema.String),
      assetId,
    ),

  onLog: (listener) => subscribe('seestar:v2:log', DesktopLogEntrySchema, listener),
  onStatus: (listener) => subscribe('seestar:v2:status', DesktopStatusSchema, listener),
}

// Dev-only control surface for the fake Seestar scenario runtime. Not used by
// product UI; exposed for manual testing and agent-browser scenario loops.
export const seestarDevFake: SeestarDevFakeApi = {
  listScenarios: () =>
    invoke('seestar:dev:fake:list-scenarios', FakeRuntimeSnapshotSchema),
  loadScenario: (scenarioId: string) =>
    invoke(
      'seestar:dev:fake:load-scenario',
      FakeRuntimeSnapshotSchema,
      scenarioId,
    ),
  reset: () =>
    invoke('seestar:dev:fake:reset', FakeRuntimeSnapshotSchema),
}

const exposeDevFakeApi = Boolean(
  process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_INSPECT_PORT,
)

contextBridge.exposeInMainWorld('seestarV2', apiV2)
if (exposeDevFakeApi) {
  contextBridge.exposeInMainWorld('seestarDevFake', seestarDevFake)
}

async function invoke<A, I>(channel: string, schema: Schema.Schema<A, I>, ...args: unknown[]): Promise<A> {
  return Schema.decodeUnknownPromise(schema)(await ipcRenderer.invoke(channel, ...args))
}

function subscribe<A, I>(
  channel: string,
  schema: Schema.Schema<A, I>,
  listener: (payload: A) => void,
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    const decoded = Schema.decodeUnknownEither(schema)(payload)
    if (decoded._tag === 'Right') listener(decoded.right)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.off(channel, wrapped)
  }
}
