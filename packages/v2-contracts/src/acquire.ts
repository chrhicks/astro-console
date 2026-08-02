import { Data, Schema } from 'effect'
import {
  AssetId,
  AttemptId,
  AcquireRevision,
  NonNegativeInt,
  NonNegativeNumber,
  PositiveInt,
  PositiveNumber,
  RunId,
} from './primitives.js'
import { SolveRecoveryParameters } from './commands.js'

export const RecoverySeriesId = Schema.NonEmptyString.pipe(
  Schema.brand('RecoverySeriesId'),
)

export const PointingVector = Schema.Struct({
  rightAscensionArcsec: Schema.Finite,
  declinationArcsec: Schema.Finite,
  convention: Schema.Literals(['mountRaDec', 'imageAxis']),
})

export interface PointingVector extends Schema.Schema.Type<
  typeof PointingVector
> {}

export const CelestialCoordinate = Schema.Struct({
  rightAscensionDegrees: Schema.Finite,
  declinationDegrees: Schema.Finite,
})

export interface CelestialCoordinate extends Schema.Schema.Type<
  typeof CelestialCoordinate
> {}

export const AcquireEvidencePolicy = Schema.Struct({
  centeringToleranceArcsec: NonNegativeNumber,
  automaticCorrectionLimitArcsec: PositiveNumber,
  hardCorrectionLimitArcsec: PositiveNumber,
  maxSolveAttemptsPerSeries: PositiveInt,
  maxCorrectionAttempts: PositiveInt,
  maxRecoverySeries: NonNegativeInt,
  polarToleranceArcsec: PositiveNumber,
}).check(
  Schema.makeFilter((policy) => {
    if (
      policy.centeringToleranceArcsec > policy.automaticCorrectionLimitArcsec
    ) {
      return {
        path: ['centeringToleranceArcsec'],
        issue:
          'centering tolerance must not exceed the automatic correction limit',
      }
    }
    if (
      policy.automaticCorrectionLimitArcsec > policy.hardCorrectionLimitArcsec
    ) {
      return {
        path: ['automaticCorrectionLimitArcsec'],
        issue:
          'automatic correction limit must not exceed the hard safety limit',
      }
    }
  }),
)

export interface AcquireEvidencePolicy extends Schema.Schema.Type<
  typeof AcquireEvidencePolicy
> {}

export const SolveSeries = Schema.Struct({
  seriesId: RecoverySeriesId,
  purpose: Schema.Literals([
    'initial',
    'operatorRecovery',
    'correctionVerification',
  ]),
  parameters: SolveRecoveryParameters,
  maxAttempts: PositiveInt,
  verificationOfCorrectionAttemptId: Schema.NullOr(AttemptId),
  completedAttemptIds: Schema.Array(AttemptId),
})

export interface SolveSeries extends Schema.Schema.Type<typeof SolveSeries> {}

export const PointingSolveResult = Schema.TaggedUnion({
  Solved: {
    desiredCenter: CelestialCoordinate,
    solvedCenter: CelestialCoordinate,
    correction: PointingVector,
    uncertaintyArcsec: NonNegativeNumber,
  },
  NoSolution: {
    category: Schema.NonEmptyString,
    retryable: Schema.Boolean,
    diagnosticRef: Schema.NonEmptyString,
  },
})

export type PointingSolveResult = typeof PointingSolveResult.Type

export const AcquireEvidence = Schema.TaggedUnion({
  SolveAttempt: {
    attemptId: AttemptId,
    seriesId: RecoverySeriesId,
    attemptNumber: PositiveInt,
    sourceFrameAssetId: AssetId,
    capturedAtEpochMs: NonNegativeInt,
    solverId: Schema.NonEmptyString,
    solverVersion: Schema.NonEmptyString,
    verificationOfCorrectionAttemptId: Schema.NullOr(AttemptId),
    result: PointingSolveResult,
  },
  CorrectionAccepted: {
    correctionAttemptId: AttemptId,
    proposalId: Schema.NullOr(Schema.NonEmptyString),
    basedOnSolveAttemptId: AttemptId,
    basis: Schema.Literals(['measuredInverse', 'operatorRevision']),
    correction: PointingVector,
    acknowledgedAtEpochMs: NonNegativeInt,
    driverAcknowledgementRef: Schema.NonEmptyString,
  },
  CorrectionRejected: {
    correctionAttemptId: AttemptId,
    proposalId: Schema.NullOr(Schema.NonEmptyString),
    basedOnSolveAttemptId: AttemptId,
    basis: Schema.Literals(['measuredInverse', 'operatorRevision']),
    correction: PointingVector,
    rejectedAtEpochMs: NonNegativeInt,
    diagnosticRef: Schema.NonEmptyString,
  },
  PolarMeasurement: {
    attemptId: AttemptId,
    sourceFrameAssetId: AssetId,
    measuredAtEpochMs: NonNegativeInt,
    desiredPole: CelestialCoordinate,
    measuredMountAxis: CelestialCoordinate,
    altitudeErrorArcsec: Schema.Finite,
    azimuthErrorArcsec: Schema.Finite,
    totalErrorArcsec: NonNegativeNumber,
    uncertaintyArcsec: NonNegativeNumber,
    withinTolerance: Schema.Boolean,
  },
})

export type AcquireEvidence = typeof AcquireEvidence.Type

