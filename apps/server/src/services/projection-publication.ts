import type { BootstrapSseEventEnvelope } from '@astro-console/protocol'
import { Context, Effect, Layer, Queue, Schedule, Stream } from 'effect'
import type { LocalIdentity } from '../auth/identity.ts'

export interface ProjectionPublicationShape {
  readonly publish: (cursor: number) => Effect.Effect<void>
  readonly stream: (
    identity: LocalIdentity,
  ) => Stream.Stream<BootstrapSseEventEnvelope>
}

export class ProjectionPublication extends Context.Service<
  ProjectionPublication,
  ProjectionPublicationShape
>()('@astro-console/server/ProjectionPublication') {}

/**
 * A projection event contains the complete current snapshot and cursor. A slow
 * subscriber can recover from the latest event, so one pending update is
 * sufficient and older pending updates are replaced.
 */
export const makeLatestProjectionQueue = <A>() => Queue.sliding<A>(1)

export const projectionPublicationLayer = (dependencies: {
  readonly expire: () => void
  readonly currentCursor: () => number
  readonly eventFor: (identity: LocalIdentity) => BootstrapSseEventEnvelope
  readonly controllerConnected: (identity: LocalIdentity) => void
  readonly controllerDisconnected: (identity: LocalIdentity) => void
  readonly observe?: (event: 'connect' | 'disconnect' | 'publish') => void
}) =>
  Layer.effect(
    ProjectionPublication,
    Effect.gen(function* () {
      type Subscription = {
        readonly identity: LocalIdentity
        readonly queue: Queue.Queue<BootstrapSseEventEnvelope>
      }

      const subscriptions = new Map<number, Subscription>()
      const controllerStreams = new Map<string, number>()
      let nextSubscriptionId = 0
      let emittedCursor = 0

      const publish = Effect.fn('ProjectionPublication.publish')(function* (
        cursor: number,
      ) {
        emittedCursor = Math.max(emittedCursor, cursor)
        yield* Effect.forEach(
          subscriptions.values(),
          ({ identity, queue }) =>
            Queue.offer(queue, dependencies.eventFor(identity)),
          { discard: true },
        )
        dependencies.observe?.('publish')
      })

      const stream = (identity: LocalIdentity) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const queue =
              yield* makeLatestProjectionQueue<BootstrapSseEventEnvelope>()
            const subscriptionId = nextSubscriptionId
            nextSubscriptionId += 1
            const initial = yield* Effect.acquireRelease(
              Effect.sync(() => {
                const streamCount =
                  controllerStreams.get(identity.clientId) ?? 0
                if (streamCount === 0)
                  dependencies.controllerConnected(identity)
                controllerStreams.set(identity.clientId, streamCount + 1)
                const current = dependencies.eventFor(identity)

                // A PubSub value would have to be one shared envelope. These
                // envelopes are identity-specific and must be frozen at
                // publication time, so each subscriber owns one latest-value
                // queue instead of rebuilding state later from a shared cursor.
                subscriptions.set(subscriptionId, { identity, queue })
                dependencies.observe?.('connect')
                return current
              }),
              () =>
                Effect.sync(() => {
                  subscriptions.delete(subscriptionId)
                  dependencies.observe?.('disconnect')
                  const remaining =
                    (controllerStreams.get(identity.clientId) ?? 1) - 1
                  if (remaining <= 0) {
                    controllerStreams.delete(identity.clientId)
                    dependencies.controllerDisconnected(identity)
                  } else controllerStreams.set(identity.clientId, remaining)
                }).pipe(Effect.andThen(Queue.shutdown(queue))),
            )
            return Stream.make(initial).pipe(
              Stream.concat(Stream.fromQueue(queue)),
            )
          }),
        )

      const poll = Effect.sync(() => {
        dependencies.expire()
        return dependencies.currentCursor()
      }).pipe(
        Effect.flatMap((cursor) =>
          cursor > emittedCursor ? publish(cursor) : Effect.void,
        ),
        Effect.repeat(Schedule.spaced('250 millis')),
      )
      yield* poll.pipe(Effect.forkScoped)

      return ProjectionPublication.of({ publish, stream })
    }),
  )
