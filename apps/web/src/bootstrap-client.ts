import {
  Context,
  Data,
  Effect,
  Layer,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
} from 'effect'
import {
  BootstrapHttpSuccessEnvelope,
  BootstrapSseEventEnvelope,
  decideEventCursor,
  EventCursorDecision,
  type BootstrapSnapshot,
} from '@astro-console/v2-contracts'

export type BootstrapClientState = Data.TaggedEnum<{
  Current: { readonly snapshot: BootstrapSnapshot }
  Stale: { readonly snapshot: BootstrapSnapshot; readonly reason: string }
  Reconnecting: {
    readonly snapshot: BootstrapSnapshot
    readonly reason: string
  }
  Unavailable: { readonly reason: string }
}>

export const BootstrapClientState = Data.taggedEnum<BootstrapClientState>()

export class SnapshotUnavailable extends Schema.TaggedErrorClass<SnapshotUnavailable>()(
  'Web.SnapshotUnavailable',
  { reason: Schema.NonEmptyString },
) {}

export class EventSourceDisconnected extends Schema.TaggedErrorClass<EventSourceDisconnected>()(
  'Web.EventSourceDisconnected',
  { reason: Schema.NonEmptyString },
) {}

export class EventPayloadInvalid extends Schema.TaggedErrorClass<EventPayloadInvalid>()(
  'Web.EventPayloadInvalid',
  { reason: Schema.NonEmptyString },
) {}

export interface SnapshotTransportShape {
  readonly load: () => Effect.Effect<unknown, SnapshotUnavailable>
}

export class SnapshotTransport extends Context.Service<
  SnapshotTransport,
  SnapshotTransportShape
>()('@astro-console/web/SnapshotTransport') {}

export type SseMessage =
  | { readonly _tag: 'ProjectionChanged'; readonly data: unknown }
  | { readonly _tag: 'Disconnected'; readonly reason: string }

export interface EventStreamShape {
  readonly events: () => Stream.Stream<SseMessage, never>
}

export class EventStream extends Context.Service<
  EventStream,
  EventStreamShape
>()('@astro-console/web/EventStream') {}

export interface BootstrapClientShape {
  readonly read: () => Effect.Effect<BootstrapClientState>
  readonly refresh: () => Effect.Effect<void>
  readonly states: Stream.Stream<BootstrapClientState>
}

export class BootstrapClient extends Context.Service<
  BootstrapClient,
  BootstrapClientShape
>()('@astro-console/web/BootstrapClient') {}

export const layer = Layer.effect(
  BootstrapClient,
  Effect.gen(function* () {
    const snapshots = yield* SnapshotTransport
    const events = yield* EventStream
    const initial = yield* loadSnapshot(snapshots).pipe(
      Effect.map((snapshot) => BootstrapClientState.Current({ snapshot })),
      Effect.catchTag('Web.SnapshotUnavailable', (error) =>
        Effect.succeed(
          BootstrapClientState.Unavailable({ reason: error.reason }),
        ),
      ),
    )
    const state = yield* SubscriptionRef.make<BootstrapClientState>(initial)

    const installSnapshot = Effect.fn('BootstrapClient.installSnapshot')(
      function* () {
        const previous = yield* SubscriptionRef.get(state)
        const snapshot = yield* loadSnapshot(snapshots).pipe(
          Effect.catchTag('Web.SnapshotUnavailable', (error) =>
            SubscriptionRef.set(state, stale(previous, error.reason)).pipe(
              Effect.as(undefined),
            ),
          ),
        )
        if (snapshot !== undefined)
          yield* SubscriptionRef.set(
            state,
            BootstrapClientState.Current({ snapshot }),
          )
      },
    )

    const reconcile = Effect.fn('BootstrapClient.reconcile')(function* (
      message: SseMessage,
    ) {
      const current = yield* SubscriptionRef.get(state)
      const next = yield* receiveEvent(current, message)
      yield* SubscriptionRef.set(state, next.state)
      if (next.refresh) yield* installSnapshot()
    })

    const listen = events.events().pipe(Stream.runForEach(reconcile))
    yield* listen.pipe(Effect.forever, Effect.forkScoped)

    return BootstrapClient.of({
      read: Effect.fn('BootstrapClient.read')(function* () {
        return yield* SubscriptionRef.get(state)
      }),
      refresh: installSnapshot,
      states: SubscriptionRef.changes(state),
    })
  }),
)

export interface BrowserEventSource {
  readonly close: () => void
  readonly onProjectionChanged: (listener: (data: string) => void) => void
  readonly onError: (listener: () => void) => void
}

export interface BrowserEventSourceFactoryShape {
  readonly open: (url: string) => BrowserEventSource
}

export class BrowserEventSourceFactory extends Context.Service<
  BrowserEventSourceFactory,
  BrowserEventSourceFactoryShape
>()('@astro-console/web/BrowserEventSourceFactory') {}

export const browserEventSourceFactoryLayer = Layer.succeed(
  BrowserEventSourceFactory,
  BrowserEventSourceFactory.of({
    open: (url) => {
      const source = new EventSource(url)
      return {
        close: () => source.close(),
        onProjectionChanged: (listener) =>
          source.addEventListener(
            'ProjectionChanged',
            (event: MessageEvent<string>) => listener(event.data),
          ),
        onError: (listener) => source.addEventListener('error', listener),
      }
    },
  }),
)