export const AcquireActiveWork = Schema.TaggedUnion({
  SolveRequested: {
    attemptId: AttemptId,
    seriesId: RecoverySeriesId,
    attemptNumber: PositiveInt,
    purpose: Schema.Literals(['initial', 'retry', 'verification']),
    verificationOfCorrectionAttemptId: Schema.NullOr(AttemptId),
  },
  CorrectionRequested: {
    correctionAttemptId: AttemptId,
    proposalId: Schema.NullOr(Schema.NonEmptyString),
    basedOnSolveAttemptId: AttemptId,
    basis: Schema.Literals(['measuredInverse', 'operatorRevision']),
    correction: PointingVector,
  },
  PolarMeasurementRequested: {
    attemptId: AttemptId,
  },
})

export type AcquireActiveWork = typeof AcquireActiveWork.Type

export const CorrectionProposal = Schema.Struct({
  proposalId: Schema.NonEmptyString,
  basedOnSolveAttemptId: AttemptId,
  basedOnRevision: AcquireRevision,
  basis: Schema.Literals(['measuredInverse', 'operatorRevision']),
  correction: PointingVector,
  expiresAtEpochMs: NonNegativeInt,
})

export interface CorrectionProposal extends Schema.Schema.Type<
  typeof CorrectionProposal
> {}

export const AcquireSession = Schema.Struct({
  runId: RunId,
  revision: AcquireRevision,
  mode: Schema.Literals(['pointing', 'polar']),
  phase: Schema.Literals([
    'solving',
    'correcting',
    'verifying',
    'awaitingApproval',
    'polarMeasuring',
    'polarGuidance',
    'paused',
    'skipped',
    'completed',
  ]),
  policy: AcquireEvidencePolicy,
  solveSeries: Schema.Array(SolveSeries),
  evidence: Schema.Array(AcquireEvidence),
  activeWork: Schema.NullOr(AcquireActiveWork),
  pendingCorrectionProposal: Schema.NullOr(CorrectionProposal),
  latestPolarMeasurementAttemptId: Schema.NullOr(AttemptId),
  acceptedPolarMeasurementAttemptId: Schema.NullOr(AttemptId),
}).check(Schema.makeFilter((session) => validateAcquireSession(session)))

export interface AcquireSession extends Schema.Schema.Type<
  typeof AcquireSession
> {}

export const SolveCompletion = Schema.Struct({
  attemptId: AttemptId,
  sourceFrameAssetId: AssetId,
  capturedAtEpochMs: NonNegativeInt,
  solverId: Schema.NonEmptyString,
  solverVersion: Schema.NonEmptyString,
  result: PointingSolveResult,
  nextAttemptId: AttemptId,
  correctionAttemptId: AttemptId,
  proposalId: Schema.NonEmptyString,
  proposalExpiresAtEpochMs: NonNegativeInt,
})

export interface SolveCompletion extends Schema.Schema.Type<
  typeof SolveCompletion
> {}

export type SolveCompletionDecision = Data.TaggedEnum<{
  Centered: {
    readonly session: AcquireSession
    readonly solveAttemptId: typeof AttemptId.Type
  }
  RetryScheduled: {
    readonly session: AcquireSession
    readonly attemptId: typeof AttemptId.Type
  }
  AutomaticCorrectionStarted: {
    readonly session: AcquireSession
    readonly correction: PointingVector
  }
  CorrectionApprovalRequired: {
    readonly session: AcquireSession
    readonly proposal: CorrectionProposal
  }
  Paused: {
    readonly session: AcquireSession
    readonly reason:
      | 'SolveBudgetExhausted'
      | 'SolveFailureNotRetryable'
      | 'CorrectionBudgetExhausted'
      | 'CorrectionOutsideSafetyBound'
  }
  Rejected: {
    readonly reason:
      | 'SolveNotExpected'
      | 'AttemptMismatch'
      | 'SeriesUnavailable'
      | 'AttemptNumberInvalid'
      | 'ProposalExpiryInvalid'
  }
}>

export const SolveCompletionDecision =
  Data.taggedEnum<SolveCompletionDecision>()

