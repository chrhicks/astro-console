import { Effect, Context, Layer } from 'effect'
import { SessionAggregate } from './aggregate'
import { DesktopStatus } from '../../../shared/api-v2'
import type { ObserverContext } from '../../../shared/observer-context'
import { AggregateStore } from './aggregate-store'
import { ObserverContextStore } from '../observer/observer-context-store'

export interface StatusProjector {
  readonly project: (
    aggregate: SessionAggregate,
    observerContext: ObserverContext | null,
  ) => DesktopStatus
  readonly snapshot: Effect.Effect<DesktopStatus>
}

export const StatusProjector =
  Context.GenericTag<StatusProjector>('StatusProjector')

function project(
  session: SessionAggregate,
  observerContext: ObserverContext | null,
): DesktopStatus {
  return {
    session: session.session,
    capture: session.capture,
    device: session.device,
    library: session.library,
    pointing: session.pointing,
    preview: session.preview,
    currentTarget: session.currentTarget,
    observerContext,
    lastUpdatedAt: session.lastUpdatedAt,
    lastError: session.session.lastError,
  }
}

export const StatusProjectorLive = Layer.effect(
  StatusProjector,
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const observerContextStore = yield* ObserverContextStore

    return {
      project,
      snapshot: Effect.gen(function* () {
        const aggregate = yield* store.get
        const observerContext = yield* observerContextStore.getCurrent()
        return project(aggregate, observerContext)
      }),
    }
  }),
)
