import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  CheckpointId,
  CaptureSetId,
  CreateProcessingProjectRequest,
  DevelopOperation,
  ExecutableProcessingStage,
  IntentId,
  OpenedProcessingProject,
  PersonId,
  ClientId,
  PreviewId,
  ProcessingAttempt,
  ProcessingAttemptOutput,
  ProcessingAttemptStageEvidence,
  ProcessingCurrentResult,
  ProcessingDevelopPreview,
  ProcessingDevelopBase,
  ProcessingFrozenSource,
  ProcessingLibraryFormat,
  ProcessingLibraryRole,
  ProcessingOutputId,
  ProcessingProject,
  ProcessingProjectAuthority,
  ProcessingProjectChangeRequest,
  ProcessingProjectChanged,
  ProcessingProjectEvidence,
  ProcessingProjectEvidenceQuery,
  ProcessingProjectError,
  ProcessingProjectId,
  ProcessingProjectIntent,
  ProcessingProjectNotice,
  ProcessingProjectRevision,
  ProcessingProjectSource,
  ProcessingProjectSummary,
  ProcessingProjectWarning,
  ProcessingRecommendation,
  ProcessingStageDraft,
  ProcessingStageDraftValue,
  ProcessingStageResult,
  ProcessingStageResultId,
  ProcessingStageState,
  ProcessingStageView,
  ProcessingStageAttemptId,
  decideProcessingProjectAuthority,
  currentProcessingStageResult,
  sameProcessingResult,
  type ProcessingSourceRole,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'

const ProjectRow = Schema.Struct({ project: Schema.String })
const ReceiptRow = Schema.Struct({
  semantic_key: Schema.String,
  response: Schema.String,
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
  captureSetId: Schema.optionalKey(Schema.String),
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
      frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
      exposureSeconds: Schema.Number,
      filter: Schema.String,
      binning: Schema.Int,
    }),
  ),
})
const ProjectWorkRow = Schema.Struct({
  work_id: Schema.String,
  project_id: Schema.String,
  kind: Schema.Literal('projectStage'),
  payload: Schema.String,
  state: Schema.Literals(['pending', 'claimed']),
  stage: ExecutableProcessingStage,
  claim_token: Schema.NullOr(Schema.String),
  enqueued_at: Schema.String,
})
const ProjectWorkPayload = Schema.Struct({
  projectId: ProcessingProjectId,
  attemptId: ProcessingStageAttemptId,
  stage: ExecutableProcessingStage,
})
const ProjectBacklogRow = Schema.Struct({
  count: Schema.Int,
  oldest: Schema.NullOr(Schema.String),
})
const LibraryDetail = Schema.Struct({
  checksum: Schema.optionalKey(Schema.String),
  lineage: Schema.Struct({
    processingOutputId: Schema.optionalKey(Schema.String),
  }),
})
const SavedMasterRow = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  role: Schema.String,
  detail: Schema.String,
})

type Project = typeof ProcessingProject.Type
type Stage = typeof ExecutableProcessingStage.Type
type Intent = typeof ProcessingProjectIntent.Type
type ChangeRequest = typeof ProcessingProjectChangeRequest.Type
type Caller = LocalIdentity
type NoticeSubscriber = {
  readonly values: Array<typeof ProcessingProjectNotice.Type>
  readonly waiters: Array<() => void>
}

const noticeSubscribers = new WeakMap<DatabaseSync, Set<NoticeSubscriber>>()

export type ProcessingProjectMaterialization = {
  readonly workId: string
  readonly stage: Stage
  readonly payload: string
}

export type ProcessingProjectMaterializedEvidence = {
  readonly path: string
  readonly checksum: string
}

export type ProcessingProjectWorkResult =
  | { readonly outcome: 'idle'; readonly backlog: 0 }
  | {
      readonly outcome: 'completed' | 'failed' | 'stale' | 'claimedUnresolved'
      readonly kind: 'projectStage'
      readonly stage: Stage
      readonly backlog: number
      readonly oldestAgeSeconds: number
    }

type ProjectError = typeof ProcessingProjectError.Type

