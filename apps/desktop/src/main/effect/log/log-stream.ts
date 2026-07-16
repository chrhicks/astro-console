import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect'
import type { DesktopLogEntryV2 } from '../../../shared/api-v2'
import { EventBus } from '../event/event-bus'
import { LogSink, toDesktopLogEntry } from './log-sink'

export interface LogStream {
  readonly subscribe: (
    onLog: (entry: DesktopLogEntryV2) => void,
  ) => Effect.Effect<() => void>
}

export const LogStream = Context.Service<LogStream>('LogStream')

export const LogStreamLive = Layer.effect(
  LogStream,
  Effect.gen(function* () {
    const bus = yield* EventBus
    const sink = yield* LogSink

    return {
      subscribe: (onLog) =>
        Effect.gen(function* () {
          // Preserve the oldest queued logs and drop newer entries when a
          // renderer cannot keep up.
          const queue = yield* Queue.dropping<DesktopLogEntryV2>(250)
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
            if (event.name === 'status.snapshot.emitted') {
              return Effect.void
            }

            return Queue.offer(queue, toDesktopLogEntry(event))
          })

          const initialLogs = yield* sink.list
          for (const entry of initialLogs) {
            yield* Queue.offer(queue, entry)
          }

          fiber = yield* Stream.fromQueue(queue).pipe(
            Stream.runForEach((entry) =>
              (closed ? Effect.void : Effect.sync(() => onLog(entry))).pipe(
                Effect.catch(() => Effect.sync(close)),
              ),
            ),
            Effect.forkDetach,
          )

          return close
        }),
    } satisfies LogStream
  }),
)
