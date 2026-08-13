import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  CommandEnvelope,
  CommandFailure,
  CommandHttpFailureEnvelope,
  CommandHttpSuccessEnvelope,
  CommandId,
  IdempotencyKey,
  type BootstrapSnapshot,
} from '@astro-console/protocol'
import {
  BootstrapClient,
  BootstrapClientState,
  type BootstrapClientState as ClientState,
} from './bootstrap-client'

export type ControlAction = Data.TaggedEnum<{
  RequestControl: { readonly _never?: never }
  GrantControl: {
    readonly requestId: string
    readonly targetClientId: string
  }
  DeclineControl: { readonly requestId: string }
  ReleaseControl: { readonly _never?: never }
  TakeControl: { readonly _never?: never }
}>

export const ControlAction = Data.taggedEnum<ControlAction>()

const ControlIntent = Schema.TaggedUnion({
  RequestControl: {
    commandId: CommandId,
    idempotencyKey: IdempotencyKey,
  },
  GrantControl: {
    commandId: CommandId,
    requestId: Schema.NonEmptyString,
    targetClientId: Schema.NonEmptyString,
    idempotencyKey: IdempotencyKey,
  },
  DeclineControl: {
    commandId: CommandId,
    requestId: Schema.NonEmptyString,
    idempotencyKey: IdempotencyKey,
  },
  ReleaseControl: {
    commandId: CommandId,
    idempotencyKey: IdempotencyKey,
  },
  TakeControl: {
    commandId: CommandId,
    idempotencyKey: IdempotencyKey,
  },
})

type ControlIntent = typeof ControlIntent.Type

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
  readonly submit: (action: ControlAction) => Effect.Effect<CommandSubmission>
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
      action: ControlAction,
    ) {
      const current = yield* bootstrap.read()
      const snapshot = currentSnapshot(current)
      const unavailable = eligibility(current, action)
      if (unavailable !== undefined || snapshot === undefined)
        return CommandSubmission.Unavailable({
          current,
          reason: unavailable ?? 'No authoritative snapshot is available.',
          safeNextAction: 'Wait for a current eligible control projection.',
        })

      const response = yield* Effect.gen(function* () {
        const identity = yield* createControlIdentity()
        const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(
          commandEnvelope(
            controlIntent(action, identity),
            snapshot.control.revision,
          ),
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

const createControlIdentity = Effect.fn('CommandClient.createControlIdentity')(
  () =>
    Effect.sync(() => ({
      commandId: CommandId.make(crypto.randomUUID()),
      idempotencyKey: IdempotencyKey.make(crypto.randomUUID()),
    })),
)

function controlIntent(
  action: ControlAction,
  identity: {
    readonly commandId: typeof CommandId.Type
    readonly idempotencyKey: typeof IdempotencyKey.Type
  },
): ControlIntent {
  return ControlAction.$match(action, {
    RequestControl: () => ({ _tag: 'RequestControl' as const, ...identity }),
    GrantControl: ({ requestId, targetClientId }) => ({
      _tag: 'GrantControl' as const,
      requestId,
      targetClientId,
      ...identity,
    }),
    DeclineControl: ({ requestId }) => ({
      _tag: 'DeclineControl' as const,
      requestId,
      ...identity,
    }),
    ReleaseControl: () => ({
      _tag: 'ReleaseControl' as const,
      ...identity,
    }),
    TakeControl: () => ({ _tag: 'TakeControl' as const, ...identity }),
  })
}

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
    GrantControl: ({
      commandId,
      requestId,
      targetClientId,
      idempotencyKey,
    }): unknown => ({
      commandId,
      command: {
        _tag: 'GrantControl' as const,
        expectedLeaseRevision,
        requestId,
        targetClientId,
        idempotencyKey,
      },
    }),
    DeclineControl: ({ commandId, requestId, idempotencyKey }): unknown => ({
      commandId,
      command: {
        _tag: 'DeclineControl' as const,
        expectedLeaseRevision,
        requestId,
        idempotencyKey,
      },
    }),
    ReleaseControl: ({ commandId, idempotencyKey }): unknown => ({
      commandId,
      command: {
        _tag: 'ReleaseControl' as const,
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
  action: ControlAction,
): string | undefined {
  return BootstrapClientState.$match(state, {
    Unavailable: () => 'No authoritative snapshot is available.',
    Stale: () => 'The authoritative snapshot is stale.',
    Reconnecting: () => 'The authoritative snapshot is reconnecting.',
    Current: ({ snapshot }) => {
      if (snapshot.membership.capability !== 'controlCapable')
        return 'This client is read-only.'
      return ControlAction.$match(action, {
        RequestControl: () =>
          snapshot.membership.role !== 'viewer'
            ? 'Viewer membership is required to request control.'
            : snapshot.control.holderClientId === snapshot.membership.clientId
              ? 'This client already holds control.'
              : snapshot.control.pendingRequests?.some(
                    (request) =>
                      request.clientId === snapshot.membership.clientId,
                  )
                ? 'This client already requested control.'
                : undefined,
        GrantControl: ({ requestId, targetClientId }) =>
          snapshot.membership.role !== 'owner'
            ? 'Owner membership is required for this control command.'
            : snapshot.control.holderClientId === snapshot.membership.clientId
              ? 'This client already holds control.'
              : snapshot.control.pendingRequests?.some(
                    (request) =>
                      request.requestId === requestId &&
                      request.clientId === targetClientId,
                  ) !== true
                ? 'The projected control request is no longer available.'
                : undefined,
        DeclineControl: ({ requestId }) =>
          snapshot.membership.role !== 'owner'
            ? 'Owner membership is required for this control command.'
            : snapshot.control.holderClientId === snapshot.membership.clientId
              ? 'This client already holds control.'
              : snapshot.control.pendingRequests?.some(
                    (request) => request.requestId === requestId,
                  ) !== true
                ? 'The projected control request is no longer available.'
                : undefined,
        ReleaseControl: () =>
          snapshot.control.holderClientId !== snapshot.membership.clientId
            ? 'This client does not hold control.'
            : undefined,
        TakeControl: () =>
          snapshot.control.holderClientId === snapshot.membership.clientId
            ? 'This client already holds control.'
            : snapshot.membership.role !== 'owner'
              ? 'Owner membership is required for this control command.'
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
