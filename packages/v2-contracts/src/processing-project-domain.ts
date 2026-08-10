import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  AttemptId,
  CaptureSetId,
  CheckpointId,
  PreviewId,
  ProcessingOutputId,
  ProcessingProjectId,
  ProcessingProjectRevision,
  ProcessingStageAttemptId,
  ProcessingStageResultId,
} from './primitives.js'

const UnitAmount = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
)
const SignedAmount = Schema.Finite.check(
  Schema.isBetween({ minimum: -1, maximum: 1 }),
)

export const DevelopOperation = Schema.TaggedUnion({
  AstrometryWcs: {
    solverProfile: Schema.Literals(['balanced', 'wide-field']),
  },
  BackgroundExtraction: {
    sampleDensity: Schema.Literals(['sparse', 'balanced']),
  },
  AstronomyColorCalibration: {
    method: Schema.Literal('photometric'),
  },
  GreenNoiseReduction: { strength: UnitAmount },
  Stretch: {
    method: Schema.Literals(['asinh', 'generalized-hyperbolic']),
    amount: UnitAmount,
  },
  ColorAdjustment: {
    cyan: SignedAmount,
    yellow: SignedAmount,
    red: SignedAmount,
    saturation: SignedAmount,
  },
  RemoveStars: { mode: Schema.Literal('balanced') },
  AddStars: {},
})
export type DevelopOperation = typeof DevelopOperation.Type

export const DevelopDraftSnapshot = Schema.Struct({
  operation: DevelopOperation,
})

export const DevelopDraft = Schema.Struct({
  revision: Schema.Int,
  operation: DevelopOperation,
  undo: Schema.Array(DevelopDraftSnapshot),
  redo: Schema.Array(DevelopDraftSnapshot),
})

export const DevelopBase = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  checksum: Schema.NonEmptyString,
  stackingAttemptId: ProcessingStageAttemptId,
  stackResultId: ProcessingStageResultId,
})

export const DevelopOutput = Schema.Struct({
  outputId: ProcessingOutputId,
  checksum: Schema.NonEmptyString,
  format: Schema.Literal('fits'),
  relation: Schema.Literals(['developed', 'starless', 'starCompanion']),
  diagnostic: Schema.NonEmptyString,
})

export const DevelopPreview = Schema.Struct({
  previewId: PreviewId,
  draftRevision: Schema.Int,
  inputCheckpointId: CheckpointId,
  operation: DevelopOperation,
  toolIdentity: Schema.Literal('deterministic-develop-adapter-v1'),
  checksum: Schema.NonEmptyString,
  synchronizedAt: Schema.NonEmptyString,
})

export const DevelopAttempt = Schema.Struct({
  attemptId: AttemptId,
  state: Schema.Literals(['queued', 'running', 'succeeded', 'failed']),
  inputCheckpointId: CheckpointId,
  previewId: PreviewId,
  draftRevision: Schema.Int,
  operation: DevelopOperation,
  toolIdentity: Schema.Literal('deterministic-develop-adapter-v1'),
  inputChecksum: Schema.NonEmptyString,
  relatedInputOutputIds: Schema.Array(ProcessingOutputId),
  outputs: Schema.Array(DevelopOutput),
  diagnostics: Schema.Array(Schema.NonEmptyString),
  retryOfAttemptId: Schema.optionalKey(AttemptId),
  startedAt: Schema.optionalKey(Schema.NonEmptyString),
  completedAt: Schema.optionalKey(Schema.NonEmptyString),
})

export const DevelopHistoryEntry = Schema.Struct({
  checkpointId: CheckpointId,
  attemptId: AttemptId,
  outputId: ProcessingOutputId,
  checksum: Schema.NonEmptyString,
  operation: DevelopOperation,
  relatedOutputIds: Schema.Array(ProcessingOutputId),
})

export const DevelopSavedResult = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  checksum: Schema.NonEmptyString,
  checkpointId: CheckpointId,
  attemptId: AttemptId,
  outputId: ProcessingOutputId,
  savedAt: Schema.NonEmptyString,
})

export const DevelopState = Schema.Struct({
  base: DevelopBase,
  draft: DevelopDraft,
  preview: Schema.optionalKey(DevelopPreview),
  attempts: Schema.Array(DevelopAttempt),
  history: Schema.Array(DevelopHistoryEntry),
  historyCursor: Schema.Int,
  failedAttemptId: Schema.optionalKey(AttemptId),
  savedResults: Schema.Array(DevelopSavedResult),
})

export const ProcessingLibraryRole = Schema.Literals([
  'original',
  'linearMaster',
  'intermediate',
  'final',
  'preview',
  'diagnostic',
  'unknown',
])

export const ProcessingLibraryFormat = Schema.Literals([
  'cameraRaw',
  'fits',
  'tiff',
  'png',
  'jpeg',
  'unknown',
])

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

export const CalibrationOverride = Schema.Struct({
  assetId: AssetId,
  decision: Schema.Literal('Use anyway'),
})

export const RegistrationFrameInclusion = Schema.Struct({
  assetId: AssetId,
  decision: Schema.Literal('Include warning frame'),
})

export const StackingFrameChoice = Schema.Struct({
  assetId: AssetId,
  decision: Schema.Literals(['Include', 'Exclude']),
})

