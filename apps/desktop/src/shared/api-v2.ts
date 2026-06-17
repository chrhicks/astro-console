export interface SessionProjection {
  phase: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
  host?: string
  productModel?: string
  discovering: boolean
  reconnect?: {
    active: boolean
    attempt: number
    nextRetryAt?: string
    lastError?: string
  }
}

export interface PointingProjection {
  phase: 'idle'
}

export interface CaptureProjection {
  phase: 'idle'
}

export interface PreviewProjection {
  source: 'none'
  active: false
}

export interface LibraryProjection {
  scope: 'current_target'
  assets: []
  polling: false
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
}

export interface TargetSummary {
  id: string
  short: string
  name: string
  visibility: 'later'
  visibilityLabel: string
  recommendedFilter: 'clear'
  type: 'dso'
}

export interface DesktopStatus {
  session: SessionProjection
  pointing: PointingProjection
  capture: CaptureProjection
  preview: PreviewProjection
  device: DeviceProjection
  library: LibraryProjection
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
  onLog(listener: (entry: DesktopLogEntryV2) => void): () => void
  onStatus(listener: (status: DesktopStatus) => void): () => void
}
