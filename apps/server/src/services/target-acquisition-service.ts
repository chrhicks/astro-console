import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  AcquireActiveWork,
  AcquireEvidence,
  AcquireCommandRequest,
  AcquireIntent,
  CaptureMetric,
  AssetId,
  AttemptId,
  PointingSolveResult,
  RecoverySeriesId,
  RecoverySeriesDecision,
  LunarDiskLimbCompletion,
  CorrectionAcknowledgementDecision,
  CorrectionCommandDecision,
  approveCorrectionProposal,
  recordCorrectionAcknowledgement,
  reviseCorrectionProposal,
  recordLunarDiskLimbCompletion,
  LiveFrameEvidence,
  recordManagedCapture,
  recordLiveFrameEvidence,
  recordSolveCompletion,
  recordTargetSlewAcknowledgement,
  openRecoverySeries,
  skipAcquireTarget,
  abortAcquire,
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
  readonly frame?: () => Effect.Effect<unknown, unknown>
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
  if (AcquireIntent.guards.RetryPlateSolveWithParameters(intent)) {
    const recovery = openRecoverySeries(session, {
      seriesId: RecoverySeriesId.make(`recovery-${session.revision + 1}`),
      attemptId: AttemptId.make(`recovery-solve-${session.revision + 1}`),
      parameters: intent.parameters,
    })
    if (!RecoverySeriesDecision.$is('Started')(recovery))
      return {
        _tag: 'Rejected' as const,
        summary:
          recovery.reason === 'RecoveryParametersUnchanged'
            ? 'Recovery needs materially changed solve parameters.'
            : recovery.reason === 'RecoveryBudgetExhausted'
              ? 'The one recovery series has already been used.'
              : 'Acquire is not paused for plate-solve recovery.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(recovery.session, 'AcquireRecoveryStarted')
        .cursor,
    }
  }
  if (AcquireIntent.guards.SkipAcquireTarget(intent)) {
    if (session.phase !== 'paused')
      return {
        _tag: 'Rejected' as const,
        summary: 'Skip is available only while Acquire is paused for recovery.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(
        skipAcquireTarget(session),
        'AcquireTargetSkipped',
      ).cursor,
    }
  }
  if (AcquireIntent.guards.AbortAcquire(intent)) {
    if (session.phase === 'completed' || session.phase === 'skipped')
      return {
        _tag: 'Rejected' as const,
        summary: 'Acquire is already terminal for this target.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(abortAcquire(session), 'AcquireAborted')
        .cursor,
    }
  }
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
  if (AcquireIntent.guards.RecordLiveFrameEvidence(intent)) {
    if (session.phase !== 'completed')
      return {
        _tag: 'Rejected' as const,
        summary:
          'Live frame evidence starts after target acquisition completes.',
      }
    const provider = yield* Effect.serviceOption(TargetAcquisitionProvider)
    if (Option.isNone(provider) || provider.value.frame === undefined)
      return {
        _tag: 'Unavailable' as const,
        summary: 'No live frame evidence provider is configured.',
      }
    const rawFrame = yield* provider.value.frame().pipe(Effect.option)
    if (Option.isNone(rawFrame))
      return {
        _tag: 'Unavailable' as const,
        summary: 'The live frame evidence provider did not return a frame.',
      }
    const frame = yield* Schema.decodeUnknownEffect(LiveFrameEvidence)(
      rawFrame.value,
    ).pipe(Effect.option)
    if (Option.isNone(frame))
      return {
        _tag: 'Unavailable' as const,
        summary: 'The live frame evidence is invalid.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(
        recordLiveFrameEvidence(session, frame.value),
        'LiveFrameEvidenceRecorded',
      ).cursor,
    }
  }
  if (
    AcquireIntent.guards.StartManagedCapture(intent) ||
    AcquireIntent.guards.PauseManagedCapture(intent) ||
    AcquireIntent.guards.StopManagedCapture(intent) ||
    AcquireIntent.guards.RecenterManagedCapture(intent)
  )
    return yield* managedCaptureCommand(session, intent, persistence)
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

const managedCaptureCommand = Effect.fn(
  'TargetAcquisitionService.managedCaptureCommand',
)(function* (
  session: typeof import('@astro-console/v2-contracts').AcquireSession.Type,
  intent: typeof AcquireIntent.Type,
  persistence: import('./polar-service.ts').AcquirePersistenceShape,
) {
  const frame = session.evidence.findLast(AcquireEvidence.guards.LiveFrame)
  const quality =
    frame === undefined
      ? 'unknown'
      : frame.disposition === 'accepted' &&
          frame.targetFraming === 'inFrame' &&
          frame.clipping === 'clear' &&
          frame.exposure === 'usable'
        ? 'good'
        : 'attention'
  const current = session.managedCapture
  if (AcquireIntent.guards.StartManagedCapture(intent)) {
    if (
      session.phase !== 'completed' ||
      frame === undefined ||
      current !== undefined
    )
      return {
        _tag: 'Rejected' as const,
        summary:
          'Managed capture requires completed acquisition and current frame evidence.',
      }
    const storageReserveMb = CaptureMetric.match(frame.storageForecastMb, {
      Known: ({ value }) => value,
      Unknown: () => 0,
    })
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(
        recordManagedCapture(session, {
          state: 'active',
          exposureCount: 1,
          stackCount: frame.acceptedFrameCount,
          totalExposureCount: 24,
          elapsedSeconds: 180,
          remainingSeconds: 4_140,
          stopCondition: '24 usable 180-second exposures',
          storageReserveMb,
          resourceProtection:
            storageReserveMb >= 512 ? 'available' : 'protected',
          quality,
        }),
        'ManagedCaptureStarted',
      ).cursor,
    }
  }
  if (current === undefined)
    return {
      _tag: 'Rejected' as const,
      summary: 'Managed capture is not active.',
    }
  if (AcquireIntent.guards.PauseManagedCapture(intent)) {
    if (current.state !== 'active')
      return {
        _tag: 'Rejected' as const,
        summary: 'Managed capture cannot pause in its current state.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(
        recordManagedCapture(session, { ...current, state: 'paused' }),
        'ManagedCapturePaused',
      ).cursor,
    }
  }
  if (AcquireIntent.guards.StopManagedCapture(intent)) {
    if (current.state !== 'active' && current.state !== 'paused')
      return {
        _tag: 'Rejected' as const,
        summary: 'Managed capture cannot stop in its current state.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(
        recordManagedCapture(session, { ...current, state: 'stopped' }),
        'ManagedCaptureStopped',
      ).cursor,
    }
  }
  if (AcquireIntent.guards.RecenterManagedCapture(intent)) {
    if (current.state !== 'active' || current.quality !== 'attention')
      return {
        _tag: 'Rejected' as const,
        summary:
          'Recenter is available only for active capture that needs attention.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(
        recordManagedCapture(session, { ...current, quality: 'good' }),
        'ManagedCaptureRecenterRequested',
      ).cursor,
    }
  }
  return {
    _tag: 'Rejected' as const,
    summary: 'The managed capture command is invalid.',
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
