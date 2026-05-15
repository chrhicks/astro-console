import type { PlanningSnapshot, SiteProfileDraft } from "./planning";
import type { CatalogSearchResult, ManualCatalogTargetInput } from "./starter-catalog";

export interface DesktopDiscoveredDevice {
  host: string;
  port: number;
  productModel?: string;
  serialNumber?: string;
  ssid?: string;
}

export interface DesktopLogEntry {
  ts: string;
  level: string;
  event: string;
  component: string;
  summary?: string;
  details?: string;
  error?: string;
  host?: string;
  data?: unknown;
}

export interface DesktopPreviewState {
  active: boolean;
  mode: "rtsp-mjpeg";
  rtspUrl?: string;
  lastFrameAt?: string;
  lastError?: string;
}

export interface DesktopPreviewFrame {
  ts: string;
  dataUrl: string;
}

export interface DesktopRecordingState {
  active: boolean;
  sessionId?: string;
  sessionDir?: string;
  startedAt?: string;
}

export interface DesktopReconnectState {
  active: boolean;
  attempt: number;
  host?: string;
  nextRetryAt?: string;
  lastError?: string;
}

export interface DesktopDeviceTime {
  year: number;
  mon: number;
  day: number;
  hour: number;
  min: number;
  sec: number;
  timeZone?: string;
}

export interface DesktopPlannerSiteContext {
  id: string;
  name: string;
  lat: number;
  lon: number;
  timezone: string;
}

export interface DesktopPlannerDiscoveryState {
  attempted: boolean;
  mode: "direct" | "discovered" | "fallback";
  requestedHost?: string;
  resolvedHost?: string;
  candidateCount?: number;
  lastAttemptAt?: string;
  lastError?: string;
}

export interface DesktopPlannerClockState {
  attempted: boolean;
  synced: boolean;
  staleBeforeSync: boolean;
  deviceTime?: DesktopDeviceTime;
  hostTime?: DesktopDeviceTime;
  lastSyncedAt?: string;
  lastError?: string;
}

export interface DesktopPlannerLocationState {
  attempted: boolean;
  synced: boolean;
  matchesActiveSite: boolean;
  targetLocation?: { lat: number; lon: number };
  deviceLocation?: { lat: number; lon: number };
  lastSyncedAt?: string;
  lastError?: string;
}

export interface DesktopPlannerHealth {
  ready: boolean;
  activeSite?: DesktopPlannerSiteContext;
  discovery: DesktopPlannerDiscoveryState;
  clock: DesktopPlannerClockState;
  location: DesktopPlannerLocationState;
  issues: string[];
  lastCheckedAt?: string;
}

export interface DesktopStatus {
  connected: boolean;
  authenticated: boolean;
  host?: string;
  deviceState: Record<string, unknown> | null;
  viewState: Record<string, unknown> | null;
  preview: DesktopPreviewState;
  recording: DesktopRecordingState;
  reconnect: DesktopReconnectState;
  planner: DesktopPlannerHealth;
  lastUpdatedAt?: string;
  lastError?: string;
}

export interface ConnectRequest {
  host?: string;
}

export interface CreateSiteProfileRequest {
  site: SiteProfileDraft;
  makeActive?: boolean;
}

export interface UpdateSiteProfileRequest {
  siteId: string;
  site: SiteProfileDraft;
}

export interface DuplicateSiteProfileRequest {
  siteId: string;
  makeActive?: boolean;
}

export interface ArchiveSiteProfileRequest {
  siteId: string;
}

export interface SetActiveSiteRequest {
  siteId: string;
}

export interface SearchCatalogTargetsRequest {
  query: string;
  limit?: number;
}

export interface AddManualCatalogTargetRequest {
  target: ManualCatalogTargetInput;
}

export type DesktopViewMode = "star" | "moon" | "sun" | "planet" | "scenery";

export type DesktopCommandAction =
  | "open-arm"
  | "park"
  | "start-view"
  | "stop-view"
  | "start-stack"
  | "stop-stack"
  | "autofocus";

export interface DesktopCommandRequest {
  action: DesktopCommandAction;
  mode?: DesktopViewMode;
}

export interface SeestarDesktopApi {
  discover(): Promise<DesktopDiscoveredDevice[]>;
  connect(input: ConnectRequest): Promise<DesktopStatus>;
  disconnect(): Promise<DesktopStatus>;
  getStatus(): Promise<DesktopStatus>;
  getPlanningSnapshot(): Promise<PlanningSnapshot>;
  createSiteProfile(input: CreateSiteProfileRequest): Promise<PlanningSnapshot>;
  updateSiteProfile(input: UpdateSiteProfileRequest): Promise<PlanningSnapshot>;
  duplicateSiteProfile(input: DuplicateSiteProfileRequest): Promise<PlanningSnapshot>;
  archiveSiteProfile(input: ArchiveSiteProfileRequest): Promise<PlanningSnapshot>;
  setActiveSite(input: SetActiveSiteRequest): Promise<PlanningSnapshot>;
  searchCatalogTargets(input: SearchCatalogTargetsRequest): Promise<CatalogSearchResult[]>;
  addManualCatalogTarget(input: AddManualCatalogTargetRequest): Promise<PlanningSnapshot>;
  refreshState(): Promise<DesktopStatus>;
  startPreview(): Promise<DesktopStatus>;
  stopPreview(): Promise<DesktopStatus>;
  runCommand(input: DesktopCommandRequest): Promise<DesktopStatus>;
  getLogs(): Promise<DesktopLogEntry[]>;
  onLog(listener: (entry: DesktopLogEntry) => void): () => void;
  onStatus(listener: (status: DesktopStatus) => void): () => void;
  onPreviewFrame(listener: (frame: DesktopPreviewFrame) => void): () => void;
}
