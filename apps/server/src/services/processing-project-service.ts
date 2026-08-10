import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  CaptureSetId,
  Command,
  ProcessingProject,
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
  | { readonly _tag: 'AssignProcessingSourceRole' }
  | { readonly _tag: 'NavigateProcessingProjectStage' }
  | { readonly _tag: 'UpdateProcessingStageDraft' }
  | { readonly _tag: 'UndoProcessingStageDraft' }
  | { readonly _tag: 'RedoProcessingStageDraft' }
  | { readonly _tag: 'RunProcessingProjectStage' }
  | { readonly _tag: 'SelectProcessingStageResult' }
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
const ReceiptRow = Schema.Struct({ response: Schema.String })
const ProjectAcceptedResponse = Schema.Struct({
  outcome: Schema.Literal('accepted'),
  replayed: Schema.Boolean,
  effect: Schema.Literals([
    'projectCreated',
    'projectSourcesAdded',
    'projectSourceRoleAssigned',
    'projectStageNavigated',
    'projectStageDraftUpdated',
    'projectStageDraftUndone',
    'projectStageDraftRedone',
    'projectStageRunQueued',
    'projectStageResultSelected',
  ]),
  project: ProcessingProject,
})
const SourceRow = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  availability: Schema.String,
  comparison_group_id: Schema.String,
  captured_at: Schema.String,
  role: Schema.String,
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

