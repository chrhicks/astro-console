import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bootstrapFixtures,
  BootstrapSnapshot,
  CommandEnvelope,
} from '@astro-console/v2-contracts'
import { Effect, Schema, Stream } from 'effect'
import {
  BootstrapClient,
  BootstrapClientState,
  type BootstrapClientState as ClientState,
} from './bootstrap-client'
import {
  CommandClient,
  CommandSubmission,
  CommandTransport,
  CommandTransportFailure,
  ControlIntent,
  layer,
} from './command-client'

const snapshot = (value: unknown) =>
  Schema.decodeUnknownSync(BootstrapSnapshot)(value)

const intent = (tag: ControlIntent['_tag']): ControlIntent =>
  Schema.decodeUnknownSync(ControlIntent)({
    _tag: tag,
    commandId: `${tag}-command`,
    idempotencyKey: `${tag}-key`,
    ...(tag === 'GrantControl'
      ? { requestId: 'request-1', targetClientId: 'desktop-member' }
      : tag === 'DeclineControl'
        ? { requestId: 'request-1' }
        : {}),
  })

type CurrentState = Extract<ClientState, { readonly _tag: 'Current' }>

const current = (value: unknown): CurrentState =>
  BootstrapClientState.Current({ snapshot: snapshot(value) })

test('does not send unavailable, stale, or reconnecting projections', async () => {
  for (const state of [
    BootstrapClientState.Unavailable({ reason: 'offline' }),
    BootstrapClientState.Stale({
      snapshot: snapshot(bootstrapFixtures.fresh),
      reason: 'stale',
    }),
    BootstrapClientState.Reconnecting({
      snapshot: snapshot(bootstrapFixtures.fresh),
      reason: 'reconnecting',
    }),
  ]) {
    let calls = 0
    const result = await submit(state, intent('RequestControl'), () => {
      calls += 1
      return Effect.die('must not submit')
    })
    assert.equal(CommandSubmission.$is('Unavailable')(result), true)
    assert.equal(calls, 0)
  }
})

test('does not send viewer, phone, or already-controller intents', async () => {
  for (const state of [
    current(bootstrapFixtures.viewer),
    current(bootstrapFixtures.phone),
    current(bootstrapFixtures.fresh),
  ]) {
    let calls = 0
    const result = await submit(state, intent('TakeControl'), () => {
      calls += 1
      return Effect.die('must not submit')
    })
    assert.equal(CommandSubmission.$is('Unavailable')(result), true)
    assert.equal(calls, 0)
  }
})

test('submits eligible request and take control once with the current lease revision', async () => {
  const requestState = current({
    ...bootstrapFixtures.fresh,
    control: { revision: 9, state: 'held', holderClientId: 'another-owner' },
  })
  const takeState = current({
    ...bootstrapFixtures.noRun,
    control: { revision: 10, state: 'unheld' },
  })
  for (const [state, command] of [
    [requestState, intent('RequestControl')],
    [takeState, intent('TakeControl')],
  ] as const) {
    let calls = 0
    let submitted: CommandEnvelope | undefined
    const result = await submit(state, command, (body) => {
      calls += 1
      submitted = Schema.decodeUnknownSync(CommandEnvelope)(body)
      return Effect.succeed({
        ok: true,
        data: snapshot(bootstrapFixtures.fresh),
      })
    })
    assert.equal(CommandSubmission.$is('Accepted')(result), true)
    assert.equal(calls, 1)
    assert.equal(
      submitted?.command._tag === command._tag
        ? submitted.command.expectedLeaseRevision
        : undefined,
      state.snapshot.control.revision,
    )
    assert.equal(
      submitted?.command._tag === command._tag
        ? submitted.command.idempotencyKey
        : undefined,
      command.idempotencyKey,
    )
  }
})