export const StackingRecommendation = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  decision: Schema.Literals(['Include', 'Exclude', 'Review']),
  technicallyUsable: Schema.Boolean,
  reasons: Schema.Array(Schema.NonEmptyString),
})

export const CalibrationDraftSnapshot = Schema.Struct({
  settings: Schema.Array(ProcessingStageSetting),
  overrides: Schema.Array(CalibrationOverride),
  registrationInclusions: Schema.Array(RegistrationFrameInclusion),
  stackingFrameChoices: Schema.Array(StackingFrameChoice),
})

export const CalibrationRecommendation = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  role: ProcessingSourceRole,
  decision: Schema.Literals(['Include', 'Exclude', 'Review']),
  compatibility: Schema.Literals([
    'Compatible',
    'Advisory mismatch',
    'Technically unavailable',
  ]),
  reasons: Schema.Array(Schema.NonEmptyString),
  matchedLightAssetIds: Schema.Array(AssetId),
})

export const CalibrationFrameOutcome = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  outcome: Schema.Literals(['Succeeded', 'Warning', 'Failed', 'Unavailable']),
  message: Schema.NonEmptyString,
  outputChecksum: Schema.optionalKey(Schema.NonEmptyString),
  diagnostic: Schema.optionalKey(Schema.NonEmptyString),
})

export const CalibrationOutput = Schema.Struct({
  sourceAssetId: AssetId,
  sourceAssetRevision: AssetRevision,
  checksum: Schema.NonEmptyString,
  format: Schema.Literal('deterministicEvidenceJson'),
})

export const RegistrationTransform = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  referenceAssetId: AssetId,
  referenceAssetRevision: AssetRevision,
  model: Schema.Literals(['translation', 'affine']),
  coefficients: Schema.Array(Schema.Finite),
  checksum: Schema.NonEmptyString,
  usable: Schema.Boolean,
  diagnostic: Schema.optionalKey(Schema.NonEmptyString),
})

export const ProcessingStageDraft = Schema.Struct({
  revision: Schema.Int,
  settings: Schema.Array(ProcessingStageSetting),
  overrides: Schema.Array(CalibrationOverride),
  registrationInclusions: Schema.Array(RegistrationFrameInclusion),
  stackingFrameChoices: Schema.Array(StackingFrameChoice),
  undo: Schema.Array(CalibrationDraftSnapshot),
  redo: Schema.Array(CalibrationDraftSnapshot),
})

export const ProcessingStageAttempt = Schema.Struct({
  attemptId: ProcessingStageAttemptId,
  stage: ExecutableProcessingStage,
  state: Schema.Literals(['queued', 'running', 'succeeded', 'failed']),
  draftRevision: Schema.Int,
  settings: Schema.Array(ProcessingStageSetting),
  toolIdentity: Schema.Literals([
    'deterministic-stage-harness-v1',
    'deterministic-calibration-adapter-v1',
    'deterministic-registration-adapter-v1',
    'deterministic-stacking-adapter-v1',
  ]),
  resultKind: Schema.Literals([
    'deterministicStageEvidence',
    'deterministicCalibrationEvidence',
    'deterministicRegistrationEvidence',
    'deterministicStackingEvidence',
  ]),
  basedOnEarlierUpstream: Schema.Boolean,
  sourceRevisions: Schema.Array(
    Schema.Struct({
      assetId: AssetId,
      assetRevision: AssetRevision,
      role: ProcessingSourceRole,
    }),
  ),
  recommendations: Schema.Array(CalibrationRecommendation),
  overrides: Schema.Array(CalibrationOverride),
  registrationInclusions: Schema.Array(RegistrationFrameInclusion),
  stackingRecommendations: Schema.Array(StackingRecommendation),
  stackingFrameChoices: Schema.Array(StackingFrameChoice),
  stackingInputAssetIds: Schema.Array(AssetId),
  frameOutcomes: Schema.Array(CalibrationFrameOutcome),
  outputs: Schema.Array(CalibrationOutput),
  registrationTransforms: Schema.Array(RegistrationTransform),
  viableAssetIds: Schema.Array(AssetId),
  stackingOutput: Schema.optionalKey(
    Schema.Struct({
      checksum: Schema.NonEmptyString,
      format: Schema.Literal('fits'),
      includedAssetIds: Schema.Array(AssetId),
      diagnostic: Schema.NonEmptyString,
    }),
  ),
  savedMaster: Schema.optionalKey(
    Schema.Struct({
      assetId: AssetId,
      assetRevision: AssetRevision,
      checksum: Schema.NonEmptyString,
      projectId: ProcessingProjectId,
      registrationAttemptId: ProcessingStageAttemptId,
      stackingAttemptId: ProcessingStageAttemptId,
      stackResultId: ProcessingStageResultId,
      savedAt: Schema.NonEmptyString,
    }),
  ),
  diagnostics: Schema.Array(Schema.NonEmptyString),
  stageOutcome: Schema.optionalKey(
    Schema.Literals(['Succeeded', 'Warning', 'Failed', 'Unavailable']),
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
  calibrationRecommendations: Schema.Array(CalibrationRecommendation),
  stackingRecommendations: Schema.Array(StackingRecommendation),
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
  libraryRole: ProcessingLibraryRole,
  libraryFormat: ProcessingLibraryFormat,
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
  developMasterAssetId: Schema.optionalKey(AssetId),
  develop: Schema.optionalKey(DevelopState),
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
