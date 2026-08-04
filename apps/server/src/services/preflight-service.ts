import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  PreflightSnapshot,
  RefreshPreflightRequest,
  RefreshPreflightResponse,
} from '@astro-console/v2-contracts'

export interface ReadOnlyPreflightProviderShape {
  readonly observe: () => Effect.Effect<unknown, unknown>
}
export class ReadOnlyPreflightProvider extends Context.Service<
  ReadOnlyPreflightProvider,
  ReadOnlyPreflightProviderShape
>()('@astro-console/server/ReadOnlyPreflightProvider') {}

export interface PreflightPersistenceShape {
  readonly activeRun: () => {
    readonly id: string
    readonly revision: number
    readonly phase: string
  } | null
  readonly persist: (
    snapshot: typeof PreflightSnapshot.Type,
  ) => Effect.Effect<{ readonly cursor: number }, unknown>
}
export class PreflightPersistence extends Context.Service<
  PreflightPersistence,
  PreflightPersistenceShape
>()('@astro-console/server/PreflightPersistence') {}

export const preflightPersistenceLayer = (
  implementation: PreflightPersistenceShape,
) =>
  Layer.succeed(PreflightPersistence, PreflightPersistence.of(implementation))

export const refreshPreflight = Effect.fn('PreflightService.refresh')(
  function* (raw: unknown) {
    const decoded = yield* Schema.decodeUnknownEffect(RefreshPreflightRequest)(
      raw,
    ).pipe(Effect.option)
    if (Option.isNone(decoded))
      return RefreshPreflightResponse.cases.Rejected.make({
        summary: 'The preflight refresh request is invalid.',
      })
    const input = decoded.value
    const persistence = yield* PreflightPersistence
    const run = persistence.activeRun()
    if (
      run === null ||
      run.phase !== 'preflight' ||
      run.id !== input.runId ||
      run.revision !== input.expectedRunRevision
    )
      return RefreshPreflightResponse.cases.Rejected.make({
        summary:
          'The current preflight run changed. Refresh Observe before evaluating again.',
      })
    const provider = yield* Effect.serviceOption(ReadOnlyPreflightProvider)
    if (Option.isNone(provider))
      return RefreshPreflightResponse.cases.Unavailable.make({
        summary:
          'No read-only rig provider is configured. Preflight cannot report a safe verdict.',
      })
    const observed = yield* provider.value
      .observe()
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(PreflightSnapshot)),
        Effect.option,
      )
    if (Option.isNone(observed))
      return RefreshPreflightResponse.cases.Unavailable.make({
        summary:
          'The read-only rig provider is unavailable. Preflight cannot report a safe verdict.',
      })
    const persisted = yield* persistence.persist(observed.value)
    return {
      response: RefreshPreflightResponse.cases.Refreshed.make({
        snapshot: observed.value,
      }),
      cursor: persisted.cursor,
    }
  },
)