export const recordSolveCompletion = (
  session: AcquireSession,
  completion: SolveCompletion,
): SolveCompletionDecision => {
  const activeWork = session.activeWork
  if (!AcquireActiveWork.guards.SolveRequested(activeWork)) {
    return SolveCompletionDecision.Rejected({ reason: 'SolveNotExpected' })
  }
  if (activeWork.attemptId !== completion.attemptId) {
    return SolveCompletionDecision.Rejected({ reason: 'AttemptMismatch' })
  }

  const series = session.solveSeries.find(
    ({ seriesId }) => seriesId === activeWork.seriesId,
  )
  if (series === undefined)
    return SolveCompletionDecision.Rejected({ reason: 'SeriesUnavailable' })
  if (activeWork.attemptNumber !== series.completedAttemptIds.length + 1) {
    return SolveCompletionDecision.Rejected({ reason: 'AttemptNumberInvalid' })
  }

  const solveEvidence = AcquireEvidence.cases.SolveAttempt.make({
    attemptId: completion.attemptId,
    seriesId: series.seriesId,
    attemptNumber: activeWork.attemptNumber,
    sourceFrameAssetId: completion.sourceFrameAssetId,
    capturedAtEpochMs: completion.capturedAtEpochMs,
    solverId: completion.solverId,
    solverVersion: completion.solverVersion,
    verificationOfCorrectionAttemptId:
      activeWork.verificationOfCorrectionAttemptId,
    result: completion.result,
  })
  const recorded = appendSolveEvidence(session, series, solveEvidence)

  return PointingSolveResult.match(completion.result, {
    NoSolution: ({ retryable }) => {
      if (!retryable)
        return pauseEvidenceSession(recorded, 'SolveFailureNotRetryable')
      if (activeWork.attemptNumber >= series.maxAttempts) {
        return pauseEvidenceSession(recorded, 'SolveBudgetExhausted')
      }
      const nextWork = AcquireActiveWork.cases.SolveRequested.make({
        attemptId: completion.nextAttemptId,
        seriesId: series.seriesId,
        attemptNumber: PositiveInt.make(activeWork.attemptNumber + 1),
        purpose: 'retry',
        verificationOfCorrectionAttemptId:
          activeWork.verificationOfCorrectionAttemptId,
      })
      return SolveCompletionDecision.RetryScheduled({
        session: advanceEvidenceSession(
          recorded,
          session.phase,
          nextWork,
          null,
        ),
        attemptId: completion.nextAttemptId,
      })
    },
    Solved: ({ correction }) => {
      const magnitudeArcsec = pointingMagnitude(correction)
      if (magnitudeArcsec <= session.policy.centeringToleranceArcsec) {
        return SolveCompletionDecision.Centered({
          session: advanceEvidenceSession(recorded, 'completed', null, null),
          solveAttemptId: completion.attemptId,
        })
      }
      if (magnitudeArcsec > session.policy.hardCorrectionLimitArcsec) {
        return pauseEvidenceSession(recorded, 'CorrectionOutsideSafetyBound')
      }
      if (
        countAcceptedCorrections(recorded) >=
        session.policy.maxCorrectionAttempts
      ) {
        return pauseEvidenceSession(recorded, 'CorrectionBudgetExhausted')
      }
      if (magnitudeArcsec <= session.policy.automaticCorrectionLimitArcsec) {
        const work = AcquireActiveWork.cases.CorrectionRequested.make({
          correctionAttemptId: completion.correctionAttemptId,
          proposalId: null,
          basedOnSolveAttemptId: completion.attemptId,
          basis: 'measuredInverse',
          correction,
        })
        return SolveCompletionDecision.AutomaticCorrectionStarted({
          session: advanceEvidenceSession(recorded, 'correcting', work, null),
          correction,
        })
      }
      if (completion.proposalExpiresAtEpochMs <= completion.capturedAtEpochMs) {
        return SolveCompletionDecision.Rejected({
          reason: 'ProposalExpiryInvalid',
        })
      }
      const proposal = CorrectionProposal.make({
        proposalId: completion.proposalId,
        basedOnSolveAttemptId: completion.attemptId,
        basedOnRevision: AcquireRevision.make(session.revision + 1),
        basis: 'measuredInverse',
        correction,
        expiresAtEpochMs: completion.proposalExpiresAtEpochMs,
      })
      return SolveCompletionDecision.CorrectionApprovalRequired({
        session: advanceEvidenceSession(
          recorded,
          'awaitingApproval',
          null,
          proposal,
        ),
        proposal,
      })
    },
  })
}

export type RecoverySeriesDecision = Data.TaggedEnum<{
  Started: {
    readonly session: AcquireSession
    readonly seriesId: typeof RecoverySeriesId.Type
    readonly attemptId: typeof AttemptId.Type
  }
  Rejected: {
    readonly reason:
      | 'AcquireNotPaused'
      | 'RecoveryParametersUnchanged'
      | 'RecoveryBudgetExhausted'
      | 'WrongAcquireMode'
  }
}>

export const RecoverySeriesDecision = Data.taggedEnum<RecoverySeriesDecision>()

export const openRecoverySeries = (
  session: AcquireSession,
  input: {
    readonly seriesId: typeof RecoverySeriesId.Type
    readonly attemptId: typeof AttemptId.Type
    readonly parameters: typeof SolveRecoveryParameters.Type
  },
): RecoverySeriesDecision => {
  if (session.mode !== 'pointing')
    return RecoverySeriesDecision.Rejected({ reason: 'WrongAcquireMode' })
  if (session.phase !== 'paused')
    return RecoverySeriesDecision.Rejected({ reason: 'AcquireNotPaused' })
  const recoverySeries = session.solveSeries.filter(
    ({ purpose }) => purpose === 'operatorRecovery',
  )
  if (recoverySeries.length >= session.policy.maxRecoverySeries) {
    return RecoverySeriesDecision.Rejected({
      reason: 'RecoveryBudgetExhausted',
    })
  }
  const previous = session.solveSeries.at(-1)
  if (
    previous !== undefined &&
    sameSolveParameters(previous.parameters, input.parameters)
  ) {
    return RecoverySeriesDecision.Rejected({
      reason: 'RecoveryParametersUnchanged',
    })
  }
  const series = SolveSeries.make({
    seriesId: input.seriesId,
    purpose: 'operatorRecovery',
    parameters: input.parameters,
    maxAttempts: session.policy.maxSolveAttemptsPerSeries,
    verificationOfCorrectionAttemptId: null,
    completedAttemptIds: [],
  })
  const work = AcquireActiveWork.cases.SolveRequested.make({
    attemptId: input.attemptId,
    seriesId: input.seriesId,
    attemptNumber: PositiveInt.make(1),
    purpose: 'initial',
    verificationOfCorrectionAttemptId: null,
  })
  return RecoverySeriesDecision.Started({
    session: advanceEvidenceSession(
      { ...session, solveSeries: [...session.solveSeries, series] },
      'solving',
      work,
      null,
    ),
    seriesId: input.seriesId,
    attemptId: input.attemptId,
  })
}

