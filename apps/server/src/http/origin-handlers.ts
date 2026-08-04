import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import { PlanWorkspaceProjection } from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  type ControlEvent,
  type FailureReason,
  type Snapshot,
} from '../services/domain-state.ts'

const StoredEvidence = Schema.Struct({
  frameId: Schema.String,
  capturedAt: Schema.String,
  quality: Schema.Literals(['verified', 'warning']),
  desired: Schema.String,
  solved: Schema.String,
  uncertaintyArcsec: Schema.Number,
  stack: Schema.optionalKey(
    Schema.Struct({
      availability: Schema.Literals(['available', 'unavailable']),
      observedAt: Schema.String,
      frameCount: Schema.Int,
      message: Schema.String,
    }),
  ),
  correction: Schema.Struct({
    state: Schema.Literals(['automatic', 'exhausted']),
    evidence: Schema.String,
    bound: Schema.String,
    protection: Schema.String,
    action: Schema.String,
  }),
})
export const AdapterObservation = Schema.Struct({
  frameId: Schema.NonEmptyString,
  capturedAt: Schema.NonEmptyString,
  quality: Schema.Literals(['verified', 'warning']),
  desired: Schema.NonEmptyString,
  solved: Schema.NonEmptyString,
  uncertaintyArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  correctionState: Schema.Literals(['automatic', 'exhausted']),
  correctionEvidence: Schema.NonEmptyString,
  correctionBound: Schema.NonEmptyString,
  protection: Schema.NonEmptyString,
})
const RunMutationSchema = Schema.Struct({
  previewId: Schema.String,
  kind: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
})
const StoredState = Schema.Struct({
  snapshotVersion: Schema.Int,
  eventCursor: Schema.Int,
  planRevision: Schema.Int,
  leaseRevision: Schema.Int,
  leaseHolder: Schema.NullOr(Schema.String),
  leaseState: Schema.Literals(['held', 'reconnecting', 'unheld']),
  reconnectGraceUntil: Schema.NullOr(Schema.String),
  run: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      revision: Schema.Int,
      phase: Schema.Literals([
        'preflight',
        'acquire',
        'capture',
        'verify',
        'completed',
        'paused',
        'stopped',
        'parkRequested',
      ]),
      target: Schema.String,
      progress: Schema.Number,
      sourceDefinitionId: Schema.optionalKey(Schema.String),
      activeSequenceIndex: Schema.optionalKey(Schema.Int),
      completedSequenceCount: Schema.optionalKey(Schema.Int),
      resumablePhase: Schema.optionalKey(
        Schema.Literals(['preflight', 'acquire', 'capture', 'verify']),
      ),
      retryPhase: Schema.optionalKey(
        Schema.Literals(['preflight', 'acquire', 'capture', 'verify']),
      ),
      appliedMutations: Schema.optionalKey(Schema.Array(RunMutationSchema)),
    }),
  ),
  evidence: StoredEvidence,
})
const StoredRequest = Schema.Struct({
  request_id: Schema.String,
  client_id: Schema.String,
  person_id: Schema.String,
  created_at: Schema.String,
  expires_at: Schema.String,
  target_control_capable: Schema.Int,
})
const StoredRow = Schema.Struct({ value: Schema.String })
const PlanWorkspace = PlanWorkspaceProjection
const ObservingPlanRow = Schema.Struct({
  plan_id: Schema.String,
  revision: Schema.Int,
  projection: Schema.String,
  run_eligible: Schema.Int,
})
const operatorMessages = {
  Unauthenticated: 'A verified member identity is required.',
  FreshnessConflict:
    'The plan or control changed. Review the current plan before accepting it.',
  PlanUnavailable: 'No observation plan is installed.',
  PlanNotReady: 'The plan is not ready for RunDefinition acceptance.',
  RunDefinitionAlreadyAccepted:
    'This plan revision already has an immutable RunDefinition.',
  ClientReadOnly: 'Monitoring is read-only on this client.',
  ControlLeaseLost:
    'Control changed hands. Your command was not sent to the observatory; the accepted run continues.',
  AlreadyController: 'This desktop already controls the observatory.',
  ControlRequestAlreadyPending:
    'This desktop already has a pending control request.',
  OwnerRequired: 'Only the owner can accept a RunDefinition.',
  ControlRequestUnavailable: 'There is no current control request to grant.',
  ActiveRunConflict: 'A run is already active. Return to Observe.',
  RunRevisionConflict:
    'The active run changed. Refresh Observe before trying again.',
  AlreadyPaused: 'This run is already paused.',
  AlreadyTerminal: 'This run is terminal and cannot be paused.',
  NotPaused: 'This run is not paused.',
  ResumePhaseUnavailable: 'The paused run has no resumable phase.',
  IdempotencyConflict:
    'This idempotency key was already used for a different command.',
  InvalidInput: 'The service could not read that action.',
  DraftUnchanged: 'The displayed draft does not contain any changes to save.',
  ControlRequested:
    'Control request recorded. The owner can grant or decline it.',
  ControlGranted: 'Control granted. The other desktop now owns control.',
  ControlDeclined:
    'Control request declined. The current desktop keeps control.',
  ControlReleased: 'Control released. No desktop now owns control.',
  OwnerTookControl: 'Control returned to the owner desktop.',
  ControlLeaseExpired:
    'Control lease expired. Control is unheld; accepted work continues.',
  RunPaused: 'Pause was accepted by the service.',
  RunResumed: 'Resume was accepted by the service.',
  RunStopped: 'Stop was accepted by the service. This run cannot be resumed.',
  FakeSequenceSkipped: 'The remaining fake sequence was skipped.',
  FakePhaseRetried: 'The fake phase will retry once.',
  FakeParkRequested: 'Fake park was requested; no mount moved.',
  RunMutationApplied: 'The fake-run mutation was applied.',
  PreviewUnavailable: 'The requested fake-run preview is unavailable.',
  PreviewExpired: 'The requested fake-run preview expired.',
  ApprovalRequired: 'This fake-run mutation requires approval.',
  ApprovalMismatch: 'The fake-run approval does not match the preview.',
  RetryExhausted: 'The fake phase has already retried once.',
  PolicyUnavailable: 'This fake-run policy is unavailable.',
} satisfies Record<FailureReason | ControlEvent, string>

