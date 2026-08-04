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
import {
  PreflightRefreshClient,
  PreflightRefreshTransport,
  browserPreflightRefreshTransportLayer,
  layer as preflightRefreshClientLayer,
} from './preflight-refresh-client'
import {
  LibraryClient,
  browserLibraryTransportLayer,
  layer as libraryClientLayer,
} from './library-client'

const clientLayer = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
  planCommandTransportLayer: Layer.Layer<PlanCommandTransport>,
  observeCommandTransportLayer: Layer.Layer<ObserveCommandTransport> = browserObserveCommandTransportLayer,
  preflightRefreshTransportLayer: Layer.Layer<PreflightRefreshTransport> = browserPreflightRefreshTransportLayer,
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
      const preflightRefresh = yield* PreflightRefreshClient
      const library = yield* LibraryClient
      return Context.empty().pipe(
        Context.add(BootstrapClient, bootstrap),
        Context.add(CommandClient, commands),
        Context.add(PlanCommandClient, planCommands),
        Context.add(ObserveCommandClient, observeCommands),
        Context.add(PreflightRefreshClient, preflightRefresh),
        Context.add(LibraryClient, library),
      )
    }),
  ).pipe(
    Layer.provide(commandClientLayer),
    Layer.provide(planCommandClientLayer),
    Layer.provide(observeCommandClientLayer),
    Layer.provide(preflightRefreshClientLayer),
    Layer.provide(libraryClientLayer),
  )
  return clients.pipe(
    Layer.provide(bootstrapClientLayer),
    Layer.provide(commandTransportLayer),
    Layer.provide(planCommandTransportLayer),
    Layer.provide(observeCommandTransportLayer),
    Layer.provide(preflightRefreshTransportLayer),
    Layer.provide(browserLibraryTransportLayer),
  )
}

export const makeBootstrapRuntime = (
  snapshotTransportLayer: Layer.Layer<SnapshotTransport>,
  eventStreamLayer: Layer.Layer<EventStream>,
  commandTransportLayer: Layer.Layer<CommandTransport>,
  planCommandTransportLayer: Layer.Layer<PlanCommandTransport>,
  observeCommandTransportLayer: Layer.Layer<ObserveCommandTransport> = browserObserveCommandTransportLayer,
  preflightRefreshTransportLayer: Layer.Layer<PreflightRefreshTransport> = browserPreflightRefreshTransportLayer,
) =>
  ManagedRuntime.make(
    clientLayer(
      snapshotTransportLayer,
      eventStreamLayer,
      commandTransportLayer,
      planCommandTransportLayer,
      observeCommandTransportLayer,
      preflightRefreshTransportLayer,
    ),
  )

export const createBootstrapRuntime = () =>
  makeBootstrapRuntime(
    browserSnapshotTransportLayer,
    browserEventStreamLayer.pipe(Layer.provide(browserEventSourceFactoryLayer)),
    browserCommandTransportLayer,
    browserPlanCommandTransportLayer,
    browserObserveCommandTransportLayer,
    browserPreflightRefreshTransportLayer,
  )
