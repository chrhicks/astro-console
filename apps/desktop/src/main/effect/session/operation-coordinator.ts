import { Context, Effect, Layer, Ref } from 'effect'
import type { DeviceSession } from '../device/device-plugin'
import type {
  OperationKind,
  OperationRuntimeState,
} from '../state/aggregate'
import {
  type RuntimeState,
  type SessionAggregate,
  stampAggregate,
} from '../state/aggregate'
import { RuntimeStateRef } from '../state/runtime-state-ref'
import { SessionManager } from './session-manager'
import { isCaptureInFlight } from '../../../shared/lifecycle'

// A handle to the current operation lease. The signal is aborted when a
// recovery operation preempts this lease or when the session lifecycle
// supersedes it (beginConnect/beginDisconnect). Workflows pass the signal
// to adapter/SDK waits so stop/park/disconnect cancellation exits ordinary
// waits. The lease id is the correlation token for commitIfLease.
export interface OperationLease {
  readonly id: string
  readonly sessionId: string
  readonly kind: OperationKind
  readonly generation: number
  readonly signal: AbortSignal
}

// Ordinary hardware mutations that are mutually exclusive and must wait for
// any current operation to finish before acquiring.
type OrdinaryKind = 'point' | 'preview-start' | 'capture-start' | 'sequence' | 'sequence-continue'

// Recovery operations that preempt any current ordinary operation and
// acquire immediately.
type RecoveryKind = 'stop-preview' | 'stop-capture' | 'park'

export interface OperationCoordinator {
  // Acquire an ordinary operation lease. Waits until no current operation
  // is running AND the aggregate state has no active preview/capture/pointing.
  // Returns null if the session is superseded while waiting. The acquire
  // loop polls the shared Ref so the check and the acquire are atomic.
  readonly acquire: (
    session: DeviceSession,
    kind: OrdinaryKind,
  ) => Effect.Effect<OperationLease | null, never, SessionManager>

  // Acquire a recovery operation lease. Preempts (aborts) any current
  // operation's signal and acquires immediately. Recovery uses a fresh
  // non-aborted controller so the recovery workflow's own waits are not
  // cancelled by the preempted operation's signal.
  readonly acquireRecovery: (
    session: DeviceSession,
    kind: RecoveryKind,
  ) => Effect.Effect<OperationLease | null>

  // Release the lease if it is still current. Called by workflow finalizers.
  // No-op if the lease was already preempted or invalidated.
  readonly release: (lease: OperationLease) => Effect.Effect<void>
  readonly isCurrent: (lease: OperationLease) => Effect.Effect<boolean>

  // Atomically commit an aggregate update only if the lease is still
  // current AND the session still owns the aggregate. Returns the updated
  // aggregate if applied, null if not. This replaces check-then-write
  // patterns in workflows so a stale operation (preempted, superseded, or
  // completed) cannot overwrite newer state.
  readonly commitIfLease: (
    lease: OperationLease,
    f: (current: SessionAggregate) => SessionAggregate,
  ) => Effect.Effect<SessionAggregate | null>
}

export const OperationCoordinator =
  Context.Service<OperationCoordinator>('OperationCoordinator')

// Poll interval for the ordinary acquire loop. Short enough to be
// responsive to lease release, long enough to avoid busy-spinning.
const ACQUIRE_POLL_INTERVAL_MS = 20

