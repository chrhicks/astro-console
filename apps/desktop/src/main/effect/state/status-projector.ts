import { Effect, Context, Layer } from 'effect'
import { SessionAggregate } from './aggregate'
import { DesktopStatus } from '../../../shared/api-v2'
import { AggregateStore } from './aggregate-store'

export interface StatusProjector {
  readonly project: (aggregate: SessionAggregate) => DesktopStatus
  readonly snapshot: Effect.Effect<DesktopStatus>
}

export const StatusProjector =
  Context.GenericTag<StatusProjector>('StatusProjector')

function project(session: SessionAggregate): DesktopStatus {
  return {
    session: session.session,
    capture: session.capture,
    device: session.device,
    library: session.library,
    pointing: session.pointing,
    preview: session.preview,
    currentTarget: session.currentTarget,
    lastUpdatedAt: session.lastUpdatedAt,
    lastError: session.session.lastError,
  }
}

export const StatusProjectorLive = Layer.effect(
  StatusProjector,
  Effect.gen(function* () {
    const store = yield* AggregateStore

    return {
      project,
      snapshot: store.get.pipe(Effect.map(project)),
    }
  }),
)
