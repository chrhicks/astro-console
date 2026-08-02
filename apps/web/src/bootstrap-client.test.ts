import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bootstrapFixtures,
  BootstrapSnapshot,
} from '@astro-console/v2-contracts'
import { Effect, Fiber, Layer, Queue, Schema, Stream } from 'effect'
import {
  BootstrapClient,
  BootstrapClientState,
  BrowserEventSourceFactory,
  browserEventStreamLayer,
  EventStream,
  layer,
  SnapshotTransport,
  type BootstrapClientShape,
  type BootstrapClientState as ClientState,
  type SseMessage,
} from './bootstrap-client'

const snapshot = (snapshotVersion: number, eventCursor: number) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)({
    ...bootstrapFixtures.fresh,
    snapshotVersion,
    eventCursor,
  })

const projectionChanged = (snapshotVersion: number, eventCursor: number) => ({
  _tag: 'ProjectionChanged' as const,
  data: JSON.stringify({
    id: eventCursor,
    event: 'ProjectionChanged',
    data: snapshot(snapshotVersion, eventCursor),
  }),
})

test('loads an authoritative snapshot before exposing Current state', async () => {
  await Effect.runPromise(
    withClient([snapshot(12, 40)], (client, events, states) =>
      Effect.gen(function* () {
        const initial = yield* Queue.take(states)
        assert.equal(BootstrapClientState.$is('Current')(initial), true)
        assert.equal(
          BootstrapClientState.$match(initial, {
            Current: ({ snapshot }) => snapshot.eventCursor,
            Stale: () => -1,
            Reconnecting: () => -1,
            Unavailable: () => -1,
          }),
          40,
        )
        assert.equal(yield* Queue.size(events), 0)
      }),
    ),
  )
})

test('exposes Unavailable when the initial snapshot is malformed', async () => {
  await Effect.runPromise(
    withClient([{}], (_client, _events, states) =>
      Effect.gen(function* () {
        const initial = yield* Queue.take(states)
        assert.equal(BootstrapClientState.$is('Unavailable')(initial), true)
      }),
    ),
  )
})

test('marks a disconnect stale, installs a fresh snapshot, and recovers', async () => {
  await Effect.runPromise(
    withClient(
      [snapshot(12, 40), snapshot(13, 41)],
      (_client, events, states) =>
        Effect.gen(function* () {
          yield* Queue.take(states)
          yield* Queue.offer(events, {
            _tag: 'Disconnected',
            reason: 'Connection closed.',
          })
          const stale = yield* Queue.take(states)
          const recovered = yield* Queue.take(states)
          assert.equal(BootstrapClientState.$is('Stale')(stale), true)
          assert.equal(BootstrapClientState.$is('Current')(recovered), true)
        }),
    ),
  )
})

test('ignores duplicate events without fetching or replaying a command', async () => {
  await Effect.runPromise(
    withClient([snapshot(12, 40)], (client, events, states, loads) =>
      Effect.gen(function* () {
        yield* Queue.take(states)
        yield* Queue.offer(events, projectionChanged(12, 40))
        const next = yield* Queue.take(states)
        const current = yield* client.read()
        assert.equal(BootstrapClientState.$is('Current')(next), true)
        assert.equal(BootstrapClientState.$is('Current')(current), true)
        assert.equal(yield* Queue.size(loads), 1)
      }),
    ),
  )
})

test('installs a browser EventSource JSON payload in cursor order', async () => {
  await Effect.runPromise(
    withClient([snapshot(12, 40)], (client, events, states, loads) =>
      Effect.gen(function* () {
        yield* Queue.take(states)
        yield* Queue.offer(events, projectionChanged(13, 41))
        const next = yield* Queue.take(states)
        const current = yield* client.read()
        assert.equal(BootstrapClientState.$is('Current')(next), true)
        assert.equal(
          BootstrapClientState.$match(current, {
            Current: ({ snapshot }) => snapshot.eventCursor,
            Stale: () => -1,
            Reconnecting: () => -1,
            Unavailable: () => -1,
          }),
          41,
        )
        assert.equal(yield* Queue.size(loads), 1)
      }),
    ),
  )
})

