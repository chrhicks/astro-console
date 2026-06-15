import { Layer } from 'effect'
import { DeviceRegistryLive } from '../device/device-registry'
import { AggregateStoreLive } from '../state/aggregate-store'
import { EventBusLive } from '../event/event-bus'
import { SessionManagerFake } from '../session/session-manager.fake'
import { StatusProjectorLive } from '../state/status-projector'
import { StatusStreamLive } from '../event/status-stream'

const baseLayer = Layer.mergeAll(
  AggregateStoreLive,
  EventBusLive,
  DeviceRegistryLive,
  SessionManagerFake
)

const projectorLayer = Layer.provide(StatusProjectorLive, baseLayer)

const streamDeps = Layer.merge(baseLayer, projectorLayer)
const statusStreamLayer = Layer.provide(StatusStreamLive, streamDeps)

export const DesktopLiveLayer = Layer.mergeAll(
  baseLayer,
  projectorLayer,
  statusStreamLayer
)