export function createProcessingProjectLifecycle(database: DatabaseSync) {
  const list = (caller: Caller) => {
    void caller
    return readProjects(database).map((project) => projectSummary(project))
  }

  const open = (caller: Caller, projectId: typeof ProcessingProjectId.Type) => {
    const project = readProject(database, projectId)
    return project === undefined
      ? undefined
      : projectView(database, project, caller)
  }

  const evidence = (
    caller: Caller,
    query: typeof ProcessingProjectEvidenceQuery.Type,
  ) => {
    void caller
    const project = readProject(database, query.projectId)
    if (project === undefined) return undefined
    const filtered = project.attempts.filter(
      (attempt) => query.stage === undefined || attempt.stage === query.stage,
    )
    const start =
      query.afterAttemptId === undefined
        ? 0
        : Math.max(
            0,
            filtered.findIndex(
              (attempt) => attempt.attemptId === query.afterAttemptId,
            ) + 1,
          )
    const limit = query.limit ?? 50
    const attempts = filtered.slice(start, start + limit)
    const next = filtered[start + limit]
    return ProcessingProjectEvidence.make({
      projectId: project.projectId,
      attempts,
      ...(next === undefined ? {} : { nextAttemptId: next.attemptId }),
    })
  }

  const create = (
    caller: Caller,
    request: typeof CreateProcessingProjectRequest.Type,
  ): typeof ProcessingProjectChanged.Type | ProjectError => {
    const denied = authorityError(caller)
    if (denied !== undefined) return denied
    const replay = readReceipt(database, request.intentId, caller, request)
    if (replay !== undefined) return replay
    const sources = resolveSelection(database, request.selection)
    if (sources === undefined || sources.length === 0)
      return ProcessingProjectError.cases.SourceSelectionInvalid.make({
        issues: ['The selection does not resolve to exact retained Assets.'],
      })
    const now = new Date().toISOString()
    const assigned = assignSuggestedRoles(sources)
    const project = withWarnings(
      ProcessingProject.make({
        projectId: ProcessingProjectId.make(`project-${randomUUID()}`),
        revision: ProcessingProjectRevision.make(0),
        name: request.name,
        ...projectTarget(assigned),
        sources: assigned,
        warnings: [],
        stages: initialStages(),
        attempts: [],
        savedAssetIds: [],
        createdAt: now,
        updatedAt: now,
      }),
    )
    const response = ProcessingProjectChanged.make({
      outcome: 'Accepted',
      replayed: false,
      project: projectView(database, project, caller),
    })
    database.exec('BEGIN IMMEDIATE')
    try {
      persistNewProject(database, project)
      writeReceipt(database, request.intentId, caller, request, response)
      database.exec('COMMIT')
      publishNotice(database, project)
      return response
    } catch {
      database.exec('ROLLBACK')
      throw new Error('Processing Project persistence is unavailable.')
    }
  }

  const change = (
    caller: Caller,
    request: ChangeRequest,
  ): typeof ProcessingProjectChanged.Type | ProjectError => {
    const denied = authorityError(caller)
    if (denied !== undefined) return denied
    const replay = readReceipt(database, request.intentId, caller, request)
    if (replay !== undefined) return replay
    const current = readProject(database, request.projectId)
    if (current === undefined)
      return ProcessingProjectError.cases.ProjectNotFound.make({
        projectId: request.projectId,
      })
    if (current.revision !== request.expectedProjectRevision)
      return ProcessingProjectError.cases.ProjectRevisionConflict.make({
        projectId: request.projectId,
        currentRevision: current.revision,
      })
    const active = activeAttempt(current)
    if (active !== undefined)
      return ProcessingProjectError.cases.ActiveAttemptConflict.make({
        attemptId: active.attemptId,
        stage: active.stage,
      })

    const decision = decideChange(database, current, request.intent)
    if (!('project' in decision)) return decision
    const response = ProcessingProjectChanged.make({
      outcome: 'Accepted',
      replayed: false,
      project: projectView(database, decision.project, caller),
    })
    database.exec('BEGIN IMMEDIATE')
    try {
      const updated = database
        .prepare(
          'UPDATE processing_projects SET revision=?,project=?,updated_at=? WHERE project_id=? AND revision=?',
        )
        .run(
          decision.project.revision,
          JSON.stringify(decision.project),
          decision.project.updatedAt,
          decision.project.projectId,
          current.revision,
        )
      if (updated.changes !== 1) throw new Error('stale Project revision')
      if ('work' in decision && decision.work !== undefined)
        enqueue(database, decision.work)
      if ('save' in decision && decision.save !== undefined)
        saveLibraryAsset(database, decision.project, decision.save)
      writeReceipt(database, request.intentId, caller, request, response)
      database.exec('COMMIT')
      publishNotice(database, decision.project)
      return response
    } catch {
      database.exec('ROLLBACK')
      throw new Error('Processing Project persistence is unavailable.')
    }
  }

  const changes = async function* (
    caller: Caller,
  ): AsyncIterable<typeof ProcessingProjectNotice.Type> {
    void caller
    const subscriber: NoticeSubscriber = { values: [], waiters: [] }
    const subscribers = noticeSubscribers.get(database) ?? new Set()
    noticeSubscribers.set(database, subscribers)
    subscribers.add(subscriber)
    try {
      while (true) {
        if (subscriber.values.length === 0)
          await new Promise<void>((resolve) => subscriber.waiters.push(resolve))
        const notice = subscriber.values.shift()
        if (notice !== undefined) yield notice
      }
    } finally {
      subscribers.delete(subscriber)
    }
  }

  return { list, create, open, evidence, change, changes }
}

/** Internal seam used only by the deterministic Process worker adapter. */
export function createProcessingProjectWorkModule(
  database: DatabaseSync,
  now: () => Date = () => new Date(),
) {
  const advance = (
    materialize: (
      work: ProcessingProjectMaterialization,
    ) => ProcessingProjectMaterializedEvidence | undefined,
  ): ProcessingProjectWorkResult => {
    const backlog = Schema.decodeUnknownSync(ProjectBacklogRow)(
      database
        .prepare(
          "SELECT COUNT(*) AS count,MIN(enqueued_at) AS oldest FROM processing_work WHERE kind='projectStage' AND state IN ('pending','claimed')",
        )
        .get(),
    )
    if (backlog.count === 0) return { outcome: 'idle', backlog: 0 }
    const oldestAgeSeconds =
      backlog.oldest === null
        ? 0
        : Math.max(0, now().getTime() - Date.parse(backlog.oldest)) / 1_000
    const row = Schema.decodeUnknownSync(Schema.optional(ProjectWorkRow))(
      database
        .prepare(
          "SELECT work_id,project_id,kind,payload,state,stage,claim_token,enqueued_at FROM processing_work WHERE kind='projectStage' AND state IN ('pending','claimed') ORDER BY rowid LIMIT 1",
        )
        .get(),
    )
    if (row === undefined) return { outcome: 'idle', backlog: 0 }
    const claimed = claim(database, row, now)
    if (claimed === undefined)
      return workResult('stale', row.stage, backlog.count, oldestAgeSeconds)
    let materialized: ProcessingProjectMaterializedEvidence | undefined
    try {
      materialized = materialize({
        workId: row.work_id,
        stage: row.stage,
        payload: row.payload,
      })
    } catch {
      materialized = undefined
    }
    if (materialized === undefined)
      return workResult(
        'claimedUnresolved',
        row.stage,
        backlog.count,
        oldestAgeSeconds,
      )
    const settled = settle(database, row, claimed, materialized, now)
    return workResult(settled, row.stage, backlog.count, oldestAgeSeconds)
  }
  return { advance }
}

