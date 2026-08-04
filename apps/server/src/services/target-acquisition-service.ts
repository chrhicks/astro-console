import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  AcquireActiveWork,
  AcquireCommandRequest,
  AcquireIntent,
  AssetId,
  AttemptId,
  PointingSolveResult,
  LunarDiskLimbCompletion,
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
  if (
    Option.isNone(input) ||
    !AcquireIntent.guards.CaptureTargetAcquisitionEvidence(input.value.intent)
  )
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
  const attempt = session.activeWork.attemptId
  const acknowledged = recordTargetSlewAcknowledgement(session, {
    attemptId: attempt,
    acquisitionMethod: session.acquisitionMethod,
    ...providerResult.value.slewAcknowledgement,
  })
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
  return {
    _tag: 'Committed' as const,
    cursor: persistence.commit(
      recorded.session,
      'TargetAcquisitionEvidenceRecorded',
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
