import { Effect } from 'effect'
import type {
  CaptureProjection,
  DevicePluginKind,
  DeviceProjection,
  LibraryProjection,
  PreviewProjection,
} from '../../../shared/api-v2'

export interface RigIdentity {
  readonly rigId: string
  readonly pluginKind: DevicePluginKind
  readonly displayName: string
  readonly host?: string
  readonly port?: number
}

export interface RigConnection {
  readonly disconnect: Effect.Effect<void>
}

// Rig-level capability flags surfaced at connect time for workspace and
// catalog projection. The canonical definition lives here so the rig model
// owns the public capability seam; device-plugin re-exports it for
// compatibility.
export interface DeviceCapabilities {
  readonly supportsStacking: boolean
  readonly supportsLivePreview: boolean
  readonly supportsFilterWheel: boolean
  readonly supportsAutofocus: boolean
  readonly supportsStorageAccess: boolean
}

// Volatile device/preview/capture fields that change after rig commands.
// Workflows merge `device` into the existing aggregate device projection;
// `preview` and `capture` replace the aggregate outright. This is the
// rig-level refresh surface; plugin adapters delegate to it from their
// session-shaped refresh implementations.
export interface RigSessionRefresh {
  device: Pick<
    DeviceProjection,
    'viewMode' | 'viewStage' | 'viewState' | 'tracking' | 'mountClosed' | 'warnings'
  >
  preview: PreviewProjection
  capture: CaptureProjection
}

export interface RigCoordinates {
  readonly raHours: number
  readonly decDeg: number
}

// Generic mount operations. `park` is the baseline capability (Seestar
// exposes only park); direct coordinate slew and motion stop are
// Alpaca-style capabilities that a rig may omit when pointing is handled
// via RigPointingWorkflow orchestration instead.
export interface RigMount {
  readonly slewToCoordinates?: (
    input: RigCoordinates,
  ) => Effect.Effect<void, unknown>
  readonly park: () => Effect.Effect<void, unknown>
  readonly stopMotion?: () => Effect.Effect<void, unknown>
}

export interface RigCameraExposureInput {
  readonly durationSec: number
}

// Generic camera exposure operations. Seestar does not expose this because
// its imaging is stacking-based orchestration surfaced via RigCaptureWorkflow.
export interface RigCamera {
  readonly startExposure: (
    input: RigCameraExposureInput,
  ) => Effect.Effect<void, unknown>
  readonly stopExposure: () => Effect.Effect<void, unknown>
}

export interface RigFocuser {
  readonly moveTo: (position: number) => Effect.Effect<void, unknown>
}

export interface RigFilterWheel {
  readonly setPosition: (position: number) => Effect.Effect<void, unknown>
}

export interface RigStorage {
  readonly listImages: () => Effect.Effect<readonly string[], unknown>
}

export interface RigPointingPrepareInput {
  readonly lat: number
  readonly lon: number
}

export interface RigPointingInput {
  readonly mode: string
  readonly targetName?: string
  readonly raHours: number
  readonly decDeg: number
}

// Post-point projection override. A rig may surface deterministic
// post-point state (e.g. a fake device's scenario-driven projection) instead
// of requiring a refresh round-trip. When absent, the workflow falls back
// to rig.refresh.
export interface RigPointingResult {
  readonly device?: DeviceProjection
  readonly preview: PreviewProjection
  readonly capture: CaptureProjection
  readonly library: LibraryProjection
}

// Vendor-specific pointing orchestration above generic mount slew. Seestar
// implements this via its prepare + view-based slew choreography; a future
// Alpaca rig may implement it via mount + camera coordination or omit it.
export interface RigPointingWorkflow {
  readonly prepare: (
    input: RigPointingPrepareInput,
  ) => Effect.Effect<void, unknown>
  readonly pointToCoordinates: (
    input: RigPointingInput,
  ) => Effect.Effect<void, unknown>
  readonly afterPoint?: Effect.Effect<RigPointingResult | null, unknown>
}

export interface RigPreviewWorkflow {
  readonly start: () => Effect.Effect<void, unknown>
  readonly stop: () => Effect.Effect<void, unknown>
}

export interface RigCaptureWorkflow {
  readonly start: () => Effect.Effect<void, unknown>
  readonly stop: () => Effect.Effect<void, unknown>
}

// Connect-time projection bundle: the initial public state surfaced right
// after a rig connects. `device` is the full connect-time device projection
// (identity, location, firmware, etc.); `preview`/`capture`/`library` are
// the initial aggregate projections. Distinct from RigSessionRefresh,
// which carries only volatile post-command device fields.
export interface RigConnectState {
  readonly device: DeviceProjection
  readonly preview: PreviewProjection
  readonly capture: CaptureProjection
  readonly library: LibraryProjection
}

export interface ConnectedRig {
  readonly identity: RigIdentity
  readonly connection: RigConnection
  readonly observerLocation?: { lat: number; lon: number }
  readonly capabilities: DeviceCapabilities
  readonly connect: RigConnectState
  readonly refresh: Effect.Effect<RigSessionRefresh, unknown>
  readonly mount?: RigMount
  readonly camera?: RigCamera
  readonly focuser?: RigFocuser
  readonly filterWheel?: RigFilterWheel
  readonly storage?: RigStorage
  readonly pointing?: RigPointingWorkflow
  readonly preview?: RigPreviewWorkflow
  readonly capture?: RigCaptureWorkflow
}
