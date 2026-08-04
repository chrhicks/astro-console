import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  AcquireCommandRequest,
  AcquireSession,
  AcquireIntent,
  AssetId,
  AttemptId,
  PolarDecision,
  acceptLatestPolarMeasurement,
  recordPolarMeasurementEvidence,
  requestPolarMeasurement,
} from '@astro-console/v2-contracts'

export interface PolarMeasurementProviderShape {
  readonly measure: (attemptId: string) => Effect.Effect<unknown, unknown>
}
export class PolarMeasurementProvider extends Context.Service<
  PolarMeasurementProvider,
  PolarMeasurementProviderShape
>()('@astro-console/server/PolarMeasurementProvider') {}

export interface AcquirePersistenceShape {
  readonly current: () => typeof AcquireSession.Type | undefined
  readonly commit: (
    session: typeof AcquireSession.Type,
    type: string,
  ) => { readonly cursor: number }
}
export class AcquirePersistence extends Context.Service<
  AcquirePersistence,
  AcquirePersistenceShape
>()('@astro-console/server/AcquirePersistence') {}

export const acquirePersistenceLayer = (
  implementation: AcquirePersistenceShape,
) => Layer.succeed(AcquirePersistence, AcquirePersistence.of(implementation))

const Measurement = Schema.Struct({
  sourceFrameAssetId: AssetId,
  measuredAtEpochMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  desiredPole: Schema.Struct({
    rightAscensionDegrees: Schema.Finite,
    declinationDegrees: Schema.Finite,
  }),
  measuredMountAxis: Schema.Struct({
    rightAscensionDegrees: Schema.Finite,
    declinationDegrees: Schema.Finite,
  }),
  altitudeErrorArcsec: Schema.Finite,
  azimuthErrorArcsec: Schema.Finite,
  uncertaintyArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})

export type PolarCommandResult =
  | { readonly _tag: 'Committed'; readonly cursor: number }
  | { readonly _tag: 'Rejected'; readonly summary: string }
  | { readonly _tag: 'Unavailable'; readonly summary: string }

export const executePolarCommand = Effect.fn('PolarService.execute')(function* (
  raw: unknown,
) {
  const input = yield* Schema.decodeUnknownEffect(AcquireCommandRequest)(
    raw,
  ).pipe(Effect.option)
  if (Option.isNone(input))
    return {
      _tag: 'Rejected' as const,
      summary: 'The Polar command is invalid.',
    }
  const persistence = yield* AcquirePersistence
  const session = persistence.current()
  if (session === undefined)
    return {
      _tag: 'Unavailable' as const,
      summary: 'Polar alignment is not active for the current run.',
    }
  if (input.value.intent.expectedAcquireRevision !== session.revision)
    return {
      _tag: 'Rejected' as const,
      summary: 'Polar evidence changed. Read the current Observe projection.',
    }
  if (AcquireIntent.guards.AcceptPolarAlignmentEvidence(input.value.intent)) {
    const decision = acceptLatestPolarMeasurement(
      session,
      input.value.intent.attemptId,
    )
    if (!PolarDecision.$is('Accepted')(decision))
      return {
        _tag: 'Rejected' as const,
        summary: 'Polar evidence cannot be accepted in the current state.',
      }
    return {
      _tag: 'Committed' as const,
      cursor: persistence.commit(decision.session, 'PolarAlignmentCompleted')
        .cursor,
    }
  }
  const attemptId = AttemptId.make(`polar-${session.revision + 1}`)
  const scheduled = requestPolarMeasurement(session, attemptId)
  if (!PolarDecision.$is('MeasurementScheduled')(scheduled))
    return {
      _tag: 'Rejected' as const,
      summary: 'Polar measurement is unavailable in the current state.',
    }
  const provider = yield* Effect.serviceOption(PolarMeasurementProvider)
  if (Option.isNone(provider))
    return {
      _tag: 'Unavailable' as const,
      summary: 'No polar measurement provider is configured.',
    }
  const rawMeasurement = yield* provider.value
    .measure(attemptId)
    .pipe(Effect.option)
  if (Option.isNone(rawMeasurement))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The polar measurement provider did not return evidence.',
    }
  const measurement = yield* Schema.decodeUnknownEffect(Measurement)(
    rawMeasurement.value,
  ).pipe(Effect.option)
  if (Option.isNone(measurement))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The polar measurement evidence is invalid.',
    }
  const recorded = recordPolarMeasurementEvidence(scheduled.session, {
    ...measurement.value,
    attemptId,
  })
  if (!PolarDecision.$is('GuidanceUpdated')(recorded))
    return {
      _tag: 'Unavailable' as const,
      summary: 'The polar measurement could not be recorded.',
    }
  return {
    _tag: 'Committed' as const,
    cursor: persistence.commit(recorded.session, 'PolarMeasurementRecorded')
      .cursor,
  }
})
