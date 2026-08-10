import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  CaptureSetId,
  ProcessingProjectId,
  ProcessingProjectRevision,
  ProcessingStageAttemptId,
  ProcessingStageResultId,
} from './primitives.js'

export const ProcessingProjectStage = Schema.Literals([
  'Sources',
  'Calibration',
  'Registration',
  'Stacking',
  'Master',
  'Develop',
])
export type ProcessingProjectStage = typeof ProcessingProjectStage.Type

export const ExecutableProcessingStage = Schema.Literals([
  'Calibration',
  'Registration',
  'Stacking',
])
export type ExecutableProcessingStage = typeof ExecutableProcessingStage.Type

export const ProcessingSourceRole = Schema.Literals([
  'Lights',
  'Darks',
  'Flats',
  'Bias',
  'Dark flats',
  'Unassigned',
])
export type ProcessingSourceRole = typeof ProcessingSourceRole.Type

export const ProcessingStageSetting = Schema.Struct({
  key: Schema.NonEmptyString,
  value: Schema.NonEmptyString,
})

export const ProcessingStageDraft = Schema.Struct({
  revision: Schema.Int,
  settings: Schema.Array(ProcessingStageSetting),
  undo: Schema.Array(Schema.Array(ProcessingStageSetting)),
  redo: Schema.Array(Schema.Array(ProcessingStageSetting)),
})

export const ProcessingStageAttempt = Schema.Struct({
  attemptId: ProcessingStageAttemptId,
  stage: ExecutableProcessingStage,
  state: Schema.Literals(['queued', 'running', 'succeeded', 'failed']),
  draftRevision: Schema.Int,
  settings: Schema.Array(ProcessingStageSetting),
  toolIdentity: Schema.Literal('deterministic-stage-harness-v1'),
  resultKind: Schema.Literal('deterministicStageEvidence'),
  basedOnEarlierUpstream: Schema.Boolean,
  sourceRevisions: Schema.Array(
    Schema.Struct({
      assetId: AssetId,
      assetRevision: AssetRevision,
      role: ProcessingSourceRole,
    }),
  ),
  upstreamAttemptId: Schema.optionalKey(ProcessingStageAttemptId),
  resultId: Schema.optionalKey(ProcessingStageResultId),
  outputChecksum: Schema.optionalKey(Schema.NonEmptyString),
  startedAt: Schema.optionalKey(Schema.NonEmptyString),
  completedAt: Schema.optionalKey(Schema.NonEmptyString),
})

export const ProcessingStageState = Schema.Struct({
  stage: ExecutableProcessingStage,
  draft: ProcessingStageDraft,
  attempts: Schema.Array(ProcessingStageAttempt),
  selectedAttemptId: Schema.optionalKey(ProcessingStageAttemptId),
})

export const ProcessingProjectWarning = Schema.Struct({
  code: Schema.Literals([
    'TargetConflict',
    'MetadataConflict',
    'RoleSuggested',
    'SourceUnavailable',
  ]),
  assetIds: Schema.Array(AssetId),
  message: Schema.NonEmptyString,
})

export const ProcessingProjectSource = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  role: ProcessingSourceRole,
  suggestedRole: ProcessingSourceRole,
  captureSetId: Schema.optionalKey(CaptureSetId),
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  capturedAt: Schema.NonEmptyString,
  checksum: Schema.optionalKey(Schema.NonEmptyString),
  availability: Schema.NonEmptyString,
  provenance: Schema.Struct({
    runId: Schema.optionalKey(Schema.NonEmptyString),
    sequenceId: Schema.optionalKey(Schema.NonEmptyString),
    acquisitionId: Schema.optionalKey(Schema.NonEmptyString),
    rigId: Schema.optionalKey(Schema.NonEmptyString),
    cameraDeviceId: Schema.optionalKey(Schema.NonEmptyString),
    exposureSeconds: Schema.optionalKey(Schema.Finite),
    filter: Schema.optionalKey(Schema.NonEmptyString),
    binning: Schema.optionalKey(Schema.Int),
  }),
  warnings: Schema.Array(ProcessingProjectWarning),
})

export const ProcessingProject = Schema.Struct({
  projectId: ProcessingProjectId,
  revision: ProcessingProjectRevision,
  name: Schema.NonEmptyString,
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  sources: Schema.Array(ProcessingProjectSource),
  warnings: Schema.Array(ProcessingProjectWarning),
  currentStage: ProcessingProjectStage,
  stages: Schema.Array(ProcessingStageState),
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
})

export interface ProcessingProject extends Schema.Schema.Type<
  typeof ProcessingProject
> {}

export const ProcessingProjectSourceSelection = Schema.Struct({
  assetIds: Schema.Array(AssetId),
  captureSetIds: Schema.Array(CaptureSetId),
}).check(
  Schema.makeFilter((selection) =>
    selection.assetIds.length + selection.captureSetIds.length > 0
      ? undefined
      : { path: [], issue: 'select at least one asset or Capture Set' },
  ),
)
