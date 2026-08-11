import { Schema } from 'effect'
import {
  PlanId,
  PlanRevision,
  RunId,
  RunSequenceDefinition,
} from '@astro-console/protocol'

export const RunExecutionContext = Schema.Struct({
  rigId: Schema.NonEmptyString,
  mountDeviceId: Schema.optionalKey(Schema.NonEmptyString),
  cameraDeviceId: Schema.NonEmptyString,
  focuserDeviceId: Schema.optionalKey(Schema.NonEmptyString),
  filterWheelDeviceId: Schema.optionalKey(Schema.NonEmptyString),
  latitudeDegrees: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 })),
  ),
  longitudeDegrees: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 })),
  ),
  elevationMeters: Schema.optionalKey(Schema.Finite),
  completionBehavior: Schema.Literals(['park', 'hold']),
  unsafeBehavior: Schema.Literals(['pauseAndPark', 'stopAndPark']),
})

export const RunDefinition = Schema.Struct({
  runId: RunId,
  executor: Schema.Literals(['fake', 'fixture', 'real']),
  sourcePlanId: PlanId,
  sourcePlanRevision: PlanRevision,
  acceptedAt: Schema.NonEmptyString,
  acceptedLimitations: Schema.Array(
    Schema.Struct({
      limitationId: Schema.NonEmptyString,
      summary: Schema.NonEmptyString,
    }),
  ),
  executionContext: RunExecutionContext,
  sequences: Schema.NonEmptyArray(RunSequenceDefinition),
}).check(
  Schema.makeFilter((definition) => {
    const uniqueness = uniqueRunInputs(
      definition.sequences.map(({ sequenceId }) => sequenceId),
      definition.acceptedLimitations.map(({ limitationId }) => limitationId),
    )
    if (uniqueness !== undefined) return uniqueness
    if (
      definition.sequences.some(
        (sequence) => sequence.acquisitionMode === 'deepSkyPlateSolve',
      ) &&
      (definition.executionContext.mountDeviceId === undefined ||
        definition.executionContext.latitudeDegrees === undefined ||
        definition.executionContext.longitudeDegrees === undefined ||
        definition.executionContext.elevationMeters === undefined)
    ) {
      return {
        path: ['executionContext'],
        issue:
          'deepSkyPlateSolve requires mount identity and complete site coordinates',
      }
    }
  }),
)

export type RunDefinition = typeof RunDefinition.Type

function uniqueRunInputs(
  sequenceIds: ReadonlyArray<string>,
  limitationIds: ReadonlyArray<string>,
) {
  if (new Set(sequenceIds).size !== sequenceIds.length) {
    return {
      path: ['sequences'],
      issue: 'run sequence identities must be unique',
    }
  }
  if (new Set(limitationIds).size !== limitationIds.length) {
    return {
      path: ['limitations'],
      issue: 'plan limitation identities must be unique',
    }
  }
}
