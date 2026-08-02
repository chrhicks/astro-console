import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  CommandEnvelope,
  CommandFailure,
  CommandHttpFailureEnvelope,
  CommandHttpSuccessEnvelope,
  CommandId,
  IdempotencyKey,
  type BootstrapSnapshot,
} from '@astro-console/v2-contracts'
import {
  BootstrapClient,
  BootstrapClientState,
  type BootstrapClientState as ClientState,
} from './bootstrap-client'

export const ControlIntent = Schema.TaggedUnion({
  RequestControl: {
    commandId: CommandId,
    idempotencyKey: IdempotencyKey,
  },
  TakeControl: {
    commandId: CommandId,
    idempotencyKey: IdempotencyKey,
  },
})

export type ControlIntent = typeof ControlIntent.Type

export type CommandSubmission = Data.TaggedEnum<{
  Accepted: {
    readonly snapshot: BootstrapSnapshot
    readonly current: ClientState
    readonly safeNextAction: string
  }
  Rejected: {
    readonly failure: CommandFailure
    readonly current: ClientState
    readonly safeNextAction: string
  }
  Unavailable: {
    readonly current: ClientState
    readonly reason: string
    readonly safeNextAction: string
  }
}>

export const CommandSubmission = Data.taggedEnum<CommandSubmission>()

export class CommandTransportFailure extends Schema.TaggedErrorClass<CommandTransportFailure>()(
  'Web.CommandTransportFailure',
  { reason: Schema.NonEmptyString },
) {}

export class CommandResponseInvalid extends Schema.TaggedErrorClass<CommandResponseInvalid>()(
  'Web.CommandResponseInvalid',
  { reason: Schema.NonEmptyString },
) {}

export interface CommandTransportShape {
  readonly submit: (
    body: unknown,
  ) => Effect.Effect<unknown, CommandTransportFailure>
}

export class CommandTransport extends Context.Service<
  CommandTransport,
  CommandTransportShape
>()('@astro-console/web/CommandTransport') {}

export interface CommandClientShape {
  readonly submit: (intent: ControlIntent) => Effect.Effect<CommandSubmission>
}

export class CommandClient extends Context.Service<
  CommandClient,
  CommandClientShape
>()('@astro-console/web/CommandClient') {}

export const layer = Layer.effect(
  CommandClient,
  Effect.gen(function* () {
    const bootstrap = yield* BootstrapClient
    const transport = yield* CommandTransport

    const submit = Effect.fn('CommandClient.submit')(function* (
      intent: ControlIntent,
    ) {
      const current = yield* bootstrap.read()
      const snapshot = currentSnapshot(current)
      const unavailable = eligibility(current, intent)
      if (unavailable !== undefined || snapshot === undefined)
        return CommandSubmission.Unavailable({
          current,
          reason: unavailable ?? 'No authoritative snapshot is available.',
          safeNextAction: 'Wait for a current eligible control projection.',
        })

      const response = yield* Effect.gen(function* () {
        const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(
          commandEnvelope(intent, snapshot.control.revision),
        ).pipe(
          Effect.mapError(
            () =>
              new CommandResponseInvalid({
                reason: 'The command envelope could not be constructed.',
              }),
          ),
        )
        return yield* transport
          .submit(envelope)
          .pipe(Effect.flatMap(decodeResponse(current)))
      }).pipe(
        Effect.catchTags({
          'Web.CommandTransportFailure': (error) =>
            Effect.succeed(
              CommandSubmission.Unavailable({
                current,
                reason: error.reason,
                safeNextAction:
                  'Reconnect and read a current projection before submitting again.',
              }),
            ),
          'Web.CommandResponseInvalid': (error) =>
            Effect.succeed(
              CommandSubmission.Unavailable({
                current,
                reason: error.reason,
                safeNextAction:
                  'Wait for the authoritative projection before trying another action.',
              }),
            ),
        }),
      )
      return response
    })

    return CommandClient.of({ submit })
  }),
)

