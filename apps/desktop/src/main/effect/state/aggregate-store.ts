import { Context, Effect, Layer, Ref } from "effect";
import { SessionAggregate, createInitialAggregate } from "./aggregate";

export interface AggregateStore {
  readonly get: Effect.Effect<SessionAggregate>
  readonly set: (next: SessionAggregate) => Effect.Effect<void>
  readonly update: (f: (current: SessionAggregate) => SessionAggregate) => Effect.Effect<SessionAggregate>
}

export const AggregateStore = Context.GenericTag<AggregateStore>('AggregateStore')

function stamp(next: SessionAggregate): SessionAggregate {
  return {
    ...next,
    lastUpdatedAt: new Date().toISOString(),
  }
}

export const AggregateStoreLive = Layer.effect(
  AggregateStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make(createInitialAggregate())
    
    return {
      get: Ref.get(ref),
      set: (next) => Ref.set(ref,stamp(next)),
      update: (f) => Ref.updateAndGet(ref, (current) => stamp(f(current))),
    } satisfies AggregateStore
  })
)