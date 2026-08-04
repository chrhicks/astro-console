import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bootstrapFixtures,
  type BootstrapSnapshot,
} from '@astro-console/v2-contracts'
import { Effect, Stream } from 'effect'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'
import {
  PreflightRefreshClient,
  PreflightRefreshSubmission,
  PreflightRefreshTransport,
  layer,
} from './preflight-refresh-client'

const snapshot = {
  ...bootstrapFixtures.activeRun,
  observe: {
    runId: 'run-preflight-001',
    revision: 4,
    executor: 'fake',
    phase: 'preflight',
    target: 'M27',
    currentSequence: 0,
    completedSequences: 0,
    totalSequences: 2,
    retryUsed: false,
    lifecycleFacts: ['Fake preflight lifecycle started.'],
    attemptFacts: ['No provider facts read yet.'],
    actions: {
      pause: { _tag: 'Eligible' },
      resume: { _tag: 'Ineligible', reason: 'pausedRunRequired' },
      stop: { _tag: 'Eligible' },
      skip: { _tag: 'Eligible' },
      retry: { _tag: 'Eligible' },
      park: { _tag: 'Eligible' },
    },
  },
} as unknown as BootstrapSnapshot

test('refreshes current desktop preflight facts and reloads the projection', async () => {
  let refreshes = 0
  let request: unknown
  const result = await run(
    BootstrapClientState.Current({ snapshot }),
    (body) => {
      request = body
      return Effect.succeed({
        body: {
          _tag: 'Refreshed',
          snapshot: {
            observedAt: '2026-08-03T03:00:00.000Z',
            verdict: 'blocked',
            nextAction: 'Resolve the horizon blocker.',
            checks: [
              {
                key: 'mount-horizon',
                state: 'blocked',
                observedAt: '2026-08-03T03:00:00.000Z',
                reason: 'The target is below the configured horizon.',
              },
            ],
          },
        },
      })
    },
    () => void (refreshes += 1),
  )
  assert.deepEqual(request, {
    runId: 'run-preflight-001',
    expectedRunRevision: 4,
  })
  assert.equal(refreshes, 1)
  assert.equal(PreflightRefreshSubmission.$is('Refreshed')(result), true)
})

test('fails closed before transport for stale, phone, and non-preflight state', async () => {
  for (const state of [
    BootstrapClientState.Stale({ snapshot, reason: 'Disconnected.' }),
    BootstrapClientState.Current({
      snapshot: {
        ...snapshot,
        membership: {
          ...snapshot.membership,
          clientId: 'phone-owner',
          capability: 'readOnly',
        },
      } as BootstrapSnapshot,
    }),
    BootstrapClientState.Current({
      snapshot: {
        ...snapshot,
        observe: { ...snapshot.observe, phase: 'acquire' },
      } as BootstrapSnapshot,
    }),
  ]) {
    let requests = 0
    const result = await run(state, () => {
      requests += 1
      return Effect.die('must not refresh')
    })
    assert.equal(requests, 0)
    assert.equal(PreflightRefreshSubmission.$is('Unavailable')(result), true)
  }
})

async function run(
  state: BootstrapClientState,
  refresh: (body: unknown) => Effect.Effect<{ readonly body: unknown }>,
  didRefresh: () => void = () => undefined,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* PreflightRefreshClient).refresh()
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(
        BootstrapClient,
        BootstrapClient.of({
          read: () => Effect.succeed(state),
          refresh: () => Effect.sync(didRefresh),
          states: Stream.empty,
        }),
      ),
      Effect.provideService(
        PreflightRefreshTransport,
        PreflightRefreshTransport.of({ refresh }),
      ),
    ),
  )
}