export const isProcessingProjectCommand = (
  command: typeof Command.Type,
): command is ProjectCommand =>
  Command.guards.CreateProcessingProject(command) ||
  Command.guards.AddProcessingProjectSources(command) ||
  Command.guards.AssignProcessingSourceRole(command) ||
  Command.guards.NavigateProcessingProjectStage(command) ||
  Command.guards.UpdateProcessingStageDraft(command) ||
  Command.guards.UndoProcessingStageDraft(command) ||
  Command.guards.RedoProcessingStageDraft(command) ||
  Command.guards.RunProcessingProjectStage(command) ||
  Command.guards.SelectProcessingStageResult(command)

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
    return Schema.decodeUnknownSync(ProcessingProject)({
      currentStage: 'Sources',
      stages: initialStages(),
      ...stored,
    })
  })
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
  let work: { workId: string; attemptId: string; stage: string } | undefined
  if (Command.guards.NavigateProcessingProjectStage(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    project = reviseProject(current, current.sources, {
      currentStage: command.stage,
    })
  } else if (
    Command.guards.UpdateProcessingStageDraft(command) ||
    Command.guards.UndoProcessingStageDraft(command) ||
    Command.guards.RedoProcessingStageDraft(command)
  ) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const stage = current.stages.find((item) => item.stage === command.stage)
    if (stage === undefined)
      return { outcome: 'rejected' as const, reason: 'StageNotFound' }
    const draft = stage.draft
    const nextDraft = Command.guards.UpdateProcessingStageDraft(command)
      ? {
          revision: draft.revision + 1,
          settings: command.settings,
          undo: [...draft.undo, draft.settings].slice(-10),
          redo: [],
        }
      : Command.guards.UndoProcessingStageDraft(command)
        ? draft.undo.length === 0
          ? undefined
          : {
              revision: draft.revision + 1,
              settings: draft.undo.at(-1) ?? [],
              undo: draft.undo.slice(0, -1),
              redo: [draft.settings, ...draft.redo].slice(0, 10),
            }
        : draft.redo.length === 0
          ? undefined
          : {
              revision: draft.revision + 1,
              settings: draft.redo[0] ?? [],
              undo: [...draft.undo, draft.settings].slice(-10),
              redo: draft.redo.slice(1),
            }
    if (nextDraft === undefined)
      return { outcome: 'rejected' as const, reason: 'DraftHistoryUnavailable' }
    project = reviseProject(current, current.sources, {
      currentStage: command.stage,
      stages: replaceStage(current.stages, { ...stage, draft: nextDraft }),
    })
  } else if (Command.guards.RunProcessingProjectStage(command)) {
    if (current === undefined)
      return { outcome: 'rejected' as const, reason: 'ProjectNotFound' }
    const stage = current.stages.find((item) => item.stage === command.stage)
    if (stage === undefined)
      return { outcome: 'rejected' as const, reason: 'StageNotFound' }
    if (
      stage.attempts.some(
        (attempt) => attempt.state === 'queued' || attempt.state === 'running',
      )
    )
      return { outcome: 'rejected' as const, reason: 'StageAttemptActive' }
    const upstream = upstreamAttempt(current, command.stage)
    if (command.stage !== 'Calibration' && upstream === undefined)
      return { outcome: 'rejected' as const, reason: 'UpstreamResultRequired' }
    const attemptId = ProcessingStageAttemptId.make(
      `stage-attempt-${randomUUID()}`,
    )
    const attempt = ProcessingStageAttempt.make({
      attemptId,
      stage: command.stage,
      state: 'queued',
      draftRevision: stage.draft.revision,
      settings: stage.draft.settings,
      toolIdentity: 'deterministic-stage-harness-v1',
      resultKind: 'deterministicStageEvidence',
      basedOnEarlierUpstream: false,
      sourceRevisions: current.sources.map((source) => ({
        assetId: source.assetId,
        assetRevision: source.assetRevision,
        role: source.role,
      })),
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
          stages: initialStages(),
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
                : Command.guards.RunProcessingProjectStage(command)
                  ? ('projectStageRunQueued' as const)
                  : ('projectStageResultSelected' as const)
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
    if (work !== undefined)
      database
        .prepare(
          "INSERT INTO processing_work(work_id,session_id,kind,payload,state,stage,enqueued_at) VALUES(?,?, 'projectStage', ?, 'pending', ?, ?)",
        )
        .run(
          work.workId,
          project.projectId,
          JSON.stringify({
            _tag: 'RunProcessingProjectStage',
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
         FROM library_assets ORDER BY captured_at,asset_id`,
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
      ...projectTarget(sources),
      sources,
      ...changes,
      stages: recomputeLineage(changes.stages ?? current.stages, sources),
      warnings: [],
      updatedAt: new Date().toISOString(),
    }),
  )
}

function initialStages() {
  return (['Calibration', 'Registration', 'Stacking'] as const).map((stage) =>
    ProcessingStageState.make({
      stage,
      draft: { revision: 0, settings: [], undo: [], redo: [] },
      attempts: [],
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
  const completed = ProcessingStageAttempt.make({
    ...attempt,
    state: 'succeeded',
    resultId: ProcessingStageResultId.make(`stage-result-${attempt.attemptId}`),
    outputChecksum: checksum,
    startedAt: now,
    completedAt: now,
  })
  const selectedStages = replaceStage(project.stages, {
    ...stage,
    attempts: stage.attempts.map((item) =>
      item.attemptId === attempt.attemptId ? completed : item,
    ),
    selectedAttemptId: attempt.attemptId,
  })
  const settledProject = reviseProject(project, project.sources, {
    stages: selectedStages,
  })
  database.exec('BEGIN IMMEDIATE')
  try {
    const changed = database
      .prepare(
        "UPDATE processing_work SET state='settled',settled_at=?,checkpoint='complete' WHERE work_id=? AND state='claimed' AND claim_token=?",
      )
      .run(now, workId, claimToken)
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
    database.exec('COMMIT')
    return { outcome: 'settled' as const }
  } catch {
    database.exec('ROLLBACK')
    return { outcome: 'stale' as const }
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
  const calibrated = calibration && {
    ...calibration,
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
  return stages.map((stage) =>
    stage.stage === 'Calibration'
      ? (calibrated ?? stage)
      : stage.stage === 'Registration'
        ? (registered ?? stage)
        : {
            ...stage,
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
