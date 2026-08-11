import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  CaptureSetId,
  CheckpointId,
  IntentId,
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
  AstronomyColorCalibration: { method: Schema.Literal('photometric') },
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
  'Develop',
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

/** The exact saved Library Master selected as Develop input. */
export const ProcessingDevelopBase = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  checksum: Schema.NonEmptyString,
  stackingAttemptId: ProcessingStageAttemptId,
  stackingResultId: ProcessingStageResultId,
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

export const ProcessingStageDraftValue = Schema.TaggedUnion({
  Calibration: {
    settings: Schema.Array(ProcessingStageSetting),
    overrides: Schema.Array(CalibrationOverride),
  },
  Registration: {
    settings: Schema.Array(ProcessingStageSetting),
    inclusions: Schema.Array(RegistrationFrameInclusion),
  },
  Stacking: {
    settings: Schema.Array(ProcessingStageSetting),
    frameChoices: Schema.Array(StackingFrameChoice),
  },
  Develop: { operation: DevelopOperation },
})
export type ProcessingStageDraftValue = typeof ProcessingStageDraftValue.Type

export const ProcessingFrozenSource = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  role: ProcessingSourceRole,
  checksum: Schema.NonEmptyString,
})

export const ProcessingUpstreamResult = Schema.Struct({
  stage: ExecutableProcessingStage,
  resultId: ProcessingStageResultId,
  attemptId: ProcessingStageAttemptId,
  checksum: Schema.NonEmptyString,
})

export const ProcessingAttemptOutput = Schema.Struct({
  outputId: ProcessingOutputId,
  checksum: Schema.NonEmptyString,
  relation: Schema.Literals([
    'CurrentResult',
    'WorkingResult',
    'RelatedResult',
  ]),
})

export const ProcessingRecommendation = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  decision: Schema.Literals(['Include', 'Exclude', 'Review']),
  reasons: Schema.Array(Schema.NonEmptyString),
})

export const CalibrationFrameOutcome = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  outcome: Schema.Literals(['Succeeded', 'Warning', 'Failed', 'Unavailable']),
  message: Schema.NonEmptyString,
  outputChecksum: Schema.optionalKey(Schema.NonEmptyString),
  diagnostic: Schema.optionalKey(Schema.NonEmptyString),
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

/** Astronomy evidence retained by a sealed Processing Attempt. */
export const ProcessingAttemptStageEvidence = Schema.TaggedUnion({
  Calibration: {
    recommendations: Schema.Array(ProcessingRecommendation),
    overrides: Schema.Array(CalibrationOverride),
    frameOutcomes: Schema.Array(CalibrationFrameOutcome),
  },
  Registration: {
    recommendations: Schema.Array(ProcessingRecommendation),
    inclusions: Schema.Array(RegistrationFrameInclusion),
    transforms: Schema.Array(RegistrationTransform),
    viableAssetIds: Schema.Array(AssetId),
  },
  Stacking: {
    recommendations: Schema.Array(ProcessingRecommendation),
    frameChoices: Schema.Array(StackingFrameChoice),
    includedAssetIds: Schema.Array(AssetId),
    stackChecksum: Schema.optionalKey(Schema.NonEmptyString),
    savedMasterAssetId: Schema.optionalKey(AssetId),
  },
  Develop: {
    previewId: PreviewId,
    inputCheckpointId: CheckpointId,
    relatedOutputIds: Schema.Array(ProcessingOutputId),
  },
})

/**
 * One immutable execution record. Inputs are frozen before queued is returned.
 * A settled attempt is evidence and is never rewritten or removed.
 */
export const ProcessingAttempt = Schema.Struct({
  attemptId: ProcessingStageAttemptId,
  stage: ExecutableProcessingStage,
  state: Schema.Literals(['queued', 'running', 'succeeded', 'failed']),
  draftRevision: Schema.Int,
  draft: ProcessingStageDraftValue,
  sources: Schema.Array(ProcessingFrozenSource),
  upstream: Schema.optionalKey(ProcessingUpstreamResult),
  inputCheckpointId: Schema.optionalKey(CheckpointId),
  previewId: Schema.optionalKey(PreviewId),
  retryOfAttemptId: Schema.optionalKey(ProcessingStageAttemptId),
  frozenAt: Schema.NonEmptyString,
  startedAt: Schema.optionalKey(Schema.NonEmptyString),
  settledAt: Schema.optionalKey(Schema.NonEmptyString),
  outcome: Schema.optionalKey(
    Schema.Literals(['Succeeded', 'Warning', 'Failed', 'Unavailable']),
  ),
  outputs: Schema.Array(ProcessingAttemptOutput),
  evidence: ProcessingAttemptStageEvidence,
  diagnostics: Schema.Array(Schema.NonEmptyString),
}).check(
  Schema.makeFilter((attempt) => {
    if (
      attempt.stage !== processingDraftStage(attempt.draft) ||
      attempt.stage !== processingEvidenceStage(attempt.evidence)
    ) {
      return {
        path: ['stage'],
        issue: 'attempt draft and evidence must belong to its stage',
      }
    }
    const settled = attempt.state === 'succeeded' || attempt.state === 'failed'
    if (settled !== (attempt.settledAt !== undefined)) {
      return {
        path: ['settledAt'],
        issue: 'only settled attempts have a settlement time',
      }
    }
    if (settled !== (attempt.outcome !== undefined)) {
      return {
        path: ['outcome'],
        issue: 'only settled attempts have an outcome',
      }
    }
    if (attempt.state === 'succeeded' && attempt.outputs.length === 0) {
      return {
        path: ['outputs'],
        issue: 'a successful attempt requires immutable output evidence',
      }
    }
    if (attempt.state === 'failed' && attempt.outputs.length > 0) {
      return {
        path: ['outputs'],
        issue: 'a failed attempt cannot publish a partial artifact',
      }
    }
  }),
)

