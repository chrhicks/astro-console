import { Effect, Layer, Ref } from 'effect'
import type { DeviceSession } from '../device/device-plugin'
import {
  SessionManager,
  type ConnectIntent,
  type DisconnectIntent,
  type LifecycleReducer,
} from './session-manager'
import type { SessionAggregate } from '../state/aggregate'
import { RuntimeStateRef } from '../state/runtime-state-ref'
import { stampAggregate, type RuntimeState } from '../state/aggregate'

export const SessionManagerLive = Layer.effect(
  SessionManager,
  Effect.gen(function* () {
    const { ref } = yield* RuntimeStateRef
    let activeConnect: AbortController | null = null

    return {
      getCurrent: Effect.map(Ref.get(ref), (s) => s.session),

      ownsSession: (session) =>
        Effect.map(Ref.get(ref), (s) => s.session === session),

      isCurrent: (generation) =>
        Effect.map(Ref.get(ref), (s) => s.generation === generation),

      beginConnect: Ref.modify(ref, (state): readonly [
        { intent: ConnectIntent; superseded: DeviceSession | null },
        RuntimeState,
      ] => {
        state.discoveryController?.abort()
        activeConnect?.abort()
        const controller = new AbortController()
        activeConnect = controller
        const generation = state.generation + 1
        // Abort any current operation as part of the atomic lifecycle
        // transition. A new connect supersedes everything.
        if (state.operation) {
          state.operation.controller.abort()
        }
        const next: RuntimeState = {
          generation,
          discoveryId: state.discoveryId,
          discoveryController: null,
          session: null,
          aggregate: stampAggregate({
            ...state.aggregate,
            session: {
              ...state.aggregate.session,
              phase: 'connecting',
              sessionId: undefined,
              generation,
              lastError: undefined,
            },
          }),
          operation: null,
        }
        return [
          { intent: { generation, signal: controller.signal }, superseded: state.session },
          next,
        ]
      }),

      install: (intent, session, reducer: LifecycleReducer) =>
        Ref.modify(ref, (state): readonly [
          SessionAggregate | null,
          RuntimeState,
        ] => {
          if (state.generation !== intent.generation) {
            return [null, state]
          }
          const nextAggregate = stampAggregate(reducer(state.aggregate))
          return [
            nextAggregate,
            {
              generation: state.generation,
              discoveryId: state.discoveryId,
              discoveryController: state.discoveryController,
              session,
              aggregate: nextAggregate,
              operation: state.operation,
            },
          ]
        }),

      beginDisconnect: Ref.modify(ref, (state): readonly [
        DisconnectIntent,
        RuntimeState,
      ] => {
        state.discoveryController?.abort()
        activeConnect?.abort()
        activeConnect = null
        const generation = state.generation + 1
        // Abort and invalidate any current operation as part of the atomic
        // disconnect. The operation's workflow will see the signal abort
        // and exit; its commitIfLease/release will be no-ops because the
        // operation is already cleared.
        if (state.operation) {
          state.operation.controller.abort()
        }
        const next: RuntimeState = {
          generation,
          discoveryId: state.discoveryId,
          discoveryController: null,
          session: null,
          aggregate: stampAggregate({
            ...state.aggregate,
            session: {
              ...state.aggregate.session,
              phase: 'disconnecting',
              sessionId: undefined,
              generation,
              lastError: undefined,
            },
          }),
          operation: null,
        }
        return [{ generation, session: state.session }, next]
      }),

      clear: (intent, reducer: LifecycleReducer) =>
        Ref.modify(ref, (state): readonly [
          SessionAggregate | null,
          RuntimeState,
        ] => {
          if (state.generation !== intent.generation) {
            return [null, state]
          }
          const nextAggregate = stampAggregate(reducer(state.aggregate))
          return [
            nextAggregate,
            {
              generation: state.generation,
              discoveryId: state.discoveryId,
              discoveryController: state.discoveryController,
              session: null,
              aggregate: nextAggregate,
              operation: state.operation,
            },
          ]
        }),
    } satisfies SessionManager
  }),
)
