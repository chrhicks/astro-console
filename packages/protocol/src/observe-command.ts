import { Schema } from 'effect'
import { BootstrapSnapshot } from './bootstrap.js'
import { IdempotencyKey, LeaseRevision, RunRevision } from './primitives.js'

const ObserveAction = {
  expectedLeaseRevision: LeaseRevision,
  expectedRunRevision: RunRevision,
  idempotencyKey: IdempotencyKey,
}

export const ObserveIntent = Schema.TaggedUnion({
  PauseRun: ObserveAction,
  ResumeRun: ObserveAction,
  StopRun: ObserveAction,
  SkipSequence: ObserveAction,
  RetryPhase: ObserveAction,
  RequestPark: ObserveAction,
})

export const ObserveCommandRequest = Schema.Struct({ intent: ObserveIntent })

export interface ObserveCommandRequest extends Schema.Schema.Type<
  typeof ObserveCommandRequest
> {}

export const ObserveCommandFailure = Schema.TaggedUnion({
  InvalidInput: { summary: Schema.NonEmptyString },
  ObserveServiceUnavailable: { summary: Schema.NonEmptyString },
  Rejected: {
    reason: Schema.Literals([
      'ClientReadOnly',
      'ControlLeaseLost',
      'RunRevisionConflict',
      'AlreadyPaused',
      'AlreadyTerminal',
      'NotPaused',
      'ResumePhaseUnavailable',
      'IdempotencyConflict',
      'RetryExhausted',
      'PolicyUnavailable',
    ]),
    summary: Schema.NonEmptyString,
  },
})

export const ObserveCommandResult = Schema.TaggedUnion({
  PauseAccepted: {},
  ResumeAccepted: {},
  StopAccepted: {},
  SequenceSkipped: {},
  PhaseRetryAccepted: {},
  ParkRequested: {},
})

export const ObserveCommandResponse = Schema.TaggedUnion({
  Accepted: { result: ObserveCommandResult },
  Rejected: { failure: ObserveCommandFailure, snapshot: BootstrapSnapshot },
  Unavailable: {
    failure: Schema.TaggedStruct('ObserveServiceUnavailable', {
      summary: Schema.NonEmptyString,
    }),
  },
})
