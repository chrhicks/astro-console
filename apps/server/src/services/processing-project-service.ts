import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  AttemptId,
  CaptureSetId,
  CheckpointId,
  Command,
  DevelopAttempt,
  DevelopDraft,
  DevelopHistoryEntry,
  DevelopOutput,
  DevelopOperation,
  DevelopPreview,
  DevelopSavedResult,
  DevelopState,
  PreviewId,
  ProcessingOutputId,
  ProcessingProject,
  ProcessingLibraryFormat,
  ProcessingLibraryRole,
  CalibrationOverride,
  CalibrationFrameOutcome,
  CalibrationRecommendation,
  RegistrationFrameInclusion,
  StackingFrameChoice,
  StackingRecommendation,
  ProcessingProjectId,
  ProcessingProjectRevision,
  ProcessingProjectSource,
  ProcessingStageAttempt,
  ProcessingStageAttemptId,
  ProcessingStageResultId,
  ProcessingStageState,
  ProcessingProjectWarning,
  type ProcessingSourceRole,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'

type ProjectCommand = Extract<
  typeof Command.Type,
  | { readonly _tag: 'CreateProcessingProject' }
  | { readonly _tag: 'AddProcessingProjectSources' }
  | { readonly _tag: 'RemoveProcessingProjectSource' }
  | { readonly _tag: 'AssignProcessingSourceRole' }
  | { readonly _tag: 'NavigateProcessingProjectStage' }
  | { readonly _tag: 'UpdateProcessingStageDraft' }
  | { readonly _tag: 'UndoProcessingStageDraft' }
  | { readonly _tag: 'RedoProcessingStageDraft' }
  | { readonly _tag: 'SetCalibrationUseAnyway' }
  | { readonly _tag: 'SetRegistrationFrameIncluded' }
  | { readonly _tag: 'SetStackingFrameIncluded' }
  | { readonly _tag: 'RunProcessingProjectStage' }
  | { readonly _tag: 'SelectProcessingStageResult' }
  | { readonly _tag: 'SaveProcessingProjectMaster' }
  | { readonly _tag: 'OpenProcessingProjectDevelop' }
  | { readonly _tag: 'UpdateProcessingDevelopDraft' }
  | { readonly _tag: 'UndoProcessingDevelopDraft' }
  | { readonly _tag: 'RedoProcessingDevelopDraft' }
  | { readonly _tag: 'SyncProcessingDevelopPreview' }
  | { readonly _tag: 'ApplyProcessingDevelopPreview' }
  | { readonly _tag: 'UndoProcessingDevelopStep' }
  | { readonly _tag: 'RedoProcessingDevelopStep' }
  | { readonly _tag: 'RetryProcessingDevelopApply' }
  | { readonly _tag: 'SaveProcessingDevelopResult' }
>

const ProjectRow = Schema.Struct({ project: Schema.String })
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)
const ProjectStageWorkRow = Schema.Struct({
  session_id: Schema.String,
  payload: Schema.String,
  state: Schema.String,
  claim_token: Schema.NullOr(Schema.String),
})
const ProjectStageWorkPayload = Schema.Struct({
  projectId: ProcessingProjectId,
  projectRevision: ProcessingProjectRevision,
  attemptId: ProcessingStageAttemptId,
  stage: Schema.Literals(['Calibration', 'Registration', 'Stacking']),
})
const ProjectDevelopWorkPayload = Schema.Struct({
  projectId: ProcessingProjectId,
  projectRevision: ProcessingProjectRevision,
  attemptId: AttemptId,
  stage: Schema.Literal('Develop'),
})
const ReceiptRow = Schema.Struct({ response: Schema.String })
const MasterArtifactRow = Schema.Struct({ checksum: Schema.String })
const DevelopArtifactRow = Schema.Struct({
  path: Schema.String,
  checksum: Schema.String,
})
const ProjectAcceptedResponse = Schema.Struct({
  outcome: Schema.Literal('accepted'),
  replayed: Schema.Boolean,
  effect: Schema.Literals([
    'projectCreated',
    'projectSourcesAdded',
    'projectSourceRemoved',
    'projectSourceRoleAssigned',
    'projectStageNavigated',
    'projectStageDraftUpdated',
    'projectStageDraftUndone',
    'projectStageDraftRedone',
    'calibrationUseAnywayUpdated',
    'registrationFrameInclusionUpdated',
    'stackingFrameInclusionUpdated',
    'projectStageRunQueued',
    'projectStageResultSelected',
    'projectMasterSaved',
    'projectDevelopOpened',
    'projectDevelopDraftUpdated',
    'projectDevelopDraftUndone',
    'projectDevelopDraftRedone',
    'projectDevelopPreviewSynchronized',
    'projectDevelopApplyQueued',
    'projectDevelopStepUndone',
    'projectDevelopStepRedone',
    'projectDevelopRetryQueued',
    'projectDevelopResultSaved',
  ]),
  project: ProcessingProject,
})
const SourceRow = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  availability: Schema.String,
  comparison_group_id: Schema.String,
  captured_at: Schema.String,
  role: ProcessingLibraryRole,
  format: ProcessingLibraryFormat,
  detail: Schema.String,
})
const StoredDetail = Schema.Struct({
  checksum: Schema.optionalKey(Schema.String),
  targetName: Schema.optionalKey(Schema.String),
  captureSetId: Schema.optionalKey(CaptureSetId),
  equipment: Schema.optionalKey(
    Schema.Struct({ rigId: Schema.String, cameraDeviceId: Schema.String }),
  ),
  lineage: Schema.Struct({
    runId: Schema.optionalKey(Schema.String),
    sequenceId: Schema.optionalKey(Schema.String),
    acquisitionId: Schema.optionalKey(Schema.String),
  }),
  capture: Schema.optionalKey(
    Schema.Struct({
      exposureSeconds: Schema.Number,
      filter: Schema.String,
      binning: Schema.Int,
      frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
    }),
  ),
})
type StackingAttemptEvidence = {
  readonly stageOutcome: 'Succeeded' | 'Warning' | 'Failed' | 'Unavailable'
  readonly frameOutcomes: ReadonlyArray<typeof CalibrationFrameOutcome.Type>
  readonly diagnostics: ReadonlyArray<string>
  readonly stackingOutput?: {
    readonly checksum: string
    readonly format: 'fits'
    readonly includedAssetIds: ReadonlyArray<typeof AssetId.Type>
    readonly diagnostic: string
  }
  readonly outputArtifact?: { readonly path: string; readonly checksum: string }
}

export const isProcessingProjectCommand = (
  command: typeof Command.Type,
): command is ProjectCommand =>
  Command.guards.CreateProcessingProject(command) ||
  Command.guards.AddProcessingProjectSources(command) ||
  Command.guards.RemoveProcessingProjectSource(command) ||
  Command.guards.AssignProcessingSourceRole(command) ||
  Command.guards.NavigateProcessingProjectStage(command) ||
  Command.guards.UpdateProcessingStageDraft(command) ||
  Command.guards.UndoProcessingStageDraft(command) ||
  Command.guards.RedoProcessingStageDraft(command) ||
  Command.guards.SetCalibrationUseAnyway(command) ||
  Command.guards.SetRegistrationFrameIncluded(command) ||
  Command.guards.SetStackingFrameIncluded(command) ||
  Command.guards.RunProcessingProjectStage(command) ||
  Command.guards.SelectProcessingStageResult(command) ||
  Command.guards.SaveProcessingProjectMaster(command) ||
  Command.guards.OpenProcessingProjectDevelop(command) ||
  Command.guards.UpdateProcessingDevelopDraft(command) ||
  Command.guards.UndoProcessingDevelopDraft(command) ||
  Command.guards.RedoProcessingDevelopDraft(command) ||
  Command.guards.SyncProcessingDevelopPreview(command) ||
  Command.guards.ApplyProcessingDevelopPreview(command) ||
  Command.guards.UndoProcessingDevelopStep(command) ||
  Command.guards.RedoProcessingDevelopStep(command) ||
  Command.guards.RetryProcessingDevelopApply(command) ||
  Command.guards.SaveProcessingDevelopResult(command)

export function processingProjects(database: DatabaseSync) {
  return Schema.decodeUnknownSync(Schema.Array(ProjectRow))(
    database
      .prepare(
        'SELECT project FROM processing_projects ORDER BY updated_at,project_id',
      )
      .all(),
  ).map((row) => {
    const stored = Schema.decodeUnknownSync(UnknownRecord)(
      JSON.parse(row.project),
    )
    const project = Schema.decodeUnknownSync(ProcessingProject)({
      currentStage: 'Sources',
      stages: initialStages(),
      ...normalizeStoredProject(database, stored),
    })
    return ProcessingProject.make({
      ...project,
      stages: recomputeLineage(project.stages, project.sources),
    })
  })
}

function normalizeStoredProject(
  database: DatabaseSync,
  stored: typeof UnknownRecord.Type,
) {
  if (!Array.isArray(stored.stages)) return stored
  return {
    ...stored,
    sources: Array.isArray(stored.sources)
      ? stored.sources.map((value) => {
          const source = Schema.decodeUnknownSync(UnknownRecord)(value)
          const identity = Schema.decodeUnknownSync(
            Schema.Struct({
              assetId: AssetId,
              assetRevision: AssetRevision,
            }),
          )(value)
          const retained = Schema.decodeUnknownSync(
            Schema.optional(
              Schema.Struct({
                role: ProcessingLibraryRole,
                format: ProcessingLibraryFormat,
              }),
            ),
          )(
            database
              .prepare(
                'SELECT role,format FROM library_assets WHERE asset_id=? AND revision=?',
              )
              .get(identity.assetId, identity.assetRevision),
          )
          return {
            ...source,
            libraryRole: source.libraryRole ?? retained?.role ?? 'unknown',
            libraryFormat:
              source.libraryFormat ?? retained?.format ?? 'unknown',
          }
        })
      : [],
    stages: stored.stages.map((value) => {
      const stage = Schema.decodeUnknownSync(UnknownRecord)(value)
      const draft = Schema.decodeUnknownSync(UnknownRecord)(stage.draft)
      const normalizeHistory = (history: unknown) =>
        Array.isArray(history)
          ? history.map((entry) =>
              Array.isArray(entry)
                ? {
                    settings: entry,
                    overrides: [],
                    registrationInclusions: [],
                    stackingFrameChoices: [],
                  }
                : {
                    ...Schema.decodeUnknownSync(UnknownRecord)(entry),
                    overrides:
                      Schema.decodeUnknownSync(UnknownRecord)(entry)
                        .overrides ?? [],
                    registrationInclusions:
                      Schema.decodeUnknownSync(UnknownRecord)(entry)
                        .registrationInclusions ?? [],
                    stackingFrameChoices:
                      Schema.decodeUnknownSync(UnknownRecord)(entry)
                        .stackingFrameChoices ?? [],
                  },
            )
          : []
      return {
        ...stage,
        draft: {
          ...draft,
          overrides: draft.overrides ?? [],
          registrationInclusions: draft.registrationInclusions ?? [],
          stackingFrameChoices: draft.stackingFrameChoices ?? [],
          undo: normalizeHistory(draft.undo),
          redo: normalizeHistory(draft.redo),
        },
        calibrationRecommendations: stage.calibrationRecommendations ?? [],
        stackingRecommendations: stage.stackingRecommendations ?? [],
        attempts: Array.isArray(stage.attempts)
          ? stage.attempts.map((entry) => ({
              ...Schema.decodeUnknownSync(UnknownRecord)(entry),
              recommendations:
                Schema.decodeUnknownSync(UnknownRecord)(entry)
                  .recommendations ?? [],
              overrides:
                Schema.decodeUnknownSync(UnknownRecord)(entry).overrides ?? [],
              registrationInclusions:
                Schema.decodeUnknownSync(UnknownRecord)(entry)
                  .registrationInclusions ?? [],
              stackingRecommendations:
                Schema.decodeUnknownSync(UnknownRecord)(entry)
                  .stackingRecommendations ?? [],
              stackingFrameChoices:
                Schema.decodeUnknownSync(UnknownRecord)(entry)
                  .stackingFrameChoices ?? [],
              stackingInputAssetIds:
                Schema.decodeUnknownSync(UnknownRecord)(entry)
                  .stackingInputAssetIds ?? [],
              frameOutcomes:
                Schema.decodeUnknownSync(UnknownRecord)(entry).frameOutcomes ??
                [],
              outputs:
                Schema.decodeUnknownSync(UnknownRecord)(entry).outputs ?? [],
              registrationTransforms:
                Schema.decodeUnknownSync(UnknownRecord)(entry)
                  .registrationTransforms ?? [],
              viableAssetIds:
                Schema.decodeUnknownSync(UnknownRecord)(entry).viableAssetIds ??
                [],
              diagnostics:
                Schema.decodeUnknownSync(UnknownRecord)(entry).diagnostics ??
                [],
            }))
          : [],
      }
    }),
  }
}

