import { Schema } from 'effect'
import { NonNegativeInt, RunId, RunRevision } from './primitives.js'

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
  executor: Schema.Literals(['fake', 'fixture']),
  phase: Schema.Literals([
    'preflight',
    'acquire',
    'capture',
    'verify',
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
    Schema.Literals(['preflight', 'acquire', 'capture', 'verify']),
  ),
  retryUsed: Schema.Boolean,
  lifecycleFacts: Schema.NonEmptyArray(Schema.NonEmptyString),
  attemptFacts: Schema.NonEmptyArray(Schema.NonEmptyString),
  actions: Schema.Struct({
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
