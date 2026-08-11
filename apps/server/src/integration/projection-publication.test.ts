import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { Effect, Fiber, Queue } from 'effect'
import { TestClock } from 'effect/testing'
import { createLocalWebService } from '../app/origin-service.ts'
import {
  projectionHeartbeat,
  writeProjectionSsePayload,
} from '../http/projection-sse.ts'
import { makeLatestProjectionQueue } from '../services/projection-publication.ts'

const decoder = new TextDecoder()

const observation = (frameId: string) => ({
  frameId,
  capturedAt: '2026-08-11T12:00:00.000Z',
  quality: 'verified' as const,
  desired: 'M27 center',
  solved: 'M27 center + 8 arcsec',
  uncertaintyArcsec: 2.5,
  correctionState: 'automatic' as const,
  correctionEvidence: 'Adapter solve accepted.',
  correctionBound: '8 arcsec within 30 arcsec bound.',
  protection: 'No operator action required.',
})

const readChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
) => {
  assert.ok(reader !== undefined)
  const chunk = await reader.read()
  assert.equal(chunk.done, false)
  assert.ok(chunk.value !== undefined)
  return decoder.decode(chunk.value)
}

const eventCursor = (chunk: string) => Number(chunk.match(/^id: (\d+)$/m)?.[1])

const awaitObservations = (
  queue: Queue.Queue<'connect' | 'disconnect' | 'publish' | 'writeFailure'>,
  expected: 'connect' | 'disconnect',
  count: number,
) =>
  Effect.gen(function* () {
    let observed = 0
    while (observed < count) {
      if ((yield* Queue.take(queue)) === expected) observed += 1
    }
  })

test('projection streams publish current and ordered typed state to two clients', async (t) => {
  const observations = Effect.runSync(
    Queue.unbounded<'connect' | 'disconnect' | 'publish' | 'writeFailure'>(),
  )
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    {
      fixture: 'm27',
      observeProjectionPublication: (event) => {
        Effect.runSync(Queue.offer(observations, event))
      },
    },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const [firstResponse, secondResponse] = await Promise.all([
    fetch(`${base}/api/events`),
    fetch(`${base}/api/events`),
  ])
  const first = firstResponse.body?.getReader()
  const second = secondResponse.body?.getReader()

  const [firstInitial, secondInitial] = await Promise.all([
    readChunk(first),
    readChunk(second),
  ])
  assert.match(firstInitial, /event: ProjectionChanged/)
  assert.match(secondInitial, /event: ProjectionChanged/)
  await Effect.runPromise(awaitObservations(observations, 'connect', 2))

  assert.ok(service.ingestObservation(observation('stream-order-1')))
  const [firstPublication, secondPublication] = await Promise.all([
    readChunk(first),
    readChunk(second),
  ])
  assert.match(firstPublication, /event: ProjectionChanged/)
  assert.equal(eventCursor(firstPublication), eventCursor(secondPublication))

  assert.ok(service.ingestObservation(observation('stream-order-2')))
  const [firstLater, secondLater] = await Promise.all([
    readChunk(first),
    readChunk(second),
  ])
  const firstCursor = eventCursor(firstPublication)
  const laterCursor = eventCursor(firstLater)
  assert.ok(laterCursor > firstCursor)
  assert.equal(laterCursor, eventCursor(secondLater))

  await Promise.all([first?.cancel(), second?.cancel()])
  await Effect.runPromise(awaitObservations(observations, 'disconnect', 2))
})

test('HTTP heartbeat work is simultaneous and stops on interruption', async () => {
  const writes = Effect.runSync(Queue.unbounded<string>())
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const first = yield* projectionHeartbeat((payload) =>
          Queue.offer(writes, `first:${payload}`),
        ).pipe(Effect.forkScoped)
        const second = yield* projectionHeartbeat((payload) =>
          Queue.offer(writes, `second:${payload}`),
        ).pipe(Effect.forkScoped)

        yield* TestClock.adjust('15 seconds')
        assert.deepEqual(
          new Set(yield* Queue.takeAll(writes)),
          new Set(['first:: heartbeat\n\n', 'second:: heartbeat\n\n']),
        )

        yield* Fiber.interrupt(first)
        yield* TestClock.adjust('15 seconds')
        assert.deepEqual(yield* Queue.takeAll(writes), [
          'second:: heartbeat\n\n',
        ])

        yield* Fiber.interrupt(second)
        yield* TestClock.adjust('15 seconds')
        assert.equal(yield* Queue.size(writes), 0)
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

test('slow projection subscribers coalesce pending updates to the latest cursor', async () => {
  const queue = Effect.runSync(makeLatestProjectionQueue<number>())
  Effect.runSync(Queue.offer(queue, 1))
  Effect.runSync(Queue.offer(queue, 2))
  Effect.runSync(Queue.offer(queue, 3))

  assert.equal(Effect.runSync(Queue.size(queue)), 1)
  assert.equal(Effect.runSync(Queue.take(queue)), 3)
})

test('HTTP writes wait for drain and remove listeners when interrupted', async () => {
  class BackpressuredResponse extends EventEmitter {
    readonly payloads: Array<string> = []
    writable = false

    write(payload: string) {
      this.payloads.push(payload)
      return this.writable
    }
  }

  const response = new BackpressuredResponse()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const drained = yield* writeProjectionSsePayload(
          response,
          'first',
        ).pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        assert.equal(response.listenerCount('drain'), 1)
        response.emit('drain')
        yield* Fiber.join(drained)
        assert.deepEqual(response.payloads, ['first'])
        assert.equal(response.listenerCount('drain'), 0)

        const interrupted = yield* writeProjectionSsePayload(
          response,
          'second',
        ).pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        assert.equal(response.listenerCount('drain'), 1)
        yield* Fiber.interrupt(interrupted)
        assert.equal(response.listenerCount('drain'), 0)
        assert.equal(response.listenerCount('error'), 0)
        assert.equal(response.listenerCount('close'), 0)
      }),
    ),
  )
})

test('runtime-scope disposal finalizes simultaneous HTTP streams', async (t) => {
  const service = createLocalWebService(
    ':memory:',
    undefined,
    undefined,
    undefined,
    { fixture: 'm27' },
  )
  const listener = await service.listen()
  t.after(async () => {
    await listener.close()
    service.close()
  })
  const base = `http://127.0.0.1:${listener.port}`
  const [firstResponse, secondResponse] = await Promise.all([
    fetch(`${base}/api/events`),
    fetch(`${base}/api/events`),
  ])
  const first = firstResponse.body?.getReader()
  const second = secondResponse.body?.getReader()
  await Promise.all([readChunk(first), readChunk(second)])

  service.close()
  const [firstDone, secondDone] = await Promise.all([
    first?.read(),
    second?.read(),
  ])
  assert.equal(firstDone?.done, true)
  assert.equal(secondDone?.done, true)
})