export type CorrectionCommandDecision = Data.TaggedEnum<{
  Started: {
    readonly session: AcquireSession
    readonly correction: PointingVector
  }
  Revised: {
    readonly session: AcquireSession
    readonly proposal: CorrectionProposal
  }
  Rejected: {
    readonly reason:
      | 'ProposalUnavailable'
      | 'ProposalStale'
      | 'ProposalExpired'
      | 'CorrectionOutsideSafetyBound'
      | 'CorrectionAlreadyWithinTolerance'
  }
}>

export const CorrectionCommandDecision =
  Data.taggedEnum<CorrectionCommandDecision>()

export const approveCorrectionProposal = (
  session: AcquireSession,
  input: {
    readonly proposalId: string
    readonly correctionAttemptId: typeof AttemptId.Type
    readonly nowEpochMs: number
  },
): CorrectionCommandDecision => {
  const proposal = session.pendingCorrectionProposal
  if (proposal === null)
    return CorrectionCommandDecision.Rejected({
      reason: 'ProposalUnavailable',
    })
  if (
    proposal.proposalId !== input.proposalId ||
    proposal.basedOnRevision !== session.revision
  ) {
    return CorrectionCommandDecision.Rejected({ reason: 'ProposalStale' })
  }
  if (input.nowEpochMs > proposal.expiresAtEpochMs) {
    return CorrectionCommandDecision.Rejected({ reason: 'ProposalExpired' })
  }
  const work = AcquireActiveWork.cases.CorrectionRequested.make({
    correctionAttemptId: input.correctionAttemptId,
    proposalId: proposal.proposalId,
    basedOnSolveAttemptId: proposal.basedOnSolveAttemptId,
    basis: proposal.basis,
    correction: proposal.correction,
  })
  return CorrectionCommandDecision.Started({
    session: advanceEvidenceSession(session, 'correcting', work, null),
    correction: proposal.correction,
  })
}

export const reviseCorrectionProposal = (
  session: AcquireSession,
  input: {
    readonly currentProposalId: string
    readonly nextProposalId: string
    readonly correction: PointingVector
    readonly nowEpochMs: number
    readonly expiresAtEpochMs: number
  },
): CorrectionCommandDecision => {
  const current = session.pendingCorrectionProposal
  if (current === null)
    return CorrectionCommandDecision.Rejected({
      reason: 'ProposalUnavailable',
    })
  if (
    current.proposalId !== input.currentProposalId ||
    current.basedOnRevision !== session.revision
  ) {
    return CorrectionCommandDecision.Rejected({ reason: 'ProposalStale' })
  }
  if (input.nowEpochMs > current.expiresAtEpochMs) {
    return CorrectionCommandDecision.Rejected({ reason: 'ProposalExpired' })
  }
  const magnitudeArcsec = pointingMagnitude(input.correction)
  if (magnitudeArcsec <= session.policy.centeringToleranceArcsec) {
    return CorrectionCommandDecision.Rejected({
      reason: 'CorrectionAlreadyWithinTolerance',
    })
  }
  if (magnitudeArcsec > session.policy.hardCorrectionLimitArcsec) {
    return CorrectionCommandDecision.Rejected({
      reason: 'CorrectionOutsideSafetyBound',
    })
  }
  const proposal = CorrectionProposal.make({
    proposalId: input.nextProposalId,
    basedOnSolveAttemptId: current.basedOnSolveAttemptId,
    basedOnRevision: AcquireRevision.make(session.revision + 1),
    basis: 'operatorRevision',
    correction: input.correction,
    expiresAtEpochMs: NonNegativeInt.make(input.expiresAtEpochMs),
  })
  return CorrectionCommandDecision.Revised({
    session: advanceEvidenceSession(
      session,
      'awaitingApproval',
      null,
      proposal,
    ),
    proposal,
  })
}

export type CorrectionAcknowledgementDecision = Data.TaggedEnum<{
  VerificationScheduled: {
    readonly session: AcquireSession
    readonly attemptId: typeof AttemptId.Type
  }
  Paused: {
    readonly session: AcquireSession
    readonly reason: 'CorrectionCommandRejected'
  }
  Rejected: {
    readonly reason: 'CorrectionNotExpected' | 'CorrectionAttemptMismatch'
  }
}>

export const CorrectionAcknowledgementDecision =
  Data.taggedEnum<CorrectionAcknowledgementDecision>()