function decideChange(
  database: DatabaseSync,
  project: Project,
  intent: Intent,
) {
  if (ProcessingProjectIntent.guards.AddSources(intent)) {
    const selected = resolveSelection(database, intent.selection)
    if (selected === undefined || selected.length === 0)
      return ProcessingProjectError.cases.SourceSelectionInvalid.make({
        issues: ['The selection does not resolve to exact retained Assets.'],
      })
    const known = new Set(project.sources.map((source) => source.assetId))
    const added = assignSuggestedRoles(
      selected.filter((source) => !known.has(source.assetId)),
      project.targetName,
    )
    return {
      project: revise(project, { sources: [...project.sources, ...added] }),
    }
  }
  if (ProcessingProjectIntent.guards.RemoveSource(intent)) {
    if (!project.sources.some((source) => source.assetId === intent.assetId))
      return ProcessingProjectError.cases.SourceNotFound.make({
        assetId: intent.assetId,
      })
    return {
      project: revise(project, {
        sources: project.sources.filter(
          (source) => source.assetId !== intent.assetId,
        ),
      }),
    }
  }
  if (ProcessingProjectIntent.guards.AssignSourceRole(intent)) {
    const source = project.sources.find(
      (candidate) => candidate.assetId === intent.assetId,
    )
    if (source === undefined)
      return ProcessingProjectError.cases.SourceNotFound.make({
        assetId: intent.assetId,
      })
    if (
      intent.role === 'Lights' &&
      project.targetName !== undefined &&
      source.targetName !== undefined &&
      source.targetName !== project.targetName
    )
      return ProcessingProjectError.cases.SourceSelectionInvalid.make({
        issues: [
          `${source.targetName} does not match Project target ${project.targetName}.`,
        ],
      })
    return {
      project: revise(project, {
        sources: project.sources.map((candidate) =>
          candidate.assetId === source.assetId
            ? ProcessingProjectSource.make({ ...candidate, role: intent.role })
            : candidate,
        ),
      }),
    }
  }
  if (ProcessingProjectIntent.guards.ReplaceDraft(intent)) {
    const stage = findStage(project, intent.draft._tag)
    if (stage === undefined)
      return ProcessingProjectError.cases.DraftInvalid.make({
        stage: intent.draft._tag,
        issues: ['The draft does not name an executable Project stage.'],
      })
    const draft = ProcessingStageDraft.make({
      revision: stage.draft.revision + 1,
      value: intent.draft,
      undo: [...stage.draft.undo, stage.draft.value].slice(-10),
      redo: [],
    })
    return {
      project: revise(project, {
        stages: replaceStage(
          project.stages,
          stage.stage === 'Develop'
            ? { ...withoutDevelopPreview(stage), draft }
            : { ...stage, draft },
        ),
      }),
    }
  }
  if (
    ProcessingProjectIntent.guards.UndoDraft(intent) ||
    ProcessingProjectIntent.guards.RedoDraft(intent)
  ) {
    const stage = findStage(project, intent.stage)
    if (stage === undefined)
      return ProcessingProjectError.cases.DraftInvalid.make({
        stage: intent.stage,
        issues: ['The draft stage is unavailable.'],
      })
    const undoing = ProcessingProjectIntent.guards.UndoDraft(intent)
    const source = undoing ? stage.draft.undo : stage.draft.redo
    const value = source.at(-1)
    if (value === undefined)
      return ProcessingProjectError.cases.HistoryUnavailable.make({
        stage: intent.stage,
        target: 'Draft',
        direction: undoing ? 'Undo' : 'Redo',
      })
    const draft = ProcessingStageDraft.make({
      revision: stage.draft.revision + 1,
      value,
      undo: undoing
        ? stage.draft.undo.slice(0, -1)
        : [...stage.draft.undo, stage.draft.value].slice(-10),
      redo: undoing
        ? [...stage.draft.redo, stage.draft.value].slice(-10)
        : stage.draft.redo.slice(0, -1),
    })
    return {
      project: revise(project, {
        stages: replaceStage(
          project.stages,
          stage.stage === 'Develop'
            ? { ...withoutDevelopPreview(stage), draft }
            : { ...stage, draft },
        ),
      }),
    }
  }
  if (ProcessingProjectIntent.guards.SyncDevelopPreview(intent)) {
    const stage = findStage(project, 'Develop')
    const upstream = developBaseResult(project)
    if (
      stage === undefined ||
      upstream === undefined ||
      stage.draft.revision !== intent.expectedDraftRevision ||
      !ProcessingStageDraftValue.guards.Develop(stage.draft.value)
    )
      return ProcessingProjectError.cases.RunUnavailable.make({
        stage: 'Develop',
        reason: 'DevelopPreviewRequired',
      })
    const preview = ProcessingDevelopPreview.make({
      previewId: PreviewId.make(`preview-${randomUUID()}`),
      draftRevision: stage.draft.revision,
      inputCheckpointId: upstream.checkpointId,
      operation: stage.draft.value.operation,
      state: 'ready',
      checksum: `sha256:${digest({
        upstream: upstream.checksum,
        draft: stage.draft.value,
      })}`,
      synchronizedAt: new Date().toISOString(),
    })
    return {
      project: revise(project, {
        stages: replaceStage(project.stages, {
          ...stage,
          developPreview: preview,
        }),
      }),
    }
  }
  if (ProcessingProjectIntent.guards.RunStage(intent))
    return decideRun(database, project, intent)
  if (ProcessingProjectIntent.guards.OpenDevelop(intent)) {
    const base = developBaseForAsset(database, project, intent.assetId)
    if (base === undefined)
      return ProcessingProjectError.cases.SaveUnavailable.make({
        stage: 'Develop',
        reason: 'CurrentLineageRequired',
      })
    const develop = findStage(project, 'Develop')
    const stages =
      develop === undefined
        ? project.stages
        : replaceStage(project.stages, withoutDevelopPreview(develop))
    return {
      project: revise(project, {
        developBase: base,
        stages: restoreLineage(stages, base),
      }),
    }
  }
  if (
    ProcessingProjectIntent.guards.UndoCurrentResult(intent) ||
    ProcessingProjectIntent.guards.RedoCurrentResult(intent)
  ) {
    const stage = findStage(project, intent.stage)
    if (stage === undefined)
      return ProcessingProjectError.cases.HistoryUnavailable.make({
        stage: intent.stage,
        target: 'CurrentResult',
        direction: ProcessingProjectIntent.guards.UndoCurrentResult(intent)
          ? 'Undo'
          : 'Redo',
      })
    const cursor = ProcessingProjectIntent.guards.UndoCurrentResult(intent)
      ? stage.resultCursor - 1
      : stage.resultCursor + 1
    if (cursor < 0 || cursor > stage.resultHistory.length)
      return ProcessingProjectError.cases.HistoryUnavailable.make({
        stage: intent.stage,
        target: 'CurrentResult',
        direction: ProcessingProjectIntent.guards.UndoCurrentResult(intent)
          ? 'Undo'
          : 'Redo',
      })
    return {
      project: revise(project, {
        stages: restoreLineage(
          replaceStage(project.stages, { ...stage, resultCursor: cursor }),
          project.developBase,
        ),
      }),
    }
  }
  return decideSave(database, project, intent.stage)
}