export const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
function storedValue(db: DatabaseSync, key: string): unknown {
  const raw: unknown = db
    .prepare('SELECT value FROM state WHERE key=?')
    .get(key)
  const row = Schema.decodeUnknownSync(Schema.optional(StoredRow))(raw)
  if (row === undefined) throw new Error(`Missing stored state: ${key}`)
  const parsed: unknown = JSON.parse(row.value)
  return parsed
}
function expireControlRequests(db: DatabaseSync) {
  db.prepare('DELETE FROM control_requests WHERE expires_at<=?').run(
    new Date().toISOString(),
  )
}
export function state(
  db: DatabaseSync,
): Omit<Snapshot, 'generatedAt' | 'identity' | 'connection'> {
  expireControlRequests(db)
  const stored = Schema.decodeUnknownSync(StoredState)({
    snapshotVersion: storedValue(db, 'snapshotVersion'),
    eventCursor: storedValue(db, 'eventCursor'),
    planRevision: storedValue(db, 'planRevision'),
    leaseRevision: storedValue(db, 'leaseRevision'),
    leaseHolder: storedValue(db, 'leaseHolder'),
    leaseState: storedValue(db, 'leaseState'),
    reconnectGraceUntil: storedValue(db, 'reconnectGraceUntil'),
    run: storedValue(db, 'run'),
    evidence: storedValue(db, 'evidence'),
  })
  const requestRows: unknown = db
    .prepare(
      'SELECT request_id,client_id,person_id,created_at,expires_at,target_control_capable FROM control_requests ORDER BY client_id',
    )
    .all()
  const requests = Schema.decodeUnknownSync(Schema.Array(StoredRequest))(
    requestRows,
  )
  const rawPlan: unknown = db
    .prepare(
      "SELECT plan_id,revision,projection,run_eligible FROM observing_plans WHERE plan_id='plan-m27'",
    )
    .get()
  const storedPlan = Schema.decodeUnknownSync(
    Schema.optional(ObservingPlanRow),
  )(rawPlan)
  const projection =
    storedPlan === undefined
      ? undefined
      : Schema.decodeUnknownSync(PlanWorkspace)(
          JSON.parse(storedPlan.projection),
        )
  const plan =
    storedPlan === undefined || projection === undefined
      ? {
          id: 'uninitialized',
          revision: 0,
          target: 'No observation plan is installed.',
          readiness: 'unavailable' as const,
          runEligible: false,
        }
      : {
          id: projection.planId,
          revision: projection.revision,
          target: projection.sequences[0]?.target ?? 'Observation plan',
          readiness: projection.readiness,
          runEligible: storedPlan.run_eligible === 1,
        }
  return {
    snapshotVersion: stored.snapshotVersion,
    eventCursor: stored.eventCursor,
    plan,
    control: {
      holderClientId: stored.leaseHolder,
      revision: stored.leaseRevision,
      state: stored.leaseState,
      ...(stored.reconnectGraceUntil === null
        ? {}
        : { reconnectGraceUntil: stored.reconnectGraceUntil }),
      pendingRequests: requests.map((item) => ({
        requestId: item.request_id,
        clientId: item.client_id,
        personId: item.person_id,
        expiresAt: item.expires_at,
      })),
    },
    run: stored.run,
    dispatch: 'none',
    dispatchAction: 'none',
    evidence: {
      ...stored.evidence,
      stack: stored.evidence.stack ?? {
        availability: 'unavailable',
        observedAt: stored.evidence.capturedAt,
        frameCount: 0,
        message: 'No Stack observation has been received.',
      },
    },
  }
}
export function reject(reason: FailureReason) {
  return {
    status:
      reason === 'Unauthenticated'
        ? 401
        : reason === 'FreshnessConflict' ||
            reason === 'PlanUnavailable' ||
            reason === 'PlanNotReady' ||
            reason === 'RunDefinitionAlreadyAccepted' ||
            reason === 'ActiveRunConflict' ||
            reason === 'RunRevisionConflict' ||
            reason === 'AlreadyPaused' ||
            reason === 'AlreadyTerminal' ||
            reason === 'NotPaused' ||
            reason === 'ResumePhaseUnavailable' ||
            reason === 'IdempotencyConflict' ||
            reason === 'PreviewUnavailable' ||
            reason === 'PreviewExpired' ||
            reason === 'RetryExhausted' ||
            reason === 'PolicyUnavailable' ||
            reason === 'DraftUnchanged'
          ? 409
          : reason === 'InvalidInput'
            ? 400
            : 403,
    body: {
      outcome: 'rejected' as const,
      reason,
      message:
        operatorMessages[reason] ??
        'The requested fake-run action is unavailable.',
    },
  }
}
