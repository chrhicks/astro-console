import { Effect, Context } from 'effect'
import type { DeviceSession } from '../device/device-plugin'

// A connect intent. The generation identifies the intent uniquely; install
// only succeeds if no newer intent has superseded it.
export interface ConnectIntent {
  readonly generation: number
  readonly signal: AbortSignal
}

// A disconnect intent. Carries the session that was current when disconnect
// began so the caller can close it; clear only succeeds if no newer intent
// has superseded it.
export interface DisconnectIntent {
  readonly generation: number
  readonly session: DeviceSession | null
}

// A reducer applied atomically with install/clear. The workflow passes this
// so the final connected/disconnected/failure projection happens in the same
// Ref.modify as the session ownership change.
export interface LifecycleReducer {
  (aggregate: SessionAggregate): SessionAggregate
}

// Re-exported for the SessionManager live implementation and tests.
import type { SessionAggregate } from '../state/aggregate'

export interface SessionManager {
  // The current session, or null. Workflows borrow this to issue commands and
  // later verify ownership via ownsSession.
  readonly getCurrent: Effect.Effect<DeviceSession | null>
  // True if session is still the current session. Workflows call this after
  // an await to decide whether to commit state.
  readonly ownsSession: (session: DeviceSession) => Effect.Effect<boolean>
  // True if the given generation is still the current generation. Connect and
  // disconnect workflows use this on failure paths to decide whether they
  // still own the aggregate.
  readonly isCurrent: (generation: number) => Effect.Effect<boolean>
  // Begin a connect intent. Atomically supersedes any prior intent, clears
  // the current session, and projects phase='connecting' + clears sessionId +
  // records the new generation in the aggregate — all in one Ref.modify.
  // Returns the intent and the session that was current (if any) for
  // best-effort cleanup. The caller must close the superseded session; the
  // manager no longer references it.
  readonly beginConnect: Effect.Effect<{
    intent: ConnectIntent
    superseded: DeviceSession | null
  }>
  // Install a session for a connect intent and atomically apply the
  // lifecycle reducer (final connected projection). Returns the committed
  // aggregate if installed (intent is still current), null if a newer intent
  // superseded it. On supersession the caller should close the session it
  // created.
  readonly install: (
    intent: ConnectIntent,
    session: DeviceSession,
    reducer: LifecycleReducer,
  ) => Effect.Effect<SessionAggregate | null>
  // Begin a disconnect. Atomically supersedes in-flight connects, captures
  // the session to disconnect (if any), and projects phase='disconnecting' +
  // clears sessionId + records the new generation in the aggregate — all in
  // one Ref.modify.
  readonly beginDisconnect: Effect.Effect<DisconnectIntent>
  // Clear the current session and atomically apply the lifecycle reducer
  // (final disconnected/failure projection) if the disconnect intent still
  // owns the current generation. Returns the committed aggregate if cleared,
  // null if superseded.
  readonly clear: (
    intent: DisconnectIntent,
    reducer: LifecycleReducer,
  ) => Effect.Effect<SessionAggregate | null>
}

export const SessionManager =
  Context.Service<SessionManager>('SessionManager')
