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
import {
  PlanCommandClient,
  PlanCommandTransport,
  browserPlanCommandTransportLayer,
  layer as planCommandClientLayer,
} from './plan-command-client'

const clientLayer = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
  planCommandTransportLayer: Layer.Layer<PlanCommandTransport>,
) => {
  const bootstrapClientLayer = layer.pipe(
    Layer.provide(snapshotTransportLayer),
    Layer.provide(eventStreamLayer),
  )
  const clients = Layer.effectContext(
    Effect.gen(function* () {
      const bootstrap = yield* BootstrapClient
      const commands = yield* CommandClient
      const planCommands = yield* PlanCommandClient
      return Context.empty().pipe(
        Context.add(BootstrapClient, bootstrap),
        Context.add(CommandClient, commands),
        Context.add(PlanCommandClient, planCommands),
      )
    }),
  ).pipe(
    Layer.provide(commandClientLayer),
    Layer.provide(planCommandClientLayer),
  )
  return clients.pipe(
    Layer.provide(bootstrapClientLayer),
    Layer.provide(commandTransportLayer),
    Layer.provide(planCommandTransportLayer),
  )
}

export const makeBootstrapRuntime = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
  planCommandTransportLayer: Layer.Layer<PlanCommandTransport>,
) =>
  ManagedRuntime.make(
    clientLayer(
      snapshotTransportLayer,
      eventStreamLayer,
      commandTransportLayer,
      planCommandTransportLayer,
    ),
  )

export const createBootstrapRuntime = () =>
  makeBootstrapRuntime(
    browserSnapshotTransportLayer,
    browserEventStreamLayer.pipe(Layer.provide(browserEventSourceFactoryLayer)),
    browserCommandTransportLayer,
    browserPlanCommandTransportLayer,
  )
