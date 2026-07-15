import { Context, Effect, Layer, Ref } from 'effect'
import { SessionAggregate, RuntimeState, stampAggregate } from './aggregate'
import { RuntimeStateRef } from './runtime-state-ref'
import type { DeviceSession } from '../device/device-plugin'

export interface DiscoveryIntent {
  readonly generation: number
  readonly id: number
  readonly signal: AbortSignal
}

export interface AggregateStore {
  readonly get: Effect.Effect<SessionAggregate>
  readonly set: (next: SessionAggregate) => Effect.Effect<void>
  readonly update: (
    f: (current: SessionAggregate) => SessionAggregate,
  ) => Effect.Effect<SessionAggregate>
  // Apply f only if the unified state's current session matches expected by
  // both object identity AND sessionId correlation. For null expected, the
  // update applies only when there is no current session AND no aggregate
  // sessionId. This is the CAS-like commit guard that replaces check-then-
  // unconditional writes in workflows that borrow a session and later commit
  // state. Returns the updated aggregate if applied, null if not.
  readonly updateIfSession: (
    expected: DeviceSession | null,
    f: (current: SessionAggregate) => SessionAggregate,
  ) => Effect.Effect<SessionAggregate | null>
  readonly beginDiscovery: Effect.Effect<DiscoveryIntent>
  readonly updateIfDiscovery: (
    intent: DiscoveryIntent,
    f: (current: SessionAggregate) => SessionAggregate,
  ) => Effect.Effect<SessionAggregate | null>
}

export const AggregateStore = Context.Service<AggregateStore>('AggregateStore')

export const AggregateStoreLive = Layer.effect(
  AggregateStore,
  Effect.gen(function* () {
    const { ref } = yield* RuntimeStateRef

    return {
      get: Effect.map(Ref.get(ref), (s) => s.aggregate),

      set: (next) =>
        Ref.update(
          ref,
          (state): RuntimeState => ({
            ...state,
            aggregate: stampAggregate(next),
          }),
        ),

      update: (f) =>
        Ref.modify(ref, (state): readonly [SessionAggregate, RuntimeState] => {
          const next = stampAggregate(f(state.aggregate))
          return [next, { ...state, aggregate: next }]
        }),

      updateIfSession: (expected, f) =>
        Ref.modify(
          ref,
          (state): readonly [SessionAggregate | null, RuntimeState] => {
            if (expected === null) {
              // Null expected: only apply when no current session and no
              // aggregate sessionId.
              if (
                state.session !== null ||
                state.aggregate.session.sessionId !== undefined
              ) {
                return [null, state]
              }
            } else {
              // Non-null expected: require both object identity (manager
              // session === expected) AND sessionId correlation (aggregate
              // sessionId === expected.sessionId).
              if (
                state.session !== expected ||
                state.aggregate.session.sessionId !== expected.sessionId
              ) {
                return [null, state]
              }
            }
            const next = stampAggregate(f(state.aggregate))
            return [next, { ...state, aggregate: next }]
          },
        ),

      beginDiscovery: Ref.modify(
        ref,
        (state): readonly [DiscoveryIntent, RuntimeState] => {
          state.discoveryController?.abort()
          const controller = new AbortController()
          const intent = {
            generation: state.generation,
            id: state.discoveryId + 1,
            signal: controller.signal,
          }
          const aggregate = stampAggregate({
            ...state.aggregate,
            session: {
              ...state.aggregate.session,
              discovering: true,
              lastError: undefined,
            },
          })
          return [intent, { ...state, discoveryId: intent.id, discoveryController: controller, aggregate }]
        },
      ),

      updateIfDiscovery: (intent, f) =>
        Ref.modify(
          ref,
          (state): readonly [SessionAggregate | null, RuntimeState] => {
            if (
              state.generation !== intent.generation ||
              state.discoveryId !== intent.id
            ) {
              return [null, state]
            }
            const next = stampAggregate(f(state.aggregate))
            return [next, { ...state, aggregate: next }]
          },
        ),
    } satisfies AggregateStore
  }),
)
