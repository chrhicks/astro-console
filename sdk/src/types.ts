import type { LogLevel, Logger } from './logging.js'

/**
 * Core types for Seestar JSON-RPC protocol and device responses.
 */

export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id: number
  method: string
  Timestamp?: string
  result?: unknown
  error?: unknown
  code?: number
}

export interface JsonRpcRequest {
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  Timestamp: string
  method: string
  result?: unknown
  error?: string
  code: number
  id: number
}

export interface VerifyChallenge {
  str: string
}

export interface VerifyResult {
  is_verified: boolean
}

export interface AlbumEntry {
  groupName?: string
  type?: string
  name?: string
  files: AlbumFile[]
}

export interface AlbumFile {
  name: string
  thn: string // thumbnail relative path
  count?: number
  type?: number
}

export interface AlbumsResult {
  path: string
  list: AlbumEntry[]
}

export interface DeviceState {
  [key: string]: unknown
}

export interface EquCoord {
  ra: number
  dec: number
}

export interface ViewStateResult {
  View?: Record<string, unknown>
}

export interface SeestarPushEvent {
  Event: string
  Timestamp?: string
  timestamp?: string
  state?: string
  error?: string
  code?: number
  route?: string[]
  [key: string]: unknown
}

export type PushEventListener = (event: SeestarPushEvent) => void

export interface WaitOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  signal?: AbortSignal
}

export interface ActionWaitOptions extends WaitOptions {
  waitForCompletion?: boolean
}

export interface StackEvent extends SeestarPushEvent {
  Event: 'Stack'
  stacked_frame?: number
  dropped_frame?: number
}

export interface ClientConfig {
  host?: string
  port?: number
  pemPath: string
  timeoutMs?: number
  discoveryTimeoutMs?: number
  logger?: Logger
  logLevel?: LogLevel
  logPath?: string
  traceProtocol?: boolean
}

export type SeestarViewMode = 'star' | 'moon' | 'sun' | 'planet' | 'scenery'

export interface StartViewOptions {
  mode: SeestarViewMode
  targetName?: string
  targetRaDec?: [number, number]
  lpFilter?: boolean
}

export interface StartupTarget {
  ra: number
  dec: number
  name?: string
}

export interface StartupObservationOptions {
  kind?: 'preview' | 'stack'
  restart?: boolean
  lpFilter?: boolean
  filterWheelPosition?: number
  settings?: Record<string, unknown>
}

export interface StartupSequenceOptions {
  dryRun?: boolean
  mode?: SeestarViewMode
  target?: StartupTarget
  syncTime?: boolean
  syncLocation?: {
    lat: number
    lon: number
  }
  openArm?: 'if_needed' | 'always' | 'never'
  autofocus?: 'off' | 'after_view'
  observation?: StartupObservationOptions
}

export interface DevelopmentSmokeTestOptions {
  dryRun?: boolean
  mode?: Extract<SeestarViewMode, 'scenery' | 'moon' | 'sun' | 'planet'>
  openArm?: 'if_needed' | 'always' | 'never'
  parkAtEnd?: boolean
}

export interface StartupStepReport {
  name: string
  ok: boolean
  changed?: boolean
  skipped?: boolean
  summary: string
  data?: unknown
  warning?: string
  error?: string
}

export interface PreflightSummary {
  host: string
  productModel?: string
  serialNumber?: string
  firmwareVersion?: string
  isVerified?: boolean
  batteryPercent?: number
  deviceTempC?: number
  batteryTempC?: number
  storageFreeMb?: number
  storageTotalMb?: number
  mountClosed?: boolean
  tracking?: boolean
  equMode?: boolean
  deviceTime?: {
    year: number
    mon: number
    day: number
    hour: number
    min: number
    sec: number
    timeZone?: string
  }
  deviceTimeLooksStale?: boolean
  viewMode?: string
  viewStage?: string
  viewState?: string
  targetName?: string
  location?: {
    lat: number
    lon: number
  }
  stationSsid?: string
  currentRaDec?: EquCoord | null
  raw: {
    deviceState: DeviceState | null
    viewState: ViewStateResult | null
    setting: unknown
    diskVolume: unknown
    piInfo: unknown
    time: unknown
  }
  warnings: string[]
}

export interface StartupSequenceReport {
  ok: boolean
  dryRun: boolean
  resolvedHost: string
  preflight?: PreflightSummary
  steps: StartupStepReport[]
  warnings: string[]
}

export interface ShareEntry {
  name: string
  path: string
  isDirectory: boolean
  sizeBytes: number
  flags: string
  modifiedRaw: string
}
