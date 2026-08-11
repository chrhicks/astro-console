import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  RefreshPreflightRequest,
  RefreshPreflightResponse,
  type BootstrapSnapshot,
} from '@astro-console/protocol'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'

export type PreflightRefreshSubmission = Data.TaggedEnum<{
  Refreshed: { readonly message: string }
  Rejected: { readonly message: string }
  Unavailable: { readonly message: string }
}>

export const PreflightRefreshSubmission =
  Data.taggedEnum<PreflightRefreshSubmission>()

export class PreflightRefreshTransportFailure extends Schema.TaggedErrorClass<PreflightRefreshTransportFailure>()(
  'Web.PreflightRefreshTransportFailure',
  { reason: Schema.NonEmptyString },
) {}

export class PreflightRefreshResponseInvalid extends Schema.TaggedErrorClass<PreflightRefreshResponseInvalid>()(
  'Web.PreflightRefreshResponseInvalid',
  { reason: Schema.NonEmptyString },
) {}

export interface PreflightRefreshTransportShape {
  readonly refresh: (
    body: unknown,
  ) => Effect.Effect<
    { readonly body: unknown },
    PreflightRefreshTransportFailure
  >
}

export class PreflightRefreshTransport extends Context.Service<
  PreflightRefreshTransport,
  PreflightRefreshTransportShape
>()('@astro-console/web/PreflightRefreshTransport') {}

export interface PreflightRefreshClientShape {
  readonly refresh: () => Effect.Effect<PreflightRefreshSubmission>
}

export class PreflightRefreshClient extends Context.Service<
  PreflightRefreshClient,
  PreflightRefreshClientShape
>()('@astro-console/web/PreflightRefreshClient') {}

export const canRefreshPreflight = (snapshot: BootstrapSnapshot) =>
  snapshot.membership.capability === 'controlCapable' &&
  snapshot.observe?.phase === 'preflight'

export const layer = Layer.effect(
  PreflightRefreshClient,
  Effect.gen(function* () {
    const bootstrap = yield* BootstrapClient
    const transport = yield* PreflightRefreshTransport
    const refresh = Effect.fn('PreflightRefreshClient.refresh')(function* () {
      const state = yield* bootstrap.read()
      if (!BootstrapClientState.$is('Current')(state))
        return unavailable('A current Observe projection is required.')
      if (!canRefreshPreflight(state.snapshot))
        return unavailable(
          'Only the admitted desktop may refresh the current preflight.',
        )
      const observe = state.snapshot.observe
      if (observe === undefined)
        return unavailable('A current Observe projection is required.')
      const request = yield* Schema.decodeUnknownEffect(
        RefreshPreflightRequest,
      )({ runId: observe.runId, expectedRunRevision: observe.revision }).pipe(
        Effect.mapError(
          () =>
            new PreflightRefreshResponseInvalid({
              reason: 'The preflight refresh request could not be constructed.',
            }),
        ),
      )
      return yield* transport.refresh(request).pipe(
        Effect.flatMap(({ body }) =>
          Schema.decodeUnknownEffect(RefreshPreflightResponse)(body).pipe(
            Effect.mapError(
              () =>
                new PreflightRefreshResponseInvalid({
                  reason: 'The preflight refresh response was invalid.',
                }),
            ),
          ),
        ),
        Effect.flatMap(
          (response): Effect.Effect<PreflightRefreshSubmission> =>
            RefreshPreflightResponse.guards.Refreshed(response)
              ? bootstrap.refresh().pipe(
                  Effect.as(
                    PreflightRefreshSubmission.Refreshed({
                      message:
                        'Preflight facts refreshed from the read-only provider.',
                    }),
                  ),
                )
              : RefreshPreflightResponse.guards.Rejected(response)
                ? bootstrap.refresh().pipe(
                    Effect.as(
                      PreflightRefreshSubmission.Rejected({
                        message: response.summary,
                      }),
                    ),
                  )
                : Effect.succeed(
                    PreflightRefreshSubmission.Unavailable({
                      message: response.summary,
                    }),
                  ),
        ),
      )
    })
    return PreflightRefreshClient.of({
      refresh: () =>
        refresh().pipe(
          Effect.catchTags({
            'Web.PreflightRefreshTransportFailure': (error) =>
              Effect.succeed(unavailable(error.reason)),
            'Web.PreflightRefreshResponseInvalid': (error) =>
              Effect.succeed(unavailable(error.reason)),
          }),
        ),
    })
  }),
)

export const browserPreflightRefreshTransportLayer = Layer.succeed(
  PreflightRefreshTransport,
  PreflightRefreshTransport.of({
    refresh: Effect.fn('PreflightRefreshTransport.refresh')(function* (
      body: unknown,
    ) {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch('/api/observe/preflight', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          }),
        catch: () =>
          new PreflightRefreshTransportFailure({
            reason: 'The preflight service could not be reached.',
          }),
      })
      return {
        body: yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () =>
            new PreflightRefreshTransportFailure({
              reason: 'The preflight response could not be read.',
            }),
        }),
      }
    }),
  }),
)

function unavailable(message: string) {
  return PreflightRefreshSubmission.Unavailable({ message })
}