export const recordCorrectionAcknowledgement = (
  session: AcquireSession,
  input: {
    readonly correctionAttemptId: typeof AttemptId.Type
    readonly accepted: boolean
    readonly occurredAtEpochMs: number
    readonly acknowledgementRef: string
    readonly verificationSeriesId: typeof RecoverySeriesId.Type
    readonly verificationAttemptId: typeof AttemptId.Type
  },
): CorrectionAcknowledgementDecision => {
  if (!AcquireActiveWork.guards.CorrectionRequested(session.activeWork)) {
    return CorrectionAcknowledgementDecision.Rejected({
      reason: 'CorrectionNotExpected',
    })
  }
  if (session.activeWork.correctionAttemptId !== input.correctionAttemptId) {
    return CorrectionAcknowledgementDecision.Rejected({
      reason: 'CorrectionAttemptMismatch',
    })
  }

  const base = {
    correctionAttemptId: session.activeWork.correctionAttemptId,
    proposalId: session.activeWork.proposalId,
    basedOnSolveAttemptId: session.activeWork.basedOnSolveAttemptId,
    basis: session.activeWork.basis,
    correction: session.activeWork.correction,
  }
  if (!input.accepted) {
    const evidence = AcquireEvidence.cases.CorrectionRejected.make({
      ...base,
      rejectedAtEpochMs: NonNegativeInt.make(input.occurredAtEpochMs),
      diagnosticRef: input.acknowledgementRef,
    })
    return CorrectionAcknowledgementDecision.Paused({
      session: advanceEvidenceSession(
        { ...session, evidence: [...session.evidence, evidence] },
        'paused',
        null,
        null,
      ),
      reason: 'CorrectionCommandRejected',
    })
  }

  const evidence = AcquireEvidence.cases.CorrectionAccepted.make({
    ...base,
    acknowledgedAtEpochMs: NonNegativeInt.make(input.occurredAtEpochMs),
    driverAcknowledgementRef: input.acknowledgementRef,
  })
  const parameters = session.solveSeries.at(-1)?.parameters
  if (parameters === undefined) {
    return CorrectionAcknowledgementDecision.Rejected({
      reason: 'CorrectionNotExpected',
    })
  }
  const series = SolveSeries.make({
    seriesId: input.verificationSeriesId,
    purpose: 'correctionVerification',
    parameters,
    maxAttempts: session.policy.maxSolveAttemptsPerSeries,
    verificationOfCorrectionAttemptId: input.correctionAttemptId,
    completedAttemptIds: [],
  })
  const work = AcquireActiveWork.cases.SolveRequested.make({
    attemptId: input.verificationAttemptId,
    seriesId: input.verificationSeriesId,
    attemptNumber: PositiveInt.make(1),
    purpose: 'verification',
    verificationOfCorrectionAttemptId: input.correctionAttemptId,
  })
  return CorrectionAcknowledgementDecision.VerificationScheduled({
    session: advanceEvidenceSession(
      {
        ...session,
        evidence: [...session.evidence, evidence],
        solveSeries: [...session.solveSeries, series],
      },
      'verifying',
      work,
      null,
    ),
    attemptId: input.verificationAttemptId,
  })
}

export type PolarDecision = Data.TaggedEnum<{
  MeasurementScheduled: {
    readonly session: AcquireSession
    readonly attemptId: typeof AttemptId.Type
  }
  GuidanceUpdated: {
    readonly session: AcquireSession
    readonly measurement: typeof AcquireEvidence.cases.PolarMeasurement.Type
  }
  Accepted: {
    readonly session: AcquireSession
    readonly attemptId: typeof AttemptId.Type
  }
  Rejected: {
    readonly reason:
      | 'WrongAcquireMode'
      | 'PolarMeasurementIneligible'
      | 'MeasurementNotExpected'
      | 'AttemptMismatch'
      | 'MeasurementUnavailable'
      | 'MeasurementSuperseded'
      | 'PolarToleranceNotMet'
  }
}>

export const PolarDecision = Data.taggedEnum<PolarDecision>()

export const requestPolarMeasurement = (
  session: AcquireSession,
  attemptId: typeof AttemptId.Type,
): PolarDecision => {
  if (session.mode !== 'polar')
    return PolarDecision.Rejected({ reason: 'WrongAcquireMode' })
  if (session.phase !== 'polarGuidance' || session.activeWork !== null) {
    return PolarDecision.Rejected({ reason: 'PolarMeasurementIneligible' })
  }
  return PolarDecision.MeasurementScheduled({
    session: advanceEvidenceSession(
      session,
      'polarMeasuring',
      AcquireActiveWork.cases.PolarMeasurementRequested.make({ attemptId }),
      null,
    ),
    attemptId,
  })
}

export const recordPolarMeasurementEvidence = (
  session: AcquireSession,
  input: {
    readonly attemptId: typeof AttemptId.Type
    readonly sourceFrameAssetId: typeof AssetId.Type
    readonly measuredAtEpochMs: number
    readonly desiredPole: CelestialCoordinate
    readonly measuredMountAxis: CelestialCoordinate
    readonly altitudeErrorArcsec: number
    readonly azimuthErrorArcsec: number
    readonly uncertaintyArcsec: number
  },
): PolarDecision => {
  if (!AcquireActiveWork.guards.PolarMeasurementRequested(session.activeWork)) {
    return PolarDecision.Rejected({ reason: 'MeasurementNotExpected' })
  }
  if (session.activeWork.attemptId !== input.attemptId) {
    return PolarDecision.Rejected({ reason: 'AttemptMismatch' })
  }
  const totalErrorArcsec = Math.hypot(
    input.altitudeErrorArcsec,
    input.azimuthErrorArcsec,
  )
  const measurement = AcquireEvidence.cases.PolarMeasurement.make({
    ...input,
    measuredAtEpochMs: NonNegativeInt.make(input.measuredAtEpochMs),
    altitudeErrorArcsec: Schema.Finite.make(input.altitudeErrorArcsec),
    azimuthErrorArcsec: Schema.Finite.make(input.azimuthErrorArcsec),
    totalErrorArcsec: NonNegativeNumber.make(totalErrorArcsec),
    uncertaintyArcsec: NonNegativeNumber.make(input.uncertaintyArcsec),
    withinTolerance: totalErrorArcsec <= session.policy.polarToleranceArcsec,
  })
  return PolarDecision.GuidanceUpdated({
    session: advanceEvidenceSession(
      {
        ...session,
        evidence: [...session.evidence, measurement],
        latestPolarMeasurementAttemptId: input.attemptId,
      },
      'polarGuidance',
      null,
      null,
    ),
    measurement,
  })
}

