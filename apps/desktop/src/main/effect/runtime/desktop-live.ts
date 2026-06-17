import { Layer } from 'effect'
import { DeviceRegistryLive } from '../device/device-registry'
import { AggregateStoreLive } from '../state/aggregate-store'
import { EventBusLive } from '../event/event-bus'
import { LogSinkLive } from '../log/log-sink'
import { LogStreamLive } from '../log/log-stream'
import { SessionManagerLive } from '../session/session-manager.live'
import { StatusProjectorLive } from '../state/status-projector'
import { StatusStreamLive } from '../event/status-stream'

const baseLayer = Layer.mergeAll(
  AggregateStoreLive,
  EventBusLive,
  DeviceRegistryLive,
  SessionManagerLive,
)

const logLayer = Layer.provide(LogSinkLive, baseLayer)

const projectorLayer = Layer.provide(StatusProjectorLive, baseLayer)

const streamDeps = Layer.merge(baseLayer, projectorLayer)
const statusStreamLayer = Layer.provide(StatusStreamLive, streamDeps)
const logStreamDeps = Layer.merge(baseLayer, logLayer)
const logStreamLayer = Layer.provide(LogStreamLive, logStreamDeps)

export const DesktopLiveLayer = Layer.mergeAll(
  baseLayer,
  logLayer,
  projectorLayer,
  statusStreamLayer,
  logStreamLayer,
)