function decideRun(
  database: DatabaseSync,
  project: Project,
  intent: Extract<Intent, { readonly _tag: 'RunStage' }>,
) {
  const stage = findStage(project, intent.stage)
  if (stage === undefined)
    return ProcessingProjectError.cases.RunUnavailable.make({
      stage: intent.stage,
      reason: 'CurrentUpstreamResultRequired',
    })
  let frozen: {
    draftRevision: number
    draft: typeof ProcessingStageDraftValue.Type
    sources: ReadonlyArray<typeof ProcessingFrozenSource.Type>
    upstream?: typeof ProcessingStageResult.Type
    preview?: typeof ProcessingDevelopPreview.Type
    retryOfAttemptId?: typeof ProcessingStageAttemptId.Type
  }
  if (
    ProcessingProjectIntent.cases.RunStage.fields.from.guards.FailedAttempt(
      intent.from,
    )
  ) {
    const failedAttemptId = intent.from.attemptId
    const failed = project.attempts.find(
      (attempt) =>
        attempt.attemptId === failedAttemptId &&
        attempt.stage === intent.stage &&
        attempt.state === 'failed',
    )
    if (failed === undefined)
      return ProcessingProjectError.cases.RunUnavailable.make({
        stage: intent.stage,
        reason: 'CurrentUpstreamResultRequired',
      })
    frozen = {
      draftRevision: failed.draftRevision,
      draft: failed.draft,
      sources: failed.sources,
      ...(failed.upstream === undefined
        ? {}
        : { upstream: resultFrom(failed.upstream) }),
      ...(failed.previewId === undefined ||
      failed.inputCheckpointId === undefined
        ? {}
        : {
            preview: ProcessingDevelopPreview.make({
              previewId: failed.previewId,
              draftRevision: failed.draftRevision,
              inputCheckpointId: failed.inputCheckpointId,
              operation: ProcessingStageDraftValue.guards.Develop(failed.draft)
                ? failed.draft.operation
                : DevelopOperation.cases.Stretch.make({
                    method: 'asinh',
                    amount: 0.25,
                  }),
              state: 'ready',
            }),
          }),
      retryOfAttemptId: failed.attemptId,
    }
  } else {
    const sources = freezeSources(project.sources)
    if (sources === undefined)
      return ProcessingProjectError.cases.RunUnavailable.make({
        stage: intent.stage,
        reason: 'LightsRequired',
      })
    const upstream = upstreamResult(project, intent.stage)
    const unavailable = runUnavailable(database, project, stage, upstream)
    if (unavailable !== undefined)
      return ProcessingProjectError.cases.RunUnavailable.make({
        stage: intent.stage,
        reason: unavailable,
      })
    frozen = {
      draftRevision: stage.draft.revision,
      draft: stage.draft.value,
      sources,
      ...(upstream === undefined ? {} : { upstream }),
      ...(stage.developPreview === undefined
        ? {}
        : { preview: stage.developPreview }),
    }
  }
  const attemptId = ProcessingStageAttemptId.make(`attempt-${randomUUID()}`)
  const now = new Date().toISOString()
  const attempt = ProcessingAttempt.make({
    attemptId,
    stage: intent.stage,
    state: 'queued',
    draftRevision: frozen.draftRevision,
    draft: frozen.draft,
    sources: frozen.sources,
    ...(frozen.upstream === undefined
      ? {}
      : { upstream: upstreamReference(frozen.upstream) }),
    ...(frozen.preview === undefined
      ? {}
      : {
          previewId: frozen.preview.previewId,
          inputCheckpointId: frozen.preview.inputCheckpointId,
        }),
    ...(frozen.retryOfAttemptId === undefined
      ? {}
      : { retryOfAttemptId: frozen.retryOfAttemptId }),
    frozenAt: now,
    outputs: [],
    evidence: initialAttemptEvidence(project, intent.stage, frozen),
    diagnostics: [],
  })
  const revised = revise(project, { attempts: [...project.attempts, attempt] })
  return {
    project: revised,
    work: {
      workId: `project-stage-${attemptId}`,
      projectId: project.projectId,
      attemptId,
      stage: intent.stage,
      enqueuedAt: now,
    },
  }
}

function decideSave(
  database: DatabaseSync,
  project: Project,
  stageName: 'Stacking' | 'Develop',
) {
  const result = currentResult(project, stageName)
  if (result === undefined)
    return ProcessingProjectError.cases.SaveUnavailable.make({
      stage: stageName,
      reason: 'CurrentResultRequired',
    })
  const existing = savedAssetForOutput(database, result.outputId)
  if (existing !== undefined) {
    if (project.savedAssetIds.includes(existing)) return { project }
    return {
      project: revise(project, {
        savedAssetIds: [...project.savedAssetIds, existing],
      }),
    }
  }
  const assetId = AssetId.make(
    `asset-${stageName === 'Stacking' ? 'master' : 'develop'}-${randomUUID()}`,
  )
  return {
    project: revise(project, {
      savedAssetIds: [...project.savedAssetIds, assetId],
    }),
    save: { assetId, result },
  }
}

function claim(
  database: DatabaseSync,
  row: typeof ProjectWorkRow.Type,
  now: () => Date,
) {
  if (row.state === 'claimed') return row.claim_token ?? undefined
  const token = randomUUID()
  const payload = Schema.decodeUnknownSync(ProjectWorkPayload)(
    JSON.parse(row.payload),
  )
  const project = readProject(database, payload.projectId)
  const attempt = project?.attempts.find(
    (candidate) => candidate.attemptId === payload.attemptId,
  )
  if (project === undefined || attempt?.state !== 'queued') return undefined
  const startedAt = now().toISOString()
  const running = revise(project, {
    attempts: project.attempts.map((candidate) =>
      candidate.attemptId === attempt.attemptId
        ? ProcessingAttempt.make({ ...candidate, state: 'running', startedAt })
        : candidate,
    ),
  })
  database.exec('BEGIN IMMEDIATE')
  try {
    const work = database
      .prepare(
        "UPDATE processing_work SET state='claimed',claim_token=?,claimed_at=?,attempts=attempts+1 WHERE work_id=? AND state='pending'",
      )
      .run(token, startedAt, row.work_id)
    const changed = database
      .prepare(
        'UPDATE processing_projects SET revision=?,project=?,updated_at=? WHERE project_id=? AND revision=?',
      )
      .run(
        running.revision,
        JSON.stringify(running),
        running.updatedAt,
        running.projectId,
        project.revision,
      )
    if (work.changes !== 1 || changed.changes !== 1)
      throw new Error('stale claim')
    database.exec('COMMIT')
    publishNotice(database, running)
    return token
  } catch {
    database.exec('ROLLBACK')
    return undefined
  }
}