export const browserEventStreamLayer = Layer.effect(
  EventStream,
  Effect.gen(function* () {
    const factory = yield* BrowserEventSourceFactory
    return EventStream.of({
      events: () =>
        Stream.scoped(
          Stream.unwrap(
            Effect.gen(function* () {
              const messages = yield* Queue.bounded<SseMessage>(32)
              const source = yield* Effect.acquireRelease(
                Effect.sync(() => factory.open('/api/events')),
                (source) => Effect.sync(() => source.close()),
              )
              source.onProjectionChanged((data) =>
                Queue.offerUnsafe(messages, {
                  _tag: 'ProjectionChanged',
                  data,
                }),
              )
              source.onError(() =>
                Queue.offerUnsafe(messages, {
                  _tag: 'Disconnected',
                  reason: 'The event stream disconnected.',
                }),
              )
              return Stream.fromQueue(messages)
            }),
          ),
        ),
    })
  }),
)

export const browserSnapshotTransportLayer = Layer.succeed(
  SnapshotTransport,
  SnapshotTransport.of({
    load: Effect.fn('SnapshotTransport.load')(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch('/api/snapshot', { signal }),
        catch: () =>
          new SnapshotUnavailable({
            reason: 'The service snapshot could not be reached.',
          }),
      })
      if (!response.ok)
        return yield* Effect.fail(
          new SnapshotUnavailable({
            reason: 'The service snapshot was unavailable.',
          }),
        )
      return yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new SnapshotUnavailable({
            reason: 'The service snapshot could not be read.',
          }),
      })
    }),
  }),
)

type EventReceipt = {
  readonly state: BootstrapClientState
  readonly refresh: boolean
}

function loadSnapshot(transport: SnapshotTransportShape) {
  return transport.load().pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope)),
    Effect.map((envelope) => envelope.data),
    Effect.mapError(
      () =>
        new SnapshotUnavailable({
          reason: 'The service returned an invalid snapshot.',
        }),
    ),
  )
}

function receiveEvent(
  state: BootstrapClientState,
  message: SseMessage,
): Effect.Effect<EventReceipt> {
  if (message._tag === 'Disconnected') {
    return Effect.succeed({
      state: stale(state, message.reason),
      refresh: true,
    })
  }
  return Schema.decodeUnknownEffect(
    Schema.fromJsonString(BootstrapSseEventEnvelope),
  )(message.data).pipe(
    Effect.mapError(
      () =>
        new EventPayloadInvalid({ reason: 'The event payload was invalid.' }),
    ),
    Effect.map((event) => receiveDecodedEvent(state, event)),
    Effect.catchTag('Web.EventPayloadInvalid', (error) =>
      Effect.succeed({
        state: reconnecting(state, error.reason),
        refresh: true,
      }),
    ),
  )
}

function receiveDecodedEvent(
  state: BootstrapClientState,
  event: BootstrapSseEventEnvelope,
): EventReceipt {
  if (!BootstrapClientState.$is('Current')(state))
    return {
      state: reconnecting(state, 'A fresh snapshot is required before events.'),
      refresh: true,
    }
  const decision = decideEventCursor(state.snapshot.eventCursor, event.id)
  return EventCursorDecision.$match(decision, {
    Apply: () =>
      event.data.snapshotVersion < state.snapshot.snapshotVersion
        ? {
            state: reconnecting(
              state,
              'An event attempted to regress the snapshot version.',
            ),
            refresh: true,
          }
        : {
            state: BootstrapClientState.Current({
              snapshot: event.data,
            }),
            refresh: false,
          },
    IgnoreAlreadyApplied: () => ({ state, refresh: false }),
    RefreshSnapshot: () => ({
      state: reconnecting(
        state,
        'An event cursor gap requires a fresh snapshot.',
      ),
      refresh: true,
    }),
  })
}

function stale(
  state: BootstrapClientState,
  reason: string,
): BootstrapClientState {
  return BootstrapClientState.$match(state, {
    Current: ({ snapshot }) => BootstrapClientState.Stale({ snapshot, reason }),
    Stale: ({ snapshot }) => BootstrapClientState.Stale({ snapshot, reason }),
    Reconnecting: ({ snapshot }) =>
      BootstrapClientState.Stale({ snapshot, reason }),
    Unavailable: () => BootstrapClientState.Unavailable({ reason }),
  })
}

function reconnecting(
  state: BootstrapClientState,
  reason: string,
): BootstrapClientState {
  return BootstrapClientState.$match(state, {
    Current: ({ snapshot }) =>
      BootstrapClientState.Reconnecting({ snapshot, reason }),
    Stale: ({ snapshot }) =>
      BootstrapClientState.Reconnecting({ snapshot, reason }),
    Reconnecting: ({ snapshot }) =>
      BootstrapClientState.Reconnecting({ snapshot, reason }),
    Unavailable: () => BootstrapClientState.Unavailable({ reason }),
  })
}
