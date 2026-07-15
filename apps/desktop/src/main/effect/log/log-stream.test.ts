import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, Layer } from 'effect'
import { EventBus, EventBusLive } from '../event/event-bus'
import { LogSink } from './log-sink'
import { LogStream, LogStreamLive } from './log-stream'

test('removes a log listener when its callback throws', async () => {
  let received = 0
  let resolveFailure: () => void = () => {}
  const failed = new Promise<void>((resolve) => {
    resolveFailure = resolve
  })
  const logSink = Layer.succeed(LogSink, { list: Effect.succeed([]) })
  const deps = Layer.merge(EventBusLive, logSink)
  const streamLayer = Layer.merge(Layer.provide(LogStreamLive, deps), deps)

  await Effect.runPromise(
    Effect.gen(function* () {
      const bus = yield* EventBus
      const stream = yield* LogStream
      const unsubscribe = yield* stream.subscribe(() => {
        received += 1
        resolveFailure()
        throw new Error('renderer failed')
      })

      yield* bus.publish('capture.started', {})
      yield* Effect.tryPromise(() => failed)
      unsubscribe()
      unsubscribe()
      yield* bus.publish('capture.succeeded', {})
      assert.equal(received, 1)
    }).pipe(Effect.provide(streamLayer)),
  )
})
