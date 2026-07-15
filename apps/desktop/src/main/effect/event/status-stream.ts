import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect'
import { DesktopStatus } from '../../../shared/api-v2'
import { EventBus } from './event-bus'
import { StatusProjector } from '../state/status-projector'

export interface StatusStream {
  readonly subscribe: (
    onStatus: (status: DesktopStatus) => void,
  ) => Effect.Effect<() => void>
  readonly publishSnapshot: Effect.Effect<void>
}

export const StatusStream = Context.Service<StatusStream>('StatusStream')

export const StatusStreamLive = Layer.effect(
  StatusStream,
  Effect.gen(function* () {
    const bus = yield* EventBus
    const projector = yield* StatusProjector

    const publishSnapshot = projector.snapshot.pipe(
      Effect.flatMap((status) =>
        bus.publish('status.snapshot.emitted', {
          lastUpdatedAt: status.lastUpdatedAt,
        }),
      ),
      Effect.asVoid,
    )

    return {
      subscribe: (onStatus) =>
        Effect.gen(function* () {
          const queue = yield* Queue.sliding<DesktopStatus>(1)
          let closed = false
          let fiber: Fiber.Fiber<void> | undefined

          const close = () => {
            if (closed) return
            closed = true
            unsubscribe()
            const shutdown = Queue.shutdown(queue)
            if (!fiber) {
              Effect.runFork(shutdown)
              return
            }
            Effect.runFork(shutdown.pipe(Effect.andThen(Fiber.interrupt(fiber))))
          }

          const unsubscribe = yield* bus.listen((event) => {
            if (
              !event.name.startsWith('session.') &&
              !event.name.startsWith('pointing.') &&
              !event.name.startsWith('preview.') &&
                !event.name.startsWith('capture.') &&
                !event.name.startsWith('camera.') &&
                !event.name.startsWith('sequence.') &&
                !event.name.startsWith('observer.') &&
              !event.name.startsWith('park.') &&
              event.name !== 'status.snapshot.emitted'
            ) {
              return Effect.void
            }

            return projector.snapshot.pipe(
              Effect.flatMap((status) => Queue.offer(queue, status)),
            )
          })

          yield* Queue.offer(queue, yield* projector.snapshot)

          fiber = yield* Stream.fromQueue(queue).pipe(
            Stream.runForEach((status) =>
              (closed ? Effect.void : Effect.sync(() => onStatus(status))).pipe(
                Effect.catch(() => Effect.sync(close)),
              ),
            ),
            Effect.forkDetach,
          )

          return close
        }),
      publishSnapshot,
    } satisfies StatusStream
  }),
)