test('uses snapshot fallback for cursor gaps, version regression, and malformed events', async () => {
  await Effect.runPromise(
    withClient(
      [snapshot(12, 40), snapshot(14, 42), snapshot(16, 44), snapshot(18, 46)],
      (_client, events, states, loads) =>
        Effect.gen(function* () {
          yield* Queue.take(states)
          yield* Queue.offer(events, projectionChanged(14, 42))
          yield* Queue.take(states)
          const afterGap = yield* Queue.take(states)
          assert.equal(BootstrapClientState.$is('Current')(afterGap), true)

          yield* Queue.offer(events, projectionChanged(13, 43))
          yield* Queue.take(states)
          const afterRegression = yield* Queue.take(states)
          assert.equal(
            BootstrapClientState.$is('Current')(afterRegression),
            true,
          )

          yield* Queue.offer(events, {
            _tag: 'ProjectionChanged',
            data: { id: 47, event: 'ProjectionChanged', data: {} },
          })
          yield* Queue.take(states)
          const afterMalformed = yield* Queue.take(states)
          assert.equal(
            BootstrapClientState.$is('Current')(afterMalformed),
            true,
          )
          assert.equal(yield* Queue.size(loads), 4)
        }),
    ),
  )
})

test('keeps the last-confirmed snapshot stale through failed reconnect before recovery', async () => {
  await Effect.runPromise(
    withClient(
      [snapshot(12, 40), {}, snapshot(13, 41)],
      (_client, events, states) =>
        Effect.gen(function* () {
          yield* Queue.take(states)
          yield* Queue.offer(events, {
            _tag: 'Disconnected',
            reason: 'Connection closed.',
          })
          yield* Queue.take(states)
          const afterFailedSnapshot = yield* Queue.take(states)
          assert.equal(
            BootstrapClientState.$match(afterFailedSnapshot, {
              Current: () => -1,
              Stale: ({ snapshot }) => snapshot.eventCursor,
              Reconnecting: ({ snapshot }) => snapshot.eventCursor,
              Unavailable: () => -1,
            }),
            40,
          )

          yield* Queue.offer(events, projectionChanged(13, 41))
          yield* Queue.take(states)
          const recovered = yield* Queue.take(states)
          assert.equal(BootstrapClientState.$is('Current')(recovered), true)
        }),
    ),
  )
})

test('closes an EventSource when its scoped stream is cancelled', async () => {
  let closed = false
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = yield* EventStream
        const fiber = yield* events
          .events()
          .pipe(Stream.runDrain, Effect.forkScoped)
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
      }).pipe(
        Effect.provide(
          browserEventStreamLayer.pipe(
            Layer.provide(
              Layer.succeed(
                BrowserEventSourceFactory,
                BrowserEventSourceFactory.of({
                  open: () => ({
                    close: () => {
                      closed = true
                    },
                    onProjectionChanged: () => undefined,
                    onError: () => undefined,
                  }),
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  assert.equal(closed, true)
})

function withClient(
  snapshots: ReadonlyArray<unknown>,
  run: (
    client: BootstrapClientShape,
    events: Queue.Queue<SseMessage>,
    states: Queue.Queue<ClientState>,
    loads: Queue.Queue<void>,
  ) => Effect.Effect<void>,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const snapshotsQueue = yield* Queue.unbounded<unknown>()
      yield* Queue.offerAll(
        snapshotsQueue,
        snapshots.map((data) => ({ ok: true, data })),
      )
      const events = yield* Queue.unbounded<SseMessage>()
      const states = yield* Queue.unbounded<ClientState>()
      const loads = yield* Queue.unbounded<void>()
      yield* Effect.gen(function* () {
        const client = yield* BootstrapClient
        yield* client.states.pipe(
          Stream.runForEach((state) => Queue.offer(states, state)),
          Effect.forkScoped,
        )
        yield* run(client, events, states, loads)
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(
          SnapshotTransport,
          SnapshotTransport.of({
            load: () =>
              Queue.offer(loads, undefined).pipe(
                Effect.andThen(() => Queue.take(snapshotsQueue)),
              ),
          }),
        ),
        Effect.provideService(
          EventStream,
          EventStream.of({ events: () => Stream.fromQueue(events) }),
        ),
      )
    }),
  )
}