test('encodes every shared control operation with the current lease revision', async () => {
  const state = current({
    ...bootstrapFixtures.fresh,
    control: { revision: 9, state: 'held', holderClientId: 'desktop-owner' },
  })
  for (const tag of [
    'GrantControl',
    'DeclineControl',
    'ReleaseControl',
    'TakeControl',
  ] as const) {
    let submitted: CommandEnvelope | undefined
    await submit(
      tag === 'TakeControl'
        ? current({
            ...bootstrapFixtures.fresh,
            control: {
              revision: 9,
              state: 'held',
              holderClientId: 'desktop-member',
            },
          })
        : state,
      intent(tag),
      (body) => {
        submitted = Schema.decodeUnknownSync(CommandEnvelope)(body)
        return Effect.succeed({
          ok: true,
          data: snapshot(bootstrapFixtures.fresh),
        })
      },
    )
    assert.equal(
      submitted !== undefined && 'expectedLeaseRevision' in submitted.command
        ? submitted.command.expectedLeaseRevision
        : undefined,
      9,
    )
  }
})

test('reports malformed responses without a retry', async () => {
  let calls = 0
  const state = current(bootstrapFixtures.noRun)
  const result = await submit(state, intent('TakeControl'), () => {
    calls += 1
    return Effect.succeed({ ok: true })
  })
  assert.equal(CommandSubmission.$is('Unavailable')(result), true)
  assert.equal(calls, 1)
})

test('returns authentication failure with current truth and re-admission action', async () => {
  const state = current(bootstrapFixtures.noRun)
  const result = await submit(state, intent('TakeControl'), () =>
    Effect.succeed({
      ok: false,
      failure: {
        _tag: 'AuthenticationFailure',
        summary: 'Membership admission is required.',
      },
    }),
  )
  assert.equal(CommandSubmission.$is('Unavailable')(result), true)
  if (CommandSubmission.$is('Unavailable')(result)) {
    assert.equal(result.current, state)
    assert.equal(
      result.safeNextAction,
      'Re-admit this client, then refresh the current projection before submitting another action.',
    )
  }
})

test('returns typed rejection with current truth and a safe next action', async () => {
  const state = current(bootstrapFixtures.noRun)
  const result = await submit(state, intent('TakeControl'), () =>
    Effect.succeed({
      ok: false,
      failure: {
        _tag: 'CommandRejected',
        failure: {
          _tag: 'AuthorizationFailure',
          commandId: 'TakeControl-command',
          summary: 'Control was lost.',
          retryable: false,
          refreshFromSnapshot: true,
          safeAlternatives: ['Wait for the current control projection.'],
          reason: 'ControlLeaseLost',
        },
      },
    }),
  )
  assert.equal(CommandSubmission.$is('Rejected')(result), true)
  if (CommandSubmission.$is('Rejected')(result)) {
    assert.equal(result.current._tag, 'Current')
    assert.equal(
      result.safeNextAction,
      'Wait for the current control projection.',
    )
  }
})

test('does not retry a duplicate idempotency submission after a server recorded result', async () => {
  const state = current(bootstrapFixtures.noRun)
  let calls = 0
  const transport = () => {
    calls += 1
    return Effect.succeed({ ok: true, data: snapshot(bootstrapFixtures.fresh) })
  }
  const result = await submit(state, intent('TakeControl'), transport)
  assert.equal(CommandSubmission.$is('Accepted')(result), true)
  assert.equal(calls, 1)
})

test('accepted responses do not synthesize a BootstrapClient projection update', async () => {
  const state = current(bootstrapFixtures.noRun)
  const result = await submit(state, intent('TakeControl'), () =>
    Effect.succeed({ ok: true, data: snapshot(bootstrapFixtures.fresh) }),
  )
  assert.equal(CommandSubmission.$is('Accepted')(result), true)
  if (
    CommandSubmission.$is('Accepted')(result) &&
    BootstrapClientState.$is('Current')(result.current)
  )
    assert.equal(
      result.current.snapshot.eventCursor,
      state.snapshot.eventCursor,
    )
})

async function submit(
  state: ClientState,
  command: ControlIntent,
  transport: (body: unknown) => Effect.Effect<unknown, CommandTransportFailure>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* CommandClient
      return yield* client.submit(command)
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
        CommandTransport,
        CommandTransport.of({ submit: transport }),
      ),
    ),
  )
}
