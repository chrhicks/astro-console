import { Effect } from 'effect'
import type {
  CaptureProjection,
  DevicePluginKind,
  DeviceProjection,
  LibraryProjection,
  PreviewProjection,
  TargetType,
} from '../../../shared/api-v2'

export interface RigIdentity {
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

export interface RigCoordinates {
  readonly raHours: number
  readonly decDeg: number
}

// Optional operation context passed to Rig surfaces so adapters can observe
// cancellation. The signal is aborted when a recovery operation preempts
// the current ordinary operation (stop/park/disconnect). Adapters that
// support cancellation should pass the signal to vendor SDK waits.
export interface RigOperationContext {
  readonly signal?: AbortSignal
}

// Generic mount operations are independently optional. A rig may expose a
// direct slew without parking, or parking without direct slew when pointing
// is handled by RigPointingWorkflow orchestration.
export interface RigMount {
  readonly slewToCoordinates?: (
    input: RigCoordinates,
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
  readonly park?: (context?: RigOperationContext) => Effect.Effect<void, unknown>
  readonly unpark?: (context?: RigOperationContext) => Effect.Effect<void, unknown>
  readonly stopMotion?: (
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
}

export interface RigCameraExposureInput {
  readonly durationSec: number
  readonly light?: boolean
}

// Device-reported exposure state. Mirrors the Alpaca camera state lifecycle
// (idle → exposing → reading → ready) with an explicit error state. `imageReady`
// is the canonical completion signal: when true, the exposure is finished and
// the image is available for download (a future slice).
export interface RigCameraExposureState {
  readonly state: 'idle' | 'exposing' | 'reading' | 'ready' | 'error'
  readonly imageReady: boolean
  readonly lastExposureDurationSec?: number
  readonly lastError?: string
}

// Transport used to retrieve a finished frame. Alpaca should prefer
// `image-bytes` via GET imagearray + Accept: application/imagebytes.
export type RigFrameTransfer = 'image-bytes' | 'json-array' | 'vendor-file'

export type RigFramePixelFormat =
  | 'mono8'
  | 'mono16'
  | 'rgb24'
  | 'rgb48'
  | 'bayer16'
  | 'unknown'

// Result of retrieving a finished frame after an exposure completes. The
// `data` field carries the raw pixel payload; callers that only need
// library metadata (asset count/name/timestamp) can ignore it. Kept off the
// public DesktopStatus so frame bytes do not bloat the renderer projection.
export interface RigFrameResult {
  readonly transfer: RigFrameTransfer
  readonly width: number
  readonly height: number
  readonly pixelFormat: RigFramePixelFormat
  readonly data: Uint8Array
  // Parsed ImageBytes descriptor when transfer is 'image-bytes'. Carries the
  // ASCOM numeric element type code and array rank needed to write a faithful
  // FITS file; absent when the header could not be interpreted, in which case
  // the storage layer fails honestly instead of writing a misleading file.
  readonly imageBytes?: {
    readonly imageElementType: number
    readonly transmissionElementType: number
    readonly rank: number
    readonly planes?: number
  }
  readonly metadata?: {
    readonly exposureDurationSec?: number
    readonly cameraName?: string
    readonly capturedAt?: string
  }
}

// Generic camera exposure operations. Seestar does not expose this because
// its imaging is stacking-based orchestration surfaced via RigCaptureWorkflow.
export interface RigCamera {
  readonly startExposure: (
    input: RigCameraExposureInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
  // Optional because a generic camera cannot truthfully promise that its
  // normal exposure command produces a dark frame.
  readonly startDarkExposure?: (
    input: RigCameraExposureInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
  readonly stopExposure: (
    context?: RigOperationContext,
  ) => Effect.Effect<void, unknown>
  readonly getExposureState: (
    context?: RigOperationContext,
  ) => Effect.Effect<RigCameraExposureState, unknown>
  readonly getLatestFrame: (
    context?: RigOperationContext,
  ) => Effect.Effect<RigFrameResult, unknown>
}

export interface RigFocuser {
  readonly moveTo: (position: number) => Effect.Effect<void, unknown>
}

export interface RigAutofocus {
  readonly run: (context?: RigOperationContext) => Effect.Effect<void, unknown>
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
// (identity, location, firmware, etc.); `preview`/`capture`/`library` are
// the initial aggregate projections. Distinct from RigSessionRefresh,
// which carries only volatile post-command device fields.
export interface RigConnectState {
  readonly device: DeviceProjection
  readonly preview: PreviewProjection
  readonly capture: CaptureProjection
  readonly library: LibraryProjection
}

interface ConnectedRigBase {
  readonly identity: RigIdentity
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
