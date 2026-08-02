import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import {
  BootstrapClient,
  EventStream,
  SnapshotTransport,
  browserEventSourceFactoryLayer,
  browserEventStreamLayer,
  browserSnapshotTransportLayer,
  layer,
} from './bootstrap-client'
import {
  CommandClient,
  CommandTransport,
  browserCommandTransportLayer,
  layer as commandClientLayer,
} from './command-client'

const clientLayer = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
) => {
  const bootstrapClientLayer = layer.pipe(
    Layer.provide(snapshotTransportLayer),
    Layer.provide(eventStreamLayer),
  )
  return Layer.effectContext(
    Effect.gen(function* () {
      const bootstrap = yield* BootstrapClient
      const commands = yield* CommandClient
      return Context.empty().pipe(
        Context.add(BootstrapClient, bootstrap),
        Context.add(CommandClient, commands),
      )
    }),
  ).pipe(
    Layer.provide(commandClientLayer),
    Layer.provide(bootstrapClientLayer),
    Layer.provide(commandTransportLayer),
  )
}

export const makeBootstrapRuntime = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
) =>
  ManagedRuntime.make(
    clientLayer(
      snapshotTransportLayer,
      eventStreamLayer,
      commandTransportLayer,
    ),
  )

export const createBootstrapRuntime = () =>
  makeBootstrapRuntime(
    browserSnapshotTransportLayer,
    browserEventStreamLayer.pipe(Layer.provide(browserEventSourceFactoryLayer)),
    browserCommandTransportLayer,
  )
