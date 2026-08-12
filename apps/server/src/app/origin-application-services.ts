import { Context, Layer } from 'effect'
import type {
  OriginServerConfig,
  PreflightProviderConfig,
} from '../config/environment-config.ts'
import type { OriginTelemetry } from '../observability/origin-telemetry.ts'
import { defaultOriginTelemetry } from '../observability/origin-telemetry.ts'
import { recordOperationalEvent } from '../observability/operational-telemetry.ts'
import type { CapturedFrameStorage } from '../services/captured-frame-intake.ts'
import type { FrameInspectionStorage } from '../services/frame-inspection.ts'
import type { RunExecutionContext } from '../services/run-domain.ts'
import type { PlateSolveWorkerConfig } from '../workers/plate-solve-worker.ts'
import {
  CameraProviderSelection,
  PolarMeasurementProviderSelection,
  TargetAcquisitionProviderSelection,
  absentCameraProviderSelectionLayer,
  absentPolarMeasurementProviderSelectionLayer,
  absentTargetAcquisitionProviderSelectionLayer,
} from '../services/acquire-command-service.ts'
import {
  ReadOnlyPreflightProviderSelection,
  absentReadOnlyPreflightProviderSelectionLayer,
} from '../services/preflight-command-service.ts'
import {
  LibraryDownloadGrantSelection,
  LibraryRepresentationStorageSelection,
  absentLibraryDownloadGrantLayer,
  configuredLibraryRepresentationStorageLayer,
} from '../services/library-representation-service.ts'

export type OriginApplicationServices =
  | CameraProviderSelection
  | PolarMeasurementProviderSelection
  | TargetAcquisitionProviderSelection
  | ReadOnlyPreflightProviderSelection
  | OriginCapturedFrameStorage
  | OriginFrameInspectionStorage
  | OriginPlateSolveWorker
  | OriginConfiguredTargetProvider
  | OriginRunExecution
  | LibraryRepresentationStorageSelection
  | LibraryDownloadGrantSelection
  | OriginProjectionObservation
  | OriginProcessWorkBehavior
  | OriginApplicationTelemetry

export type OptionalSelection<A> =
  | { readonly _tag: 'Absent' }
  | { readonly _tag: 'Configured'; readonly value: A }

export class OriginCapturedFrameStorage extends Context.Service<
  OriginCapturedFrameStorage,
  OptionalSelection<CapturedFrameStorage>
>()('@astro-console/server/OriginCapturedFrameStorage') {}
export const absentOriginCapturedFrameStorageLayer = Layer.succeed(
  OriginCapturedFrameStorage,
  OriginCapturedFrameStorage.of({ _tag: 'Absent' }),
)
export const configuredOriginCapturedFrameStorageLayer = (
  value: CapturedFrameStorage,
) =>
  Layer.succeed(
    OriginCapturedFrameStorage,
    OriginCapturedFrameStorage.of({ _tag: 'Configured', value }),
  )

export class OriginFrameInspectionStorage extends Context.Service<
  OriginFrameInspectionStorage,
  OptionalSelection<FrameInspectionStorage>
>()('@astro-console/server/OriginFrameInspectionStorage') {}
export const absentOriginFrameInspectionStorageLayer = Layer.succeed(
  OriginFrameInspectionStorage,
  OriginFrameInspectionStorage.of({ _tag: 'Absent' }),
)
export const configuredOriginFrameInspectionStorageLayer = (
  value: FrameInspectionStorage,
) =>
  Layer.succeed(
    OriginFrameInspectionStorage,
    OriginFrameInspectionStorage.of({ _tag: 'Configured', value }),
  )

export class OriginPlateSolveWorker extends Context.Service<
  OriginPlateSolveWorker,
  OptionalSelection<PlateSolveWorkerConfig>
>()('@astro-console/server/OriginPlateSolveWorker') {}
export const absentOriginPlateSolveWorkerLayer = Layer.succeed(
  OriginPlateSolveWorker,
  OriginPlateSolveWorker.of({ _tag: 'Absent' }),
)
export const configuredOriginPlateSolveWorkerLayer = (
  value: PlateSolveWorkerConfig,
) =>
  Layer.succeed(
    OriginPlateSolveWorker,
    OriginPlateSolveWorker.of({ _tag: 'Configured', value }),
  )