export const browserCommandTransportLayer = Layer.succeed(
  CommandTransport,
  CommandTransport.of({
    submit: Effect.fn('CommandTransport.submit')(function* (body: unknown) {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch('/api/commands/control', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          }),
        catch: () =>
          new CommandTransportFailure({
            reason: 'The command service could not be reached.',
          }),
      })
      return yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new CommandTransportFailure({
            reason: 'The command response could not be read.',
          }),
      })
    }),
  }),
)

function commandEnvelope(
  intent: ControlIntent,
  expectedLeaseRevision: BootstrapSnapshot['control']['revision'],
): unknown {
  return ControlIntent.match(intent, {
    RequestControl: ({ commandId, idempotencyKey }): unknown => ({
      commandId,
      command: {
        _tag: 'RequestControl' as const,
        expectedLeaseRevision,
        idempotencyKey,
      },
    }),
    TakeControl: ({ commandId, idempotencyKey }): unknown => ({
      commandId,
      command: {
        _tag: 'TakeControl' as const,
        expectedLeaseRevision,
        idempotencyKey,
      },
    }),
  })
}

function decodeResponse(
  current: ClientState,
): (
  response: unknown,
) => Effect.Effect<CommandSubmission, CommandResponseInvalid> {
  return (response) =>
    Schema.decodeUnknownEffect(
      Schema.Union([CommandHttpSuccessEnvelope, CommandHttpFailureEnvelope]),
    )(response).pipe(
      Effect.mapError(
        () =>
          new CommandResponseInvalid({
            reason: 'The command service returned an invalid response.',
          }),
      ),
      Effect.map(
        (envelope): CommandSubmission =>
          envelope.ok
            ? CommandSubmission.Accepted({
                snapshot: envelope.data,
                current,
                safeNextAction:
                  'Await the next authoritative projection before treating the action as complete.',
              })
            : CommandHttpFailureEnvelope.fields.failure.match(
                envelope.failure,
                {
                  AuthenticationFailure: ({ summary }): CommandSubmission =>
                    CommandSubmission.Unavailable({
                      current,
                      reason: summary,
                      safeNextAction:
                        'Re-admit this client, then refresh the current projection before submitting another action.',
                    }),
                  InvalidInput: ({ summary }): CommandSubmission =>
                    CommandSubmission.Unavailable({
                      current,
                      reason: summary,
                      safeNextAction:
                        'Read a current projection before submitting again.',
                    }),
                  CommandRejected: ({ failure }): CommandSubmission =>
                    CommandSubmission.Rejected({
                      failure,
                      current,
                      safeNextAction:
                        failure.safeAlternatives[0] ??
                        'Read the current authoritative projection before trying another action.',
                    }),
                },
              ),
      ),
    )
}

function eligibility(
  state: ClientState,
  intent: ControlIntent,
): string | undefined {
  return BootstrapClientState.$match(state, {
    Unavailable: () => 'No authoritative snapshot is available.',
    Stale: () => 'The authoritative snapshot is stale.',
    Reconnecting: () => 'The authoritative snapshot is reconnecting.',
    Current: ({ snapshot }) => {
      if (snapshot.membership.role !== 'owner')
        return 'Owner membership is required for control commands.'
      if (snapshot.membership.capability !== 'controlCapable')
        return 'This client is read-only.'
      return ControlIntent.match(intent, {
        RequestControl: () =>
          snapshot.control.holderClientId === snapshot.membership.clientId
            ? 'This client already holds control.'
            : undefined,
        TakeControl: () =>
          snapshot.control.holderClientId === snapshot.membership.clientId
            ? 'This client already holds control.'
            : undefined,
      })
    },
  })
}

function currentSnapshot(state: ClientState): BootstrapSnapshot | undefined {
  return BootstrapClientState.$match(state, {
    Current: ({ snapshot }) => snapshot,
    Stale: () => undefined,
    Reconnecting: () => undefined,
    Unavailable: () => undefined,
  })
}
