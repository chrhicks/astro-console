import { Effect, Schema, Stream } from 'effect'

export class RigTransportError extends Schema.TaggedErrorClass<RigTransportError>()(
  'RigTransportError',
  { provider: Schema.String, operation: Schema.String, message: Schema.String, cause: Schema.Defect() },
) {}

export class RigProtocolError extends Schema.TaggedErrorClass<RigProtocolError>()(
  'RigProtocolError',
  { provider: Schema.String, operation: Schema.String, message: Schema.String },
) {}

export class RigRejectedError extends Schema.TaggedErrorClass<RigRejectedError>()(
  'RigRejectedError',
  { provider: Schema.String, operation: Schema.String, message: Schema.String },
) {}

export class RigUnavailableError extends Schema.TaggedErrorClass<RigUnavailableError>()(
  'RigUnavailableError',
  { provider: Schema.String, operation: Schema.String, message: Schema.String },
) {}

export type RigError =
  | RigTransportError
  | RigProtocolError
  | RigRejectedError
  | RigUnavailableError

export interface RigIdentity {
  readonly rigId: string
  readonly provider: 'alpaca' | 'seestar'
  readonly displayName: string
  readonly host?: string
  readonly port?: number
  readonly model?: string
  readonly serialNumber?: string
  readonly firmwareVersion?: string
}

export interface RigCoordinates {
  readonly raHours: number
  readonly decDeg: number
}

export interface RigOperationContext {
  readonly signal?: AbortSignal
}

export interface RigMountSnapshot {
  readonly parked?: boolean
  readonly tracking?: boolean
}

export interface RigPreviewSnapshot {
  readonly active: boolean
  readonly source: 'native' | 'none'
}

export interface RigCaptureSnapshot {
  readonly active: boolean
  readonly mode?: 'native' | 'external'
}

export interface RigDeviceTelemetry {
  readonly batteryPercent?: number
  readonly deviceTempC?: number
  readonly batteryTempC?: number
  readonly storageFreeMb?: number
  readonly storageTotalMb?: number
  readonly deviceTime?: {
    readonly year: number
    readonly mon: number
    readonly day: number
    readonly hour: number
    readonly min: number
    readonly sec: number
    readonly timeZone?: string
  }
  readonly deviceTimeLooksStale?: boolean
}

export interface RigSnapshot {
  readonly mount: RigMountSnapshot
  readonly preview: RigPreviewSnapshot
  readonly capture: RigCaptureSnapshot
  readonly telemetry?: RigDeviceTelemetry
  readonly warnings: readonly string[]
}

export interface RigEvent {
  readonly type: 'capture.failed' | 'status.changed'
  readonly message?: string
  readonly health?: 'healthy' | 'stale' | 'recovering' | 'failed'
}

export interface RigMount {
  readonly slewToCoordinates?: (
    input: RigCoordinates,
    context?: RigOperationContext,
  ) => Effect.Effect<void, RigError>
  readonly park?: (context?: RigOperationContext) => Effect.Effect<void, RigError>
  readonly unpark?: (context?: RigOperationContext) => Effect.Effect<void, RigError>
  readonly stopMotion?: (context?: RigOperationContext) => Effect.Effect<void, RigError>
}

export interface RigCameraExposureInput {
  readonly durationSec: number
  readonly light?: boolean
}

export interface RigCameraExposureState {
  readonly state: 'idle' | 'exposing' | 'reading' | 'ready' | 'error'
  readonly imageReady: boolean
  readonly lastExposureDurationSec?: number
  readonly lastError?: string
}

export type RigFrameTransfer = 'image-bytes' | 'json-array' | 'vendor-file'
export type RigFramePixelFormat =
  | 'mono8'
  | 'mono16'
  | 'rgb24'
  | 'rgb48'
  | 'bayer16'
  | 'unknown'

export interface RigFrameResult {
  readonly transfer: RigFrameTransfer
  readonly width: number
  readonly height: number
  readonly pixelFormat: RigFramePixelFormat
  readonly data: Uint8Array
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

export interface RigCamera {
  readonly startExposure: (
    input: RigCameraExposureInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, RigError>
  readonly startDarkExposure?: (
    input: RigCameraExposureInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, RigError>
  readonly stopExposure: (context?: RigOperationContext) => Effect.Effect<void, RigError>
  readonly getExposureState: (
    context?: RigOperationContext,
  ) => Effect.Effect<RigCameraExposureState, RigError>
  readonly getLatestFrame: (
    context?: RigOperationContext,
  ) => Effect.Effect<RigFrameResult, RigError>
}

export interface RigFocuser {
  readonly moveTo: (position: number) => Effect.Effect<void, RigError>
}

export interface RigAutofocus {
  readonly run: (context?: RigOperationContext) => Effect.Effect<void, RigError>
}

export interface RigFilterWheel {
  readonly setPosition: (
    position: number,
    context?: RigOperationContext,
  ) => Effect.Effect<void, RigError>
}

export interface RigStorage {
  readonly listImages: () => Effect.Effect<readonly string[], RigError>
}

export interface RigPointingPrepareInput {
  readonly lat: number
  readonly lon: number
}

export interface RigPointingInput extends RigCoordinates {
  readonly targetType: string
  readonly targetName?: string
}

export interface RigPointing {
  readonly prepare: (
    input: RigPointingPrepareInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, RigError>
  readonly pointToCoordinates: (
    input: RigPointingInput,
    context?: RigOperationContext,
  ) => Effect.Effect<void, RigError>
}

export interface RigPreview {
  readonly start: (context?: RigOperationContext) => Effect.Effect<void, RigError>
  readonly stop: (context?: RigOperationContext) => Effect.Effect<void, RigError>
}

export interface RigNativeCapture {
  readonly start: (context?: RigOperationContext) => Effect.Effect<void, RigError>
  readonly stop: (context?: RigOperationContext) => Effect.Effect<void, RigError>
}

export interface RigSession {
  readonly identity: RigIdentity
  readonly observerLocation?: { readonly lat: number; readonly lon: number }
  readonly snapshot: RigSnapshot
  readonly refresh: Effect.Effect<RigSnapshot, RigError>
  readonly disconnect: Effect.Effect<void, RigError>
  readonly events?: Stream.Stream<RigEvent, RigError>
  readonly mount?: RigMount
  readonly preview?: RigPreview
  readonly nativeCapture?: RigNativeCapture
  readonly camera?: RigCamera
  readonly pointing?: RigPointing
  readonly autofocus?: RigAutofocus
  readonly focuser?: RigFocuser
  readonly filterWheel?: RigFilterWheel
  readonly storage?: RigStorage
}
