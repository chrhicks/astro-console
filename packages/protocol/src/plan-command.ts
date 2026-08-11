import { Schema } from 'effect'
import {
  IdempotencyKey,
  LeaseRevision,
  PlanId,
  PlanRevision,
  PreviewId,
  RunRevision,
} from './primitives.js'
import { BootstrapSnapshot } from './bootstrap.js'
import { RunSequenceDefinition } from './commands.js'

const PlanDraftSequence = Schema.Struct({
  sequenceId: Schema.NonEmptyString,
  target: Schema.NonEmptyString,
  capture: Schema.NonEmptyString,
  acquisition: Schema.NonEmptyString,
  stopCondition: Schema.NonEmptyString,
  window: Schema.Struct({
    startsAt: Schema.NonEmptyString,
    endsAt: Schema.NonEmptyString,
    usableMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    peakAltitudeDeg: Schema.Finite,
    horizonClearanceDeg: Schema.Finite,
  }),
  estimatedMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
  storageForecastMb: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  horizon: Schema.Literals(['clear', 'limited', 'blocked', 'missing']),
  storage: Schema.Literals(['available', 'limited', 'blocked', 'missing']),
  definition: RunSequenceDefinition,
}).check(
  Schema.makeFilter((sequence) => {
    if (sequence.sequenceId !== sequence.definition.sequenceId)
      return {
        path: ['definition', 'sequenceId'],
        issue: 'definition sequence identity must match the Plan sequence',
      }
  }),
)

const RunMutation = Schema.Literals([
  'reprioritizeSecond',
  'shortenSecond',
  'discardCurrent',
])

export const PlanIntent = Schema.TaggedUnion({
  SaveDraft: {
    planId: PlanId,
    expectedPlanRevision: PlanRevision,
    idempotencyKey: IdempotencyKey,
    sequences: Schema.NonEmptyArray(PlanDraftSequence),
  },
  AcceptRunDefinition: {
    planId: PlanId,
    expectedPlanRevision: PlanRevision,
    expectedLeaseRevision: LeaseRevision,
    idempotencyKey: IdempotencyKey,
  },
  StartAcceptedRun: {
    planId: PlanId,
    expectedPlanRevision: PlanRevision,
    expectedLeaseRevision: LeaseRevision,
    idempotencyKey: IdempotencyKey,
  },
  PreviewRunMutation: {
    mutation: RunMutation,
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    idempotencyKey: IdempotencyKey,
  },
  ApplyRunMutation: {
    previewId: PreviewId,
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    idempotencyKey: IdempotencyKey,
  },
  ApproveDisruptiveRunMutation: {
    previewId: PreviewId,
    approvalToken: Schema.NonEmptyString,
    expectedLeaseRevision: LeaseRevision,
    expectedRunRevision: RunRevision,
    idempotencyKey: IdempotencyKey,
  },
})

export const PlanCommandRequest = Schema.Struct({ intent: PlanIntent })

export interface PlanCommandRequest extends Schema.Schema.Type<
  typeof PlanCommandRequest
> {}

const PlanCommandRejectionReason = Schema.Literals([
  'FreshnessConflict',
  'PlanUnavailable',
  'PlanNotReady',
  'RunDefinitionAlreadyAccepted',
  'ClientReadOnly',
  'ControlLeaseLost',
  'OwnerRequired',
  'ActiveRunConflict',
  'RunRevisionConflict',
  'IdempotencyConflict',
  'PreviewUnavailable',
  'PreviewExpired',
  'ApprovalRequired',
  'ApprovalMismatch',
  'PolicyUnavailable',
  'InvalidInput',
  'DraftUnchanged',
])

export const PlanCommandFailure = Schema.TaggedUnion({
  InvalidInput: { summary: Schema.NonEmptyString },
  PlanServiceUnavailable: { summary: Schema.NonEmptyString },
  Rejected: {
    reason: PlanCommandRejectionReason,
    summary: Schema.NonEmptyString,
  },
})

export const PlanCommandResult = Schema.TaggedUnion({
  DraftSaved: {},
  RunDefinitionAccepted: {},
  RunStarted: {},
  RunMutationPreviewed: {
    previewId: PreviewId,
    classification: Schema.Literals(['nonDisruptive', 'notice', 'disruptive']),
    consequences: Schema.NonEmptyString,
    expiresAt: Schema.NonEmptyString,
    approvalRequired: Schema.Boolean,
    approvalToken: Schema.optionalKey(Schema.NonEmptyString),
  },
  RunMutationApplied: {},
})

export const PlanCommandResponse = Schema.TaggedUnion({
  Accepted: { result: PlanCommandResult, snapshot: BootstrapSnapshot },
  Rejected: { failure: PlanCommandFailure, snapshot: BootstrapSnapshot },
  Unavailable: {
    failure: Schema.TaggedStruct('PlanServiceUnavailable', {
      summary: Schema.NonEmptyString,
    }),
  },
})
