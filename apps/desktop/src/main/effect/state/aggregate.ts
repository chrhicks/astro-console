import {
  CameraSettings,
  CaptureProjection,
  DeviceProjection,
  LibraryProjection,
  PointingProjection,
  PreviewProjection,
  TargetSummary,
  WorkspaceProjection,
} from '../../../shared/api-v2'

export interface SessionAggregate {
  // host/productModel are derived from the device projection in the status
  // projector; the aggregate does not duplicate rig/device identity metadata.
  session: {
    phase: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
    discovering: boolean
    lastError?: string
  }
  pointing: PointingProjection
  capture: CaptureProjection
  preview: PreviewProjection
  device: DeviceProjection
  library: LibraryProjection
  workspace: WorkspaceProjection
  // User-configured generic camera settings for the external exposure path.
  // Null when the connected rig has no generic RigCamera. Kept separate from
  // the volatile capture projection so rig refresh does not reset it.
  camera: CameraSettings | null
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
    camera: null,
    lastUpdatedAt: new Date().toISOString(),
  }
}
