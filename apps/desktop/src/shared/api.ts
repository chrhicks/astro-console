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
  error?: string;
  host?: string;
  data?: unknown;
}

export interface DesktopStatus {
  connected: boolean;
  authenticated: boolean;
  host?: string;
  deviceState: Record<string, unknown> | null;
  viewState: Record<string, unknown> | null;
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
  runCommand(input: DesktopCommandRequest): Promise<DesktopStatus>;
  getLogs(): Promise<DesktopLogEntry[]>;
  onLog(listener: (entry: DesktopLogEntry) => void): () => void;
  onStatus(listener: (status: DesktopStatus) => void): () => void;
}
