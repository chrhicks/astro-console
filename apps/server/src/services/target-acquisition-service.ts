import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  AcquireActiveWork,
  AcquireCommandRequest,
  AcquireIntent,
  AssetId,
  AttemptId,
  PointingSolveResult,
  RecoverySeriesId,
  LunarDiskLimbCompletion,
  CorrectionAcknowledgementDecision,
  CorrectionCommandDecision,
  approveCorrectionProposal,
  recordCorrectionAcknowledgement,
  reviseCorrectionProposal,
  recordLunarDiskLimbCompletion,
  recordSolveCompletion,
  recordTargetSlewAcknowledgement,
} from '@astro-console/v2-contracts'
import { AcquirePersistence } from './polar-service.ts'

export interface TargetAcquisitionProviderShape {
  readonly capture: (
    method: 'deepSkyPlateSolve' | 'lunarDiskLimb',
    attemptId: string,
  ) => Effect.Effect<unknown, unknown>
  readonly correct: (
    correctionAttemptId: string,
    correction: {
      readonly rightAscensionArcsec: number
      readonly declinationArcsec: number
      readonly convention: 'mountRaDec' | 'imageAxis'
    },
  ) => Effect.Effect<unknown, unknown>
}

export class TargetAcquisitionProvider extends Context.Service<
  TargetAcquisitionProvider,
  TargetAcquisitionProviderShape
>()('@astro-console/server/TargetAcquisitionProvider') {}

const ProviderResult = Schema.TaggedUnion({
  Aborted: { summary: Schema.NonEmptyString },
  Captured: {
    slewAcknowledgement: Schema.Struct({
      acknowledgedAtEpochMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      acknowledgementRef: Schema.NonEmptyString,
    }),
    evidence: Schema.Unknown,
  },
})

const CorrectionProviderResult = Schema.TaggedUnion({
  Rejected: { acknowledgementRef: Schema.NonEmptyString },
  Accepted: {
    acknowledgedAtEpochMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    acknowledgementRef: Schema.NonEmptyString,
  },
})

const DeepSkyEvidence = Schema.Struct({
  sourceFrameAssetId: AssetId,
  capturedAtEpochMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  solverId: Schema.NonEmptyString,
  solverVersion: Schema.NonEmptyString,
  result: PointingSolveResult,
})

const LunarEvidence = Schema.Struct({
  sourceFrameAssetId: AssetId,
  capturedAtEpochMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  detectorId: Schema.NonEmptyString,
  detectorVersion: Schema.NonEmptyString,
  desiredCenter: Schema.Struct({
    rightAscensionDegrees: Schema.Finite,
    declinationDegrees: Schema.Finite,
  }),
  measuredCenter: Schema.Struct({
    rightAscensionDegrees: Schema.Finite,
    declinationDegrees: Schema.Finite,
  }),
  correction: Schema.Struct({
    rightAscensionArcsec: Schema.Finite,
    declinationArcsec: Schema.Finite,
    convention: Schema.Literals(['mountRaDec', 'imageAxis']),
  }),
  uncertaintyArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})

export type TargetAcquisitionCommandResult =
  | { readonly _tag: 'Committed'; readonly cursor: number }
  | { readonly _tag: 'Aborted'; readonly summary: string }
  | { readonly _tag: 'Rejected'; readonly summary: string }
  | { readonly _tag: 'Unavailable'; readonly summary: string }

