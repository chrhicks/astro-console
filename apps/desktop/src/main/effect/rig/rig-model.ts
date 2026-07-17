import { Effect } from 'effect'
import type {
  RigAutofocus,
  RigCamera,
  RigCameraExposureInput,
  RigCameraExposureState,
  RigCoordinates,
  RigFilterWheel,
  RigFocuser,
  RigFramePixelFormat,
  RigFrameResult,
  RigFrameTransfer,
  RigMount,
  RigOperationContext,
  RigStorage,
} from 'seestar-sdk'
import type {
  CaptureProjection,
  DevicePluginKind,
  DeviceProjection,
  LibraryProjection,
  PointingProjection,
  PreviewProjection,
  TargetType,
} from '../../../shared/api-v2'

export type {
  RigAutofocus,
  RigCamera,
  RigCameraExposureInput,
  RigCameraExposureState,
  RigCoordinates,
  RigFilterWheel,
  RigFocuser,
  RigFramePixelFormat,
  RigFrameResult,
  RigFrameTransfer,
  RigMount,
  RigOperationContext,
  RigStorage,
}

export interface DesktopRigIdentity {
  readonly rigId: string
  readonly pluginKind: DevicePluginKind
  readonly displayName: string
  readonly host?: string
  readonly port?: number
}

// Volatile device/preview/capture fields that change after rig commands.
// Workflows merge `device` into the existing aggregate device projection;
// `preview` and `capture` replace the aggregate outright. This is the
// rig-level refresh surface; plugin adapters delegate to it from their
// session-shaped refresh implementations.
export interface RigSessionRefresh {
  device: Pick<
    DeviceProjection,
    'activity' | 'tracking' | 'mountClosed' | 'warnings'
  >
  preview: PreviewProjection
  capture: CaptureProjection
}


export interface RigPointingPrepareInput {
  readonly lat: number
  readonly lon: number
}

export interface RigPointingInput {
  readonly targetType: TargetType
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
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
  readonly pointToCoordinates: (
    input: RigPointingInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
  readonly afterPoint?: Effect.Effect<RigPointingResult | null, unknown>
}

export interface RigPreviewWorkflow {
  readonly start: (context?: RigOperationContext) => Effect.Effect<void, unknown>
  readonly stop: (context?: RigOperationContext) => Effect.Effect<void, unknown>
}

export interface RigCaptureWorkflow {
  readonly start: (context?: RigOperationContext) => Effect.Effect<void, unknown>
}

// Recovery-facing capture stop shared by native stacking and generic camera
// exposure. Start remains on the distinct native/external surfaces.
export interface RigCaptureStop {
  readonly stop: (context?: RigOperationContext) => Effect.Effect<void, unknown>
  readonly mode: 'native' | 'external'
}

// Connect-time projection bundle: the initial public state surfaced right
// after a rig connects. `device` is the full connect-time device projection
// (identity, location, firmware, etc.); `pointing`/`preview`/`capture`/
// `library` are the initial aggregate projections. Distinct from RigSessionRefresh,
// which carries only volatile post-command device fields.
export interface RigConnectState {
  readonly device: DeviceProjection
  readonly pointing?: PointingProjection
  readonly preview: PreviewProjection
  readonly capture: CaptureProjection
  readonly library: LibraryProjection
}

interface ConnectedRigBase {
  readonly identity: DesktopRigIdentity
  readonly observerLocation?: { lat: number; lon: number }
  readonly connect: RigConnectState
  readonly refresh: Effect.Effect<RigSessionRefresh, unknown>
  readonly mount?: RigMount
  readonly focuser?: RigFocuser
  readonly autofocus?: RigAutofocus
  readonly filterWheel?: RigFilterWheel
  readonly storage?: RigStorage
  readonly pointing?: RigPointingWorkflow
  readonly preview?: RigPreviewWorkflow
}

// Capture start and stop are assembled as one discriminated capability so a
// rig cannot expose a start surface without the matching canonical stop.
export type ConnectedRig = ConnectedRigBase & (
  | {
      readonly capture: RigCaptureWorkflow
      readonly camera?: undefined
      readonly captureStop: RigCaptureStop & { readonly mode: 'native' }
    }
  | {
      readonly capture?: undefined
      readonly camera: RigCamera
      readonly captureStop: RigCaptureStop & { readonly mode: 'external' }
    }
  | {
      readonly capture?: undefined
      readonly camera?: undefined
      readonly captureStop?: undefined
    }
)
