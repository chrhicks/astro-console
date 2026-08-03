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
import {
  ObserveCommandClient,
  ObserveCommandTransport,
  browserObserveCommandTransportLayer,
  layer as observeCommandClientLayer,
} from './observe-command-client'

const clientLayer = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
  planCommandTransportLayer: Layer.Layer<PlanCommandTransport>,
  observeCommandTransportLayer: Layer.Layer<ObserveCommandTransport> = browserObserveCommandTransportLayer,
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
      const observeCommands = yield* ObserveCommandClient
      return Context.empty().pipe(
        Context.add(BootstrapClient, bootstrap),
        Context.add(CommandClient, commands),
        Context.add(PlanCommandClient, planCommands),
        Context.add(ObserveCommandClient, observeCommands),
      )
    }),
  ).pipe(
    Layer.provide(commandClientLayer),
    Layer.provide(planCommandClientLayer),
    Layer.provide(observeCommandClientLayer),
  )
  return clients.pipe(
    Layer.provide(bootstrapClientLayer),
    Layer.provide(commandTransportLayer),
    Layer.provide(planCommandTransportLayer),
    Layer.provide(observeCommandTransportLayer),
  )
}

export const makeBootstrapRuntime = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
  planCommandTransportLayer: Layer.Layer<PlanCommandTransport>,
  observeCommandTransportLayer: Layer.Layer<ObserveCommandTransport> = browserObserveCommandTransportLayer,
) =>
  ManagedRuntime.make(
    clientLayer(
      snapshotTransportLayer,
      eventStreamLayer,
      commandTransportLayer,
      planCommandTransportLayer,
      observeCommandTransportLayer,
    ),
  )

export const createBootstrapRuntime = () =>
  makeBootstrapRuntime(
    browserSnapshotTransportLayer,
    browserEventStreamLayer.pipe(Layer.provide(browserEventSourceFactoryLayer)),
    browserCommandTransportLayer,
    browserPlanCommandTransportLayer,
    browserObserveCommandTransportLayer,
  )
