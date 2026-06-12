import { Context, Effect, Layer, Stream, Ref, PubSub } from "effect"

export interface AppEvent<A = unknown> {
  eventId: number
  ts: string
  sessionId?: string
  host?: string
  name: string
  payload: A
}

export interface EventBus {
  readonly publish: <A>(
    name: string,
    payload: A,
    options?: { sessionId?: string; host?: string },
  ) => Effect.Effect<AppEvent<A>>
  readonly listen: (handler: (event: AppEvent) => Effect.Effect<void>) => Effect.Effect<() => void>
  readonly subscribe: () => Stream.Stream<AppEvent>
}

export const EventBus = Context.GenericTag<EventBus>('EventBus')

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const nextEventId = yield* Ref.make(0)
    const listeners = new Set<((event: AppEvent) => Effect.Effect<void>)>()
    const pubsub = yield* PubSub.unbounded<AppEvent>()
    
    return {
      publish: (name, payload, options) => Effect.gen(function* () {
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
            handler(event).pipe(
              Effect.catchAll(() => Effect.void)
            ),
            { concurrency: 1, discard: true }
        )

        yield* PubSub.publish(pubsub, event)
        return event as AppEvent<typeof payload>
      }),
      listen: (handler) => 
        Effect.sync(() => {
          listeners.add(handler)
          return () => listeners.delete(handler)
        }),
      subscribe: () => Stream.fromPubSub(pubsub)
    
    } satisfies EventBus
  })
)