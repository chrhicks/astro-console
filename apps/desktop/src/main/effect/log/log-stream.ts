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
          const queue = yield* Queue.unbounded<DesktopLogEntryV2>()

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

          const fiber = yield* Stream.fromQueue(queue).pipe(
            Stream.runForEach((entry) => Effect.sync(() => onLog(entry))),
            Effect.forkDetach,
          )

          return () => {
            unsubscribe()
            Effect.runFork(Fiber.interrupt(fiber))
          }
        }),
    } satisfies LogStream
  }),
)
