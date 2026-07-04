import {
  CaptureProjection,
  DeviceProjection,
  LibraryProjection,
  PointingProjection,
  PreviewProjection,
  TargetSummary,
  WorkspaceProjection,
} from '../../../shared/api-v2'

export interface SessionAggregate {
  session: {
    phase: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
    host?: string
    productModel?: string
    discovering: boolean
    lastError?: string
  }
  pointing: PointingProjection
  capture: CaptureProjection
  preview: PreviewProjection
  device: DeviceProjection
  library: LibraryProjection
  workspace: WorkspaceProjection
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
    preview: { phase: 'none', source: 'none', active: false },
    device: {},
    library: { scope: 'current_target', assets: [], polling: false },
    workspace: {
      state: 'disconnected',
      stateLabel: 'Disconnected',
      surface: { kind: 'idle', label: 'Idle' },
      capabilities: {
        preview: 'unsupported',
        capture: 'unsupported',
        autofocus: 'no',
        filterWheel: 'no',
        storage: 'no',
      },
      actions: [],
    },
    currentTarget: null,
    runner: { owner: 'idle' },
    diagnostics: {},
    lastUpdatedAt: new Date().toISOString(),
  }
}
