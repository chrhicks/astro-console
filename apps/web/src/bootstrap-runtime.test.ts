import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapFixtures } from '@astro-console/v2-contracts'
import { Effect, Layer, Queue, Stream } from 'effect'
import {
  BootstrapClient,
  EventStream,
  SnapshotTransport,
} from './bootstrap-client'
import { CommandClient, CommandTransport } from './command-client'
import { makeBootstrapRuntime } from './bootstrap-runtime'

test('composes clients per mount and disposes each EventSource scope', async () => {
  let snapshots = 0
  let commands = 0
  let closed = 0
  const opened = Effect.runSync(Queue.unbounded<void>())
  const snapshotTransportLayer = Layer.succeed(
    SnapshotTransport,
    SnapshotTransport.of({
      load: () => {
        snapshots += 1
        return Effect.succeed({ ok: true, data: bootstrapFixtures.fresh })
      },
    }),
  )
  const eventStreamLayer = Layer.succeed(
    EventStream,
    EventStream.of({
      events: () =>
        Stream.scoped(
          Stream.unwrap(
            Effect.acquireRelease(
              Queue.offer(opened, undefined).pipe(Effect.as(Stream.never)),
              () =>
                Effect.sync(() => {
                  closed += 1
                }),
            ),
          ),
        ),
    }),
  )
  const commandTransportLayer = Layer.succeed(
    CommandTransport,
    CommandTransport.of({
      submit: () => {
        commands += 1
        return Effect.die('command submission is not expected')
      },
    }),
  )
  const runtime = makeBootstrapRuntime(
    snapshotTransportLayer,
    eventStreamLayer,
    commandTransportLayer,
  )
  await runtime.runPromise(
    Effect.gen(function* () {
      const bootstrap = yield* BootstrapClient
      const command = yield* CommandClient
      yield* bootstrap.read()
      assert.equal(command.submit === undefined, false)
    }),
  )
  await runtime.runPromise(Queue.take(opened))
  await runtime.dispose()

  const remounted = makeBootstrapRuntime(
    snapshotTransportLayer,
    eventStreamLayer,
    commandTransportLayer,
  )
  await remounted.runPromise(
    Effect.gen(function* () {
      yield* BootstrapClient
      yield* CommandClient
    }),
  )
  await remounted.runPromise(Queue.take(opened))
  await remounted.dispose()

  assert.equal(snapshots, 2)
  assert.equal(commands, 0)
  assert.equal(closed, 2)
})