function settle(
  database: DatabaseSync,
  row: typeof ProjectWorkRow.Type,
  claimToken: string,
  materialized: ProcessingProjectMaterializedEvidence,
  now: () => Date,
): 'completed' | 'failed' | 'stale' {
  const payload = Schema.decodeUnknownSync(ProjectWorkPayload)(
    JSON.parse(row.payload),
  )
  const project = readProject(database, payload.projectId)
  const attempt = project?.attempts.find(
    (candidate) => candidate.attemptId === payload.attemptId,
  )
  if (project === undefined || attempt?.state !== 'running') return 'stale'
  const successful = materialized.checksum.startsWith('sha256:')
  const settledAt = now().toISOString()
  const outputId = ProcessingOutputId.make(`output-${attempt.attemptId}`)
  const resultId = ProcessingStageResultId.make(`result-${attempt.attemptId}`)
  const completed = ProcessingAttempt.make({
    ...attempt,
    state: successful ? 'succeeded' : 'failed',
    settledAt,
    outcome: successful ? 'Succeeded' : 'Failed',
    outputs: successful
      ? [
          ProcessingAttemptOutput.make({
            outputId,
            checksum: materialized.checksum,
            relation: 'WorkingResult',
          }),
        ]
      : [],
    evidence: completedEvidence(attempt, materialized.checksum),
    diagnostics: successful
      ? [
          'Deterministic local evidence only; astronomy processing quality is not claimed.',
        ]
      : ['The deterministic result could not be verified.'],
  })
  const stage = findStage(project, attempt.stage)
  if (stage === undefined) return 'stale'
  const result = ProcessingStageResult.make({
    resultId,
    attemptId: attempt.attemptId,
    stage: attempt.stage,
    outcome: 'Succeeded',
    checksum: materialized.checksum,
    outputId,
    checkpointId: CheckpointId.make(`checkpoint-${attempt.attemptId}`),
    sources: attempt.sources,
    ...(attempt.upstream === undefined ? {} : { upstream: attempt.upstream }),
    summary: `${attempt.stage} completed with deterministic local evidence.`,
    completedAt: settledAt,
  })
  const nextStage = successful
    ? {
        ...stage,
        resultHistory: [
          ...stage.resultHistory.slice(0, stage.resultCursor),
          result,
        ],
        resultCursor: stage.resultCursor + 1,
      }
    : stage
  const settledProject = revise(project, {
    attempts: project.attempts.map((candidate) =>
      candidate.attemptId === completed.attemptId ? completed : candidate,
    ),
    stages: restoreLineage(
      replaceStage(project.stages, nextStage),
      project.developBase,
    ),
  })
  database.exec('BEGIN IMMEDIATE')
  try {
    const work = database
      .prepare(
        "UPDATE processing_work SET state=?,settled_at=?,checkpoint=? WHERE work_id=? AND state='claimed' AND claim_token=?",
      )
      .run(
        successful ? 'settled' : 'failed',
        settledAt,
        successful ? 'complete' : 'failed',
        row.work_id,
        claimToken,
      )
    const changed = database
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
    if (work.changes !== 1 || changed.changes !== 1)
      throw new Error('stale settlement')
    database
      .prepare(
        'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,0)',
      )
      .run(
        `${row.work_id}:result`,
        project.projectId,
        row.work_id,
        outputId,
        materialized.path,
        materialized.checksum,
      )
    database.exec('COMMIT')
    publishNotice(database, settledProject)
    return successful ? 'completed' : 'failed'
  } catch {
    database.exec('ROLLBACK')
    return 'stale'
  }
}

function completedEvidence(
  attempt: typeof ProcessingAttempt.Type,
  checksum: string,
) {
  if (ProcessingAttemptStageEvidence.guards.Stacking(attempt.evidence))
    return ProcessingAttemptStageEvidence.cases.Stacking.make({
      ...attempt.evidence,
      stackChecksum: checksum,
    })
  return attempt.evidence
}

function initialAttemptEvidence(
  project: Project,
  stage: Stage,
  frozen: {
    draft: typeof ProcessingStageDraftValue.Type
    preview?: typeof ProcessingDevelopPreview.Type
  },
) {
  const recommendations = project.sources.map((source) =>
    ProcessingRecommendation.make({
      assetId: source.assetId,
      assetRevision: source.assetRevision,
      decision:
        source.availability === 'availableLocally' ||
        source.availability === 'published'
          ? 'Include'
          : 'Exclude',
      reasons: [
        source.availability === 'availableLocally' ||
        source.availability === 'published'
          ? 'The exact retained source is available.'
          : 'The exact retained source is unavailable.',
      ],
    }),
  )
  if (stage === 'Calibration')
    return ProcessingAttemptStageEvidence.cases.Calibration.make({
      recommendations,
      overrides: ProcessingStageDraftValue.guards.Calibration(frozen.draft)
        ? frozen.draft.overrides
        : [],
      frameOutcomes: [],
    })
  if (stage === 'Registration')
    return ProcessingAttemptStageEvidence.cases.Registration.make({
      recommendations,
      inclusions: ProcessingStageDraftValue.guards.Registration(frozen.draft)
        ? frozen.draft.inclusions
        : [],
      transforms: [],
      viableAssetIds: [],
    })
  if (stage === 'Stacking')
    return ProcessingAttemptStageEvidence.cases.Stacking.make({
      recommendations,
      frameChoices: ProcessingStageDraftValue.guards.Stacking(frozen.draft)
        ? frozen.draft.frameChoices
        : [],
      includedAssetIds: project.sources
        .filter((source) => source.role === 'Lights')
        .map((source) => source.assetId),
    })
  if (frozen.preview === undefined)
    throw new Error('Develop preview is required')
  return ProcessingAttemptStageEvidence.cases.Develop.make({
    previewId: frozen.preview.previewId,
    inputCheckpointId: frozen.preview.inputCheckpointId,
    relatedOutputIds: [],
  })
}

function projectSummary(project: Project) {
  const active = activeAttempt(project)
  return ProcessingProjectSummary.make({
    projectId: project.projectId,
    revision: project.revision,
    name: project.name,
    ...(project.targetName === undefined
      ? {}
      : { targetName: project.targetName }),
    sourceCount: project.sources.length,
    state:
      active !== undefined
        ? 'Working'
        : project.attempts.at(-1)?.state === 'failed'
          ? 'Attention'
          : 'Ready',
    ...(active === undefined
      ? {}
      : {
          active: {
            stage: active.stage,
            state:
              active.state === 'queued'
                ? ('Queued' as const)
                : ('Running' as const),
          },
        }),
    updatedAt: project.updatedAt,
  })
}

function projectView(database: DatabaseSync, project: Project, caller: Caller) {
  const active = activeAttempt(project)
  return OpenedProcessingProject.make({
    projectId: project.projectId,
    revision: project.revision,
    name: project.name,
    ...(project.targetName === undefined
      ? {}
      : { targetName: project.targetName }),
    authority: authority(caller),
    sources: project.sources,
    warnings: project.warnings,
    stages: project.stages.map((stage) => stageView(database, project, stage)),
    ...(project.developBase === undefined
      ? {}
      : { developBase: project.developBase }),
    ...(active === undefined
      ? {}
      : {
          activeAttempt: {
            attemptId: active.attemptId,
            stage: active.stage,
            state:
              active.state === 'queued'
                ? ('Queued' as const)
                : ('Running' as const),
            acceptedAt: active.frozenAt,
            ...(active.startedAt === undefined
              ? {}
              : { startedAt: active.startedAt }),
          },
        }),
    savedAssetIds: project.savedAssetIds,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  })
}

