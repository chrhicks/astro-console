import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  PreflightSnapshot,
  RefreshPreflightRequest,
  RefreshPreflightResponse,
} from '@astro-console/protocol'

export interface ReadOnlyPreflightProviderShape {
  readonly observe: () => Effect.Effect<unknown, unknown>
  readonly unavailableSnapshot?: () => typeof PreflightSnapshot.Type
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
    yield* Effect.annotateCurrentSpan({
      'astro.workspace': 'observe',
      'astro.command.intent': 'RefreshPreflight',
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
      return yield* unavailableProviderSnapshot(provider.value, persistence)
    const persisted = yield* persistence.persist(observed.value)
    return {
      response: RefreshPreflightResponse.cases.Refreshed.make({
        snapshot: observed.value,
      }),
      cursor: persisted.cursor,
    }
  },
)

function unavailableProviderSnapshot(
  provider: ReadOnlyPreflightProviderShape,
  persistence: PreflightPersistenceShape,
) {
  if (provider.unavailableSnapshot === undefined)
    return Effect.succeed(
      RefreshPreflightResponse.cases.Unavailable.make({
        summary:
          'The read-only rig provider is unavailable. Preflight cannot report a safe verdict.',
      }),
    )
  const snapshot = provider.unavailableSnapshot()
  return persistence.persist(snapshot).pipe(
    Effect.map((persisted) => ({
      response: RefreshPreflightResponse.cases.Unavailable.make({
        summary:
          'The read-only rig provider is unavailable. Preflight cannot report a safe verdict.',
      }),
      cursor: persisted.cursor,
    })),
  )
}
