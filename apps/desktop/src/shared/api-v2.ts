import type {
  CatalogPage,
  CatalogQuery,
  DeepSkyTarget,
  SolarSystemTarget,
  TargetSummary,
} from './catalog/catalog-schema'

export * from './catalog/catalog-schema'

export type LiveSessionHealth = 'healthy' | 'stale' | 'recovering' | 'failed'

export interface LiveSessionHealthState {
  state: LiveSessionHealth
  lastCheckedAt?: string
  lastError?: string
}

export interface SessionProjection {
  phase: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
  host?: string
  productModel?: string
  discovering: boolean
  health?: LiveSessionHealthState
  reconnect?: {
    active: boolean
    attempt: number
    nextRetryAt?: string
    lastError?: string
  }
}

export interface PointingProjection {
  phase: 'idle' | 'slewing' | 'arrived' | 'failed'
  target: TargetSummary | null
  targetId?: string
  startedAt?: string
  step?: string
  lastError?: string
}

export type CapturePhase = 'idle' | 'starting' | 'capturing' | 'stopped' | 'failed'

export interface CaptureProjection {
  phase: CapturePhase
  stacks?: number
  frames?: number
  elapsedSec?: number
  lastError?: string
}

export type PreviewPhase = 'none' | 'starting' | 'active' | 'error'

export interface PreviewProjection {
  phase: PreviewPhase
  source: 'none' | 'rtsp'
  active: boolean
  lastError?: string
}

export interface LibraryAsset {
  id: string
  name: string
  capturedAt: string
  kind: 'stack' | 'sub' | 'calibration'
}

export type LibraryScope = 'current_target' | 'all_targets'

export interface LibraryProjection {
  scope: LibraryScope
  assets: LibraryAsset[]
  polling: boolean
}

export interface DeviceTimeProjection {
  year: number
  mon: number
  day: number
  hour: number
  min: number
  sec: number
  timeZone?: string
}

export interface DeviceProjection {
  pluginKind?: DevicePluginKind
  deviceId?: string
  displayName?: string
  host?: string
  productModel?: string
  serialNumber?: string
  firmwareVersion?: string
  batteryPercent?: number
  deviceTempC?: number
  batteryTempC?: number
  tracking?: boolean
  mountClosed?: boolean
  connectedAt?: string
  location?: { lat: number; lon: number }
  deviceTime?: DeviceTimeProjection
  deviceTimeLooksStale?: boolean
  viewMode?: string
  viewStage?: string
  viewState?: string
  storageFreeMb?: number
  storageTotalMb?: number
  warnings?: string[]
}

export type WorkspaceState =
  | 'disconnected'
  | 'idle_no_target'
  | 'primed'
  | 'ready_to_slew'
  | 'slewing'
  | 'on_target'
  | 'preview_starting'
  | 'preview_active'
  | 'preview_error'
  | 'capturing'
  | 'parked'

export type WorkspaceCapabilityTier = 'native' | 'external' | 'unsupported'
export type WorkspaceCapabilityFlag = 'yes' | 'no'

export interface WorkspaceCapabilities {
  preview: WorkspaceCapabilityTier
  capture: WorkspaceCapabilityTier
  autofocus: WorkspaceCapabilityFlag
  filterWheel: WorkspaceCapabilityFlag
  storage: WorkspaceCapabilityFlag
}

export type WorkspaceSurfaceKind = 'idle' | 'scenery' | 'solar' | 'deepsky'

export interface WorkspaceSurface {
  kind: WorkspaceSurfaceKind
  label: string
}

export interface WorkspaceAction {
  id: string
  label: string
  enabled: boolean
  active?: boolean
}

export interface WorkspaceProjection {
  state: WorkspaceState
  stateLabel: string
  surface: WorkspaceSurface
  capabilities: WorkspaceCapabilities
  actions: WorkspaceAction[]
}

export interface DesktopStatus {
  session: SessionProjection
  pointing: PointingProjection
  capture: CaptureProjection
  preview: PreviewProjection
  device: DeviceProjection
  library: LibraryProjection
  workspace: WorkspaceProjection
  currentTarget: TargetSummary | null
  lastUpdatedAt: string
  lastError?: string
}

export type DevicePluginKind = 'fake-seestar' | 'seestar'

export interface DesktopDiscoveredDeviceV2 {
  pluginKind: DevicePluginKind
  deviceId: string
  displayName: string
  host?: string
  productModel?: string
  serialNumber?: string
}

export interface ConnectRequestV2 {
  pluginKind: DevicePluginKind
  deviceId: string
}

export interface PointToTargetRequest {
  targetId: string
}

export interface DesktopLogEntryV2 {
  ts: string
  level: 'debug' | 'info' | 'warn' | 'error'
  event: string
  component: string
  summary?: string
  error?: string
  host?: string
  sessionId?: string
  data?: unknown
}

export interface SeestarDesktopApiV2 {
  discover(): Promise<DesktopDiscoveredDeviceV2[]>
  connect(input: ConnectRequestV2): Promise<DesktopStatus>
  disconnect(): Promise<DesktopStatus>
  getStatus(): Promise<DesktopStatus>
  getLogs(): Promise<DesktopLogEntryV2[]>
  browseTargets(query?: CatalogQuery): Promise<CatalogPage>
  getTargetById(targetId: string): Promise<
    DeepSkyTarget | SolarSystemTarget | null
  >
  pointToTarget(input: PointToTargetRequest): Promise<DesktopStatus>
  startPreview(): Promise<DesktopStatus>
  stopPreview(): Promise<DesktopStatus>
  startCapture(): Promise<DesktopStatus>
  stopCapture(): Promise<DesktopStatus>
  parkMount(): Promise<DesktopStatus>
  onLog(listener: (entry: DesktopLogEntryV2) => void): () => void
  onStatus(listener: (status: DesktopStatus) => void): () => void
}

// Dev-only control surface for the fake Seestar scenario runtime. Not used by
// product UI; exposed so manual testing and agent-browser loops can inspect,
// load, and reset fake-device scenarios without restarting the app.
export interface FakeScenarioSummary {
  id: string
  label: string
  description: string
}

export interface FakeRuntimeSnapshot {
  scenarios: FakeScenarioSummary[]
  activeScenarioId: string
  connectOutcome: 'success' | 'failure'
  device: DeviceProjection
  preview: PreviewProjection
  capture: CaptureProjection
  library: LibraryProjection
}

export interface SeestarDevFakeApi {
  listScenarios(): Promise<FakeRuntimeSnapshot>
  loadScenario(scenarioId: string): Promise<FakeRuntimeSnapshot>
  reset(): Promise<FakeRuntimeSnapshot>
}
