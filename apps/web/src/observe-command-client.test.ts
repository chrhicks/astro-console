import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BootstrapSnapshot,
  ObserveCommandRequest,
} from '@astro-console/protocol'
import { bootstrapFixtures } from './testing/bootstrap-fixtures'
import { Effect, Schema, Stream } from 'effect'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'
import {
  ObserveCommandClient,
  ObserveCommandSubmission,
  ObserveCommandTransport,
  ObserveCommandTransportFailure,
  layer,
  type ObserveAction,
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

const allActionsSnapshot = Schema.decodeUnknownSync(BootstrapSnapshot)({
  ...snapshot,
  observe: {
    ...snapshot.observe,
    actions: {
      pause: { _tag: 'Eligible' },
      resume: { _tag: 'Eligible' },
      stop: { _tag: 'Eligible' },
      skip: { _tag: 'Eligible' },
      retry: { _tag: 'Eligible' },
      park: { _tag: 'Eligible' },
    },
  },
})

const observeActions = [
  'PauseRun',
  'ResumeRun',
  'StopRun',
  'SkipSequence',
  'RetryPhase',
  'RequestPark',
] as const satisfies ReadonlyArray<ObserveAction>

const allObserveActionsCovered = true satisfies Exclude<
  ObserveAction,
  (typeof observeActions)[number]
> extends never
  ? true
  : false

const acceptedResult = {
  PauseRun: 'PauseAccepted',
  ResumeRun: 'ResumeAccepted',
  StopRun: 'StopAccepted',
  SkipSequence: 'SequenceSkipped',
  RetryPhase: 'PhaseRetryAccepted',
  RequestPark: 'ParkRequested',
} as const satisfies Record<ObserveAction, string>

const submit = (
  action: ObserveAction,
  state: BootstrapClientState,
  transport: (
    body: unknown,
  ) => Effect.Effect<
    { readonly body: unknown },
    ObserveCommandTransportFailure
  >,
  refresh: () => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ObserveCommandClient).submit(action)
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        BootstrapClient,
        BootstrapClient.of({
          read: () => Effect.succeed(state),
          refresh,
          states: Stream.empty,
        }),
      ),
      Effect.provideService(
        ObserveCommandTransport,
        ObserveCommandTransport.of({ submit: transport }),
      ),
    ),
  )

test('encodes every semantic Observe action once with current revisions and fresh identity', async () => {
  assert.equal(allObserveActionsCovered, true)
  const requests: Array<typeof ObserveCommandRequest.Type> = []
  for (const action of observeActions) {
    let calls = 0
    const result = await submit(
      action,
      BootstrapClientState.Current({ snapshot: allActionsSnapshot }),
      (body) => {
        calls += 1
        requests.push(Schema.decodeUnknownSync(ObserveCommandRequest)(body))
        return Effect.succeed({
          body: {
            _tag: 'Accepted',
            result: { _tag: acceptedResult[action] },
          },
        })
      },
    )
    assert.equal(calls, 1)
    assert.equal(ObserveCommandSubmission.$is('Accepted')(result), true)
  }

  assert.deepEqual(
    requests.map((request) => request.intent._tag),
    observeActions,
  )
  for (const request of requests) {
    assert.equal(request.intent.expectedLeaseRevision, 4)
    assert.equal(request.intent.expectedRunRevision, 1)
    assert.ok(request.intent.idempotencyKey.length > 0)
  }
  assert.equal(
    new Set(requests.map((request) => request.intent.idempotencyKey)).size,
    requests.length,
  )
})

test('refreshes authoritative state after an unavailable Observe response without replaying', async () => {
  let refreshes = 0
  let submits = 0
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ObserveCommandClient).submit('StopRun')
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

test('reports transport and malformed-response uncertainty without refresh or replay', async () => {
  const transports: ReadonlyArray<
    () => Effect.Effect<
      { readonly body: unknown },
      ObserveCommandTransportFailure
    >
  > = [
    () =>
      Effect.fail(
        new ObserveCommandTransportFailure({
          reason: 'Observe transport unavailable.',
        }),
      ),
    () => Effect.succeed({ body: { _tag: 'Unknown' } }),
  ]
  for (const transport of transports) {
    let calls = 0
    let refreshes = 0
    const result = await submit(
      'StopRun',
      BootstrapClientState.Current({ snapshot }),
      () => {
        calls += 1
        return transport()
      },
      () => Effect.sync(() => void (refreshes += 1)),
    )
    assert.equal(ObserveCommandSubmission.$is('Unavailable')(result), true)
    assert.equal(calls, 1)
    assert.equal(refreshes, 0)
  }
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
        return yield* (yield* ObserveCommandClient).submit('StopRun')
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
        return yield* (yield* ObserveCommandClient).submit('StopRun')
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
