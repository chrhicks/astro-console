import { Context, Effect, Layer, Stream, Ref, PubSub } from 'effect'

export interface AppEvent<A = unknown> {
  eventId: number
  ts: string
  sessionId?: string
  host?: string
  name: AppEventName
  payload: A
}

export interface EventBus {
  readonly publish: <A>(
    name: AppEventName,
    payload: A,
    options?: { sessionId?: string; host?: string },
  ) => Effect.Effect<AppEvent<A>>
  readonly listen: (
    handler: (event: AppEvent) => Effect.Effect<void>,
  ) => Effect.Effect<() => void>
  readonly subscribe: () => Stream.Stream<AppEvent>
}

export type AppEventName =
  | 'camera.settings.updated'
  | 'capture.device-state.updated'
  | 'capture.failed'
  | 'capture.frame.persist.failed'
  | 'capture.frame.retrieval.failed'
  | 'capture.partial'
  | 'capture.started'
  | 'capture.state.updated'
  | 'capture.stopped'
  | 'capture.succeeded'
  | 'park.failed'
  | 'park.started'
  | 'park.succeeded'
  | 'pointing.failed'
  | 'pointing.started'
  | 'pointing.succeeded'
  | 'preview.failed'
  | 'preview.started'
  | 'preview.stopped'
  | 'preview.succeeded'
  | 'session.authenticate.step.started'
  | 'session.authenticate.step.succeeded'
  | 'session.authenticate.step.failed'
  | 'session.connect.failed'
  | 'session.connect.started'
  | 'session.connect.succeeded'
  | 'session.connect.step.failed'
  | 'session.connect.step.started'
  | 'session.connect.step.succeeded'
  | 'session.discover.completed'
  | 'session.discover.failed'
  | 'session.discover.started'
  | 'session.disconnect.failed'
  | 'session.disconnect.started'
  | 'session.disconnect.succeeded'
  | 'session.fake.scenario.changed'
  | 'session.preflightCheck.step.started'
  | 'session.preflightCheck.step.succeeded'
  | 'session.preflightCheck.step.failed'
  | 'session.keepalive.failed'
  | 'session.keepalive.recovered'
  | 'session.keepalive.stale'
  | 'seestar.capture.stack.failed'
  | 'sequence.configured'
  | 'status.snapshot.emitted'

export const EventBus = Context.Service<EventBus>('EventBus')

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const nextEventId = yield* Ref.make(0)
    const listeners = new Set<(event: AppEvent) => Effect.Effect<void>>()
    const pubsub = yield* PubSub.unbounded<AppEvent>()

    return {
      publish: (name, payload, options) =>
        Effect.gen(function* () {
          const eventId = yield* Ref.updateAndGet(nextEventId, (id) => id + 1)
          const event: AppEvent = {
            eventId,
            ts: new Date().toISOString(),
            sessionId: options?.sessionId,
            host: options?.host,
            name,
            payload,
          }

          const snapshot = [...listeners]

          yield* Effect.forEach(
            snapshot,
            (handler) =>
              handler(event).pipe(Effect.catch(() => Effect.void)),
            { concurrency: 1, discard: true },
          )

          yield* PubSub.publish(pubsub, event)
          return event as AppEvent<typeof payload>
        }),
      listen: (handler) =>
        Effect.sync(() => {
          listeners.add(handler)
          return () => listeners.delete(handler)
        }),
      subscribe: () => Stream.fromPubSub(pubsub),
    } satisfies EventBus
  }),
)
