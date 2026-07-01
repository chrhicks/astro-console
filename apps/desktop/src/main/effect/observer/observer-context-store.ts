import { Context, Effect, Layer, Ref } from 'effect'
import type { ObserverContext } from '../../../shared/observer-context'

export interface ObserverContextStore {
  getCurrent(): Effect.Effect<ObserverContext | null>
}

export const ObserverContextStore = Context.GenericTag<ObserverContextStore>('ObserverContextStore')

export const ObserverContextStoreLive = Layer.effect(
  ObserverContextStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make<ObserverContext | null>(null)

    return {
      getCurrent: () => Ref.get(ref),
    } satisfies ObserverContextStore
  }),
)