export const acceptLatestPolarMeasurement = (
  session: AcquireSession,
  attemptId: typeof AttemptId.Type,
): PolarDecision => {
  if (session.mode !== 'polar')
    return PolarDecision.Rejected({ reason: 'WrongAcquireMode' })
  if (session.latestPolarMeasurementAttemptId === null) {
    return PolarDecision.Rejected({ reason: 'MeasurementUnavailable' })
  }
  if (
    session.latestPolarMeasurementAttemptId !== attemptId ||
    session.activeWork !== null
  ) {
    return PolarDecision.Rejected({ reason: 'MeasurementSuperseded' })
  }
  const measurement = session.evidence.find(
    (evidence) =>
      AcquireEvidence.guards.PolarMeasurement(evidence) &&
      evidence.attemptId === attemptId,
  )
  if (
    measurement === undefined ||
    !AcquireEvidence.guards.PolarMeasurement(measurement)
  ) {
    return PolarDecision.Rejected({ reason: 'MeasurementUnavailable' })
  }
  if (!measurement.withinTolerance)
    return PolarDecision.Rejected({ reason: 'PolarToleranceNotMet' })
  return PolarDecision.Accepted({
    session: AcquireSession.make({
      ...advanceEvidenceSession(session, 'completed', null, null),
      acceptedPolarMeasurementAttemptId: attemptId,
    }),
    attemptId,
  })
}

export type AcquireSkipDecision = Data.TaggedEnum<{
  Skipped: {
    readonly session: AcquireSession
    readonly nextSequenceId: string
  }
  Rejected: { readonly reason: 'AcquireNotPaused' | 'NoFallbackWork' }
}>

export const AcquireSkipDecision = Data.taggedEnum<AcquireSkipDecision>()

export const skipPausedAcquireTarget = (
  session: AcquireSession,
  nextSequenceId: string | undefined,
): AcquireSkipDecision => {
  if (session.phase !== 'paused')
    return AcquireSkipDecision.Rejected({ reason: 'AcquireNotPaused' })
  if (nextSequenceId === undefined || nextSequenceId.length === 0) {
    return AcquireSkipDecision.Rejected({ reason: 'NoFallbackWork' })
  }
  return AcquireSkipDecision.Skipped({
    session: advanceEvidenceSession(session, 'skipped', null, null),
    nextSequenceId,
  })
}

