import type {
  CatalogPage,
  CatalogQuery,
  OpenNgcObjectType,
  SolarSystemBody,
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

export type CapturePhase = 'idle' | 'starting' | 'capturing' | 'stopped' | 'failed' | 'partial'

// Distinguishes native stacking orchestration (Seestar RigCaptureWorkflow)
// from generic external camera exposure (RigCamera start/stop). Native rigs
// leave this unset to preserve existing behavior; external rigs set 'external'
// so the UI can use exposure-oriented copy instead of stacking copy.
export type CaptureMode = 'native' | 'external'

// Device-reported exposure state for the external camera path. Mirrors
// RigCameraExposureState.state so the UI can show what the camera hardware
// reports (e.g. 'reading' during sensor readout) rather than only the
// workflow phase. Only present when the rig exposes RigCamera and the
// polling loop is active or has completed.
export type CaptureDeviceState = 'idle' | 'exposing' | 'reading' | 'ready' | 'error'

export interface CaptureProjection {
  phase: CapturePhase
  mode?: CaptureMode
  deviceState?: CaptureDeviceState
  stacks?: number
  frames?: number
  elapsedSec?: number
  // ISO 8601 timestamp marking when the current exposure/capture entered the
  // 'capturing' phase. The external camera path sets this so the UI can derive
  // elapsed time locally without faking device-reported progress. Native
  // stacking leaves this unset because the device reports elapsedSec directly.
  startedAt?: string
  lastError?: string
}

// User-configured generic camera settings for the external exposure path.
// Distinct from CaptureProjection (volatile device-reported state) so rig
// refresh does not wipe a configured exposure duration. Only present when the
// connected rig exposes a generic RigCamera.
export interface CameraSettings {
  exposureSec: number
}

export interface ExternalSequencePlan {
  lightCount: number
  durationSec: number
  darkCount: number
}

export interface ExternalSequenceProjection {
  phase: 'idle' | 'lights' | 'awaiting-darks' | 'darks' | 'complete' | 'stopped' | 'failed'
  plan?: ExternalSequencePlan
  frameKind?: 'light' | 'dark'
  currentIndex?: number
  completed: number
  failed: number
  lastError?: string
  target?: TargetSummary
}

export type PreviewPhase = 'none' | 'starting' | 'active' | 'error'

// Rig-neutral preview source: 'native' means the rig's own live preview
// transport (e.g. Seestar RTSP), whatever it is. Kept transport-agnostic so
// the projection does not leak a specific wire protocol.
export type PreviewSource = 'none' | 'native'

export interface PreviewProjection {
  phase: PreviewPhase
  source: PreviewSource
  active: boolean
  lastError?: string
}

export interface LibraryAsset {
  id: string
  name: string
  capturedAt: string
  kind: 'stack' | 'sub' | 'calibration' | 'exposure'
  frameKind?: 'light' | 'dark'
  // Persisted frame location for external exposures. Present only when the
  // frame bytes were saved to disk by the main-process FrameStorage service;
  // absent for native stacking assets and when an external frame failed to
  // persist. The pixel format/dimensions describe how to interpret the saved
  // FITS payload for later post-processing.
  saved?: boolean
  savedFileSize?: number
  // Sibling JPG preview path for external exposures. Present when the
  // FrameStorage service generated a preview JPG alongside the FITS file;
  // absent when preview persistence failed (the FITS still exists) or for
  // native stacking assets. The UI uses this for the main preview area and
  // filmstrip thumbnails instead of on-demand FITS processing.
  hasPreview?: boolean
  previewFileSize?: number
  previewError?: string
  frameWidth?: number
  frameHeight?: number
  framePixelFormat?: string
}

export type LibraryScope = 'current_target' | 'all_targets'

export interface LibraryProjection {
  scope: LibraryScope
  assets: readonly LibraryAsset[]
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
  canPark?: boolean
  canPoint?: boolean
  serialNumber?: string
  firmwareVersion?: string
  batteryPercent?: number
  deviceTempC?: number
  batteryTempC?: number
  tracking?: boolean
  mountClosed?: boolean
  connectedAt?: string
  location?: { lat: number; lon: number }
  locationSource?: 'configured' | 'device' | 'geoip'
  deviceTime?: DeviceTimeProjection
  deviceTimeLooksStale?: boolean
  // Rig-neutral device activity signal. Adapters derive this from their
  // own raw view/imaging state so the public projection does not leak a
  // specific rig's view-mode vocabulary.
  activity?: 'idle' | 'previewing' | 'capturing'
  storageFreeMb?: number
  storageTotalMb?: number
  warnings?: readonly string[]
}

export interface RigControlsProjection {
  focuser?: { position: number; maxStep: number; moving: boolean }
  filterWheel?: { names: readonly string[]; focusOffsets: readonly number[]; position: number }
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
  darkExposure: WorkspaceCapabilityFlag
  autofocus: WorkspaceCapabilityFlag
  filterWheel: WorkspaceCapabilityFlag
  focuser?: WorkspaceCapabilityFlag
  storage: WorkspaceCapabilityFlag
}

export type WorkspaceSurfaceKind = 'idle' | 'scenery' | 'solar' | 'deepsky'

export interface WorkspaceSurface {
  kind: WorkspaceSurfaceKind
  label: string
}

export type WorkspaceActionId =
  | 'connect'
  | 'select-target'
  | 'retry-slew'
  | 'retry-preview'
  | 'stop-preview'
  | 'stop-capture'
  | 'preview'
  | 'capture'
  | 'unpark'
  | 'abort-slew'
  | 'focus'
  | 'filter'

export interface WorkspaceAction {
  id: WorkspaceActionId
  label: string
  enabled: boolean
  active?: boolean
}

export interface WorkspaceProjection {
  state: WorkspaceState
  stateLabel: string
  surface: WorkspaceSurface
  capabilities: WorkspaceCapabilities
  actions: readonly WorkspaceAction[]
}

export interface DesktopStatus {
  session: SessionProjection
  pointing: PointingProjection
  capture: CaptureProjection
  preview: PreviewProjection
  device: DeviceProjection
  library: LibraryProjection
  workspace: WorkspaceProjection
  camera?: CameraSettings
  controls?: RigControlsProjection
  sequence: ExternalSequenceProjection
  currentTarget: TargetSummary | null
  statusRevision: number
  lastUpdatedAt: string
  lastError?: string
}

export type DevicePluginKind = 'fake-seestar' | 'seestar' | 'alpaca-rig'

export interface DesktopDiscoveredDeviceV2 {
  pluginKind: DevicePluginKind
  deviceId: string
  displayName: string
  host?: string
  productModel?: string
  serialNumber?: string
}

export interface DeepSkyTargetDetails {
  kind: 'dso'
  designation: string
  objectType: OpenNgcObjectType
  raHours: number
  decDeg: number
  constellation: string
  visualMagnitude?: number
  surfaceBrightness?: number
  majorAxisArcmin?: number
}

export interface SolarSystemTargetDetails {
  kind: 'solar-system'
  designation: string
  body: SolarSystemBody
}

export type TargetDetails = DeepSkyTargetDetails | SolarSystemTargetDetails

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

export interface SetExposureDurationRequest {
  durationSec: number
}

export interface ConfigureExternalSequenceRequest extends ExternalSequencePlan {}

export interface SetObserverLocationRequest {
  location: { lat: number; lon: number } | null
}

export interface MoveFocuserRequest { position: number }
export interface SetFilterPositionRequest { position: number }

export interface SeestarDesktopApiV2 {
  discover(): Promise<readonly DesktopDiscoveredDeviceV2[]>
  connect(input: ConnectRequestV2): Promise<DesktopStatus>
  disconnect(): Promise<DesktopStatus>
  getStatus(): Promise<DesktopStatus>
  getLogs(): Promise<readonly DesktopLogEntryV2[]>
  browseTargets(query?: CatalogQuery): Promise<CatalogPage>
  getTargetById(targetId: string): Promise<TargetDetails | null>
  pointToTarget(input: PointToTargetRequest): Promise<DesktopStatus>
  startPreview(): Promise<DesktopStatus>
  stopPreview(): Promise<DesktopStatus>
  startCapture(): Promise<DesktopStatus>
  stopCapture(): Promise<DesktopStatus>
  parkMount(): Promise<DesktopStatus>
  unparkMount(): Promise<DesktopStatus>
  abortSlew(): Promise<DesktopStatus>
  setExposureDuration(
    input: SetExposureDurationRequest,
  ): Promise<DesktopStatus>
  configureExternalSequence(input: ConfigureExternalSequenceRequest): Promise<DesktopStatus>
  setObserverLocation(input: SetObserverLocationRequest): Promise<DesktopStatus>
  moveFocuser(input: MoveFocuserRequest): Promise<DesktopStatus>
  setFilterPosition(input: SetFilterPositionRequest): Promise<DesktopStatus>
  startExternalSequence(): Promise<DesktopStatus>
  continueExternalSequence(): Promise<DesktopStatus>
  finishExternalSequence(): Promise<DesktopStatus>
  // Open a persisted external frame in the OS default handler. The opaque ID
  // is resolved by main only within the managed library.
  openSavedAsset(assetId: string): Promise<void>
  // Reveal a persisted external frame in the platform file manager.
  revealSavedAsset(assetId: string): Promise<void>
  // Read the managed preview sibling for an asset as a data URL.
  getSavedAssetPreview(assetId: string): Promise<string | null>
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
  scenarios: readonly FakeScenarioSummary[]
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
