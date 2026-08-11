import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  CaptureSetId,
  CheckpointId,
  ClientCapability,
  ClientId,
  IntentId,
  MembershipRole,
  PersonId,
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

export const ProcessingStageDraft = Schema.Struct({
  revision: Schema.Int,
  value: ProcessingStageDraftValue,
  undo: Schema.Array(ProcessingStageDraftValue),
  redo: Schema.Array(ProcessingStageDraftValue),
})

/** Durable Develop preview synchronized to one exact draft and checkpoint. */
export const ProcessingDevelopPreview = Schema.Struct({
  previewId: PreviewId,
  draftRevision: Schema.Int,
  inputCheckpointId: CheckpointId,
  operation: DevelopOperation,
  state: Schema.Literals(['queued', 'computing', 'ready', 'failed']),
  checksum: Schema.optionalKey(Schema.NonEmptyString),
  synchronizedAt: Schema.optionalKey(Schema.NonEmptyString),
})

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

/** A successful result and its exact immutable lineage. */
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

/**
 * A stage has one linear product history. Cursor zero means no Current Result;
 * otherwise the Current Result is resultHistory[cursor - 1]. Attempts omitted
 * from a replaced redo branch remain in Processing Project evidence.
 */
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
export interface ProcessingProject extends Schema.Schema.Type<
  typeof ProcessingProject
> {}

export const ProcessingProjectCaller = Schema.Struct({
  personId: PersonId,
  clientId: ClientId,
  role: MembershipRole,
  capability: ClientCapability,
})

export const ProcessingProjectAuthority = Schema.TaggedUnion({
  Allowed: {},
  Denied: {
    reason: Schema.Literals(['OwnerRequired', 'ControlCapableClientRequired']),
  },
})

export const decideProcessingProjectAuthority = (
  caller: typeof ProcessingProjectCaller.Type,
): typeof ProcessingProjectAuthority.Type =>
  caller.role !== 'owner'
    ? ProcessingProjectAuthority.cases.Denied.make({ reason: 'OwnerRequired' })
    : caller.capability !== 'controlCapable'
      ? ProcessingProjectAuthority.cases.Denied.make({
          reason: 'ControlCapableClientRequired',
        })
      : ProcessingProjectAuthority.cases.Allowed.make({})

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

/** A successful Run after Undo replaces the product redo branch. */
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

/** Restore the newest downstream result with the exact active upstream lineage. */
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