function validateAcquireSession(session: {
  readonly mode: 'pointing' | 'polar'
  readonly phase:
    | 'solving'
    | 'correcting'
    | 'verifying'
    | 'awaitingApproval'
    | 'polarMeasuring'
    | 'polarGuidance'
    | 'paused'
    | 'skipped'
    | 'completed'
  readonly solveSeries: ReadonlyArray<SolveSeries>
  readonly evidence: ReadonlyArray<AcquireEvidence>
  readonly activeWork: AcquireActiveWork | null
  readonly pendingCorrectionProposal: CorrectionProposal | null
  readonly latestPolarMeasurementAttemptId: typeof AttemptId.Type | null
  readonly acceptedPolarMeasurementAttemptId: typeof AttemptId.Type | null
  readonly policy: AcquireEvidencePolicy
  readonly revision: typeof AcquireRevision.Type
}) {
  if (session.mode === 'pointing' && session.solveSeries.length === 0) {
    return {
      path: ['solveSeries'],
      issue: 'pointing Acquire requires at least one solve series',
    }
  }
  if (session.mode === 'polar' && session.solveSeries.length > 0) {
    return {
      path: ['solveSeries'],
      issue: 'polar Acquire cannot contain pointing solve series',
    }
  }
  if (
    session.phase === 'awaitingApproval' &&
    session.pendingCorrectionProposal === null
  ) {
    return {
      path: ['pendingCorrectionProposal'],
      issue: 'approval phase requires a current proposal',
    }
  }
  if (
    session.phase !== 'awaitingApproval' &&
    session.pendingCorrectionProposal !== null
  ) {
    return {
      path: ['pendingCorrectionProposal'],
      issue: 'a proposal exists only during approval',
    }
  }
  if (
    (session.phase === 'solving' || session.phase === 'verifying') &&
    !AcquireActiveWork.guards.SolveRequested(session.activeWork)
  ) {
    return {
      path: ['activeWork'],
      issue: 'solve phases require requested solve work',
    }
  }
  if (
    session.phase === 'correcting' &&
    !AcquireActiveWork.guards.CorrectionRequested(session.activeWork)
  ) {
    return {
      path: ['activeWork'],
      issue: 'correction phase requires requested correction work',
    }
  }
  if (
    session.phase === 'polarMeasuring' &&
    !AcquireActiveWork.guards.PolarMeasurementRequested(session.activeWork)
  ) {
    return {
      path: ['activeWork'],
      issue: 'polar measurement phase requires requested measurement work',
    }
  }
  if (
    (session.phase === 'paused' ||
      session.phase === 'skipped' ||
      session.phase === 'completed' ||
      session.phase === 'awaitingApproval' ||
      session.phase === 'polarGuidance') &&
    session.activeWork !== null
  ) {
    return {
      path: ['activeWork'],
      issue: 'inactive phase cannot retain active work',
    }
  }
  if (session.latestPolarMeasurementAttemptId !== null) {
    const hasMeasurement = session.evidence.some(
      (evidence) =>
        AcquireEvidence.guards.PolarMeasurement(evidence) &&
        evidence.attemptId === session.latestPolarMeasurementAttemptId,
    )
    if (!hasMeasurement) {
      return {
        path: ['latestPolarMeasurementAttemptId'],
        issue: 'latest polar measurement must reference stored evidence',
      }
    }
  }
  if (
    session.acceptedPolarMeasurementAttemptId !== null &&
    session.acceptedPolarMeasurementAttemptId !==
      session.latestPolarMeasurementAttemptId
  ) {
    return {
      path: ['acceptedPolarMeasurementAttemptId'],
      issue: 'accepted polar evidence must be the latest measurement',
    }
  }

  const seriesIds = session.solveSeries.map(({ seriesId }) => seriesId)
  if (new Set(seriesIds).size !== seriesIds.length) {
    return {
      path: ['solveSeries'],
      issue: 'solve series identities must be unique',
    }
  }
  const evidenceIds = session.evidence.map((evidence) =>
    AcquireEvidence.match(evidence, {
      SolveAttempt: ({ attemptId }) => attemptId,
      CorrectionAccepted: ({ correctionAttemptId }) => correctionAttemptId,
      CorrectionRejected: ({ correctionAttemptId }) => correctionAttemptId,
      PolarMeasurement: ({ attemptId }) => attemptId,
    }),
  )
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    return { path: ['evidence'], issue: 'evidence identities must be unique' }
  }
  const solveEvidence = session.evidence.filter(
    AcquireEvidence.guards.SolveAttempt,
  )
  const correctionEvidence = session.evidence.filter(
    (evidence) =>
      AcquireEvidence.guards.CorrectionAccepted(evidence) ||
      AcquireEvidence.guards.CorrectionRejected(evidence),
  )
  const acceptedCorrections = session.evidence.filter(
    AcquireEvidence.guards.CorrectionAccepted,
  )
  const polarEvidence = session.evidence.filter(
    AcquireEvidence.guards.PolarMeasurement,
  )
  const seriesMismatch = session.solveSeries.some((series) => {
    const recordedIds = solveEvidence
      .filter((evidence) => evidence.seriesId === series.seriesId)
      .map(({ attemptId }) => attemptId)
    return (
      recordedIds.length !== series.completedAttemptIds.length ||
      recordedIds.some(
        (attemptId, index) => attemptId !== series.completedAttemptIds[index],
      ) ||
      solveEvidence.some(
        (evidence) =>
          evidence.seriesId === series.seriesId &&
          evidence.verificationOfCorrectionAttemptId !==
            series.verificationOfCorrectionAttemptId,
      )
    )
  })
  if (
    seriesMismatch ||
    solveEvidence.some((evidence) => !seriesIds.includes(evidence.seriesId))
  ) {
    return {
      path: ['solveSeries'],
      issue:
        'solve series must exactly index their correlated attempt evidence',
    }
  }
  if (
    session.solveSeries.filter(({ purpose }) => purpose === 'operatorRecovery')
      .length > session.policy.maxRecoverySeries
  ) {
    return {
      path: ['solveSeries'],
      issue: 'recovery series exceed the snapshotted policy bound',
    }
  }
  if (acceptedCorrections.length > session.policy.maxCorrectionAttempts) {
    return {
      path: ['evidence'],
      issue: 'accepted corrections exceed the snapshotted policy bound',
    }
  }
  if (
    correctionEvidence.some(
      ({ basedOnSolveAttemptId }) =>
        !solveEvidence.some(
          ({ attemptId }) => attemptId === basedOnSolveAttemptId,
        ),
    )
  ) {
    return {
      path: ['evidence'],
      issue: 'correction evidence must reference stored solve evidence',
    }
  }
  if (
    session.solveSeries.some(
      ({ verificationOfCorrectionAttemptId }) =>
        verificationOfCorrectionAttemptId !== null &&
        !acceptedCorrections.some(
          ({ correctionAttemptId }) =>
            correctionAttemptId === verificationOfCorrectionAttemptId,
        ),
    )
  ) {
    return {
      path: ['solveSeries'],
      issue: 'verification series must reference an accepted correction',
    }
  }
  if (AcquireActiveWork.guards.SolveRequested(session.activeWork)) {
    const activeWork = session.activeWork
    const activeSeries = session.solveSeries.find(
      ({ seriesId }) => seriesId === activeWork.seriesId,
    )
    if (
      activeSeries === undefined ||
      activeWork.attemptNumber !==
        activeSeries.completedAttemptIds.length + 1 ||
      activeWork.verificationOfCorrectionAttemptId !==
        activeSeries.verificationOfCorrectionAttemptId ||
      evidenceIds.includes(activeWork.attemptId)
    ) {
      return {
        path: ['activeWork'],
        issue:
          'active solve work must be the next unique attempt in its correlated series',
      }
    }
  }
  if (AcquireActiveWork.guards.CorrectionRequested(session.activeWork)) {
    const activeWork = session.activeWork
    const basedOnSolve = solveEvidence.find(
      ({ attemptId }) => attemptId === activeWork.basedOnSolveAttemptId,
    )
    if (
      basedOnSolve === undefined ||
      !PointingSolveResult.guards.Solved(basedOnSolve.result) ||
      (activeWork.basis === 'measuredInverse' &&
        !samePointingVector(
          basedOnSolve.result.correction,
          activeWork.correction,
        )) ||
      evidenceIds.includes(activeWork.correctionAttemptId)
    ) {
      return {
        path: ['activeWork'],
        issue:
          'active correction must preserve the exact vector from stored solve evidence',
      }
    }
  }
  if (session.pendingCorrectionProposal !== null) {
    const basedOnSolve = solveEvidence.find(
      ({ attemptId }) =>
        attemptId === session.pendingCorrectionProposal?.basedOnSolveAttemptId,
    )
    if (
      session.pendingCorrectionProposal.basedOnRevision !== session.revision ||
      basedOnSolve === undefined ||
      !PointingSolveResult.guards.Solved(basedOnSolve.result) ||
      (session.pendingCorrectionProposal.basis === 'measuredInverse' &&
        !samePointingVector(
          basedOnSolve.result.correction,
          session.pendingCorrectionProposal.correction,
        ))
    ) {
      return {
        path: ['pendingCorrectionProposal'],
        issue:
          'proposal must bind the current revision and exact stored solve vector',
      }
    }
  }
  if (
    polarEvidence.some((measurement) => {
      const total = Math.hypot(
        measurement.altitudeErrorArcsec,
        measurement.azimuthErrorArcsec,
      )
      return (
        Math.abs(total - measurement.totalErrorArcsec) > 0.000_001 ||
        measurement.withinTolerance !==
          total <= session.policy.polarToleranceArcsec
      )
    })
  ) {
    return {
      path: ['evidence'],
      issue:
        'polar tolerance facts must be derived from the stored measurement and policy',
    }
  }
  if (
    session.latestPolarMeasurementAttemptId !== null &&
    polarEvidence.at(-1)?.attemptId !== session.latestPolarMeasurementAttemptId
  ) {
    return {
      path: ['latestPolarMeasurementAttemptId'],
      issue:
        'latest polar identity must reference the last stored polar measurement',
    }
  }
  if (session.acceptedPolarMeasurementAttemptId !== null) {
    const accepted = polarEvidence.find(
      ({ attemptId }) =>
        attemptId === session.acceptedPolarMeasurementAttemptId,
    )
    if (
      session.mode !== 'polar' ||
      session.phase !== 'completed' ||
      accepted?.withinTolerance !== true
    ) {
      return {
        path: ['acceptedPolarMeasurementAttemptId'],
        issue:
          'accepted polar evidence must be current, within tolerance, and complete',
      }
    }
  }
}

