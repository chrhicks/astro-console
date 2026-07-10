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
import type { DeviceSession } from '../device/device-plugin'

export interface SessionAggregate {
  // host/productModel are derived from the device projection in the status
  // projector; the aggregate does not duplicate rig/device identity metadata.
  session: {
    phase: 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
    discovering: boolean
    lastError?: string
    // Correlates aggregate session state with the SessionManager's current
    // session. Set when a session is installed; cleared on disconnect. The
    // projector and workflows check this to avoid reporting connected for a
    // stale or absent session. Not exposed to the renderer.
    sessionId?: string
    // Monotonic lifecycle generation. Bumped atomically by beginConnect/
    // beginDisconnect in the unified RuntimeStateRef. Final commits require
    // exact generation ownership so an older intent can never overwrite a
    // newer intent's aggregate state. Not exposed to the renderer.
    generation: number
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
  diagnostics: {}
  lastUpdatedAt: string
}

// The kind of operation that holds the current operation lease. Ordinary
// hardware mutations (point, preview-start, capture-start) are mutually
// exclusive. Recovery operations (stop-preview, stop-capture, park,
// disconnect) preempt any current ordinary operation. Not exposed to the
// renderer.
export type OperationKind =
  | 'point'
  | 'preview-start'
  | 'capture-start'
  | 'stop-preview'
  | 'stop-capture'
  | 'park'
  | 'disconnect'

// Internal runtime state for the current operation lease. Held in RuntimeState
// (not SessionAggregate) so operation internals are never exposed to the
// renderer. The AbortController is mutable; recovery preempts by calling
// controller.abort() on the superseded operation.
export interface OperationRuntimeState {
  readonly id: string
  readonly sessionId: string
  readonly kind: OperationKind
  readonly generation: number
  readonly controller: AbortController
}

// The unified runtime state: session manager ownership + aggregate + current
// operation lease in one value, backed by a single Ref. All lifecycle
// transitions (beginConnect, beginDisconnect, install, clear), operation
// lease acquire/preempt/release, and workflow CAS commits (commitIfLease)
// operate on this via Ref.modify so generation, current session, aggregate
// phase/sessionId, and operation lease are always atomically consistent.
export interface RuntimeState {
  readonly generation: number
  readonly session: DeviceSession | null
  readonly aggregate: SessionAggregate
  readonly operation: OperationRuntimeState | null
}

export function createInitialAggregate(): SessionAggregate {
  return {
    session: { phase: 'disconnected', discovering: false, generation: 0 },
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
    diagnostics: {},
    camera: null,
    lastUpdatedAt: new Date().toISOString(),
  }
}

export function createInitialRuntimeState(): RuntimeState {
  return {
    generation: 0,
    session: null,
    aggregate: createInitialAggregate(),
    operation: null,
  }
}

// Stamp the aggregate's lastUpdatedAt. Used by all store operations.
export function stampAggregate(next: SessionAggregate): SessionAggregate {
  return {
    ...next,
    lastUpdatedAt: new Date().toISOString(),
  }
}