export const OperationCoordinatorLive = Layer.effect(
  OperationCoordinator,
  Effect.gen(function* () {
    const { ref } = yield* RuntimeStateRef
    const sessions = yield* SessionManager

    return {
      acquire: (session: DeviceSession, kind: OrdinaryKind) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const controller = new AbortController()

          while (true) {
            if (!(yield* sessions.ownsSession(session))) return null

            const result = yield* Ref.modify(
              ref,
              (state): readonly [OperationLease | 'busy' | null, RuntimeState] => {
                if (state.session !== session) return [null, state]
                if (state.operation !== null) {
                  // Point commands serialize with each other. Starts are
                  // edge-triggered commands: a duplicate or a start issued
                  // during recovery is rejected rather than queued to run
                  // after the operation that made it obsolete.
                  if (kind === 'point' && state.operation.kind === 'point') {
                    return ['busy', state]
                  }
                  return [null, state]
                }
                if (isAggregateBusy(state.aggregate, kind)) return [null, state]
                const operation: OperationRuntimeState = {
                  id,
                  sessionId: session.sessionId,
                  kind,
                  generation: state.generation,
                  controller,
                }
                return [{
                  id,
                  sessionId: session.sessionId,
                  kind,
                  generation: state.generation,
                  signal: controller.signal,
                }, { ...state, operation }]
              },
            )

            if (result !== 'busy') return result
            yield* Effect.sleep(ACQUIRE_POLL_INTERVAL_MS)
          }
        }),

      acquireRecovery: (session: DeviceSession, kind: RecoveryKind) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const controller = new AbortController()

          return yield* Ref.modify(
            ref,
            (state): readonly [OperationLease | null, RuntimeState] => {
              if (state.session !== session) return [null, state]
              if (state.operation && isRecovery(state.operation.kind)) {
                // Park has priority over an in-flight stop. Nothing may
                // preempt park, and duplicate/competing stops are rejected
                // rather than queued to run with stale intent later.
                if (kind !== 'park' || state.operation.kind === 'park') {
                  return [null, state]
                }
              }
              if (state.operation) state.operation.controller.abort()
              const operation: OperationRuntimeState = {
                id,
                sessionId: session.sessionId,
                kind,
                generation: state.generation,
                controller,
              }
              const lease: OperationLease = {
                id,
                sessionId: session.sessionId,
                kind,
                generation: state.generation,
                signal: controller.signal,
              }
              return [lease, { ...state, operation }]
            },
          )
        }),

      release: (lease: OperationLease) =>
        Ref.modify(ref, (state): readonly [void, RuntimeState] => {
          if (!ownsLease(state, lease)) return [undefined, state]
          return [undefined, { ...state, operation: null }]
        }),

      isCurrent: (lease: OperationLease) => Ref.get(ref).pipe(Effect.map((state) => ownsLease(state, lease))),

      commitIfLease: (lease: OperationLease, f) =>
        Ref.modify(
          ref,
          (state): readonly [SessionAggregate | null, RuntimeState] => {
            if (!ownsLease(state, lease)) return [null, state]
            const next = stampAggregate(f(state.aggregate))
            return [next, { ...state, aggregate: next }]
          },
        ),
    } satisfies OperationCoordinator
  }),
)

// Returns true when the aggregate has an active preview, capture, or
// pointing state that would conflict with a new ordinary start. This
// enforces the conflict semantics: active preview/capture blocks
// incompatible ordinary starts even after the start command returns.
function isAggregateBusy(aggregate: SessionAggregate, kind: OrdinaryKind): boolean {
  if (
    isCaptureInFlight(aggregate.capture.phase)
  ) {
    return true
  }
  if (
    aggregate.preview.phase === 'starting' ||
    aggregate.preview.phase === 'active'
  ) {
    return true
  }
  if (aggregate.pointing.phase === 'slewing') return true
  if (aggregate.sequence.phase === 'awaiting-darks' && kind !== 'sequence-continue') return true
  return false
}

function isRecovery(kind: OperationKind): kind is RecoveryKind {
  return kind === 'stop-preview' || kind === 'stop-capture' || kind === 'park'
}

function ownsLease(state: RuntimeState, lease: OperationLease): boolean {
  return state.generation === lease.generation &&
    state.session?.sessionId === lease.sessionId &&
    state.operation?.id === lease.id &&
    state.operation.sessionId === lease.sessionId &&
    state.operation.kind === lease.kind &&
    state.operation.generation === lease.generation
}