function stageView(
  database: DatabaseSync,
  project: Project,
  stage: typeof ProcessingStageState.Type,
) {
  const result = currentProcessingStageResult(stage)
  const unavailable = runUnavailable(
    database,
    project,
    stage,
    upstreamResult(project, stage.stage),
  )
  return ProcessingStageView.make({
    stage: stage.stage,
    draft: {
      revision: stage.draft.revision,
      value: stage.draft.value,
      canUndo: stage.draft.undo.length > 0,
      canRedo: stage.draft.redo.length > 0,
    },
    ...(result === undefined
      ? {}
      : {
          currentResult: ProcessingCurrentResult.make({
            resultId: result.resultId,
            attemptId: result.attemptId,
            outcome: result.outcome,
            lineage: 'Current',
            summary: result.summary,
            completedAt: result.completedAt,
          }),
        }),
    ...(stage.developPreview === undefined
      ? {}
      : {
          developPreview: {
            previewId: stage.developPreview.previewId,
            draftRevision: stage.developPreview.draftRevision,
            inputCheckpointId: stage.developPreview.inputCheckpointId,
            state:
              stage.developPreview.state === 'queued'
                ? ('Queued' as const)
                : stage.developPreview.state === 'computing'
                  ? ('Computing' as const)
                  : stage.developPreview.state === 'ready'
                    ? ('Ready' as const)
                    : ('Failed' as const),
          },
        }),
    resultHistory: {
      canUndo: stage.resultCursor > 0,
      canRedo: stage.resultCursor < stage.resultHistory.length,
    },
    run:
      unavailable === undefined
        ? ProcessingStageView.fields.run.cases.Available.make({
            label:
              stage.stage === 'Develop'
                ? 'Apply'
                : result === undefined
                  ? 'Run'
                  : 'Rerun',
          })
        : ProcessingStageView.fields.run.cases.Unavailable.make({
            reason: unavailable,
          }),
  })
}

function runUnavailable(
  database: DatabaseSync,
  project: Project,
  stage: typeof ProcessingStageState.Type,
  upstream: typeof ProcessingStageResult.Type | undefined,
):
  | 'LightsRequired'
  | 'CurrentUpstreamResultRequired'
  | 'SavedMasterRequired'
  | 'DevelopPreviewRequired'
  | 'AttemptActive'
  | undefined {
  if (activeAttempt(project) !== undefined) return 'AttemptActive'
  if (stage.stage === 'Calibration')
    return project.sources.some((source) => source.role === 'Lights')
      ? undefined
      : 'LightsRequired'
  if (upstream === undefined) return 'CurrentUpstreamResultRequired'
  if (stage.stage !== 'Develop') return undefined
  if (savedAssetForOutput(database, upstream.outputId) === undefined)
    return 'SavedMasterRequired'
  const preview = stage.developPreview
  return preview !== undefined &&
    preview.state === 'ready' &&
    preview.draftRevision === stage.draft.revision &&
    preview.inputCheckpointId === upstream.checkpointId
    ? undefined
    : 'DevelopPreviewRequired'
}

function initialStages() {
  const drafts = {
    Calibration: ProcessingStageDraftValue.cases.Calibration.make({
      settings: [
        { key: 'operation', value: 'calibrate-and-debayer' },
        { key: 'missingSupport', value: 'allow-with-warning' },
      ],
      overrides: [],
    }),
    Registration: ProcessingStageDraftValue.cases.Registration.make({
      settings: [
        { key: 'referenceAssetId', value: 'auto' },
        { key: 'alignmentModel', value: 'translation' },
        { key: 'starDetection', value: 'balanced' },
      ],
      inclusions: [],
    }),
    Stacking: ProcessingStageDraftValue.cases.Stacking.make({
      settings: [
        { key: 'weighting', value: 'equal' },
        { key: 'rejection', value: 'winsorized-sigma' },
      ],
      frameChoices: [],
    }),
    Develop: ProcessingStageDraftValue.cases.Develop.make({
      operation: DevelopOperation.cases.Stretch.make({
        method: 'asinh',
        amount: 0.25,
      }),
    }),
  } as const
  return (['Calibration', 'Registration', 'Stacking', 'Develop'] as const).map(
    (stage) =>
      ProcessingStageState.make({
        stage,
        draft: ProcessingStageDraft.make({
          revision: 0,
          value: drafts[stage],
          undo: [],
          redo: [],
        }),
        resultHistory: [],
        resultCursor: 0,
      }),
  )
}

function restoreLineage(
  stages: ReadonlyArray<typeof ProcessingStageState.Type>,
  developBase?: typeof ProcessingDevelopBase.Type,
) {
  const ordered = [...stages]
  for (let index = 1; index < ordered.length; index += 1) {
    const stage = ordered[index]
    const upstream = ordered[index - 1]
    if (stage === undefined || upstream === undefined) continue
    const currentUpstream =
      stage.stage === 'Develop' && developBase !== undefined
        ? upstream.resultHistory.find(
            (result) =>
              result.resultId === developBase.stackingResultId &&
              result.attemptId === developBase.stackingAttemptId &&
              result.checksum === developBase.checksum,
          )
        : currentProcessingStageResult(upstream)
    const match = stage.resultHistory.findLastIndex((result) =>
      sameProcessingResult(result.upstream, currentUpstream),
    )
    ordered[index] = ProcessingStageState.make(
      stage.stage === 'Develop' && match < 0
        ? { ...withoutDevelopPreview(stage), resultCursor: 0 }
        : { ...stage, resultCursor: match < 0 ? 0 : match + 1 },
    )
  }
  return ordered
}

function upstreamResult(project: Project, stage: Stage) {
  if (stage === 'Develop') return developBaseResult(project)
  const index = project.stages.findIndex(
    (candidate) => candidate.stage === stage,
  )
  if (index <= 0) return undefined
  const upstream = project.stages[index - 1]
  return upstream === undefined
    ? undefined
    : currentProcessingStageResult(upstream)
}

function developBaseResult(project: Project) {
  const base = project.developBase
  if (base === undefined) return undefined
  return findStage(project, 'Stacking')?.resultHistory.find(
    (result) =>
      result.resultId === base.stackingResultId &&
      result.attemptId === base.stackingAttemptId &&
      result.checksum === base.checksum,
  )
}