export const ProcessingProjectAuthority = Schema.TaggedUnion({
  Allowed: {},
  Denied: {
    reason: Schema.Literals(['OwnerRequired', 'ControlCapableClientRequired']),
  },
})

export const ProcessingProjectIntent = Schema.TaggedUnion({
  AddSources: { selection: ProcessingProjectSourceSelection },
  RemoveSource: { assetId: AssetId },
  AssignSourceRole: { assetId: AssetId, role: ProcessingSourceRole },
  ReplaceDraft: { draft: ProcessingStageDraftValue },
  UndoDraft: { stage: ExecutableProcessingStage },
  RedoDraft: { stage: ExecutableProcessingStage },
  SyncDevelopPreview: { expectedDraftRevision: Schema.Int },
  RunStage: {
    stage: ExecutableProcessingStage,
    from: Schema.TaggedUnion({
      CurrentDraft: {},
      FailedAttempt: { attemptId: ProcessingStageAttemptId },
    }),
  },
  UndoCurrentResult: { stage: ExecutableProcessingStage },
  RedoCurrentResult: { stage: ExecutableProcessingStage },
  SaveCurrentResult: { stage: Schema.Literals(['Stacking', 'Develop']) },
  OpenDevelop: { assetId: AssetId },
})
export type ProcessingProjectIntent = typeof ProcessingProjectIntent.Type

export const CreateProcessingProjectRequest = Schema.Struct({
  name: Schema.NonEmptyString,
  selection: ProcessingProjectSourceSelection,
  intentId: IntentId,
})

export const ProcessingProjectChangeRequest = Schema.Struct({
  projectId: ProcessingProjectId,
  expectedProjectRevision: ProcessingProjectRevision,
  intentId: IntentId,
  intent: ProcessingProjectIntent,
})

export const ProcessingProjectSummary = Schema.Struct({
  projectId: ProcessingProjectId,
  revision: ProcessingProjectRevision,
  name: Schema.NonEmptyString,
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  sourceCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  state: Schema.Literals(['Ready', 'Working', 'Attention']),
  active: Schema.optionalKey(
    Schema.Struct({
      stage: ExecutableProcessingStage,
      state: Schema.Literals(['Queued', 'Running']),
    }),
  ),
  updatedAt: Schema.NonEmptyString,
})

export const ProcessingCurrentResult = Schema.Struct({
  resultId: ProcessingStageResultId,
  attemptId: ProcessingStageAttemptId,
  outcome: Schema.Literals(['Succeeded', 'Warning']),
  lineage: Schema.Literals(['Current', 'Earlier']),
  summary: Schema.NonEmptyString,
  completedAt: Schema.NonEmptyString,
})

export const ProcessingStageView = Schema.Struct({
  stage: ExecutableProcessingStage,
  draft: Schema.Struct({
    revision: Schema.Int,
    value: ProcessingStageDraftValue,
    canUndo: Schema.Boolean,
    canRedo: Schema.Boolean,
  }),
  currentResult: Schema.optionalKey(ProcessingCurrentResult),
  developPreview: Schema.optionalKey(
    Schema.Struct({
      previewId: PreviewId,
      draftRevision: Schema.Int,
      inputCheckpointId: CheckpointId,
      state: Schema.Literals(['Queued', 'Computing', 'Ready', 'Failed']),
    }),
  ),
  resultHistory: Schema.Struct({
    canUndo: Schema.Boolean,
    canRedo: Schema.Boolean,
  }),
  run: Schema.TaggedUnion({
    Available: { label: Schema.Literals(['Run', 'Rerun', 'Apply']) },
    Unavailable: {
      reason: Schema.Literals([
        'LightsRequired',
        'CurrentUpstreamResultRequired',
        'RegistrationReferenceRequired',
        'StackingInputRequired',
        'SavedMasterRequired',
        'DevelopPreviewRequired',
        'AttemptActive',
      ]),
    },
  }),
})

