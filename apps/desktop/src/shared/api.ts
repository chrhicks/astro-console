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

export interface DesktopStatus {
  connected: boolean;
  authenticated: boolean;
  host?: string;
  deviceState: Record<string, unknown> | null;
  viewState: Record<string, unknown> | null;
  preview: DesktopPreviewState;
  recording: DesktopRecordingState;
  reconnect: DesktopReconnectState;
  lastUpdatedAt?: string;
  lastError?: string;
}

export interface ConnectRequest {
  host: string;
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
  refreshState(): Promise<DesktopStatus>;
  startPreview(): Promise<DesktopStatus>;
  stopPreview(): Promise<DesktopStatus>;
  runCommand(input: DesktopCommandRequest): Promise<DesktopStatus>;
  getLogs(): Promise<DesktopLogEntry[]>;
  onLog(listener: (entry: DesktopLogEntry) => void): () => void;
  onStatus(listener: (status: DesktopStatus) => void): () => void;
  onPreviewFrame(listener: (frame: DesktopPreviewFrame) => void): () => void;
}