function developBaseForAsset(
  database: DatabaseSync,
  project: Project,
  assetId: typeof AssetId.Type,
) {
  if (!project.savedAssetIds.includes(assetId)) return undefined
  const row = Schema.decodeUnknownSync(Schema.optional(SavedMasterRow))(
    database
      .prepare(
        "SELECT asset_id,revision,role,detail FROM library_assets WHERE asset_id=? AND role='linearMaster'",
      )
      .get(assetId),
  )
  if (row === undefined) return undefined
  const detail = Schema.decodeUnknownSync(LibraryDetail)(JSON.parse(row.detail))
  const result = findStage(project, 'Stacking')?.resultHistory.find(
    (candidate) =>
      candidate.outputId === detail.lineage.processingOutputId &&
      candidate.checksum === detail.checksum,
  )
  if (result === undefined) return undefined
  return ProcessingDevelopBase.make({
    assetId,
    assetRevision: AssetRevision.make(row.revision),
    checksum: result.checksum,
    stackingAttemptId: result.attemptId,
    stackingResultId: result.resultId,
  })
}

function currentResult(project: Project, stage: Stage) {
  const found = findStage(project, stage)
  return found === undefined ? undefined : currentProcessingStageResult(found)
}

function upstreamReference(result: typeof ProcessingStageResult.Type) {
  return {
    stage: result.stage,
    resultId: result.resultId,
    attemptId: result.attemptId,
    checksum: result.checksum,
  }
}

function resultFrom(
  reference: NonNullable<(typeof ProcessingAttempt.Type)['upstream']>,
) {
  return ProcessingStageResult.make({
    ...reference,
    outcome: 'Succeeded',
    outputId: ProcessingOutputId.make(`output-${reference.attemptId}`),
    checkpointId: CheckpointId.make(`checkpoint-${reference.attemptId}`),
    sources: [],
    summary: 'Frozen retry upstream.',
    completedAt: new Date(0).toISOString(),
  })
}

function freezeSources(sources: Project['sources']) {
  const frozen: Array<typeof ProcessingFrozenSource.Type> = []
  for (const source of sources) {
    if (source.checksum === undefined) return undefined
    frozen.push(
      ProcessingFrozenSource.make({
        assetId: source.assetId,
        assetRevision: source.assetRevision,
        role: source.role,
        checksum: source.checksum,
      }),
    )
  }
  return frozen
}

function resolveSelection(
  database: DatabaseSync,
  selection: (typeof CreateProcessingProjectRequest.Type)['selection'],
) {
  const rows = Schema.decodeUnknownSync(Schema.Array(SourceRow))(
    database
      .prepare(
        'SELECT asset_id,revision,availability,comparison_group_id,captured_at,role,format,detail FROM library_assets ORDER BY captured_at,asset_id',
      )
      .all(),
  )
  const assetIds = new Set(selection.assetIds)
  const captureSetIds = new Set(selection.captureSetIds)
  const selected = rows
    .map(projectSource)
    .filter(
      (source) =>
        assetIds.has(source.assetId) ||
        (source.captureSetId !== undefined &&
          captureSetIds.has(source.captureSetId)),
    )
  if (
    [...assetIds].some(
      (assetId) => !selected.some((source) => source.assetId === assetId),
    ) ||
    [...captureSetIds].some(
      (captureSetId) =>
        !selected.some((source) => source.captureSetId === captureSetId),
    )
  )
    return undefined
  return selected
}

function projectSource(row: typeof SourceRow.Type) {
  const detail = Schema.decodeUnknownSync(StoredDetail)(JSON.parse(row.detail))
  return ProcessingProjectSource.make({
    assetId: AssetId.make(row.asset_id),
    assetRevision: AssetRevision.make(row.revision),
    role: 'Unassigned',
    suggestedRole: suggestedRole(detail.capture?.frameType),
    libraryRole: row.role,
    libraryFormat: row.format,
    ...(detail.captureSetId === undefined
      ? {}
      : { captureSetId: CaptureSetId.make(detail.captureSetId) }),
    ...(detail.targetName === undefined
      ? {}
      : { targetName: detail.targetName }),
    capturedAt: row.captured_at,
    checksum:
      detail.checksum ??
      `sha256:${digest({ assetId: row.asset_id, revision: row.revision })}`,
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

function assignSuggestedRoles(
  sources: ReadonlyArray<typeof ProcessingProjectSource.Type>,
  existingTarget?: string,
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
              `${source.targetName} does not match project target ${target}; the source remains Unassigned.`,
            ),
          ]
        : [],
    })
  })
}

function suggestedRole(
  frameType: 'light' | 'dark' | 'flat' | 'bias' | undefined,
): ProcessingSourceRole {
  if (frameType === 'light') return 'Lights'
  if (frameType === 'dark') return 'Darks'
  if (frameType === 'flat') return 'Flats'
  if (frameType === 'bias') return 'Bias'
  return 'Unassigned'
}