export const OpenedProcessingProject = Schema.Struct({
  projectId: ProcessingProjectId,
  revision: ProcessingProjectRevision,
  name: Schema.NonEmptyString,
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  authority: ProcessingProjectAuthority,
  sources: Schema.Array(ProcessingProjectSource),
  warnings: Schema.Array(ProcessingProjectWarning),
  stages: Schema.Array(ProcessingStageView),
  developBase: Schema.optionalKey(ProcessingDevelopBase),
  activeAttempt: Schema.optionalKey(
    Schema.Struct({
      attemptId: ProcessingStageAttemptId,
      stage: ExecutableProcessingStage,
      state: Schema.Literals(['Queued', 'Running']),
      acceptedAt: Schema.NonEmptyString,
      startedAt: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  savedAssetIds: Schema.Array(AssetId),
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
})

export const ProcessingProjectList = Schema.Array(ProcessingProjectSummary)

export const ProcessingProjectEvidenceQuery = Schema.Struct({
  projectId: ProcessingProjectId,
  stage: Schema.optionalKey(ExecutableProcessingStage),
  afterAttemptId: Schema.optionalKey(ProcessingStageAttemptId),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
})

export const ProcessingProjectEvidence = Schema.Struct({
  projectId: ProcessingProjectId,
  attempts: Schema.Array(ProcessingAttempt),
  nextAttemptId: Schema.optionalKey(ProcessingStageAttemptId),
})

export const ProcessingProjectChanged = Schema.Struct({
  outcome: Schema.Literal('Accepted'),
  replayed: Schema.Boolean,
  project: OpenedProcessingProject,
})

export const ProcessingProjectError = Schema.TaggedUnion({
  ProcessAuthorityDenied: {
    reason: Schema.Literals(['OwnerRequired', 'ControlCapableClientRequired']),
  },
  ProjectNotFound: { projectId: ProcessingProjectId },
  ProjectRevisionConflict: {
    projectId: ProcessingProjectId,
    currentRevision: ProcessingProjectRevision,
  },
  IntentConflict: { intentId: IntentId },
  ActiveAttemptConflict: {
    attemptId: ProcessingStageAttemptId,
    stage: ExecutableProcessingStage,
  },
  SourceSelectionInvalid: { issues: Schema.Array(Schema.NonEmptyString) },
  SourceNotFound: { assetId: AssetId },
  DraftInvalid: {
    stage: ExecutableProcessingStage,
    issues: Schema.Array(Schema.NonEmptyString),
  },
  HistoryUnavailable: {
    stage: ExecutableProcessingStage,
    target: Schema.Literals(['Draft', 'CurrentResult']),
    direction: Schema.Literals(['Undo', 'Redo']),
  },
  RunUnavailable: {
    stage: ExecutableProcessingStage,
    reason: ProcessingStageView.fields.run.cases.Unavailable.fields.reason,
  },
  SaveUnavailable: {
    stage: Schema.Literals(['Stacking', 'Develop']),
    reason: Schema.Literals([
      'CurrentResultRequired',
      'CurrentLineageRequired',
    ]),
  },
})

/** Change notices invalidate a Project read. They are not an event replay API. */
export const ProcessingProjectNotice = Schema.Struct({
  projectId: ProcessingProjectId,
  revision: ProcessingProjectRevision,
})

export const ProcessingProjectHttpFailure = Schema.TaggedUnion({
  InvalidInput: { message: Schema.NonEmptyString },
  RequestTooLarge: { message: Schema.NonEmptyString },
  ServiceUnavailable: { message: Schema.NonEmptyString },
  ProjectRouteNotFound: { message: Schema.NonEmptyString },
  DomainRejected: { error: ProcessingProjectError },
})

export type ProcessingProjectHttpFailure =
  typeof ProcessingProjectHttpFailure.Type

export const ProcessingProjectListResponse = Schema.Union([
  ProcessingProjectList,
  ProcessingProjectHttpFailure,
])
export const OpenedProcessingProjectResponse = Schema.Union([
  OpenedProcessingProject,
  ProcessingProjectHttpFailure,
])
export const ProcessingProjectEvidenceResponse = Schema.Union([
  ProcessingProjectEvidence,
  ProcessingProjectHttpFailure,
])
export const ProcessingProjectChangedResponse = Schema.Union([
  ProcessingProjectChanged,
  ProcessingProjectHttpFailure,
])

const processingDraftStage = (
  value: typeof ProcessingStageDraftValue.Type,
): typeof ExecutableProcessingStage.Type =>
  ProcessingStageDraftValue.match(value, {
    Calibration: () => 'Calibration',
    Registration: () => 'Registration',
    Stacking: () => 'Stacking',
    Develop: () => 'Develop',
  })

const processingEvidenceStage = (
  value: typeof ProcessingAttemptStageEvidence.Type,
): typeof ExecutableProcessingStage.Type =>
  ProcessingAttemptStageEvidence.match(value, {
    Calibration: () => 'Calibration',
    Registration: () => 'Registration',
    Stacking: () => 'Stacking',
    Develop: () => 'Develop',
  })
