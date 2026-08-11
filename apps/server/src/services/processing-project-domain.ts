import { Schema } from 'effect'
import {
  AssetId,
  CheckpointId,
  ClientCapability,
  ClientId,
  MembershipRole,
  PersonId,
  ProcessingAttempt,
  ProcessingDevelopBase,
  ProcessingDevelopPreview,
  ProcessingFrozenSource,
  ProcessingOutputId,
  ProcessingProjectAuthority,
  ProcessingProjectId,
  ProcessingProjectRevision,
  ProcessingProjectSource,
  ProcessingProjectWarning,
  ProcessingStageAttemptId,
  ProcessingStageDraft,
  ProcessingStageDraftValue,
  ProcessingStageResultId,
  ProcessingUpstreamResult,
  ExecutableProcessingStage,
} from '@astro-console/protocol'

export const ProcessingStageResult = Schema.Struct({
  resultId: ProcessingStageResultId,
  attemptId: ProcessingStageAttemptId,
  stage: ExecutableProcessingStage,
  outcome: Schema.Literals(['Succeeded', 'Warning']),
  checksum: Schema.NonEmptyString,
  outputId: ProcessingOutputId,
  checkpointId: CheckpointId,
  sources: Schema.Array(ProcessingFrozenSource),
  upstream: Schema.optionalKey(ProcessingUpstreamResult),
  summary: Schema.NonEmptyString,
  completedAt: Schema.NonEmptyString,
})

export const ProcessingStageState = Schema.Struct({
  stage: ExecutableProcessingStage,
  draft: ProcessingStageDraft,
  developPreview: Schema.optionalKey(ProcessingDevelopPreview),
  resultHistory: Schema.Array(ProcessingStageResult),
  resultCursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).check(
  Schema.makeFilter((state) => {
    if (state.resultCursor > state.resultHistory.length) {
      return {
        path: ['resultCursor'],
        issue: 'Current Result cursor must not exceed result history',
      }
    }
    if (processingDraftStage(state.draft.value) !== state.stage) {
      return {
        path: ['draft', 'value'],
        issue: 'stage draft must belong to its stage',
      }
    }
    if (state.resultHistory.some((result) => result.stage !== state.stage)) {
      return {
        path: ['resultHistory'],
        issue: 'result history entries must belong to their stage',
      }
    }
    const resultIds = state.resultHistory.map((result) => result.resultId)
    if (new Set(resultIds).size !== resultIds.length) {
      return {
        path: ['resultHistory'],
        issue: 'result history identities must be unique',
      }
    }
  }),
)

const processingDraftStage = (
  value: typeof ProcessingStageDraftValue.Type,
): typeof ExecutableProcessingStage.Type =>
  ProcessingStageDraftValue.match(value, {
    Calibration: () => 'Calibration',
    Registration: () => 'Registration',
    Stacking: () => 'Stacking',
    Develop: () => 'Develop',
  })

export const ProcessingProject = Schema.Struct({
  projectId: ProcessingProjectId,
  revision: ProcessingProjectRevision,
  name: Schema.NonEmptyString,
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  sources: Schema.Array(ProcessingProjectSource),
  warnings: Schema.Array(ProcessingProjectWarning),
  stages: Schema.Array(ProcessingStageState),
  attempts: Schema.Array(ProcessingAttempt),
  developBase: Schema.optionalKey(ProcessingDevelopBase),
  savedAssetIds: Schema.Array(AssetId),
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
}).check(
  Schema.makeFilter((project) => {
    const active = project.attempts.filter(
      (attempt) => attempt.state === 'queued' || attempt.state === 'running',
    )
    if (active.length > 1) {
      return {
        path: ['attempts'],
        issue: 'a Processing Project can have only one active attempt',
      }
    }
    const stages = project.stages.map((stage) => stage.stage)
    if (new Set(stages).size !== stages.length) {
      return {
        path: ['stages'],
        issue: 'a Processing Project can have only one state per stage',
      }
    }
  }),
)

export type ProcessingProject = typeof ProcessingProject.Type

type ProcessingProjectCaller = {
  readonly personId: typeof PersonId.Type
  readonly clientId: typeof ClientId.Type
  readonly role: typeof MembershipRole.Type
  readonly capability: typeof ClientCapability.Type
}

export const decideProcessingProjectAuthority = (
  caller: ProcessingProjectCaller,
): typeof ProcessingProjectAuthority.Type =>
  caller.role !== 'owner'
    ? ProcessingProjectAuthority.cases.Denied.make({ reason: 'OwnerRequired' })
    : caller.capability !== 'controlCapable'
      ? ProcessingProjectAuthority.cases.Denied.make({
          reason: 'ControlCapableClientRequired',
        })
      : ProcessingProjectAuthority.cases.Allowed.make({})

export const currentProcessingStageResult = (
  state: typeof ProcessingStageState.Type,
): typeof ProcessingStageResult.Type | undefined =>
  state.resultCursor === 0
    ? undefined
    : state.resultHistory[state.resultCursor - 1]

export const sameProcessingResult = (
  left: typeof ProcessingUpstreamResult.Type | undefined,
  right: typeof ProcessingStageResult.Type | undefined,
): boolean =>
  left === undefined
    ? right === undefined
    : right !== undefined &&
      left.stage === right.stage &&
      left.resultId === right.resultId &&
      left.attemptId === right.attemptId &&
      left.checksum === right.checksum

export const moveProcessingCurrentResult = (
  state: typeof ProcessingStageState.Type,
  direction: 'Undo' | 'Redo',
): typeof ProcessingStageState.Type | undefined => {
  const nextCursor =
    direction === 'Undo' ? state.resultCursor - 1 : state.resultCursor + 1
  return nextCursor < 0 || nextCursor > state.resultHistory.length
    ? undefined
    : ProcessingStageState.make({ ...state, resultCursor: nextCursor })
}

export const appendProcessingStageResult = (
  state: typeof ProcessingStageState.Type,
  result: typeof ProcessingStageResult.Type,
): typeof ProcessingStageState.Type => {
  const retained = state.resultHistory.slice(0, state.resultCursor)
  const resultHistory = [...retained, result]
  return ProcessingStageState.make({
    ...state,
    resultHistory,
    resultCursor: resultHistory.length,
  })
}

export const restoreProcessingResultForUpstream = (
  state: typeof ProcessingStageState.Type,
  upstream: typeof ProcessingStageResult.Type | undefined,
): typeof ProcessingStageState.Type => {
  let matchingCursor = 0
  for (let index = 0; index < state.resultHistory.length; index += 1) {
    if (sameProcessingResult(state.resultHistory[index]?.upstream, upstream)) {
      matchingCursor = index + 1
    }
  }
  return ProcessingStageState.make({ ...state, resultCursor: matchingCursor })
}
