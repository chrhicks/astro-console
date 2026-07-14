import { Context, Effect, Layer, Ref } from 'effect'
import {
  RuntimeState,
  createInitialRuntimeState,
} from './aggregate'

// The single shared Ref that backs both SessionManager and AggregateStore.
// All lifecycle transitions and CAS commits go through Ref.modify on this
// Ref, so generation, current session, and aggregate phase/sessionId are
// always atomically consistent. There is no window where a newer intent's
// generation is visible in the manager but the aggregate still shows an
// older intent's phase.
export interface RuntimeStateRef {
  readonly ref: Ref.Ref<RuntimeState>
}

export const RuntimeStateRef =
  Context.Service<RuntimeStateRef>('RuntimeStateRef')

export const RuntimeStateRefLive = Layer.sync(RuntimeStateRef, () => ({
  ref: Ref.makeUnsafe(createInitialRuntimeState()),
}))
