import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect'
import { DesktopStatus } from '../../../shared/api-v2'
import { EventBus } from './event-bus'
import { StatusProjector } from '../state/status-projector'

export interface StatusStream {
  readonly subscribe: (onStatus: (status: DesktopStatus) => void) => Effect.Effect<() => void>
  readonly publishSnapshot: Effect.Effect<void>
}

export const StatusStream = Context.GenericTag<StatusStream>('StatusStream')

export const StatusStreamLive = Layer.effect(
  StatusStream,
  Effect.gen(function* () {
    const bus = yield* EventBus
    const projector = yield* StatusProjector

    const publishSnapshot = projector.snapshot.pipe(
      Effect.flatMap((status) =>
        bus.publish('status.snapshot.emitted', {
          lastUpdatedAt: status.lastUpdatedAt
        })
      ),
      Effect.asVoid
    )

    return {
      subscribe: (onStatus) =>
        Effect.gen(function* () {
          const queue = yield* Queue.unbounded<DesktopStatus>()

          const unsubscribe = yield* bus.listen((event) => {
            if (
              !event.name.startsWith('session.') &&
              event.name !== 'status.snapshot.emitted'
            ) {
              return Effect.void
            }

            return projector.snapshot.pipe(
              Effect.flatMap((status) => Queue.offer(queue, status))
            )
          })

          yield* Queue.offer(queue, yield* projector.snapshot)

          const fiber = yield* Stream.fromQueue(queue).pipe(
            Stream.runForEach((status) => Effect.sync(() => onStatus(status))),
            // This single status stream is currently owned by Electron-side
            // unsubscribe cleanup. If we add more pushed streams, switch to a
            // scoped subscription model owned per WebContents instead.
            Effect.forkDaemon
          )

          return () => {
            unsubscribe()
            Effect.runFork(Fiber.interrupt(fiber))
          }
        }),
      publishSnapshot,
    } satisfies StatusStream
  })
)
