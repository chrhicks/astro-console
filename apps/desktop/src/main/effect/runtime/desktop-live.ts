import { Layer } from 'effect'
import { CatalogStoreLive } from '../catalog/catalog-store.live'
import { DeviceRegistryLive } from '../device/device-registry'
import { GeoServiceLive } from '../geo/geo-service.live'
import { RuntimeStateRefLive } from '../state/runtime-state-ref'
import { AggregateStoreLive } from '../state/aggregate-store'
import { EventBusLive } from '../event/event-bus'
import { NativeCaptureMonitorLive } from '../event/native-capture-monitor'
import { LogSinkLive } from '../log/log-sink'
import { LogStreamLive } from '../log/log-stream'
import { SessionManagerLive } from '../session/session-manager.live'
import { OperationCoordinatorLive } from '../session/operation-coordinator'
import { StatusProjectorLive } from '../state/status-projector'
import { StatusStreamLive } from '../event/status-stream'
import { FrameStorageLive } from '../storage/frame-storage'

// RuntimeStateRefLive is the shared foundation: both AggregateStoreLive and
// SessionManagerLive depend on it and operate on the same Ref. They are
// merged together and RuntimeStateRefLive is provided to the merged layer so
// both services share one RuntimeState instance.
const servicesNeedingRuntimeState = Layer.mergeAll(
  AggregateStoreLive,
  SessionManagerLive,
)
const runtimeStateServices = Layer.provide(
  servicesNeedingRuntimeState,
  RuntimeStateRefLive,
)

const operationCoordinatorLayer = Layer.provide(
  OperationCoordinatorLive,
  Layer.merge(runtimeStateServices, RuntimeStateRefLive),
)

const baseLayer = Layer.mergeAll(
  runtimeStateServices,
  operationCoordinatorLayer,
  EventBusLive,
  DeviceRegistryLive,
  GeoServiceLive,
  FrameStorageLive,
)

const catalogLayer = Layer.provide(CatalogStoreLive, baseLayer)

const logLayer = Layer.provide(LogSinkLive, baseLayer)

const projectorLayer = Layer.provide(StatusProjectorLive, baseLayer)

const streamDeps = Layer.merge(baseLayer, projectorLayer)
const statusStreamLayer = Layer.provide(StatusStreamLive, streamDeps)
const logStreamDeps = Layer.merge(baseLayer, logLayer)
const logStreamLayer = Layer.provide(LogStreamLive, logStreamDeps)

const nativeCaptureMonitorLayer = Layer.provide(
  NativeCaptureMonitorLive,
  baseLayer,
)

export const DesktopLiveLayer = Layer.mergeAll(
  baseLayer,
  catalogLayer,
  logLayer,
  projectorLayer,
  statusStreamLayer,
  logStreamLayer,
  nativeCaptureMonitorLayer,
)
