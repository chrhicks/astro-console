import { contextBridge, ipcRenderer } from 'electron'
import { Result, Schema } from 'effect'
import type {
  CatalogPage,
  CatalogQuery,
  ConnectRequestV2,
  ConfigureExternalSequenceRequest,
  DesktopDiscoveredDeviceV2,
  DesktopLogEntryV2,
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
  getStatus: () => invokeStatus('seestar:v2:get-status'),
  connect: (input: ConnectRequestV2) =>
    invokeStatus('seestar:v2:connect', input),
  disconnect: () =>
    invokeStatus('seestar:v2:disconnect'),
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
    invokeStatus('seestar:v2:point-to-target', input),
  startPreview: () =>
    invokeStatus('seestar:v2:start-preview'),
  stopPreview: () =>
    invokeStatus('seestar:v2:stop-preview'),
  startCapture: () =>
    invokeStatus('seestar:v2:start-capture'),
  stopCapture: () =>
    invokeStatus('seestar:v2:stop-capture'),
  parkMount: () =>
    invokeStatus('seestar:v2:park'),
  unparkMount: () =>
    invokeStatus('seestar:v2:unpark'),
  setExposureDuration: (input: SetExposureDurationRequest) =>
    invokeStatus('seestar:v2:set-exposure-duration', input),
  configureExternalSequence: (input: ConfigureExternalSequenceRequest) =>
    invokeStatus('seestar:v2:configure-external-sequence', input),
  startExternalSequence: () => invokeStatus('seestar:v2:start-external-sequence'),
  continueExternalSequence: () => invokeStatus('seestar:v2:continue-external-sequence'),
  finishExternalSequence: () => invokeStatus('seestar:v2:finish-external-sequence'),
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

async function invoke<S extends Schema.ConstraintDecoder<unknown>>(
  channel: string,
  schema: S,
  ...args: unknown[]
): Promise<S['Type']> {
  return Schema.decodeUnknownPromise(schema)(await ipcRenderer.invoke(channel, ...args))
}

function invokeStatus(channel: string, ...args: unknown[]) {
  return invoke(channel, DesktopStatusSchema, ...args)
}

function subscribe<S extends Schema.ConstraintDecoder<unknown>>(
  channel: string,
  schema: S,
  listener: (payload: S['Type']) => void,
): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    const decoded = Schema.decodeUnknownResult(schema)(payload)
    if (Result.isSuccess(decoded)) listener(decoded.success)
  }
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.off(channel, wrapped)
  }
}
