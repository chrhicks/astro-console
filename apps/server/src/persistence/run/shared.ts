import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  PlanIntent,
  PlanWorkspaceProjection,
  RunDefinition,
  RunExecutionContext,
  type ObserveIntent,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../../auth/identity.ts'
import type { FailureReason } from '../../services/domain-state.ts'
import type { StateSqliteRepositoryShape } from '../state-sqlite-repository.ts'

export { createHash, DatabaseSync, Schema }
export type StartRun = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'StartAcceptedRun' }
>
export type AcceptRunDefinition = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'AcceptRunDefinition' }
>
export type PauseRun = Extract<
  typeof ObserveIntent.Type,
  { readonly _tag: 'PauseRun' }
>
export type ResumeRun = Extract<
  typeof ObserveIntent.Type,
  { readonly _tag: 'ResumeRun' }
>
export type FakePolicy = Extract<
  typeof ObserveIntent.Type,
  | { readonly _tag: 'StopRun' }
  | { readonly _tag: 'SkipSequence' }
  | { readonly _tag: 'RetryPhase' }
  | { readonly _tag: 'RequestPark' }
>
export type PreviewRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'PreviewRunMutation' }
>
export type ApplyRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'ApplyRunMutation' }
>
export type ApproveDisruptiveRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'ApproveDisruptiveRunMutation' }
>
export type SavePlanDraft = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'SaveDraft' }
>
export type { LocalIdentity, StateSqliteRepositoryShape }
export type RunDefinitionAuthority =
  | { readonly executor: 'fake' }
  | { readonly executor: 'unavailable' }
  | {
      readonly executor: 'real'
      readonly executionContext: typeof RunExecutionContext.Type
    }
export const StoredRunDefinition = Schema.Struct({
  id: Schema.String,
  definition: RunDefinition,
  plan: PlanWorkspaceProjection,
})
export const PlanReceiptRow = Schema.Struct({ response: Schema.String })
export const RunDefinitionRow = Schema.Struct({
  run_definition_id: Schema.String,
  source_plan_id: Schema.String,
  source_plan_revision: Schema.Int,
  definition: Schema.String,
  accepted_at: Schema.String,
})
export const RunDefinitionReceiptRow = Schema.Struct({
  response: Schema.String,
})
export const ReceiptRow = Schema.Struct({ response: Schema.String })
export const InterventionReceiptRow = Schema.Struct({
  semantic_key: Schema.String,
  response: Schema.String,
})
export const CommandResultSchema = Schema.Any
export const StoredMutationPreview = Schema.Struct({
  preview_id: Schema.String,
  run_id: Schema.String,
  run_revision: Schema.Int,
  owner_person_id: Schema.String,
  mutation: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
  consequences: Schema.String,
  classification: Schema.Literals(['nonDisruptive', 'notice', 'disruptive']),
  expires_at: Schema.String,
  applied_at: Schema.NullOr(Schema.String),
})
const messages: Record<string, string> = {
  ClientReadOnly: 'Monitoring is read-only on this client.',
  OwnerRequired: 'Only the owner can accept a RunDefinition.',
  FreshnessConflict:
    'The plan or control changed. Review the current plan before accepting it.',
  PlanUnavailable: 'No observation plan is installed.',
  PlanNotReady: 'The plan is not ready for RunDefinition acceptance.',
  RunDefinitionAlreadyAccepted:
    'This plan revision already has an immutable RunDefinition.',
  ActiveRunConflict: 'A run is already active. Return to Observe.',
  ControlLeaseLost:
    'Control changed hands. Your command was not sent to the observatory; the accepted run continues.',
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
}
export const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
export const operatorMessages = messages
export const reject = (reason: FailureReason) => ({
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
      messages[reason] ?? 'The requested fake-run action is unavailable.',
  },
})