function appendSolveEvidence(
  session: AcquireSession,
  series: SolveSeries,
  evidence: typeof AcquireEvidence.cases.SolveAttempt.Type,
): AcquireSession {
  return {
    ...session,
    solveSeries: session.solveSeries.map((candidate) =>
      candidate.seriesId === series.seriesId
        ? SolveSeries.make({
            ...candidate,
            completedAttemptIds: [
              ...candidate.completedAttemptIds,
              evidence.attemptId,
            ],
          })
        : candidate,
    ),
    evidence: [...session.evidence, evidence],
  }
}

function advanceEvidenceSession(
  session: AcquireSession,
  phase: AcquireSession['phase'],
  activeWork: AcquireActiveWork | null,
  pendingCorrectionProposal: CorrectionProposal | null,
): AcquireSession {
  return AcquireSession.make({
    ...session,
    revision: AcquireRevision.make(session.revision + 1),
    phase,
    activeWork,
    pendingCorrectionProposal,
  })
}

function pauseEvidenceSession(
  session: AcquireSession,
  reason:
    | 'SolveBudgetExhausted'
    | 'SolveFailureNotRetryable'
    | 'CorrectionBudgetExhausted'
    | 'CorrectionOutsideSafetyBound',
): SolveCompletionDecision {
  return SolveCompletionDecision.Paused({
    session: advanceEvidenceSession(session, 'paused', null, null),
    reason,
  })
}

function pointingMagnitude(correction: PointingVector) {
  return Math.hypot(
    correction.rightAscensionArcsec,
    correction.declinationArcsec,
  )
}

function countAcceptedCorrections(session: AcquireSession) {
  return session.evidence.filter(AcquireEvidence.guards.CorrectionAccepted)
    .length
}

function sameSolveParameters(
  left: typeof SolveRecoveryParameters.Type,
  right: typeof SolveRecoveryParameters.Type,
) {
  return (
    left.exposureSeconds === right.exposureSeconds &&
    left.binning === right.binning &&
    left.solverProfile === right.solverProfile
  )
}

function samePointingVector(left: PointingVector, right: PointingVector) {
  return (
    left.rightAscensionArcsec === right.rightAscensionArcsec &&
    left.declinationArcsec === right.declinationArcsec &&
    left.convention === right.convention
  )
}
