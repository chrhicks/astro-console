import { Context, Effect, Layer, Match, Schema } from 'effect'
import { RefreshPreflightResponse } from '@astro-console/protocol'
import type { LocalIdentity } from '../auth/identity.ts'
import { StateSqliteRepository } from '../persistence/state-sqlite-repository.ts'
import {
  ReadOnlyPreflightProvider,
  preflightPersistenceLayer,
  refreshPreflight,
  type ReadOnlyPreflightProviderShape,
} from './preflight-service.ts'
import { ProjectionPublication } from './projection-publication.ts'

export const PreflightCommandOutcome = Schema.TaggedUnion({
  ReadOnly: { response: RefreshPreflightResponse.cases.Rejected },
  Refreshed: { response: RefreshPreflightResponse.cases.Refreshed },
  Rejected: { response: RefreshPreflightResponse.cases.Rejected },
  Unavailable: { response: RefreshPreflightResponse.cases.Unavailable },
})

const commandOutcome = (outcome: typeof PreflightCommandOutcome.Type) => outcome

export interface PreflightCommandServiceShape {
  readonly execute: (
    raw: unknown,
    identity: LocalIdentity,
  ) => Effect.Effect<typeof PreflightCommandOutcome.Type, unknown>
}

export class PreflightCommandService extends Context.Service<
  PreflightCommandService,
  PreflightCommandServiceShape
>()('@astro-console/server/PreflightCommandService') {}

export type ReadOnlyPreflightProviderSelectionShape =
  | { readonly _tag: 'Absent' }
  | {
      readonly _tag: 'Configured'
      readonly provider: ReadOnlyPreflightProviderShape
    }

export class ReadOnlyPreflightProviderSelection extends Context.Service<
  ReadOnlyPreflightProviderSelection,
  ReadOnlyPreflightProviderSelectionShape
>()('@astro-console/server/ReadOnlyPreflightProviderSelection') {}

export const absentReadOnlyPreflightProviderSelectionLayer = Layer.succeed(
  ReadOnlyPreflightProviderSelection,
  ReadOnlyPreflightProviderSelection.of({ _tag: 'Absent' }),
)

export const configuredReadOnlyPreflightProviderSelectionLayer = (
  provider: ReadOnlyPreflightProviderShape,
) =>
  Layer.succeed(
    ReadOnlyPreflightProviderSelection,
    ReadOnlyPreflightProviderSelection.of({
      _tag: 'Configured',
      provider,
    }),
  )

export const preflightCommandServiceLayer = Layer.effect(
  PreflightCommandService,
  Effect.gen(function* () {
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication
    const provider = yield* ReadOnlyPreflightProviderSelection
    const persistence = preflightPersistenceLayer({
      activeRun: () => repository.state().run,
      persist: (snapshot) =>
        Effect.try({
          try: () => repository.persistPreflight(snapshot),
          catch: (cause) => cause,
        }),
    })

    return PreflightCommandService.of({
      execute: Effect.fn('PreflightCommandService.execute')(
        function* (raw, identity) {
          if (identity.capability !== 'controlCapable')
            return commandOutcome(
              PreflightCommandOutcome.cases.ReadOnly.make({
                response: RefreshPreflightResponse.cases.Rejected.make({
                  summary:
                    'This client is read-only and cannot refresh preflight.',
                }),
              }),
            )
          const refresh = refreshPreflight(raw).pipe(
            Effect.provide(persistence),
          )
          const result = yield* Match.value(provider).pipe(
            Match.when({ _tag: 'Configured' }, ({ provider }) =>
              refresh.pipe(
                Effect.provideService(ReadOnlyPreflightProvider, provider),
              ),
            ),
            Match.orElse(() => refresh),
          )
          const response = 'response' in result ? result.response : result
          if ('response' in result) yield* publication.publish(result.cursor)
          return RefreshPreflightResponse.match(response, {
            Refreshed: (response) =>
              commandOutcome(
                PreflightCommandOutcome.cases.Refreshed.make({ response }),
              ),
            Rejected: (response) =>
              commandOutcome(
                PreflightCommandOutcome.cases.Rejected.make({ response }),
              ),
            Unavailable: (response) =>
              commandOutcome(
                PreflightCommandOutcome.cases.Unavailable.make({ response }),
              ),
          })
        },
      ),
    })
  }),
)
