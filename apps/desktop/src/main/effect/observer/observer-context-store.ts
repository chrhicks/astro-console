import { Context, Effect } from 'effect'
import type { ObserverContext } from '../../../shared/observer-context'

export interface ObserverContextStore {
  getCurrent(): Effect.Effect<ObserverContext | null>
}

export const ObserverContextStore = Context.GenericTag<ObserverContextStore>('ObserverContextStore')