export const executeTargetAcquisitionCommand = Effect.fn(
  'TargetAcquisitionService.execute',
)(function* (raw: unknown) {
  const input = yield* Schema.decodeUnknownEffect(AcquireCommandRequest)(
    raw,
  ).pipe(Effect.option)
  if (Option.isNone(input))
    return {
      _tag: 'Rejected' as const,
      summary: 'The target acquisition command is invalid.',
    }
  const persistence = yield* AcquirePersistence
  const session = persistence.current()
  if (session === undefined || session.acquisitionMethod === undefined)
    return {
      _tag: 'Unavailable' as const,
      summary: 'Target acquisition is not active for the current run.',
    }
  if (input.value.intent.expectedAcquireRevision !== session.revision)
    return {
      _tag: 'Rejected' as const,
      summary: 'Target evidence changed. Read the current Observe projection.',
    }
  const intent = input.value.intent
  if (AcquireIntent.guards.ApprovePointingCorrection(intent)) {
    const approved = approveCorrectionProposal(session, {
      proposalId: intent.proposalId,
      correctionAttemptId: AttemptId.make(`correction-${session.revision + 1}`),
      nowEpochMs: 1_722_729_600_000,
    })
    if (!CorrectionCommandDecision.$is('Started')(approved))
      return {
        _tag: 'Rejected' as const,
        summary: 'That pointing correction proposal is no longer available.',
      }
    return yield* acknowledgeCorrection(approved.session, persistence)
  }
  if (AcquireIntent.guards.RevisePointingCorrection(intent)) {
    const proposal = session.pendingCorrectionProposal
    if (proposal === null)
      return {
        _tag: 'Rejected' as const,
        summary: 'That pointing correction proposal is no longer available.',
      }
    const revised = reviseCorrectionProposal(session, {
      currentProposalId: intent.proposalId,
      nextProposalId: `${intent.proposalId}-revision-${session.revision + 1}`,
      correction: {
        ...intent.correction,
        convention: proposal.correction.convention,
      },
      nowEpochMs: 1_722_729_600_000,
      expiresAtEpochMs: 1_722_729_660_000,
    })
    if (!CorrectionCommandDecision.$is('Revised')(revised))
      return {
        _tag: 'Rejected' as const,
        summary:
          'That revised pointing correction is outside the current bound.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(revised.session, 'PointingCorrectionRevised')
        .cursor,
    }
  }
  if (!AcquireIntent.guards.CaptureTargetAcquisitionEvidence(intent))
    return {
      _tag: 'Rejected' as const,
      summary: 'The target acquisition command is invalid.',
    }
  if (!AcquireActiveWork.guards.SolveRequested(session.activeWork))
    return {
      _tag: 'Rejected' as const,
      summary:
        'A target evidence capture is not expected in the current state.',
    }
  const provider = yield* Effect.serviceOption(TargetAcquisitionProvider)
  if (Option.isNone(provider))
    return {
      _tag: 'Unavailable' as const,
      summary: 'No target acquisition provider is configured.',
    }
  const rawResult = yield* provider.value
    .capture(session.acquisitionMethod, session.activeWork.attemptId)
    .pipe(Effect.option)
  if (Option.isNone(rawResult))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The target acquisition provider did not return evidence.',
    }
  const providerResult = yield* Schema.decodeUnknownEffect(ProviderResult)(
    rawResult.value,
  ).pipe(Effect.option)
  if (Option.isNone(providerResult))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The target acquisition evidence is invalid.',
    }
  if (ProviderResult.guards.Aborted(providerResult.value))
    return {
      _tag: 'Aborted' as const,
      summary: providerResult.value.summary,
    }
  const work = session.activeWork
  const attempt = work.attemptId
  const acknowledged =
    work.purpose === 'initial'
      ? recordTargetSlewAcknowledgement(session, {
          attemptId: attempt,
          acquisitionMethod: session.acquisitionMethod,
          ...providerResult.value.slewAcknowledgement,
        })
      : session
  const recorded =
    session.acquisitionMethod === 'deepSkyPlateSolve'
      ? yield* Schema.decodeUnknownEffect(DeepSkyEvidence)(
          providerResult.value.evidence,
        ).pipe(
          Effect.map((evidence) =>
            recordSolveCompletion(acknowledged, {
              attemptId: attempt,
              ...evidence,
              nextAttemptId: AttemptId.make(`${attempt}-retry`),
              correctionAttemptId: AttemptId.make(`${attempt}-correction`),
              proposalId: `${attempt}-proposal`,
              proposalExpiresAtEpochMs: evidence.capturedAtEpochMs + 60_000,
            }),
          ),
        )
      : yield* Schema.decodeUnknownEffect(LunarEvidence)(
          providerResult.value.evidence,
        ).pipe(
          Effect.map((evidence) =>
            recordLunarDiskLimbCompletion(
              acknowledged,
              LunarDiskLimbCompletion.make({ attemptId: attempt, ...evidence }),
            ),
          ),
        )
  if (!('session' in recorded))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The target acquisition evidence could not be recorded.',
    }
  if (AcquireActiveWork.guards.CorrectionRequested(recorded.session.activeWork))
    return yield* acknowledgeCorrection(recorded.session, persistence)
  return {
    _tag: 'Committed' as const,
    cursor: persistence.commit(
      recorded.session,
      'TargetAcquisitionEvidenceRecorded',
    ).cursor,
  }
})

const acknowledgeCorrection = Effect.fn(
  'TargetAcquisitionService.acknowledgeCorrection',
)(function* (
  session: typeof import('@astro-console/v2-contracts').AcquireSession.Type,
  persistence: import('./polar-service.ts').AcquirePersistenceShape,
) {
  if (!AcquireActiveWork.guards.CorrectionRequested(session.activeWork))
    return {
      _tag: 'Rejected' as const,
      summary: 'A pointing correction is not expected.',
    }
  const provider = yield* Effect.serviceOption(TargetAcquisitionProvider)
  if (Option.isNone(provider))
    return {
      _tag: 'Unavailable' as const,
      summary: 'No pointing correction provider is configured.',
    }
  const work = session.activeWork
  const raw = yield* provider.value
    .correct(work.correctionAttemptId, work.correction)
    .pipe(Effect.option)
  if (Option.isNone(raw))
    return {
      _tag: 'Unavailable' as const,
      summary:
        'The pointing correction provider did not acknowledge the request.',
    }
  const acknowledgement = yield* Schema.decodeUnknownEffect(
    CorrectionProviderResult,
  )(raw.value).pipe(Effect.option)
  if (Option.isNone(acknowledgement))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The pointing correction acknowledgement is invalid.',
    }
  const result = recordCorrectionAcknowledgement(session, {
    correctionAttemptId: work.correctionAttemptId,
    accepted: CorrectionProviderResult.guards.Accepted(acknowledgement.value),
    occurredAtEpochMs: CorrectionProviderResult.guards.Accepted(
      acknowledgement.value,
    )
      ? acknowledgement.value.acknowledgedAtEpochMs
      : 1_722_729_600_000,
    acknowledgementRef: acknowledgement.value.acknowledgementRef,
    verificationSeriesId: RecoverySeriesId.make(
      `${work.correctionAttemptId}-verification`,
    ),
    verificationAttemptId: AttemptId.make(
      `${work.correctionAttemptId}-verification-1`,
    ),
  })
  if (CorrectionAcknowledgementDecision.$is('Rejected')(result))
    return {
      _tag: 'Rejected' as const,
      summary: 'The pointing correction acknowledgement could not be recorded.',
    }
  return {
    _tag: 'Committed' as const,
    cursor: persistence.commit(
      result.session,
      CorrectionAcknowledgementDecision.$is('VerificationScheduled')(result)
        ? 'PointingCorrectionAcknowledged'
        : 'PointingCorrectionRejected',
    ).cursor,
  }
})

export const targetAcquisitionProviderLayer = (
  implementation: TargetAcquisitionProviderShape,
) =>
  Layer.succeed(
    TargetAcquisitionProvider,
    TargetAcquisitionProvider.of(implementation),
  )