function withWarnings(project: Project) {
  const warnings = project.sources.flatMap((source) => {
    const result: Array<typeof ProcessingProjectWarning.Type> = [
      ...source.warnings,
    ]
    if (source.role !== source.suggestedRole)
      result.push(
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
      result.push(
        warning(
          'SourceUnavailable',
          [source.assetId],
          `${source.assetId} is frozen in the Project but its bytes are unavailable.`,
        ),
      )
    return result
  })
  return ProcessingProject.make({ ...project, warnings })
}

function warning(
  code: (typeof ProcessingProjectWarning.Type)['code'],
  assetIds: ReadonlyArray<typeof AssetId.Type>,
  message: string,
) {
  return ProcessingProjectWarning.make({ code, assetIds, message })
}

function revise(project: Project, changes: Partial<Project>) {
  const sources = changes.sources ?? project.sources
  const { targetName: _targetName, ...withoutTarget } = project
  return withWarnings(
    ProcessingProject.make({
      ...withoutTarget,
      revision: ProcessingProjectRevision.make(project.revision + 1),
      ...projectTarget(sources),
      ...changes,
      sources,
      warnings: [],
      updatedAt: new Date().toISOString(),
    }),
  )
}

function projectTarget(sources: Project['sources']) {
  const targetName = sources.find(
    (source) => source.role === 'Lights' && source.targetName !== undefined,
  )?.targetName
  return targetName === undefined ? {} : { targetName }
}

function withoutDevelopPreview(stage: typeof ProcessingStageState.Type) {
  const { developPreview: _developPreview, ...rest } = stage
  return rest
}

function activeAttempt(project: Project) {
  return project.attempts.find(
    (attempt) => attempt.state === 'queued' || attempt.state === 'running',
  )
}

function findStage(project: Project, stage: Stage) {
  return project.stages.find((candidate) => candidate.stage === stage)
}

function replaceStage(
  stages: Project['stages'],
  replacement: typeof ProcessingStageState.Type,
) {
  return stages.map((stage) =>
    stage.stage === replacement.stage ? replacement : stage,
  )
}

function readProjects(database: DatabaseSync) {
  return Schema.decodeUnknownSync(Schema.Array(ProjectRow))(
    database
      .prepare(
        'SELECT project FROM processing_projects ORDER BY updated_at,project_id',
      )
      .all(),
  ).map((row) =>
    Schema.decodeUnknownSync(ProcessingProject)(JSON.parse(row.project)),
  )
}

function readProject(
  database: DatabaseSync,
  projectId: typeof ProcessingProjectId.Type,
) {
  const row = Schema.decodeUnknownSync(Schema.optional(ProjectRow))(
    database
      .prepare('SELECT project FROM processing_projects WHERE project_id=?')
      .get(projectId),
  )
  return row === undefined
    ? undefined
    : Schema.decodeUnknownSync(ProcessingProject)(JSON.parse(row.project))
}

function persistNewProject(database: DatabaseSync, project: Project) {
  database
    .prepare(
      'INSERT INTO processing_projects(project_id,revision,project,updated_at) VALUES(?,?,?,?)',
    )
    .run(
      project.projectId,
      project.revision,
      JSON.stringify(project),
      project.updatedAt,
    )
}

function enqueue(
  database: DatabaseSync,
  work: {
    readonly workId: string
    readonly projectId: typeof ProcessingProjectId.Type
    readonly attemptId: typeof ProcessingStageAttemptId.Type
    readonly stage: Stage
    readonly enqueuedAt: string
  },
) {
  database
    .prepare(
      "INSERT INTO processing_work(work_id,project_id,kind,payload,state,stage,enqueued_at) VALUES(?,?, 'projectStage', ?, 'pending', ?, ?)",
    )
    .run(
      work.workId,
      work.projectId,
      JSON.stringify({
        projectId: work.projectId,
        attemptId: work.attemptId,
        stage: work.stage,
      }),
      work.stage,
      work.enqueuedAt,
    )
}

function saveLibraryAsset(
  database: DatabaseSync,
  project: Project,
  save: {
    readonly assetId: typeof AssetId.Type
    readonly result: typeof ProcessingStageResult.Type
  },
) {
  const now = new Date().toISOString()
  const role = save.result.stage === 'Stacking' ? 'linearMaster' : 'final'
  const detail = {
    assetId: save.assetId,
    revision: 1,
    role,
    format: 'fits',
    checksum: save.result.checksum,
    availability: 'availableLocally',
    capturedAt: now,
    comparisonGroupId: `processing-project-${project.projectId}`,
    ...(project.targetName === undefined
      ? {}
      : { targetName: project.targetName }),
    lineage: {
      sourceAssetIds: save.result.sources.map((source) => source.assetId),
      processingProjectId: project.projectId,
      processingAttemptIds: [save.result.attemptId],
      processingResultId: save.result.resultId,
      processingOutputId: save.result.outputId,
      operationIds: [save.result.attemptId],
    },
    representations: [
      { label: 'Saved Processing Project result', state: 'available' },
    ],
  }
  database
    .prepare('INSERT INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(
      save.assetId,
      1,
      role,
      'fits',
      'availableLocally',
      detail.comparisonGroupId,
      now,
      now,
      0,
      JSON.stringify(detail),
    )
  database
    .prepare(
      'UPDATE processing_artifacts SET saved=1 WHERE project_id=? AND output_id=?',
    )
    .run(project.projectId, save.result.outputId)
  database
    .prepare(
      'INSERT INTO process_asset_events (asset_id,event_type,checksum) VALUES (?,?,?)',
    )
    .run(save.assetId, 'ProcessSaved', save.result.checksum)
}

function savedAssetForOutput(
  database: DatabaseSync,
  outputId: typeof ProcessingOutputId.Type,
) {
  const rows = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({ asset_id: Schema.String, detail: Schema.String }),
    ),
  )(
    database
      .prepare(
        "SELECT asset_id,detail FROM library_assets WHERE role IN ('linearMaster','final')",
      )
      .all(),
  )
  const row = rows.find((candidate) => {
    const detail = Schema.decodeUnknownSync(LibraryDetail)(
      JSON.parse(candidate.detail),
    )
    return detail.lineage.processingOutputId === outputId
  })
  return row === undefined ? undefined : AssetId.make(row.asset_id)
}

function readReceipt(
  database: DatabaseSync,
  intentId: typeof IntentId.Type,
  caller: Caller,
  request: unknown,
) {
  const row = Schema.decodeUnknownSync(Schema.optional(ReceiptRow))(
    database
      .prepare(
        'SELECT semantic_key,response FROM processing_project_receipts WHERE idempotency_key=? AND owner_person_id=?',
      )
      .get(intentId, caller.personId),
  )
  if (row === undefined) return undefined
  if (row.semantic_key !== digest(request))
    return ProcessingProjectError.cases.IntentConflict.make({
      intentId,
    })
  const response = Schema.decodeUnknownSync(ProcessingProjectChanged)(
    JSON.parse(row.response),
  )
  return ProcessingProjectChanged.make({ ...response, replayed: true })
}

function writeReceipt(
  database: DatabaseSync,
  intentId: typeof IntentId.Type,
  caller: Caller,
  request: unknown,
  response: typeof ProcessingProjectChanged.Type,
) {
  database
    .prepare('INSERT INTO processing_project_receipts VALUES (?,?,?,?)')
    .run(intentId, caller.personId, digest(request), JSON.stringify(response))
}

function authority(caller: Caller) {
  return decideProcessingProjectAuthority({
    personId: PersonId.make(caller.personId),
    clientId: ClientId.make(caller.clientId),
    role: caller.role ?? 'viewer',
    capability: caller.capability,
  })
}

function authorityError(caller: Caller): ProjectError | undefined {
  const decision = authority(caller)
  return ProcessingProjectAuthority.guards.Allowed(decision)
    ? undefined
    : ProcessingProjectError.cases.ProcessAuthorityDenied.make({
        reason: decision.reason,
      })
}

function publishNotice(database: DatabaseSync, project: Project) {
  const notice = ProcessingProjectNotice.make({
    projectId: project.projectId,
    revision: project.revision,
  })
  for (const subscriber of noticeSubscribers.get(database) ?? []) {
    subscriber.values.push(notice)
    subscriber.waiters.shift()?.()
  }
}

function workResult(
  outcome: Exclude<ProcessingProjectWorkResult['outcome'], 'idle'>,
  stage: Stage,
  backlog: number,
  oldestAgeSeconds: number,
): ProcessingProjectWorkResult {
  return { outcome, kind: 'projectStage', stage, backlog, oldestAgeSeconds }
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