export class OriginConfiguredTargetProvider extends Context.Service<
  OriginConfiguredTargetProvider,
  OptionalSelection<PreflightProviderConfig>
>()('@astro-console/server/OriginConfiguredTargetProvider') {}
export const absentOriginConfiguredTargetProviderLayer = Layer.succeed(
  OriginConfiguredTargetProvider,
  OriginConfiguredTargetProvider.of({ _tag: 'Absent' }),
)
export const configuredOriginConfiguredTargetProviderLayer = (
  value: PreflightProviderConfig,
) =>
  Layer.succeed(
    OriginConfiguredTargetProvider,
    OriginConfiguredTargetProvider.of({ _tag: 'Configured', value }),
  )

export type OriginRunExecutionShape =
  | { readonly _tag: 'Absent' }
  | {
      readonly _tag: 'Configured'
      readonly context: typeof RunExecutionContext.Type
      readonly providerOrigin: string
    }
export class OriginRunExecution extends Context.Service<
  OriginRunExecution,
  OriginRunExecutionShape
>()('@astro-console/server/OriginRunExecution') {}
export const absentOriginRunExecutionLayer = Layer.succeed(
  OriginRunExecution,
  OriginRunExecution.of({ _tag: 'Absent' }),
)
export const configuredOriginRunExecutionLayer = (
  context: typeof RunExecutionContext.Type,
  providerOrigin: string,
) =>
  Layer.succeed(
    OriginRunExecution,
    OriginRunExecution.of({ _tag: 'Configured', context, providerOrigin }),
  )

export type ProjectionObservationEvent = 'connect' | 'disconnect' | 'publish'
export class OriginProjectionObservation extends Context.Service<
  OriginProjectionObservation,
  (event: ProjectionObservationEvent) => void
>()('@astro-console/server/OriginProjectionObservation') {}
export const originProjectionObservationLayer = (
  observe: (event: ProjectionObservationEvent) => void = () => undefined,
) => Layer.succeed(OriginProjectionObservation, observe)

export type OriginProcessWorkBehaviorShape = {
  readonly outputRoot?: string
  readonly autoRun: boolean
}
export class OriginProcessWorkBehavior extends Context.Service<
  OriginProcessWorkBehavior,
  OriginProcessWorkBehaviorShape
>()('@astro-console/server/OriginProcessWorkBehavior') {}
export const originProcessWorkBehaviorLayer = (
  value: OriginProcessWorkBehaviorShape,
) =>
  Layer.succeed(OriginProcessWorkBehavior, OriginProcessWorkBehavior.of(value))

export class OriginApplicationTelemetry extends Context.Service<
  OriginApplicationTelemetry,
  OriginTelemetry
>()('@astro-console/server/OriginApplicationTelemetry') {}
export const originApplicationTelemetryLayer = (
  telemetry: OriginTelemetry = defaultOriginTelemetry,
) => Layer.succeed(OriginApplicationTelemetry, telemetry)

export const originTelemetryServicesLayer = (
  telemetry: OriginTelemetry = defaultOriginTelemetry,
) =>
  Layer.merge(
    originApplicationTelemetryLayer(telemetry),
    originProjectionObservationLayer((event) =>
      telemetry.runSync(
        recordOperationalEvent({
          scope: 'projection',
          operation: `sse.${event}`,
          outcome: 'success',
        }),
      ),
    ),
  )

export const defaultOriginApplicationServicesLayer = (
  config: OriginServerConfig,
) =>
  Layer.mergeAll(
    absentCameraProviderSelectionLayer,
    absentPolarMeasurementProviderSelectionLayer,
    absentTargetAcquisitionProviderSelectionLayer,
    absentReadOnlyPreflightProviderSelectionLayer,
    absentOriginCapturedFrameStorageLayer,
    absentOriginFrameInspectionStorageLayer,
    absentOriginPlateSolveWorkerLayer,
    absentOriginConfiguredTargetProviderLayer,
    absentOriginRunExecutionLayer,
    absentLibraryDownloadGrantLayer,
    configuredLibraryRepresentationStorageLayer({
      originalsRoot: config.runtime.originalsRoot,
      previewsRoot: config.runtime.previewRoot,
    }),
    originProjectionObservationLayer(),
    originProcessWorkBehaviorLayer({ autoRun: true }),
    originApplicationTelemetryLayer(),
  )
