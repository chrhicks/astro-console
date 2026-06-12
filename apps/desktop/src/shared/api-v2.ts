import type { ConnectRequest } from "./api"

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
  
  export interface DeviceProjection {}
  
  export interface LibraryProjection {
    scope: 'current_target'
    assets: []
    polling: false
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

  export interface SeestarDesktopApiV2 {
    connect(input: ConnectRequest): Promise<DesktopStatus>
    disconnect(): Promise<DesktopStatus>
    getStatus(): Promise<DesktopStatus>

    onStatus(listener: (status: DesktopStatus) => void): () => void
  }
  