export function executeProcessingProjectCommand(
  database: DatabaseSync,
  command: ProjectCommand,
  identity: LocalIdentity,
) {
  const existing = Schema.decodeUnknownSync(Schema.optional(ReceiptRow))(
    database
      .prepare(
        'SELECT response FROM processing_project_receipts WHERE idempotency_key=? AND owner_person_id=?',
      )
      .get(command.idempotencyKey, identity.personId),
  )
  if (existing !== undefined)
    return ProjectAcceptedResponse.make({
      ...Schema.decodeUnknownSync(ProjectAcceptedResponse)(
        JSON.parse(existing.response),
      ),
      replayed: true,
    })

  const current = Command.guards.CreateProcessingProject(command)
    ? undefined
    : processingProjects(database).find(
        (project) => project.projectId === command.projectId,
      )
  if (
    current !== undefined &&
    !Command.guards.CreateProcessingProject(command) &&
    current.revision !== command.expectedProjectRevision
  )
    return { outcome: 'rejected' as const, reason: 'ProjectRevisionConflict' }

  let project: ProcessingProject
  let work:
    | {
        workId: string
        attemptId: string
        stage: string
        kind: 'projectStage' | 'projectDevelopApply'
      }
    | undefined
  let masterSave:
    | {
        assetId: typeof AssetId.Type
        attemptId: typeof ProcessingStageAttemptId.Type
        resultId: typeof ProcessingStageResultId.Type
        registrationAttemptId: typeof ProcessingStageAttemptId.Type
        checksum: string
        includedAssetIds: ReadonlyArray<typeof AssetId.Type>
        savedAt: string
      }
    | undefined
  let developSave:
    | {
        assetId: typeof AssetId.Type
        checksum: string
        outputId: typeof ProcessingOutputId.Type
        checkpointId: typeof CheckpointId.Type
        attemptId: typeof AttemptId.Type
        operationIds: ReadonlyArray<string>
        savedAt: string
      }
    | undefined
  if (Command.guards.NavigateProcessingProjectStage(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const selectedSavedMaster = current.stages
      .find((stage) => stage.stage === 'Stacking')
      ?.attempts.find(
        (attempt) =>
          attempt.attemptId ===
          current.stages.find((stage) => stage.stage === 'Stacking')
            ?.selectedAttemptId,
      )?.savedMaster
    if (command.stage === 'Develop') {
      if (selectedSavedMaster === undefined)
        return { outcome: 'rejected' as const, reason: 'SavedMasterRequired' }
      project = reviseProject(current, current.sources, {
        currentStage: command.stage,
        developMasterAssetId: selectedSavedMaster.assetId,
        develop: current.develop ?? initialDevelopState(selectedSavedMaster),
      })
    } else
      project = reviseProject(current, current.sources, {
        currentStage: command.stage,
      })
  } else if (
    Command.guards.UpdateProcessingStageDraft(command) ||
    Command.guards.UndoProcessingStageDraft(command) ||
    Command.guards.RedoProcessingStageDraft(command) ||
    Command.guards.SetCalibrationUseAnyway(command) ||
    Command.guards.SetRegistrationFrameIncluded(command) ||
    Command.guards.SetStackingFrameIncluded(command)
  ) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const stageName = Command.guards.SetCalibrationUseAnyway(command)
      ? 'Calibration'
      : Command.guards.SetRegistrationFrameIncluded(command)
        ? 'Registration'
        : Command.guards.SetStackingFrameIncluded(command)
          ? 'Stacking'
          : command.stage
    const stage = current.stages.find((item) => item.stage === stageName)
    if (stage === undefined)
      return { outcome: 'rejected' as const, reason: 'StageNotFound' }
    const draft = stage.draft
    if (Command.guards.SetCalibrationUseAnyway(command)) {
      const recommendation = stage.calibrationRecommendations.find(
        (candidate) => candidate.assetId === command.assetId,
      )
      if (recommendation?.compatibility !== 'Advisory mismatch')
        return {
          outcome: 'rejected' as const,
          reason: 'CalibrationOverrideUnavailable',
        }
    }
    if (Command.guards.SetRegistrationFrameIncluded(command)) {
      const latest = stage.attempts
        .filter(
          (attempt) =>
            attempt.state === 'succeeded' && !attempt.basedOnEarlierUpstream,
        )
        .at(-1)
      const outcome = latest?.frameOutcomes.find(
        (candidate) => candidate.assetId === command.assetId,
      )
      const transform = latest?.registrationTransforms.find(
        (candidate) => candidate.assetId === command.assetId,
      )
      if (outcome?.outcome !== 'Warning' || transform?.usable !== true)
        return {
          outcome: 'rejected' as const,
          reason: 'RegistrationFrameChoiceUnavailable',
        }
    }
    if (Command.guards.SetStackingFrameIncluded(command)) {
      const recommendation = stage.stackingRecommendations.find(
        (candidate) => candidate.assetId === command.assetId,
      )
      if (recommendation?.technicallyUsable !== true)
        return {
          outcome: 'rejected' as const,
          reason: 'StackingFrameChoiceUnavailable',
        }
    }
    const snapshot = {
      settings: draft.settings,
      overrides: draft.overrides,
      registrationInclusions: draft.registrationInclusions,
      stackingFrameChoices: draft.stackingFrameChoices,
    }
    const nextDraft = Command.guards.SetCalibrationUseAnyway(command)
      ? {
          revision: draft.revision + 1,
          settings: draft.settings,
          overrides: command.useAnyway
            ? [
                ...draft.overrides.filter(
                  (override) => override.assetId !== command.assetId,
                ),
                { assetId: command.assetId, decision: 'Use anyway' as const },
              ]
            : draft.overrides.filter(
                (override) => override.assetId !== command.assetId,
              ),
          registrationInclusions: draft.registrationInclusions,
          stackingFrameChoices: draft.stackingFrameChoices,
          undo: [...draft.undo, snapshot].slice(-10),
          redo: [],
        }
      : Command.guards.SetRegistrationFrameIncluded(command)
        ? {
            revision: draft.revision + 1,
            settings: draft.settings,
            overrides: draft.overrides,
            registrationInclusions: command.included
              ? [
                  ...draft.registrationInclusions.filter(
                    (choice) => choice.assetId !== command.assetId,
                  ),
                  {
                    assetId: command.assetId,
                    decision: 'Include warning frame' as const,
                  },
                ]
              : draft.registrationInclusions.filter(
                  (choice) => choice.assetId !== command.assetId,
                ),
            stackingFrameChoices: draft.stackingFrameChoices,
            undo: [...draft.undo, snapshot].slice(-10),
            redo: [],
          }
        : Command.guards.SetStackingFrameIncluded(command)
          ? {
              revision: draft.revision + 1,
              settings: draft.settings,
              overrides: draft.overrides,
              registrationInclusions: draft.registrationInclusions,
              stackingFrameChoices: [
                ...draft.stackingFrameChoices.filter(
                  (choice) => choice.assetId !== command.assetId,
                ),
                {
                  assetId: command.assetId,
                  decision: command.included
                    ? ('Include' as const)
                    : ('Exclude' as const),
                },
              ],
              undo: [...draft.undo, snapshot].slice(-10),
              redo: [],
            }
          : Command.guards.UpdateProcessingStageDraft(command)
            ? {
                revision: draft.revision + 1,
                settings: command.settings,
                overrides: draft.overrides,
                registrationInclusions: draft.registrationInclusions,
                stackingFrameChoices: draft.stackingFrameChoices,
                undo: [...draft.undo, snapshot].slice(-10),
                redo: [],
              }
            : Command.guards.UndoProcessingStageDraft(command)
              ? draft.undo.length === 0
                ? undefined
                : {
                    revision: draft.revision + 1,
                    settings: draft.undo.at(-1)?.settings ?? [],
                    overrides: draft.undo.at(-1)?.overrides ?? [],
                    registrationInclusions:
                      draft.undo.at(-1)?.registrationInclusions ?? [],
                    stackingFrameChoices:
                      draft.undo.at(-1)?.stackingFrameChoices ?? [],
                    undo: draft.undo.slice(0, -1),
                    redo: [snapshot, ...draft.redo].slice(0, 10),
                  }
              : draft.redo.length === 0
                ? undefined
                : {
                    revision: draft.revision + 1,
                    settings: draft.redo[0]?.settings ?? [],
                    overrides: draft.redo[0]?.overrides ?? [],
                    registrationInclusions:
                      draft.redo[0]?.registrationInclusions ?? [],
                    stackingFrameChoices:
                      draft.redo[0]?.stackingFrameChoices ?? [],
                    undo: [...draft.undo, snapshot].slice(-10),
                    redo: draft.redo.slice(1),
                  }
    if (nextDraft === undefined)
      return { outcome: 'rejected' as const, reason: 'DraftHistoryUnavailable' }
    project = reviseProject(current, current.sources, {
      currentStage: stageName,
      stages: replaceStage(current.stages, { ...stage, draft: nextDraft }),
    })
  } else if (Command.guards.RunProcessingProjectStage(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const stage = current.stages.find((item) => item.stage === command.stage)
    if (stage === undefined)
      return { outcome: 'rejected' as const, reason: 'StageNotFound' }
    if (
      command.stage === 'Calibration' &&
      !current.sources.some(
        (source) =>
          source.role === 'Lights' &&
          isCalibrationInputSource(source) &&
          (source.availability === 'availableLocally' ||
            source.availability === 'published'),
      )
    )
      return {
        outcome: 'rejected' as const,
        reason: 'CalibrationLightsUnavailable',
      }
    if (
      stage.attempts.some(
        (attempt) => attempt.state === 'queued' || attempt.state === 'running',
      )
    )
      return { outcome: 'rejected' as const, reason: 'StageAttemptActive' }
    const upstream = upstreamAttempt(current, command.stage)
    if (command.stage !== 'Calibration' && upstream === undefined)
      return { outcome: 'rejected' as const, reason: 'UpstreamResultRequired' }
    const upstreamResult =
      command.stage === 'Registration' && upstream !== undefined
        ? current.stages
            .find((item) => item.stage === 'Calibration')
            ?.attempts.find((item) => item.attemptId === upstream)
        : undefined
    const registrationResult =
      command.stage === 'Stacking' && upstream !== undefined
        ? current.stages
            .find((item) => item.stage === 'Registration')
            ?.attempts.find((item) => item.attemptId === upstream)
        : undefined
    if (
      command.stage === 'Registration' &&
      registrationReference(stage.draft.settings, upstreamResult) === undefined
    )
      return {
        outcome: 'rejected' as const,
        reason: 'RegistrationReferenceUnavailable',
      }
    const stackRecommendations =
      command.stage === 'Stacking'
        ? stackingRecommendations(registrationResult)
        : []
    const stackingInputAssetIds = stackRecommendations.flatMap(
      (recommendation) => {
        const choice = stage.draft.stackingFrameChoices.find(
          (candidate) => candidate.assetId === recommendation.assetId,
        )
        const included =
          choice?.decision === 'Include' ||
          (choice === undefined && recommendation.decision === 'Include')
        return recommendation.technicallyUsable && included
          ? [recommendation.assetId]
          : []
      },
    )
    if (command.stage === 'Stacking' && stackingInputAssetIds.length === 0)
      return {
        outcome: 'rejected' as const,
        reason: 'StackingInputUnavailable',
      }
    const attemptId = ProcessingStageAttemptId.make(
      `stage-attempt-${randomUUID()}`,
    )
    const attempt = ProcessingStageAttempt.make({
      attemptId,
      stage: command.stage,
      state: 'queued',
      draftRevision: stage.draft.revision,
      settings: stage.draft.settings,
      toolIdentity:
        command.stage === 'Calibration'
          ? 'deterministic-calibration-adapter-v1'
          : command.stage === 'Registration'
            ? 'deterministic-registration-adapter-v1'
            : 'deterministic-stacking-adapter-v1',
      resultKind:
        command.stage === 'Calibration'
          ? 'deterministicCalibrationEvidence'
          : command.stage === 'Registration'
            ? 'deterministicRegistrationEvidence'
            : 'deterministicStackingEvidence',
      basedOnEarlierUpstream: false,
      sourceRevisions:
        command.stage === 'Registration' && upstreamResult !== undefined
          ? upstreamResult.frameOutcomes.map((source) => ({
              assetId: source.assetId,
              assetRevision: source.assetRevision,
              role: 'Lights' as const,
            }))
          : command.stage === 'Stacking' && registrationResult !== undefined
            ? registrationResult.registrationTransforms
                .filter((transform) =>
                  registrationResult.viableAssetIds.includes(transform.assetId),
                )
                .map((transform) => ({
                  assetId: transform.assetId,
                  assetRevision: transform.assetRevision,
                  role: 'Lights' as const,
                }))
            : current.sources.map((source) => ({
                assetId: source.assetId,
                assetRevision: source.assetRevision,
                role: source.role,
              })),
      recommendations:
        command.stage === 'Calibration' ? stage.calibrationRecommendations : [],
      overrides: command.stage === 'Calibration' ? stage.draft.overrides : [],
      registrationInclusions:
        command.stage === 'Registration'
          ? stage.draft.registrationInclusions
          : [],
      stackingRecommendations: stackRecommendations,
      stackingFrameChoices:
        command.stage === 'Stacking' ? stage.draft.stackingFrameChoices : [],
      stackingInputAssetIds,
      frameOutcomes: [],
      outputs: [],
      registrationTransforms: [],
      viableAssetIds: [],
      diagnostics: [],
      ...(upstream === undefined ? {} : { upstreamAttemptId: upstream }),
    })
    project = reviseProject(current, current.sources, {
      currentStage: command.stage,
      stages: replaceStage(current.stages, {
        ...stage,
        attempts: [...stage.attempts, attempt],
      }),
    })
    work = {
      workId: `project-stage-${attemptId}`,
      attemptId,
      stage: command.stage,
      kind: 'projectStage',
    }
  } else if (Command.guards.SelectProcessingStageResult(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const stage = current.stages.find((item) => item.stage === command.stage)
    const attempt = stage?.attempts.find(
      (item) => item.attemptId === command.attemptId,
    )
    if (stage === undefined || attempt?.state !== 'succeeded')
      return { outcome: 'rejected' as const, reason: 'StageResultUnavailable' }
    project = reviseProject(current, current.sources, {
      currentStage: command.stage,
      stages: replaceStage(current.stages, {
        ...stage,
        selectedAttemptId: attempt.attemptId,
      }),
    })
  } else if (Command.guards.SaveProcessingProjectMaster(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const stage = current.stages.find((item) => item.stage === 'Stacking')
    const attempt = stage?.attempts.find(
      (item) => item.attemptId === stage.selectedAttemptId,
    )
    if (
      stage === undefined ||
      attempt?.state !== 'succeeded' ||
      attempt.resultId === undefined ||
      attempt.upstreamAttemptId === undefined ||
      attempt.stackingOutput === undefined
    )
      return { outcome: 'rejected' as const, reason: 'StackResultRequired' }
    if (attempt.savedMaster !== undefined) project = current
    else {
      const artifact = Schema.decodeUnknownSync(
        Schema.optional(MasterArtifactRow),
      )(
        database
          .prepare(
            'SELECT checksum FROM processing_artifacts WHERE session_id=? AND output_id=?',
          )
          .get(current.projectId, `stack-output-${attempt.attemptId}`),
      )
      if (artifact?.checksum !== attempt.stackingOutput.checksum)
        return { outcome: 'rejected' as const, reason: 'StackResultRequired' }
      const savedAt = new Date().toISOString()
      const save = {
        assetId: AssetId.make(`asset-master-${randomUUID()}`),
        attemptId: attempt.attemptId,
        resultId: attempt.resultId,
        registrationAttemptId: attempt.upstreamAttemptId,
        checksum: attempt.stackingOutput.checksum,
        includedAssetIds: attempt.stackingOutput.includedAssetIds,
        savedAt,
      }
      masterSave = save
      project = reviseProject(current, current.sources, {
        currentStage: 'Master',
        stages: replaceStage(current.stages, {
          ...stage,
          attempts: stage.attempts.map((candidate) =>
            candidate.attemptId === attempt.attemptId
              ? {
                  ...candidate,
                  savedMaster: {
                    assetId: save.assetId,
                    assetRevision: AssetRevision.make(1),
                    checksum: save.checksum,
                    projectId: current.projectId,
                    registrationAttemptId: save.registrationAttemptId,
                    stackingAttemptId: attempt.attemptId,
                    stackResultId: save.resultId,
                    savedAt,
                  },
                }
              : candidate,
          ),
        }),
      })
    }
  } else if (Command.guards.OpenProcessingProjectDevelop(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const saved = current.stages
      .find((stage) => stage.stage === 'Stacking')
      ?.attempts.find(
        (attempt) => attempt.savedMaster?.assetId === command.assetId,
      )?.savedMaster
    if (saved === undefined)
      return { outcome: 'rejected' as const, reason: 'SavedMasterRequired' }
    if (
      current.develop !== undefined &&
      current.develop.base.assetId !== saved.assetId
    )
      return { outcome: 'rejected' as const, reason: 'DevelopBaseConflict' }
    project = reviseProject(current, current.sources, {
      currentStage: 'Develop',
      developMasterAssetId: saved.assetId,
      develop: current.develop ?? initialDevelopState(saved),
    })
  } else if (
    Command.guards.UpdateProcessingDevelopDraft(command) ||
    Command.guards.UndoProcessingDevelopDraft(command) ||
    Command.guards.RedoProcessingDevelopDraft(command)
  ) {
    if (current?.develop === undefined)
      return { outcome: 'rejected' as const, reason: 'DevelopBaseRequired' }
    if (developAttemptActive(current.develop))
      return { outcome: 'rejected' as const, reason: 'DevelopApplyActive' }
    const draft = current.develop.draft
    const snapshot = { operation: draft.operation }
    const nextDraft = Command.guards.UpdateProcessingDevelopDraft(command)
      ? DevelopDraft.make({
          revision: draft.revision + 1,
          operation: command.operation,
          undo: [...draft.undo, snapshot].slice(-10),
          redo: [],
        })
      : Command.guards.UndoProcessingDevelopDraft(command)
        ? draft.undo.length === 0
          ? undefined
          : DevelopDraft.make({
              revision: draft.revision + 1,
              operation: draft.undo.at(-1)?.operation ?? draft.operation,
              undo: draft.undo.slice(0, -1),
              redo: [snapshot, ...draft.redo].slice(0, 10),
            })
        : draft.redo.length === 0
          ? undefined
          : DevelopDraft.make({
              revision: draft.revision + 1,
              operation: draft.redo[0]?.operation ?? draft.operation,
              undo: [...draft.undo, snapshot].slice(-10),
              redo: draft.redo.slice(1),
            })
    if (nextDraft === undefined)
      return { outcome: 'rejected' as const, reason: 'DraftHistoryUnavailable' }
    project = reviseProject(current, current.sources, {
      currentStage: 'Develop',
      develop: DevelopState.make({
        ...withoutDevelopPreview(current.develop),
        draft: nextDraft,
      }),
    })
  } else if (Command.guards.SyncProcessingDevelopPreview(command)) {
    if (current?.develop === undefined)
      return { outcome: 'rejected' as const, reason: 'DevelopBaseRequired' }
    const develop = current.develop
    if (developAttemptActive(develop))
      return { outcome: 'rejected' as const, reason: 'DevelopApplyActive' }
    if (command.expectedDevelopDraftRevision !== develop.draft.revision)
      return {
        outcome: 'rejected' as const,
        reason: 'DevelopDraftRevisionConflict',
      }
    const checkpoint = currentDevelopCheckpoint(develop)
    const now = new Date().toISOString()
    const preview = DevelopPreview.make({
      previewId: PreviewId.make(`develop-preview-${randomUUID()}`),
      draftRevision: develop.draft.revision,
      inputCheckpointId: checkpoint.checkpointId,
      operation: develop.draft.operation,
      toolIdentity: 'deterministic-develop-adapter-v1',
      checksum: `sha256:${digestJson({
        inputChecksum: checkpoint.checksum,
        operation: develop.draft.operation,
        tool: 'deterministic-develop-adapter-v1',
      })}`,
      synchronizedAt: now,
    })
    project = reviseProject(current, current.sources, {
      currentStage: 'Develop',
      develop: DevelopState.make({ ...develop, preview }),
    })
  } else if (Command.guards.ApplyProcessingDevelopPreview(command)) {
    if (current?.develop === undefined)
      return { outcome: 'rejected' as const, reason: 'DevelopBaseRequired' }
    const develop = current.develop
    if (developAttemptActive(develop))
      return { outcome: 'rejected' as const, reason: 'DevelopApplyActive' }
    const checkpoint = currentDevelopCheckpoint(develop)
    const preview = develop.preview
    if (
      preview === undefined ||
      preview.previewId !== command.previewId ||
      preview.draftRevision !== develop.draft.revision ||
      preview.inputCheckpointId !== checkpoint.checkpointId
    )
      return { outcome: 'rejected' as const, reason: 'DevelopPreviewRequired' }
    const relatedInputOutputIds = developStarPair(develop)
    if (
      DevelopOperation.guards.AddStars(develop.draft.operation) &&
      relatedInputOutputIds.length !== 2
    )
      return { outcome: 'rejected' as const, reason: 'DevelopStarPairRequired' }
    const attemptId = AttemptId.make(`develop-attempt-${randomUUID()}`)
    const attempt = DevelopAttempt.make({
      attemptId,
      state: 'queued',
      inputCheckpointId: checkpoint.checkpointId,
      previewId: preview.previewId,
      draftRevision: develop.draft.revision,
      operation: develop.draft.operation,
      toolIdentity: 'deterministic-develop-adapter-v1',
      inputChecksum: checkpoint.checksum,
      relatedInputOutputIds,
      outputs: [],
      diagnostics: [],
    })
    project = reviseProject(current, current.sources, {
      currentStage: 'Develop',
      develop: DevelopState.make({
        ...withoutDevelopFailure(develop),
        attempts: [...develop.attempts, attempt],
      }),
    })
    work = {
      workId: `project-develop-${attemptId}`,
      attemptId,
      stage: 'Develop',
      kind: 'projectDevelopApply',
    }
  } else if (
    Command.guards.UndoProcessingDevelopStep(command) ||
    Command.guards.RedoProcessingDevelopStep(command)
  ) {
    if (current?.develop === undefined)
      return { outcome: 'rejected' as const, reason: 'DevelopBaseRequired' }
    const develop = current.develop
    if (developAttemptActive(develop))
      return { outcome: 'rejected' as const, reason: 'DevelopApplyActive' }
    const cursor = Command.guards.UndoProcessingDevelopStep(command)
      ? develop.historyCursor - 1
      : develop.historyCursor + 1
    if (cursor < 0 || cursor > develop.history.length)
      return {
        outcome: 'rejected' as const,
        reason: 'DevelopHistoryUnavailable',
      }
    project = reviseProject(current, current.sources, {
      currentStage: 'Develop',
      develop: DevelopState.make({
        ...withoutDevelopPreview(develop),
        historyCursor: cursor,
      }),
    })
  } else if (Command.guards.RetryProcessingDevelopApply(command)) {
    if (current?.develop === undefined)
      return { outcome: 'rejected' as const, reason: 'DevelopBaseRequired' }
    const develop = current.develop
    if (developAttemptActive(develop))
      return { outcome: 'rejected' as const, reason: 'DevelopApplyActive' }
    const failed = develop.attempts.find(
      (attempt) =>
        attempt.attemptId === command.failedAttemptId &&
        attempt.state === 'failed' &&
        develop.failedAttemptId === attempt.attemptId,
    )
    if (failed === undefined)
      return {
        outcome: 'rejected' as const,
        reason: 'DevelopFailedAttemptRequired',
      }
    const attemptId = AttemptId.make(`develop-attempt-${randomUUID()}`)
    const {
      startedAt: _startedAt,
      completedAt: _completedAt,
      ...retryBase
    } = failed
    const retry = DevelopAttempt.make({
      ...retryBase,
      attemptId,
      state: 'queued',
      outputs: [],
      diagnostics: [],
      retryOfAttemptId: failed.attemptId,
    })
    project = reviseProject(current, current.sources, {
      currentStage: 'Develop',
      develop: DevelopState.make({
        ...develop,
        attempts: [...develop.attempts, retry],
      }),
    })
    work = {
      workId: `project-develop-${attemptId}`,
      attemptId,
      stage: 'Develop',
      kind: 'projectDevelopApply',
    }
  } else if (Command.guards.SaveProcessingDevelopResult(command)) {
    if (current?.develop === undefined)
      return { outcome: 'rejected' as const, reason: 'DevelopBaseRequired' }
    const develop = current.develop
    const entry = currentDevelopEntry(develop)
    if (entry === undefined)
      return {
        outcome: 'rejected' as const,
        reason: 'DevelopAppliedResultRequired',
      }
    const existingSave = develop.savedResults.find(
      (saved) => saved.checkpointId === entry.checkpointId,
    )
    if (existingSave !== undefined) project = current
    else {
      const artifact = Schema.decodeUnknownSync(
        Schema.optional(MasterArtifactRow),
      )(
        database
          .prepare(
            'SELECT checksum FROM processing_artifacts WHERE session_id=? AND output_id=?',
          )
          .get(current.projectId, entry.outputId),
      )
      if (artifact?.checksum !== entry.checksum)
        return {
          outcome: 'rejected' as const,
          reason: 'DevelopAppliedResultRequired',
        }
      const savedAt = new Date().toISOString()
      const saved = DevelopSavedResult.make({
        assetId: AssetId.make(`asset-develop-${randomUUID()}`),
        assetRevision: AssetRevision.make(1),
        checksum: entry.checksum,
        checkpointId: entry.checkpointId,
        attemptId: entry.attemptId,
        outputId: entry.outputId,
        savedAt,
      })
      const stackingAttempt = current.stages
        .find((stage) => stage.stage === 'Stacking')
        ?.attempts.find(
          (attempt) => attempt.attemptId === develop.base.stackingAttemptId,
        )
      const registrationAttempt = current.stages
        .find((stage) => stage.stage === 'Registration')
        ?.attempts.find(
          (attempt) => attempt.attemptId === stackingAttempt?.upstreamAttemptId,
        )
      developSave = {
        ...saved,
        operationIds: [
          ...(registrationAttempt?.upstreamAttemptId === undefined
            ? []
            : [registrationAttempt.upstreamAttemptId]),
          ...(stackingAttempt?.upstreamAttemptId === undefined
            ? []
            : [stackingAttempt.upstreamAttemptId]),
          develop.base.stackingAttemptId,
          ...develop.history
            .slice(0, develop.historyCursor)
            .map((item) => item.attemptId),
        ],
      }
      project = reviseProject(current, current.sources, {
        currentStage: 'Develop',
        develop: DevelopState.make({
          ...develop,
          savedResults: [...develop.savedResults, saved],
        }),
      })
    }
  } else if (Command.guards.AssignProcessingSourceRole(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const source = current.sources.find(
      (candidate) => candidate.assetId === command.assetId,
    )
    if (source === undefined)
      return { outcome: 'rejected' as const, reason: 'SourceNotFound' }
    if (
      command.role === 'Lights' &&
      source.targetName !== undefined &&
      current.targetName !== undefined &&
      source.targetName !== current.targetName
    )
      return { outcome: 'rejected' as const, reason: 'TargetConflict' }
    project = reviseProject(
      current,
      current.sources.map((candidate) =>
        candidate.assetId === source.assetId
          ? ProcessingProjectSource.make({ ...candidate, role: command.role })
          : candidate,
      ),
    )
  } else if (Command.guards.RemoveProcessingProjectSource(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    if (
      current.stages.some((stage) =>
        stage.attempts.some(
          (attempt) =>
            attempt.state === 'queued' || attempt.state === 'running',
        ),
      )
    )
      return { outcome: 'rejected' as const, reason: 'StageAttemptActive' }
    if (!current.sources.some((source) => source.assetId === command.assetId))
      return { outcome: 'rejected' as const, reason: 'SourceNotFound' }
    project = reviseProject(
      current,
      current.sources.filter((source) => source.assetId !== command.assetId),
    )
  } else {
    const selected = resolveSelection(database, command.selection)
    if (selected.length === 0)
      return { outcome: 'rejected' as const, reason: 'SourceSelectionInvalid' }
    const now = new Date().toISOString()
    if (Command.guards.CreateProcessingProject(command)) {
      const sources = assignSuggestedRoles(selected, undefined)
      project = withProjectWarnings(
        ProcessingProject.make({
          projectId: ProcessingProjectId.make(`project-${randomUUID()}`),
          revision: ProcessingProjectRevision.make(0),
          name: command.name,
          ...projectTarget(sources),
          sources,
          warnings: [],
          currentStage: 'Sources',
          stages: initialStages(sources),
          createdAt: now,
          updatedAt: now,
        }),
      )
    } else {
      if (current === undefined)
        return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
      const known = new Set(current.sources.map((source) => source.assetId))
      const added = assignSuggestedRoles(
        selected.filter((source) => !known.has(source.assetId)),
        current.targetName,
      )
      project = reviseProject(current, [...current.sources, ...added])
    }
  }

  const effect = Command.guards.CreateProcessingProject(command)
    ? ('projectCreated' as const)
    : Command.guards.AddProcessingProjectSources(command)
      ? ('projectSourcesAdded' as const)
      : Command.guards.RemoveProcessingProjectSource(command)
        ? ('projectSourceRemoved' as const)
        : Command.guards.AssignProcessingSourceRole(command)
          ? ('projectSourceRoleAssigned' as const)
          : Command.guards.NavigateProcessingProjectStage(command)
            ? ('projectStageNavigated' as const)
            : Command.guards.UpdateProcessingStageDraft(command)
              ? ('projectStageDraftUpdated' as const)
              : Command.guards.UndoProcessingStageDraft(command)
                ? ('projectStageDraftUndone' as const)
                : Command.guards.RedoProcessingStageDraft(command)
                  ? ('projectStageDraftRedone' as const)
                  : Command.guards.SetCalibrationUseAnyway(command)
                    ? ('calibrationUseAnywayUpdated' as const)
                    : Command.guards.SetRegistrationFrameIncluded(command)
                      ? ('registrationFrameInclusionUpdated' as const)
                      : Command.guards.SetStackingFrameIncluded(command)
                        ? ('stackingFrameInclusionUpdated' as const)
                        : Command.guards.RunProcessingProjectStage(command)
                          ? ('projectStageRunQueued' as const)
                          : Command.guards.SelectProcessingStageResult(command)
                            ? ('projectStageResultSelected' as const)
                            : Command.guards.SaveProcessingProjectMaster(
                                  command,
                                )
                              ? ('projectMasterSaved' as const)
                              : Command.guards.OpenProcessingProjectDevelop(
                                    command,
                                  )
                                ? ('projectDevelopOpened' as const)
                                : Command.guards.UpdateProcessingDevelopDraft(
                                      command,
                                    )
                                  ? ('projectDevelopDraftUpdated' as const)
                                  : Command.guards.UndoProcessingDevelopDraft(
                                        command,
                                      )
                                    ? ('projectDevelopDraftUndone' as const)
                                    : Command.guards.RedoProcessingDevelopDraft(
                                          command,
                                        )
                                      ? ('projectDevelopDraftRedone' as const)
                                      : Command.guards.SyncProcessingDevelopPreview(
                                            command,
                                          )
                                        ? ('projectDevelopPreviewSynchronized' as const)
                                        : Command.guards.ApplyProcessingDevelopPreview(
                                              command,
                                            )
                                          ? ('projectDevelopApplyQueued' as const)
                                          : Command.guards.UndoProcessingDevelopStep(
                                                command,
                                              )
                                            ? ('projectDevelopStepUndone' as const)
                                            : Command.guards.RedoProcessingDevelopStep(
                                                  command,
                                                )
                                              ? ('projectDevelopStepRedone' as const)
                                              : Command.guards.RetryProcessingDevelopApply(
                                                    command,
                                                  )
                                                ? ('projectDevelopRetryQueued' as const)
                                                : ('projectDevelopResultSaved' as const)
  const response = {
    outcome: 'accepted' as const,
    replayed: false,
    effect,
    project,
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    database
      .prepare(
        'INSERT INTO processing_projects(project_id,revision,project,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,project=excluded.project,updated_at=excluded.updated_at',
      )
      .run(
        project.projectId,
        project.revision,
        JSON.stringify(project),
        project.updatedAt,
      )
    database
      .prepare('INSERT INTO processing_project_receipts VALUES (?,?,?)')
      .run(command.idempotencyKey, identity.personId, JSON.stringify(response))
    if (masterSave !== undefined) {
      const detail = {
        assetId: masterSave.assetId,
        revision: 1,
        role: 'linearMaster',
        format: 'fits',
        checksum: masterSave.checksum,
        availability: 'availableLocally',
        capturedAt: masterSave.savedAt,
        comparisonGroupId: `processing-project-${project.projectId}`,
        ...(project.targetName === undefined
          ? {}
          : { targetName: project.targetName }),
        lineage: {
          sourceAssetIds: masterSave.includedAssetIds,
          processingSessionId: project.projectId,
          processingOutputId: masterSave.resultId,
          operationIds: [
            masterSave.registrationAttemptId,
            masterSave.attemptId,
          ],
        },
        representations: [
          { label: 'Saved deterministic Master retained', state: 'available' },
        ],
      }
      database
        .prepare('INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(
          masterSave.assetId,
          1,
          'linearMaster',
          'fits',
          'availableLocally',
          detail.comparisonGroupId,
          masterSave.savedAt,
          masterSave.savedAt,
          0,
          JSON.stringify(detail),
        )
      database
        .prepare(
          'UPDATE processing_artifacts SET saved=1 WHERE session_id=? AND output_id=?',
        )
        .run(project.projectId, `stack-output-${masterSave.attemptId}`)
      database
        .prepare(
          'INSERT INTO process_asset_events (asset_id,event_type,checksum) VALUES (?,?,?)',
        )
        .run(masterSave.assetId, 'ProcessSaved', masterSave.checksum)
    }
    if (developSave !== undefined) {
      const detail = {
        assetId: developSave.assetId,
        revision: 1,
        role: 'final',
        format: 'fits',
        checksum: developSave.checksum,
        availability: 'availableLocally',
        capturedAt: developSave.savedAt,
        comparisonGroupId: `processing-project-${project.projectId}`,
        ...(project.targetName === undefined
          ? {}
          : { targetName: project.targetName }),
        lineage: {
          sourceAssetIds: [project.develop?.base.assetId],
          processingSessionId: project.projectId,
          processingOutputId: developSave.outputId,
          operationIds: developSave.operationIds,
        },
        representations: [
          {
            label: 'Saved deterministic Develop result retained',
            state: 'available',
          },
        ],
      }
      database
        .prepare('INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(
          developSave.assetId,
          1,
          'final',
          'fits',
          'availableLocally',
          detail.comparisonGroupId,
          developSave.savedAt,
          developSave.savedAt,
          0,
          JSON.stringify(detail),
        )
      database
        .prepare(
          'UPDATE processing_artifacts SET saved=1 WHERE session_id=? AND output_id=?',
        )
        .run(project.projectId, developSave.outputId)
      database
        .prepare(
          'INSERT INTO process_asset_events (asset_id,event_type,checksum) VALUES (?,?,?)',
        )
        .run(developSave.assetId, 'ProcessSaved', developSave.checksum)
    }
    if (work !== undefined)
      database
        .prepare(
          "INSERT INTO processing_work(work_id,session_id,kind,payload,state,stage,enqueued_at) VALUES(?,?, ?, ?, 'pending', ?, ?)",
        )
        .run(
          work.workId,
          project.projectId,
          work.kind,
          JSON.stringify({
            _tag:
              work.kind === 'projectStage'
                ? 'RunProcessingProjectStage'
                : 'ApplyProcessingDevelopPreview',
            projectId: project.projectId,
            projectRevision: project.revision,
            attemptId: work.attemptId,
            stage: work.stage,
          }),
          work.stage,
          new Date().toISOString(),
        )
    database.exec('COMMIT')
    return response
  } catch {
    database.exec('ROLLBACK')
    return {
      outcome: 'rejected' as const,
      reason: 'ProjectPersistenceUnavailable',
    }
  }
}

function initialDevelopState(saved: {
  readonly assetId: typeof AssetId.Type
  readonly assetRevision: typeof AssetRevision.Type
  readonly checksum: string
  readonly stackingAttemptId: typeof ProcessingStageAttemptId.Type
  readonly stackResultId: typeof ProcessingStageResultId.Type
}) {
  return DevelopState.make({
    base: {
      assetId: saved.assetId,
      assetRevision: saved.assetRevision,
      checksum: saved.checksum,
      stackingAttemptId: saved.stackingAttemptId,
      stackResultId: saved.stackResultId,
    },
    draft: {
      revision: 0,
      operation: DevelopOperation.cases.Stretch.make({
        method: 'asinh',
        amount: 0.25,
      }),
      undo: [],
      redo: [],
    },
    attempts: [],
    history: [],
    historyCursor: 0,
    savedResults: [],
  })
}

function developAttemptActive(develop: typeof DevelopState.Type) {
  return develop.attempts.some(
    (attempt) => attempt.state === 'queued' || attempt.state === 'running',
  )
}

function withoutDevelopPreview(develop: typeof DevelopState.Type) {
  const { preview: _preview, ...rest } = develop
  return rest
}

function withoutDevelopFailure(develop: typeof DevelopState.Type) {
  const { failedAttemptId: _failedAttemptId, ...rest } = develop
  return rest
}

function currentDevelopEntry(develop: typeof DevelopState.Type) {
  return develop.historyCursor === 0
    ? undefined
    : develop.history[develop.historyCursor - 1]
}

function currentDevelopCheckpoint(develop: typeof DevelopState.Type) {
  const entry = currentDevelopEntry(develop)
  return (
    entry ?? {
      checkpointId: CheckpointId.make(`develop-base-${develop.base.assetId}`),
      checksum: develop.base.checksum,
    }
  )
}

function developStarPair(develop: typeof DevelopState.Type) {
  const entry = currentDevelopEntry(develop)
  if (entry === undefined) return []
  const attempt = develop.attempts.find(
    (candidate) => candidate.attemptId === entry.attemptId,
  )
  const starless = attempt?.outputs.find(
    (output) => output.relation === 'starless',
  )
  const companion = attempt?.outputs.find(
    (output) => output.relation === 'starCompanion',
  )
  return starless === undefined || companion === undefined
    ? []
    : [starless.outputId, companion.outputId]
}

function digestJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function resolveSelection(
  database: DatabaseSync,
  selection: {
    readonly assetIds: ReadonlyArray<string>
    readonly captureSetIds: ReadonlyArray<string>
  },
) {
  const rows = Schema.decodeUnknownSync(Schema.Array(SourceRow))(
    database
      .prepare(
        `SELECT asset_id,revision,availability,comparison_group_id,captured_at,role,detail
         ,format FROM library_assets ORDER BY captured_at,asset_id`,
      )
      .all(),
  )
  const assetIds = new Set(selection.assetIds)
  const captureSets = new Set(selection.captureSetIds)
  return rows
    .map(projectSource)
    .filter(
      (source) =>
        assetIds.has(source.assetId) ||
        (source.captureSetId !== undefined &&
          captureSets.has(source.captureSetId)),
    )
}

function projectSource(row: typeof SourceRow.Type) {
  const detail = Schema.decodeUnknownSync(StoredDetail)(JSON.parse(row.detail))
  const suggestedRole = suggestedRoleFor(detail.capture?.frameType)
  const targetName = detail.targetName
  return ProcessingProjectSource.make({
    assetId: AssetId.make(row.asset_id),
    assetRevision: AssetRevision.make(row.revision),
    role: 'Unassigned',
    suggestedRole,
    libraryRole: row.role,
    libraryFormat: row.format,
    ...(detail.captureSetId === undefined
      ? {}
      : { captureSetId: detail.captureSetId }),
    ...(targetName === undefined ? {} : { targetName }),
    capturedAt: row.captured_at,
    ...(detail.checksum === undefined ? {} : { checksum: detail.checksum }),
    availability: row.availability,
    provenance: {
      ...detail.lineage,
      ...(detail.equipment ?? {}),
      ...(detail.capture === undefined
        ? {}
        : {
            exposureSeconds: detail.capture.exposureSeconds,
            filter: detail.capture.filter,
            binning: detail.capture.binning,
          }),
    },
    warnings: [],
  })
}

function suggestedRoleFor(
  frameType: 'light' | 'dark' | 'flat' | 'bias' | undefined,
): ProcessingSourceRole {
  if (frameType === 'light') return 'Lights'
  if (frameType === 'dark') return 'Darks'
  if (frameType === 'flat') return 'Flats'
  if (frameType === 'bias') return 'Bias'
  return 'Unassigned'
}

function assignSuggestedRoles(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
  existingTarget: string | undefined,
) {
  let target = existingTarget
  return sources.map((source) => {
    const desired = source.suggestedRole
    if (desired !== 'Lights')
      return ProcessingProjectSource.make({ ...source, role: desired })
    if (target === undefined) target = source.targetName
    const conflict =
      target !== undefined &&
      source.targetName !== undefined &&
      source.targetName !== target
    return ProcessingProjectSource.make({
      ...source,
      role: conflict ? 'Unassigned' : 'Lights',
      warnings: conflict
        ? [
            warning(
              'TargetConflict',
              [source.assetId],
              `${source.targetName} does not match project target ${target}; the frame remains Unassigned.`,
            ),
          ]
        : [],
    })
  })
}

function reviseProject(
  current: ProcessingProject,
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
  changes: Partial<ProcessingProject> = {},
) {
  return withProjectWarnings(
    ProcessingProject.make({
      ...current,
      revision: ProcessingProjectRevision.make(current.revision + 1),
      ...(current.targetName === undefined
        ? projectTarget(sources)
        : { targetName: current.targetName }),
      sources,
      ...changes,
      stages: recomputeLineage(changes.stages ?? current.stages, sources),
      warnings: [],
      updatedAt: new Date().toISOString(),
    }),
  )
}

function initialStages(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type> = [],
) {
  return (['Calibration', 'Registration', 'Stacking'] as const).map((stage) =>
    ProcessingStageState.make({
      stage,
      draft: {
        revision: 0,
        settings:
          stage === 'Calibration'
            ? [
                { key: 'operation', value: 'calibrate-and-debayer' },
                { key: 'allowUncalibrated', value: 'true' },
              ]
            : stage === 'Registration'
              ? [
                  { key: 'referenceAssetId', value: 'auto' },
                  { key: 'alignmentModel', value: 'translation' },
                  { key: 'starDetection', value: 'balanced' },
                ]
              : [
                  { key: 'weighting', value: 'equal' },
                  { key: 'rejection', value: 'winsorized-sigma' },
                ],
        overrides: [],
        registrationInclusions: [],
        stackingFrameChoices: [],
        undo: [],
        redo: [],
      },
      attempts: [],
      calibrationRecommendations:
        stage === 'Calibration' ? calibrationRecommendations(sources) : [],
      stackingRecommendations: [],
    }),
  )
}

function replaceStage(
  stages: ProcessingProject['stages'],
  replacement: ProcessingProject['stages'][number],
) {
  return stages.map((stage) =>
    stage.stage === replacement.stage ? replacement : stage,
  )
}

function upstreamAttempt(
  project: ProcessingProject,
  stage: 'Calibration' | 'Registration' | 'Stacking',
) {
  if (stage === 'Calibration') return undefined
  const upstreamStage =
    stage === 'Registration' ? 'Calibration' : 'Registration'
  const upstream = project.stages.find((item) => item.stage === upstreamStage)
  const attempt = upstream?.attempts.find(
    (item) => item.attemptId === upstream.selectedAttemptId,
  )
  return attempt?.state === 'succeeded' && !attempt.basedOnEarlierUpstream
    ? attempt.attemptId
    : undefined
}

function registrationReference(
  settings: ReadonlyArray<{ readonly key: string; readonly value: string }>,
  upstream: typeof ProcessingStageAttempt.Type | undefined,
) {
  const outputs = upstream?.outputs ?? []
  const selected =
    settings.find((setting) => setting.key === 'referenceAssetId')?.value ??
    'auto'
  return selected === 'auto'
    ? outputs[0]
    : outputs.find((output) => output.sourceAssetId === selected)
}

export function settleProcessingProjectStage(
  database: DatabaseSync,
  workId: string,
  claimToken: string,
  checksum: string,
  artifactPath: string,
) {
  const row = Schema.decodeUnknownSync(Schema.optional(ProjectStageWorkRow))(
    database
      .prepare(
        'SELECT session_id,payload,state,claim_token FROM processing_work WHERE work_id=?',
      )
      .get(workId),
  )
  if (
    row === undefined ||
    row.state !== 'claimed' ||
    row.claim_token !== claimToken
  )
    return { outcome: 'stale' as const }
  const payload = Schema.decodeUnknownSync(ProjectStageWorkPayload)(
    JSON.parse(row.payload),
  )
  const project = processingProjects(database).find(
    (item) => item.projectId === row.session_id,
  )
  if (project === undefined) return { outcome: 'stale' as const }
  const stage = project.stages.find((item) => item.stage === payload.stage)
  const attempt = stage?.attempts.find(
    (item) => item.attemptId === payload.attemptId,
  )
  if (
    stage === undefined ||
    attempt === undefined ||
    attempt.state !== 'queued'
  )
    return { outcome: 'stale' as const }
  const now = new Date().toISOString()
  const calibrationEvidence =
    attempt.stage === 'Calibration'
      ? calibrationAttemptEvidence(
          project,
          attempt,
          checksum,
          artifactPath,
          claimToken,
        )
      : undefined
  const registrationEvidence =
    attempt.stage === 'Registration'
      ? registrationAttemptEvidence(
          project,
          attempt,
          checksum,
          artifactPath,
          claimToken,
        )
      : undefined
  const stackingEvidence =
    attempt.stage === 'Stacking'
      ? stackingAttemptEvidence(
          project,
          attempt,
          checksum,
          artifactPath,
          claimToken,
        )
      : undefined
  const calibration =
    calibrationEvidence === undefined
      ? undefined
      : {
          stageOutcome: calibrationEvidence.stageOutcome,
          frameOutcomes: calibrationEvidence.frameOutcomes,
          outputs: calibrationEvidence.outputs,
          diagnostics: calibrationEvidence.diagnostics,
        }
  const registration =
    registrationEvidence === undefined
      ? undefined
      : {
          stageOutcome: registrationEvidence.stageOutcome,
          frameOutcomes: registrationEvidence.frameOutcomes,
          outputs: registrationEvidence.outputs,
          diagnostics: registrationEvidence.diagnostics,
          registrationTransforms: registrationEvidence.transforms,
          viableAssetIds: registrationEvidence.viableAssetIds,
        }
  const stacking =
    stackingEvidence === undefined
      ? undefined
      : {
          stageOutcome: stackingEvidence.stageOutcome,
          frameOutcomes: stackingEvidence.frameOutcomes,
          diagnostics: stackingEvidence.diagnostics,
          ...(stackingEvidence.stackingOutput === undefined
            ? {}
            : { stackingOutput: stackingEvidence.stackingOutput }),
        }
  const evidence = calibration ?? registration ?? stacking
  const successful =
    stacking !== undefined
      ? stacking.stackingOutput !== undefined
      : evidence === undefined ||
        ('outputs' in evidence &&
          evidence.outputs.length > 0 &&
          (registration === undefined ||
            registration.viableAssetIds.length > 0))
  const completed = ProcessingStageAttempt.make({
    ...attempt,
    state: successful ? 'succeeded' : 'failed',
    ...(successful
      ? {
          resultId: ProcessingStageResultId.make(
            `stage-result-${attempt.attemptId}`,
          ),
          outputChecksum: checksum,
        }
      : {}),
    ...(evidence ?? {
      stageOutcome: 'Succeeded' as const,
      frameOutcomes: [],
      outputs: [],
      diagnostics: [],
      registrationTransforms: [],
      viableAssetIds: [],
      stackingRecommendations: attempt.stackingRecommendations,
      stackingFrameChoices: attempt.stackingFrameChoices,
      stackingInputAssetIds: attempt.stackingInputAssetIds,
    }),
    startedAt: now,
    completedAt: now,
  })
  const selectedStages = replaceStage(project.stages, {
    ...stage,
    attempts: stage.attempts.map((item) =>
      item.attemptId === attempt.attemptId ? completed : item,
    ),
    ...(completed.state === 'succeeded'
      ? { selectedAttemptId: attempt.attemptId }
      : {}),
  })
  const settledProject = reviseProject(project, project.sources, {
    stages: selectedStages,
  })
  database.exec('BEGIN IMMEDIATE')
  try {
    const changed = database
      .prepare(
        `UPDATE processing_work SET state=?,settled_at=?,checkpoint=? WHERE work_id=? AND state='claimed' AND claim_token=?`,
      )
      .run(
        completed.state === 'succeeded' ? 'settled' : 'failed',
        now,
        completed.state === 'succeeded' ? 'complete' : 'failed',
        workId,
        claimToken,
      )
    if (changed.changes !== 1) throw new Error('stale project stage settlement')
    database
      .prepare(
        'UPDATE processing_projects SET revision=?,project=?,updated_at=? WHERE project_id=? AND revision=?',
      )
      .run(
        settledProject.revision,
        JSON.stringify(settledProject),
        settledProject.updatedAt,
        settledProject.projectId,
        project.revision,
      )
    database
      .prepare(
        'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
      )
      .run(
        `${workId}:evidence`,
        settledProject.projectId,
        workId,
        `stage-evidence-${workId}`,
        artifactPath,
        checksum,
      )
    for (const [index, artifact] of (
      calibrationEvidence?.outputArtifacts ?? []
    ).entries()) {
      database
        .prepare(
          'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
        )
        .run(
          `${workId}:calibration:${artifact.sourceAssetId}`,
          settledProject.projectId,
          workId,
          `calibration-output-${attempt.attemptId}-${index + 1}`,
          artifact.path,
          artifact.checksum,
        )
    }
    for (const [index, artifact] of (
      registrationEvidence?.outputArtifacts ?? []
    ).entries())
      database
        .prepare(
          'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
        )
        .run(
          `${workId}:registration:${artifact.sourceAssetId}`,
          settledProject.projectId,
          workId,
          `registration-transform-${attempt.attemptId}-${index + 1}`,
          artifact.path,
          artifact.checksum,
        )
    if (stackingEvidence?.outputArtifact !== undefined)
      database
        .prepare(
          'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
        )
        .run(
          `${workId}:stacking:master`,
          settledProject.projectId,
          workId,
          `stack-output-${attempt.attemptId}`,
          stackingEvidence.outputArtifact.path,
          stackingEvidence.outputArtifact.checksum,
        )
    database.exec('COMMIT')
    return {
      outcome: 'settled' as const,
      stageOutcome: completed.stageOutcome ?? 'Succeeded',
    }
  } catch {
    database.exec('ROLLBACK')
    return { outcome: 'stale' as const }
  }
}

export function settleProcessingProjectDevelop(
  database: DatabaseSync,
  workId: string,
  claimToken: string,
  evidencePath: string,
) {
  const row = Schema.decodeUnknownSync(Schema.optional(ProjectStageWorkRow))(
    database
      .prepare(
        'SELECT session_id,payload,state,claim_token FROM processing_work WHERE work_id=?',
      )
      .get(workId),
  )
  if (
    row === undefined ||
    row.state !== 'claimed' ||
    row.claim_token !== claimToken
  )
    return { outcome: 'stale' as const }
  const payload = Schema.decodeUnknownSync(ProjectDevelopWorkPayload)(
    JSON.parse(row.payload),
  )
  const project = processingProjects(database).find(
    (candidate) => candidate.projectId === payload.projectId,
  )
  const develop = project?.develop
  const attempt = develop?.attempts.find(
    (candidate) => candidate.attemptId === payload.attemptId,
  )
  if (
    project === undefined ||
    develop === undefined ||
    attempt === undefined ||
    attempt.state !== 'queued'
  )
    return { outcome: 'stale' as const }
  const inputOutputId =
    attempt.inputCheckpointId ===
    CheckpointId.make(`develop-base-${develop.base.assetId}`)
      ? `stack-output-${develop.base.stackingAttemptId}`
      : develop.history.find(
          (entry) => entry.checkpointId === attempt.inputCheckpointId,
        )?.outputId
  const inputArtifact =
    inputOutputId === undefined
      ? undefined
      : Schema.decodeUnknownSync(Schema.optional(DevelopArtifactRow))(
          database
            .prepare(
              'SELECT path,checksum FROM processing_artifacts WHERE session_id=? AND output_id=?',
            )
            .get(project.projectId, inputOutputId),
        )
  const relatedArtifacts = attempt.relatedInputOutputIds.map((outputId) =>
    Schema.decodeUnknownSync(Schema.optional(DevelopArtifactRow))(
      database
        .prepare(
          'SELECT path,checksum FROM processing_artifacts WHERE session_id=? AND output_id=?',
        )
        .get(project.projectId, outputId),
    ),
  )
  const inputAvailable =
    inputArtifact !== undefined &&
    inputArtifact.checksum === attempt.inputChecksum &&
    existsSync(inputArtifact.path) &&
    relatedArtifacts.every(
      (artifact) => artifact !== undefined && existsSync(artifact.path),
    )
  const now = new Date().toISOString()
  let outputs: ReadonlyArray<typeof DevelopOutput.Type> = []
  const outputArtifacts: Array<{
    readonly outputId: typeof ProcessingOutputId.Type
    readonly path: string
    readonly checksum: string
  }> = []
  if (inputAvailable) {
    const relations = DevelopOperation.guards.RemoveStars(attempt.operation)
      ? (['starless', 'starCompanion'] as const)
      : (['developed'] as const)
    outputs = relations.map((relation) => {
      const outputId = ProcessingOutputId.make(
        `develop-output-${attempt.attemptId}-${relation}`,
      )
      const frozen = {
        kind: 'deterministicDevelopEvidence',
        base: develop.base,
        inputCheckpointId: attempt.inputCheckpointId,
        inputChecksum: attempt.inputChecksum,
        relatedInputOutputIds: attempt.relatedInputOutputIds,
        operation: attempt.operation,
        toolIdentity: attempt.toolIdentity,
        relation,
      }
      const bytes = deterministicFitsBytes(frozen)
      const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
      const path = `${evidencePath}.develop.${relation}.fits`
      retainAtomicBytes(path, bytes, claimToken, 'Develop output')
      outputArtifacts.push({ outputId, path, checksum })
      return DevelopOutput.make({
        outputId,
        checksum,
        format: 'fits',
        relation,
        diagnostic:
          'Deterministic 1 x 1 FITS evidence; not an astronomy-quality image.',
      })
    })
  }
  const completed = DevelopAttempt.make({
    ...attempt,
    state: inputAvailable ? 'succeeded' : 'failed',
    outputs,
    diagnostics: inputAvailable
      ? [
          'Deterministic Develop evidence only; astronomy processing quality is not claimed.',
          ...(DevelopOperation.guards.RemoveStars(attempt.operation)
            ? [
                'Starless and star-companion outputs are retained as one related pair.',
              ]
            : DevelopOperation.guards.AddStars(attempt.operation)
              ? [
                  'The exact retained starless and star-companion pair was consumed.',
                ]
              : []),
        ]
      : [
          'The exact input checkpoint bytes are unavailable or do not match the frozen checksum.',
        ],
    startedAt: now,
    completedAt: now,
  })
  const primary = completed.outputs.find(
    (output) => output.relation !== 'starCompanion',
  )
  const branch = develop.history.slice(0, develop.historyCursor)
  const history =
    completed.state === 'succeeded' && primary !== undefined
      ? [
          ...branch,
          DevelopHistoryEntry.make({
            checkpointId: CheckpointId.make(
              `develop-checkpoint-${attempt.attemptId}`,
            ),
            attemptId: attempt.attemptId,
            outputId: primary.outputId,
            checksum: primary.checksum,
            operation: attempt.operation,
            relatedOutputIds: completed.outputs.map(
              (output) => output.outputId,
            ),
          }),
        ]
      : develop.history
  const nextDevelop = DevelopState.make({
    ...(completed.state === 'succeeded'
      ? withoutDevelopFailure(withoutDevelopPreview(develop))
      : develop),
    attempts: develop.attempts.map((candidate) =>
      candidate.attemptId === attempt.attemptId ? completed : candidate,
    ),
    history,
    historyCursor:
      completed.state === 'succeeded' ? history.length : develop.historyCursor,
    ...(completed.state === 'failed'
      ? { failedAttemptId: completed.attemptId }
      : {}),
  })
  const settledProject = reviseProject(project, project.sources, {
    currentStage: 'Develop',
    develop: nextDevelop,
  })
  database.exec('BEGIN IMMEDIATE')
  try {
    const changed = database
      .prepare(
        `UPDATE processing_work SET state=?,settled_at=?,checkpoint=? WHERE work_id=? AND state='claimed' AND claim_token=?`,
      )
      .run(
        completed.state === 'succeeded' ? 'settled' : 'failed',
        now,
        completed.state === 'succeeded' ? 'complete' : 'failed',
        workId,
        claimToken,
      )
    if (changed.changes !== 1) throw new Error('stale Develop settlement')
    const updated = database
      .prepare(
        'UPDATE processing_projects SET revision=?,project=?,updated_at=? WHERE project_id=? AND revision=?',
      )
      .run(
        settledProject.revision,
        JSON.stringify(settledProject),
        settledProject.updatedAt,
        settledProject.projectId,
        project.revision,
      )
    if (updated.changes !== 1) throw new Error('stale Develop project')
    database
      .prepare(
        'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
      )
      .run(
        `${workId}:evidence`,
        project.projectId,
        workId,
        `develop-evidence-${attempt.attemptId}`,
        evidencePath,
        `sha256:${createHash('sha256').update(readFileSync(evidencePath)).digest('hex')}`,
      )
    for (const artifact of outputArtifacts)
      database
        .prepare(
          'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
        )
        .run(
          `${workId}:${artifact.outputId}`,
          project.projectId,
          workId,
          artifact.outputId,
          artifact.path,
          artifact.checksum,
        )
    database.exec('COMMIT')
    return {
      outcome: 'settled' as const,
      successful: completed.state === 'succeeded',
    }
  } catch {
    database.exec('ROLLBACK')
    return { outcome: 'stale' as const }
  }
}

function deterministicFitsBytes(value: unknown) {
  const pixel = createHash('sha256')
    .update(JSON.stringify(value))
    .digest()
    .readUInt16BE(0)
  const card = (key: string, cardValue: string) =>
    `${key.padEnd(8, ' ')}= ${cardValue}`.padEnd(80, ' ')
  const header = [
    card('SIMPLE', '                    T'),
    card('BITPIX', '                   16'),
    card('NAXIS', '                    2'),
    card('NAXIS1', '                    1'),
    card('NAXIS2', '                    1'),
    card('BZERO', '                32768'),
    card('BSCALE', '                    1'),
    'END'.padEnd(80, ' '),
  ]
    .join('')
    .padEnd(2880, ' ')
  const data = Buffer.alloc(2880)
  data.writeUInt16BE(pixel, 0)
  return Buffer.concat([Buffer.from(header, 'ascii'), data])
}

function retainAtomicBytes(
  path: string,
  bytes: Buffer,
  claimToken: string,
  label: string,
) {
  if (!existsSync(path)) {
    const temporaryPath = `${path}.${claimToken}.tmp`
    if (existsSync(temporaryPath)) {
      if (!readFileSync(temporaryPath).equals(bytes))
        throw new Error(`temporary ${label} does not match frozen evidence`)
    } else writeFileSync(temporaryPath, bytes, { flag: 'wx' })
    renameSync(temporaryPath, path)
  }
  if (!readFileSync(path).equals(bytes))
    throw new Error(`retained ${label} does not match frozen evidence`)
}

function calibrationAttemptEvidence(
  project: ProcessingProject,
  attempt: typeof ProcessingStageAttempt.Type,
  evidenceChecksum: string,
  artifactPath: string,
  claimToken: string,
) {
  const sources = new Map(
    project.sources.map((source) => [source.assetId, source]),
  )
  const overrideIds = new Set(
    attempt.overrides.map((override) => override.assetId),
  )
  const usableSupport = attempt.recommendations.filter(
    (recommendation) =>
      recommendation.decision === 'Include' ||
      (recommendation.decision === 'Review' &&
        overrideIds.has(recommendation.assetId)),
  )
  const adapterFailure = attempt.settings.some(
    (setting) => setting.key === 'adapterMode' && setting.value === 'fail',
  )
  const allowUncalibrated =
    attempt.settings.find((setting) => setting.key === 'allowUncalibrated')
      ?.value !== 'false'
  const outputArtifacts: Array<{
    sourceAssetId: typeof AssetId.Type
    sourceAssetRevision: typeof AssetRevision.Type
    path: string
    checksum: string
  }> = []
  const frameOutcomes = attempt.sourceRevisions
    .filter((source) => source.role === 'Lights')
    .map((input) => {
      const source = sources.get(input.assetId)
      if (
        source === undefined ||
        !isCalibrationInputSource(source) ||
        (source.availability !== 'availableLocally' &&
          source.availability !== 'published')
      )
        return {
          assetId: input.assetId,
          assetRevision: input.assetRevision,
          outcome: 'Unavailable' as const,
          message:
            source !== undefined && !isCalibrationInputSource(source)
              ? 'The frozen Light is not an original camera-raw or FITS Library asset.'
              : 'The frozen Light bytes are not currently readable.',
          diagnostic:
            source !== undefined && !isCalibrationInputSource(source)
              ? 'CalibrationInputUnsupported'
              : 'SourceBytesUnavailable',
        }
      if (adapterFailure)
        return {
          assetId: input.assetId,
          assetRevision: input.assetRevision,
          outcome: 'Failed' as const,
          message:
            'The deterministic Calibration adapter reported a bounded failure.',
          diagnostic: 'DeterministicAdapterFailure',
        }
      const matchingSupport = usableSupport.filter(
        (support) =>
          support.matchedLightAssetIds.includes(input.assetId) ||
          overrideIds.has(support.assetId),
      )
      const warning = matchingSupport.length === 0
      if (warning && !allowUncalibrated)
        return {
          assetId: input.assetId,
          assetRevision: input.assetRevision,
          outcome: 'Failed' as const,
          message:
            'No compatible or explicitly included mismatched support was selected and uncalibrated continuation is disabled.',
          diagnostic: 'CalibrationSupportRequired',
        }
      const outputBytes = JSON.stringify({
        kind: 'deterministicCalibrationEvidence',
        sourceAssetId: input.assetId,
        sourceAssetRevision: input.assetRevision,
        frozenEvidenceChecksum: evidenceChecksum,
        settings: attempt.settings,
        recommendations: attempt.recommendations,
        overrides: attempt.overrides,
        toolIdentity: attempt.toolIdentity,
      })
      const outputChecksum = `sha256:${createHash('sha256')
        .update(outputBytes)
        .digest('hex')}`
      const outputPath = `${artifactPath}.${outputArtifacts.length + 1}.calibration.json`
      if (!existsSync(outputPath)) {
        const temporaryPath = `${outputPath}.${claimToken}.tmp`
        if (existsSync(temporaryPath)) {
          if (readFileSync(temporaryPath, 'utf8') !== outputBytes)
            throw new Error(
              'temporary Calibration output does not match frozen evidence',
            )
        } else writeFileSync(temporaryPath, outputBytes, { flag: 'wx' })
        renameSync(temporaryPath, outputPath)
      }
      const retainedBytes = readFileSync(outputPath, 'utf8')
      if (retainedBytes !== outputBytes)
        throw new Error(
          'retained Calibration output does not match frozen evidence',
        )
      const retainedChecksum = `sha256:${createHash('sha256')
        .update(retainedBytes)
        .digest('hex')}`
      if (retainedChecksum !== outputChecksum)
        throw new Error('retained Calibration output checksum mismatch')
      outputArtifacts.push({
        sourceAssetId: input.assetId,
        sourceAssetRevision: input.assetRevision,
        path: outputPath,
        checksum: outputChecksum,
      })
      return {
        assetId: input.assetId,
        assetRevision: input.assetRevision,
        outcome: warning ? ('Warning' as const) : ('Succeeded' as const),
        message: warning
          ? 'Calibration continued without compatible support under the retained draft setting.'
          : 'The deterministic adapter used compatible or explicitly included mismatched support.',
        outputChecksum,
      }
    })
  const outputs = frameOutcomes.flatMap((outcome) =>
    outcome.outputChecksum === undefined
      ? []
      : [
          {
            sourceAssetId: outcome.assetId,
            sourceAssetRevision: outcome.assetRevision,
            checksum: outcome.outputChecksum,
            format: 'deterministicEvidenceJson' as const,
          },
        ],
  )
  const stageOutcome =
    outputs.length === 0
      ? frameOutcomes.some((outcome) => outcome.outcome === 'Unavailable')
        ? ('Unavailable' as const)
        : ('Failed' as const)
      : frameOutcomes.some((outcome) => outcome.outcome !== 'Succeeded')
        ? ('Warning' as const)
        : ('Succeeded' as const)
  return {
    stageOutcome,
    frameOutcomes,
    outputs,
    diagnostics: [
      'Deterministic adapter evidence only; astronomy calibration quality is not claimed.',
      ...attempt.recommendations.flatMap((recommendation) =>
        recommendation.reasons.map(
          (reason) => `${recommendation.assetId}: ${reason}`,
        ),
      ),
    ],
    outputArtifacts,
  }
}

function registrationAttemptEvidence(
  project: ProcessingProject,
  attempt: typeof ProcessingStageAttempt.Type,
  evidenceChecksum: string,
  artifactPath: string,
  claimToken: string,
) {
  const calibration = project.stages
    .find((stage) => stage.stage === 'Calibration')
    ?.attempts.find(
      (candidate) => candidate.attemptId === attempt.upstreamAttemptId,
    )
  const reference = registrationReference(attempt.settings, calibration)
  if (calibration === undefined || reference === undefined)
    return {
      stageOutcome: 'Unavailable' as const,
      frameOutcomes: attempt.sourceRevisions.map((source) => ({
        assetId: source.assetId,
        assetRevision: source.assetRevision,
        outcome: 'Unavailable' as const,
        message: 'The exact selected Calibration output is unavailable.',
        diagnostic: 'CalibrationOutputUnavailable',
      })),
      outputs: [],
      diagnostics: [
        'Registration requires one exact selected Calibration result.',
      ],
      transforms: [],
      viableAssetIds: [],
      outputArtifacts: [],
    }
  const upstreamOutputs = new Map(
    calibration.outputs.map((output) => [output.sourceAssetId, output]),
  )
  const includedWarnings = new Set(
    attempt.registrationInclusions.map((choice) => choice.assetId),
  )
  const model =
    attempt.settings.find((setting) => setting.key === 'alignmentModel')
      ?.value === 'affine'
      ? ('affine' as const)
      : ('translation' as const)
  const strict =
    attempt.settings.find((setting) => setting.key === 'starDetection')
      ?.value === 'strict'
  const fail = attempt.settings.some(
    (setting) => setting.key === 'adapterMode' && setting.value === 'fail',
  )
  const partial = attempt.settings.some(
    (setting) => setting.key === 'adapterMode' && setting.value === 'partial',
  )
  const outputArtifacts: Array<{
    sourceAssetId: typeof AssetId.Type
    sourceAssetRevision: typeof AssetRevision.Type
    path: string
    checksum: string
  }> = []
  const transforms: Array<{
    assetId: typeof AssetId.Type
    assetRevision: typeof AssetRevision.Type
    referenceAssetId: typeof AssetId.Type
    referenceAssetRevision: typeof AssetRevision.Type
    model: 'translation' | 'affine'
    coefficients: ReadonlyArray<number>
    checksum: string
    usable: boolean
    diagnostic?: string
  }> = []
  const frameOutcomes = attempt.sourceRevisions.map((source, index) => {
    const upstream = upstreamOutputs.get(source.assetId)
    if (upstream === undefined)
      return {
        assetId: source.assetId,
        assetRevision: source.assetRevision,
        outcome: 'Unavailable' as const,
        message:
          'Calibration produced no readable output for this Light, so Registration has no input bytes.',
        diagnostic: 'CalibrationOutputUnavailable',
      }
    const isReference = source.assetId === reference.sourceAssetId
    if (fail || (!isReference && (partial || strict)))
      return {
        assetId: source.assetId,
        assetRevision: source.assetRevision,
        outcome: 'Failed' as const,
        message:
          'The deterministic adapter found no usable transform for this Light.',
        diagnostic: 'NoUsableTransform',
      }
    const warning = !isReference && index % 2 === 1
    const coefficients = isReference
      ? [1, 0, 0, 0, 1, 0]
      : model === 'affine'
        ? [1, 0.001, index, -0.001, 1, index * -0.5]
        : [1, 0, index, 0, 1, index * -0.5]
    const bytes = JSON.stringify({
      kind: 'deterministicRegistrationTransform',
      sourceAssetId: source.assetId,
      sourceAssetRevision: source.assetRevision,
      referenceAssetId: reference.sourceAssetId,
      referenceAssetRevision: reference.sourceAssetRevision,
      model,
      coefficients,
      upstreamAttemptId: attempt.upstreamAttemptId,
      upstreamChecksum: upstream.checksum,
      frozenEvidenceChecksum: evidenceChecksum,
      settings: attempt.settings,
      registrationInclusions: attempt.registrationInclusions,
      toolIdentity: attempt.toolIdentity,
    })
    const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    const path = `${artifactPath}.${outputArtifacts.length + 1}.registration.json`
    if (!existsSync(path)) {
      const temporaryPath = `${path}.${claimToken}.tmp`
      if (existsSync(temporaryPath)) {
        if (readFileSync(temporaryPath, 'utf8') !== bytes)
          throw new Error(
            'temporary Registration transform does not match frozen evidence',
          )
      } else writeFileSync(temporaryPath, bytes, { flag: 'wx' })
      renameSync(temporaryPath, path)
    }
    const retained = readFileSync(path, 'utf8')
    if (retained !== bytes)
      throw new Error(
        'retained Registration transform does not match frozen evidence',
      )
    if (
      `sha256:${createHash('sha256').update(retained).digest('hex')}` !==
      checksum
    )
      throw new Error('retained Registration transform checksum mismatch')
    outputArtifacts.push({
      sourceAssetId: source.assetId,
      sourceAssetRevision: source.assetRevision,
      path,
      checksum,
    })
    transforms.push({
      assetId: source.assetId,
      assetRevision: source.assetRevision,
      referenceAssetId: reference.sourceAssetId,
      referenceAssetRevision: reference.sourceAssetRevision,
      model,
      coefficients,
      checksum,
      usable: true,
      ...(warning ? { diagnostic: 'AlignmentNeedsReview' } : {}),
    })
    return {
      assetId: source.assetId,
      assetRevision: source.assetRevision,
      outcome: warning ? ('Warning' as const) : ('Succeeded' as const),
      message: warning
        ? includedWarnings.has(source.assetId)
          ? 'A usable transform was retained and this Light is included despite the alignment warning.'
          : 'A usable transform was retained, but this Light stays out of the next Stack input until included.'
        : isReference
          ? 'This exact calibrated Light is the Registration reference.'
          : 'The deterministic adapter retained a usable transform.',
      outputChecksum: checksum,
      ...(warning ? { diagnostic: 'AlignmentNeedsReview' } : {}),
    }
  })
  const outputs = transforms.map((transform) => ({
    sourceAssetId: transform.assetId,
    sourceAssetRevision: transform.assetRevision,
    checksum: transform.checksum,
    format: 'deterministicEvidenceJson' as const,
  }))
  const viableAssetIds = frameOutcomes.flatMap((outcome) =>
    outcome.outcome === 'Succeeded' ||
    (outcome.outcome === 'Warning' && includedWarnings.has(outcome.assetId))
      ? [outcome.assetId]
      : [],
  )
  const stageOutcome =
    viableAssetIds.length === 0
      ? frameOutcomes.some((outcome) => outcome.outcome === 'Unavailable')
        ? ('Unavailable' as const)
        : ('Failed' as const)
      : frameOutcomes.some((outcome) => outcome.outcome !== 'Succeeded')
        ? ('Warning' as const)
        : ('Succeeded' as const)
  return {
    stageOutcome,
    frameOutcomes,
    outputs,
    diagnostics: [
      'Deterministic transform evidence only; astronomy registration quality is not claimed.',
      `${viableAssetIds.length} Light${viableAssetIds.length === 1 ? '' : 's'} selected for the next Stack input.`,
    ],
    transforms,
    viableAssetIds,
    outputArtifacts,
  }
}

function stackingAttemptEvidence(
  project: ProcessingProject,
  attempt: typeof ProcessingStageAttempt.Type,
  evidenceChecksum: string,
  artifactPath: string,
  claimToken: string,
): StackingAttemptEvidence {
  const registration = project.stages
    .find((stage) => stage.stage === 'Registration')
    ?.attempts.find(
      (candidate) => candidate.attemptId === attempt.upstreamAttemptId,
    )
  const transforms = new Map(
    registration?.registrationTransforms.map((transform) => [
      transform.assetId,
      transform,
    ]) ?? [],
  )
  const frameOutcomes = attempt.stackingRecommendations.map(
    (recommendation) => {
      const included = attempt.stackingInputAssetIds.includes(
        recommendation.assetId,
      )
      const transform = transforms.get(recommendation.assetId)
      if (
        registration === undefined ||
        transform?.usable !== true ||
        !registration.viableAssetIds.includes(recommendation.assetId)
      )
        return {
          assetId: recommendation.assetId,
          assetRevision: recommendation.assetRevision,
          outcome: 'Unavailable' as const,
          message:
            'This Light has no usable transform in the exact Registration result.',
          diagnostic: 'RegistrationTransformUnavailable',
        }
      return {
        assetId: recommendation.assetId,
        assetRevision: recommendation.assetRevision,
        outcome:
          recommendation.decision === 'Review' && included
            ? ('Warning' as const)
            : ('Succeeded' as const),
        message: included
          ? recommendation.decision === 'Review'
            ? 'This technically usable Light is included after operator review.'
            : 'This technically usable Light is included in the Stack.'
          : 'This technically usable Light remains outside this Stack attempt.',
        ...(recommendation.decision === 'Review' && included
          ? { diagnostic: 'IncludedAfterReview' }
          : {}),
      }
    },
  )
  const included = attempt.stackingInputAssetIds.filter(
    (assetId) => transforms.get(assetId)?.usable === true,
  )
  if (registration === undefined || included.length === 0)
    return {
      stageOutcome: 'Unavailable' as const,
      frameOutcomes,
      diagnostics: [
        'The exact selected Registration result has no usable Stack input.',
      ],
    }
  const frozen = JSON.stringify({
    kind: 'deterministicStackingEvidence',
    upstreamAttemptId: attempt.upstreamAttemptId,
    includedAssetIds: included,
    transforms: included.map((assetId) => transforms.get(assetId)?.checksum),
    settings: attempt.settings,
    recommendations: attempt.stackingRecommendations,
    choices: attempt.stackingFrameChoices,
    toolIdentity: attempt.toolIdentity,
    evidenceChecksum,
  })
  const pixel = createHash('sha256').update(frozen).digest().readUInt16BE(0)
  const card = (key: string, value: string) =>
    `${key.padEnd(8, ' ')}= ${value}`.padEnd(80, ' ')
  const header = [
    card('SIMPLE', '                    T'),
    card('BITPIX', '                   16'),
    card('NAXIS', '                    2'),
    card('NAXIS1', '                    1'),
    card('NAXIS2', '                    1'),
    card('BZERO', '                32768'),
    card('BSCALE', '                    1'),
    'END'.padEnd(80, ' '),
  ]
    .join('')
    .padEnd(2880, ' ')
  const data = Buffer.alloc(2880)
  data.writeUInt16BE(pixel, 0)
  const bytes = Buffer.concat([Buffer.from(header, 'ascii'), data])
  const outputChecksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const path = `${artifactPath}.stacking.fits`
  if (!existsSync(path)) {
    const temporaryPath = `${path}.${claimToken}.tmp`
    if (existsSync(temporaryPath)) {
      if (!readFileSync(temporaryPath).equals(bytes))
        throw new Error('temporary Stack output does not match frozen evidence')
    } else writeFileSync(temporaryPath, bytes, { flag: 'wx' })
    renameSync(temporaryPath, path)
  }
  if (!readFileSync(path).equals(bytes))
    throw new Error('retained Stack output does not match frozen evidence')
  return {
    stageOutcome: frameOutcomes.some((outcome) => outcome.outcome === 'Warning')
      ? ('Warning' as const)
      : ('Succeeded' as const),
    frameOutcomes,
    diagnostics: [
      'Deterministic FITS evidence only; astronomy stacking quality is not claimed.',
      `${included.length} Light${included.length === 1 ? '' : 's'} contributed to this versioned Stack result.`,
    ],
    stackingOutput: {
      checksum: outputChecksum,
      format: 'fits' as const,
      includedAssetIds: included,
      diagnostic:
        'Deterministic 1 x 1 FITS evidence; not an astronomy-quality image.',
    },
    outputArtifact: { path, checksum: outputChecksum },
  }
}

function recomputeLineage(
  stages: ProcessingProject['stages'],
  sources: ProcessingProject['sources'],
) {
  const exactSources = sources.map((source) => ({
    assetId: source.assetId,
    assetRevision: source.assetRevision,
    role: source.role,
  }))
  const calibration = stages.find((stage) => stage.stage === 'Calibration')
  const recommendations = calibrationRecommendations(sources)
  const advisoryIds = new Set(
    recommendations
      .filter(
        (recommendation) =>
          recommendation.compatibility === 'Advisory mismatch',
      )
      .map((recommendation) => recommendation.assetId),
  )
  const retainCurrentOverrides = (snapshot: {
    settings: ReadonlyArray<{ readonly key: string; readonly value: string }>
    overrides: ReadonlyArray<typeof CalibrationOverride.Type>
    registrationInclusions: ReadonlyArray<
      typeof RegistrationFrameInclusion.Type
    >
    stackingFrameChoices: ReadonlyArray<typeof StackingFrameChoice.Type>
  }) => ({
    ...snapshot,
    overrides: snapshot.overrides.filter((override) =>
      advisoryIds.has(override.assetId),
    ),
  })
  const calibrated = calibration && {
    ...calibration,
    draft: {
      ...calibration.draft,
      overrides: calibration.draft.overrides.filter((override) =>
        advisoryIds.has(override.assetId),
      ),
      undo: calibration.draft.undo.map(retainCurrentOverrides),
      redo: calibration.draft.redo.map(retainCurrentOverrides),
    },
    attempts: calibration.attempts.map((attempt) => ({
      ...attempt,
      basedOnEarlierUpstream:
        JSON.stringify(attempt.sourceRevisions) !==
        JSON.stringify(exactSources),
    })),
  }
  const selectedCalibration = calibrated?.attempts.find(
    (attempt) => attempt.attemptId === calibrated.selectedAttemptId,
  )
  const registration = stages.find((stage) => stage.stage === 'Registration')
  const registered = registration && {
    ...registration,
    attempts: registration.attempts.map((attempt) => ({
      ...attempt,
      basedOnEarlierUpstream:
        selectedCalibration?.state !== 'succeeded' ||
        selectedCalibration.basedOnEarlierUpstream ||
        attempt.upstreamAttemptId !== selectedCalibration.attemptId,
    })),
  }
  const selectedRegistration = registered?.attempts.find(
    (attempt) => attempt.attemptId === registered.selectedAttemptId,
  )
  const stackRecommendations = stackingRecommendations(selectedRegistration)
  const stackIds = new Set(
    stackRecommendations
      .filter((recommendation) => recommendation.technicallyUsable)
      .map((recommendation) => recommendation.assetId),
  )
  return stages.map((stage) =>
    stage.stage === 'Calibration'
      ? {
          ...(calibrated ?? stage),
          calibrationRecommendations: recommendations,
        }
      : stage.stage === 'Registration'
        ? (registered ?? stage)
        : {
            ...stage,
            stackingRecommendations: stackRecommendations,
            draft: {
              ...stage.draft,
              stackingFrameChoices: stage.draft.stackingFrameChoices.filter(
                (choice) => stackIds.has(choice.assetId),
              ),
            },
            attempts: stage.attempts.map((attempt) => ({
              ...attempt,
              basedOnEarlierUpstream:
                selectedRegistration?.state !== 'succeeded' ||
                selectedRegistration.basedOnEarlierUpstream ||
                attempt.upstreamAttemptId !== selectedRegistration.attemptId,
            })),
          },
  )
}

function stackingRecommendations(
  registration: typeof ProcessingStageAttempt.Type | undefined,
) {
  if (registration?.state !== 'succeeded') return []
  const viable = new Set(registration.viableAssetIds)
  return registration.registrationTransforms.map((transform, index) =>
    StackingRecommendation.make({
      assetId: transform.assetId,
      assetRevision: transform.assetRevision,
      technicallyUsable: transform.usable && viable.has(transform.assetId),
      decision:
        !transform.usable || !viable.has(transform.assetId)
          ? 'Exclude'
          : index % 3 === 0
            ? 'Include'
            : index % 3 === 1
              ? 'Review'
              : 'Exclude',
      reasons: [
        !transform.usable || !viable.has(transform.assetId)
          ? 'This Light has no transform in the exact viable Registration subset.'
          : index % 3 === 0
            ? 'The retained transform is usable and this frame is recommended for the Stack.'
            : index % 3 === 1
              ? 'The retained transform is usable; review this frame before adding its signal.'
              : 'The retained transform is usable, but the deterministic quality review recommends leaving it out.',
      ],
    }),
  )
}

function calibrationRecommendations(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
) {
  const lights = sources.filter((source) => source.role === 'Lights')
  return sources
    .filter(
      (source) => source.role !== 'Lights' && source.role !== 'Unassigned',
    )
    .map((source) => calibrationRecommendation(source, lights))
}

function calibrationRecommendation(
  source: typeof ProcessingProjectSource.Type,
  lights: ReadonlyArray<typeof ProcessingProjectSource.Type>,
) {
  if (!isCalibrationInputSource(source))
    return CalibrationRecommendation.make({
      assetId: source.assetId,
      assetRevision: source.assetRevision,
      role: source.role,
      decision: 'Exclude',
      compatibility: 'Technically unavailable',
      reasons: [
        source.libraryRole === 'unknown' || source.libraryFormat === 'unknown'
          ? 'The exact Library role or format is unavailable, so this source cannot be used for Calibration.'
          : `Calibration requires an original camera-raw or FITS asset; this source is ${source.libraryRole} / ${source.libraryFormat}.`,
      ],
      matchedLightAssetIds: [],
    })
  if (
    source.availability !== 'availableLocally' &&
    source.availability !== 'published'
  )
    return CalibrationRecommendation.make({
      assetId: source.assetId,
      assetRevision: source.assetRevision,
      role: source.role,
      decision: 'Exclude',
      compatibility: 'Technically unavailable',
      reasons: ['The retained source bytes are not currently readable.'],
      matchedLightAssetIds: [],
    })
  const matched: Array<typeof AssetId.Type> = []
  const mismatches: Array<string> = []
  for (const light of lights) {
    const facts = compatibilityFacts(source, light)
    if (facts.length === 0) matched.push(light.assetId)
    else mismatches.push(...facts.map((fact) => `${light.assetId}: ${fact}`))
  }
  const reasons = [
    ...(mismatches.length === 0
      ? [
          'Retained exposure, filter, binning, and camera facts are compatible where applicable.',
        ]
      : mismatches),
    'Gain and temperature are not retained and were not evaluated.',
  ]
  return CalibrationRecommendation.make({
    assetId: source.assetId,
    assetRevision: source.assetRevision,
    role: source.role,
    decision: mismatches.length === 0 ? 'Include' : 'Review',
    compatibility: mismatches.length === 0 ? 'Compatible' : 'Advisory mismatch',
    reasons,
    matchedLightAssetIds: matched,
  })
}

function isCalibrationInputSource(source: typeof ProcessingProjectSource.Type) {
  return (
    source.libraryRole === 'original' &&
    (source.libraryFormat === 'cameraRaw' || source.libraryFormat === 'fits')
  )
}

function compatibilityFacts(
  support: typeof ProcessingProjectSource.Type,
  light: typeof ProcessingProjectSource.Type,
) {
  const facts: Array<string> = []
  const compare = (
    label: string,
    supportValue: string | number | undefined,
    lightValue: string | number | undefined,
  ) => {
    if (supportValue === undefined || lightValue === undefined)
      facts.push(`${label} is not retained for both sources`)
    else if (supportValue !== lightValue) facts.push(`${label} differs`)
  }
  compare('binning', support.provenance.binning, light.provenance.binning)
  compare(
    'camera identity',
    support.provenance.cameraDeviceId,
    light.provenance.cameraDeviceId,
  )
  if (support.role === 'Darks')
    compare(
      'exposure',
      support.provenance.exposureSeconds,
      light.provenance.exposureSeconds,
    )
  if (support.role === 'Flats' || support.role === 'Dark flats')
    compare('filter', support.provenance.filter, light.provenance.filter)
  return facts
}

function projectTarget(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
) {
  const targetName = sources.find(
    (source) => source.role === 'Lights' && source.targetName !== undefined,
  )?.targetName
  return targetName === undefined ? {} : { targetName }
}

function withProjectWarnings(project: ProcessingProject) {
  const warnings: Array<typeof ProcessingProjectWarning.Type> = []
  const lights = project.sources.filter((source) => source.role === 'Lights')
  const reference = lights[0]
  if (reference !== undefined) {
    const conflicts = lights.filter(
      (source) =>
        source.provenance.filter !== reference.provenance.filter ||
        source.provenance.binning !== reference.provenance.binning,
    )
    if (conflicts.length > 0)
      warnings.push(
        warning(
          'MetadataConflict',
          conflicts.map((source) => source.assetId),
          'Light metadata differs from the first selected Light. Review filter and binning before Calibration.',
        ),
      )
  }
  for (const source of project.sources) {
    if (source.role !== source.suggestedRole)
      warnings.push(
        warning(
          'RoleSuggested',
          [source.assetId],
          `${source.assetId} is assigned ${source.role}; retained metadata suggests ${source.suggestedRole}.`,
        ),
      )
    if (
      source.availability !== 'availableLocally' &&
      source.availability !== 'published'
    )
      warnings.push(
        warning(
          'SourceUnavailable',
          [source.assetId],
          `${source.assetId} is frozen in the project but its bytes are not currently local.`,
        ),
      )
  }
  return ProcessingProject.make({ ...project, warnings })
}

function warning(
  code: (typeof ProcessingProjectWarning.Type)['code'],
  assetIds: ReadonlyArray<typeof AssetId.Type>,
  message: string,
) {
  return ProcessingProjectWarning.make({ code, assetIds, message })
}
