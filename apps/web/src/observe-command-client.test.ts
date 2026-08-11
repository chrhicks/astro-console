import assert from 'node:assert/strict'
import test from 'node:test'
import { BootstrapSnapshot, IdempotencyKey } from '@astro-console/protocol'
import { bootstrapFixtures } from './testing/bootstrap-fixtures'
import { Effect, Schema, Stream } from 'effect'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'
import {
  ObserveCommandClient,
  ObserveCommandSubmission,
  ObserveCommandTransport,
  layer,
} from './observe-command-client'

const snapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
  ...bootstrapFixtures.activeRun,
  observe: {
    runId: 'run-active-001',
    revision: 1,
    executor: 'fake',
    phase: 'capture',
    target: 'M27',
    currentSequence: 0,
    completedSequences: 0,
    totalSequences: 2,
    retryUsed: false,
    lifecycleFacts: ['Fake/fixture lifecycle started.'],
    attemptFacts: ['Fake/fixture only.'],
    actions: {
      pause: { _tag: 'Eligible' },
      resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
      stop: { _tag: 'Eligible' },
      skip: { _tag: 'Eligible' },
      retry: { _tag: 'Eligible' },
      park: { _tag: 'Eligible' },
    },
  },
})

test('refreshes authoritative state after an unavailable Observe response without replaying', async () => {
  let refreshes = 0
  let submits = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ObserveCommandClient).submit(
        'StopRun',
        IdempotencyKey.make('observe-unavailable'),
      )
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        BootstrapClient,
        BootstrapClient.of({
          read: () =>
            Effect.succeed(BootstrapClientState.Current({ snapshot })),
          refresh: () => Effect.sync(() => void (refreshes += 1)),
          states: Stream.empty,
        }),
      ),
      Effect.provideService(
        ObserveCommandTransport,
        ObserveCommandTransport.of({
          submit: () => {
            submits += 1
            return Effect.succeed({
              body: {
                _tag: 'Unavailable',
                failure: {
                  _tag: 'ObserveServiceUnavailable',
                  summary: 'Observe is recovering.',
                },
              },
            })
          },
        }),
      ),
    ),
  )
  assert.equal(submits, 1)
  assert.equal(refreshes, 1)
  assert.equal(ObserveCommandSubmission.$is('Unavailable')(result), true)
})

test('fails closed without transport for stale, unavailable, no-control, phone, and ineligible Observe projections', async () => {
  for (const state of [
    BootstrapClientState.Stale({ snapshot, reason: 'stale' }),
    BootstrapClientState.Unavailable({ reason: 'unavailable' }),
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
        ...snapshot,
        membership: { ...snapshot.membership, role: 'viewer' },
        observe: {
          ...snapshot.observe,
          actions: {
            ...snapshot.observe?.actions,
            stop: { _tag: 'Ineligible', reason: 'controlRequired' },
          },
        },
      }),
    }),
    BootstrapClientState.Current({
      snapshot: Schema.decodeUnknownSync(BootstrapSnapshot)({
        ...snapshot,
        membership: { ...snapshot.membership, capability: 'readOnly' },
        observe: {
          ...snapshot.observe,
          actions: {
            ...snapshot.observe?.actions,
            stop: { _tag: 'Ineligible', reason: 'readOnlyClient' },
          },
        },
      }),
    }),
  ]) {
    let submits = 0
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ObserveCommandClient).submit(
          'StopRun',
          IdempotencyKey.make('observe-fails-closed'),
        )
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(
          BootstrapClient,
          BootstrapClient.of({
            read: () => Effect.succeed(state),
            refresh: () => Effect.void,
            states: Stream.empty,
          }),
        ),
        Effect.provideService(
          ObserveCommandTransport,
          ObserveCommandTransport.of({
            submit: () => {
              submits += 1
              return Effect.die('must not submit')
            },
          }),
        ),
      ),
    )
    assert.equal(ObserveCommandSubmission.$is('Unavailable')(result), true)
    assert.equal(submits, 0)
  }
})

test('acceptance does not install a returned snapshot or refresh, while rejection refreshes', async () => {
  for (const response of [
    { _tag: 'Accepted', result: { _tag: 'StopAccepted' } },
    {
      _tag: 'Rejected',
      failure: {
        _tag: 'Rejected',
        reason: 'AlreadyTerminal',
        summary: 'The run is terminal.',
      },
      snapshot,
    },
  ]) {
    let refreshes = 0
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* ObserveCommandClient).submit(
          'StopRun',
          IdempotencyKey.make('observe-response'),
        )
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(
          BootstrapClient,
          BootstrapClient.of({
            read: () =>
              Effect.succeed(BootstrapClientState.Current({ snapshot })),
            refresh: () => Effect.sync(() => void (refreshes += 1)),
            states: Stream.empty,
          }),
        ),
        Effect.provideService(
          ObserveCommandTransport,
          ObserveCommandTransport.of({
            submit: () => Effect.succeed({ body: response }),
          }),
        ),
      ),
    )
    assert.equal(refreshes, response._tag === 'Rejected' ? 1 : 0)
    assert.equal(
      ObserveCommandSubmission.$is(
        response._tag === 'Rejected' ? 'Rejected' : 'Accepted',
      )(result),
      true,
    )
  }
})
