import { Schema } from 'effect'
import { NonNegativeInt, RunId, RunRevision } from './primitives.js'
import { PreflightSnapshot } from './preflight.js'
import { AcquireSnapshot } from './snapshots.js'

export const ObserveExecutorWork = Schema.Struct({
  workId: Schema.NonEmptyString,
  kind: Schema.Literals(['BeginRun', 'StartExposure', 'AbortExposure']),
  state: Schema.Literals([
    'pending',
    'commandAttempted',
    'observing',
    'reconciling',
    'completed',
    'rejected',
    'cancelled',
  ]),
  commandAttemptedAt: Schema.optionalKey(Schema.NonEmptyString),
  acknowledgedAt: Schema.optionalKey(Schema.NonEmptyString),
  settledAt: Schema.optionalKey(Schema.NonEmptyString),
  lastError: Schema.optionalKey(Schema.NonEmptyString),
})

export const ObserveActionEligibility = Schema.TaggedUnion({
  Eligible: {},
  Ineligible: {
    reason: Schema.Literals([
      'readOnlyClient',
      'controlRequired',
      'activeRunRequired',
      'pausedRunRequired',
      'terminalRun',
      'retryUsed',
      'policyUnavailable',
    ]),
  },
})

export const ObserveWorkspaceProjection = Schema.Struct({
  runId: RunId,
  revision: RunRevision,
  executor: Schema.Literals(['fake', 'fixture', 'real']),
  phase: Schema.Literals([
    'preflight',
    'acquire',
    'capture',
    'verify',
    'recover',
    'paused',
    'completed',
    'stopped',
    'parkRequested',
  ]),
  terminalOutcome: Schema.optionalKey(
    Schema.Literals(['completed', 'stopped', 'parkRequested']),
  ),
  target: Schema.NonEmptyString,
  currentSequence: NonNegativeInt,
  completedSequences: NonNegativeInt,
  totalSequences: NonNegativeInt,
  resumablePhase: Schema.optionalKey(
    Schema.Literals(['preflight', 'acquire', 'capture', 'verify', 'recover']),
  ),
  retryUsed: Schema.Boolean,
  preflight: Schema.optionalKey(PreflightSnapshot),
  acquire: Schema.optionalKey(AcquireSnapshot),
  lifecycleFacts: Schema.NonEmptyArray(Schema.NonEmptyString),
  attemptFacts: Schema.NonEmptyArray(Schema.NonEmptyString),
  executorWork: Schema.optionalKey(Schema.Array(ObserveExecutorWork)),
  actions: Schema.Struct({
    refreshPreflight: Schema.optionalKey(ObserveActionEligibility),
    pause: ObserveActionEligibility,
    resume: ObserveActionEligibility,
    stop: ObserveActionEligibility,
    skip: ObserveActionEligibility,
    retry: ObserveActionEligibility,
    park: ObserveActionEligibility,
  }),
})

export interface ObserveWorkspaceProjection extends Schema.Schema.Type<
  typeof ObserveWorkspaceProjection
> {}
