import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  IdempotencyKey,
  ObserveCommandRequest,
  ObserveCommandResponse,
  type ObserveWorkspaceProjection,
} from '@astro-console/protocol'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'

export type ObserveAction =
  | 'PauseRun'
  | 'ResumeRun'
  | 'StopRun'
  | 'SkipSequence'
  | 'RetryPhase'
  | 'RequestPark'

export type ObserveCommandSubmission = Data.TaggedEnum<{
  Accepted: { readonly message: string }
  Rejected: { readonly reason: string; readonly safeNextAction: string }
  Unavailable: { readonly reason: string; readonly safeNextAction: string }
}>

export const ObserveCommandSubmission =
  Data.taggedEnum<ObserveCommandSubmission>()

export class ObserveCommandTransportFailure extends Schema.TaggedErrorClass<ObserveCommandTransportFailure>()(
  'Web.ObserveCommandTransportFailure',
  { reason: Schema.NonEmptyString },
) {}

export class ObserveCommandResponseInvalid extends Schema.TaggedErrorClass<ObserveCommandResponseInvalid>()(
  'Web.ObserveCommandResponseInvalid',
  { reason: Schema.NonEmptyString },
) {}

export interface ObserveCommandTransportShape {
  readonly submit: (
    body: unknown,
  ) => Effect.Effect<{ readonly body: unknown }, ObserveCommandTransportFailure>
}

export class ObserveCommandTransport extends Context.Service<
  ObserveCommandTransport,
  ObserveCommandTransportShape
>()('@astro-console/web/ObserveCommandTransport') {}

export interface ObserveCommandClientShape {
  readonly submit: (
    action: ObserveAction,
  ) => Effect.Effect<ObserveCommandSubmission>
}

export class ObserveCommandClient extends Context.Service<
  ObserveCommandClient,
  ObserveCommandClientShape
>()('@astro-console/web/ObserveCommandClient') {}

export const layer = Layer.effect(
  ObserveCommandClient,
  Effect.gen(function* () {
    const bootstrap = yield* BootstrapClient
    const transport = yield* ObserveCommandTransport
    const submit = Effect.fn('ObserveCommandClient.submit')(
      function* (action: ObserveAction) {
        const state = yield* bootstrap.read()
        if (
          !BootstrapClientState.$is('Current')(state) ||
          state.snapshot.observe === undefined
        )
          return unavailable(
            'A current Observe projection is required before submitting this action.',
          )
        if (!eligible(action, state.snapshot.observe))
          return unavailable(
            'This action is not available in the current Observe projection.',
          )
        const idempotencyKey = yield* Effect.sync(() =>
          IdempotencyKey.make(crypto.randomUUID()),
        )
        const request = yield* Schema.decodeUnknownEffect(
          ObserveCommandRequest,
        )({
          intent: {
            _tag: action,
            expectedLeaseRevision: state.snapshot.control.revision,
            expectedRunRevision: state.snapshot.observe.revision,
            idempotencyKey,
          },
        }).pipe(
          Effect.mapError(
            () =>
              new ObserveCommandResponseInvalid({
                reason: 'The Observe command could not be constructed.',
              }),
          ),
        )
        return yield* transport.submit(request).pipe(
          Effect.flatMap(({ body }) =>
            Schema.decodeUnknownEffect(ObserveCommandResponse)(body).pipe(
              Effect.mapError(
                () =>
                  new ObserveCommandResponseInvalid({
                    reason: 'The Observe command response was invalid.',
                  }),
              ),
            ),
          ),
          Effect.flatMap(
            (response): Effect.Effect<ObserveCommandSubmission> => {
              if (ObserveCommandResponse.guards.Accepted(response))
                return Effect.succeed(
                  ObserveCommandSubmission.Accepted({
                    message: resultLabel(response.result._tag),
                  }),
                )
              if (ObserveCommandResponse.guards.Rejected(response))
                return bootstrap.refresh().pipe(
                  Effect.as(
                    ObserveCommandSubmission.Rejected({
                      reason: response.failure.summary,
                      safeNextAction:
                        'Read the current Observe projection before trying another action.',
                    }),
                  ),
                )
              return bootstrap
                .refresh()
                .pipe(Effect.as(unavailable(response.failure.summary)))
            },
          ),
        )
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            'Web.ObserveCommandTransportFailure': (error) =>
              Effect.succeed(unavailable(error.reason)),
            'Web.ObserveCommandResponseInvalid': (error) =>
              Effect.succeed(unavailable(error.reason)),
          }),
        ),
    )
    return ObserveCommandClient.of({ submit })
  }),
)

export const browserObserveCommandTransportLayer = Layer.succeed(
  ObserveCommandTransport,
  ObserveCommandTransport.of({
    submit: Effect.fn('ObserveCommandTransport.submit')(function* (
      body: unknown,
    ) {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch('/api/observe/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          }),
        catch: () =>
          new ObserveCommandTransportFailure({
            reason: 'The Observe command service could not be reached.',
          }),
      })
      return {
        body: yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () =>
            new ObserveCommandTransportFailure({
              reason: 'The Observe command response could not be read.',
            }),
        }),
      }
    }),
  }),
)

function eligible(action: ObserveAction, observe: ObserveWorkspaceProjection) {
  const key =
    action === 'PauseRun'
      ? 'pause'
      : action === 'ResumeRun'
        ? 'resume'
        : action === 'StopRun'
          ? 'stop'
          : action === 'SkipSequence'
            ? 'skip'
            : action === 'RetryPhase'
              ? 'retry'
              : 'park'
  return observe.actions[key]._tag === 'Eligible'
}

function unavailable(reason: string) {
  return ObserveCommandSubmission.Unavailable({
    reason,
    safeNextAction:
      'Wait for a current Observe projection before trying again.',
  })
}

function resultLabel(result: string) {
  return result === 'ParkRequested'
    ? 'Park policy accepted; no mount moved. Await current lifecycle evidence.'
    : 'Action accepted. Await current lifecycle evidence.'
}
