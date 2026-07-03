import { DeviceProjection, PointingProjection, TargetSummary } from '../../../shared/api-v2'

export interface SessionAggregate {
  session: {
    phase: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
    host?: string
    productModel?: string
    discovering: boolean
    lastError?: string
  }
  pointing: PointingProjection
  capture: { phase: 'idle' }
  preview: { source: 'none'; active: false }
  device: DeviceProjection
  library: { scope: 'current_target'; assets: []; polling: false }
  currentTarget: TargetSummary | null
  runner: { owner: 'idle' }
  diagnostics: {}
  lastUpdatedAt: string
}

export function createInitialAggregate(): SessionAggregate {
  return {
    session: { phase: 'disconnected', discovering: false },
    pointing: { phase: 'idle', target: null },
    capture: { phase: 'idle' },
    preview: { source: 'none', active: false },
    device: {},
    library: { scope: 'current_target', assets: [], polling: false },
    currentTarget: null,
    runner: { owner: 'idle' },
    diagnostics: {},
    lastUpdatedAt: new Date().toISOString(),
  }
}
