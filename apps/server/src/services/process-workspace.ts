import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Effect, Exit, Match, Schema } from 'effect'
import {
  ActorContext,
  AssetId,
  AssetRevision,
  CheckpointId,
  Command,
  CommandEnvelope,
  EventCursor,
  FrozenProcessingSelection,
  HostPressure,
  ProcessingOutputId,
  ProcessingProjection,
  ProcessingRevision,
  ProcessingWork,
  ProcessingSourceRef,
  SnapshotVersion,
  StagedArtifact,
  leaveProcessingSessionUnfinished,
  projectProcessingProjection,
  projectProcessingProjectActions,
} from '@astro-console/v2-contracts'
import {
  makeProcessingServerSimulation,
  type ProcessingSimulationState,
  ClientId,
  PersonId,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import { processRecommendedSet } from '../persistence/library-sqlite-repository.ts'
import {
  executeProcessingProjectCommand,
  isProcessingProjectCommand,
  processingProjects,
} from './processing-project-service.ts'

const Stored = Schema.Struct({ state: Schema.String })
const Asset = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  role: Schema.String,
  availability: Schema.String,
})
const ComparisonGroupRow = Schema.Struct({ comparison_group_id: Schema.String })
const WorkReceiptRow = Schema.Struct({ response: Schema.String })
const FailedBuildWorkRow = Schema.Struct({
  work_id: Schema.String,
  checkpoint: Schema.NullOr(Schema.String),
})
const ClaimedWorkRow = Schema.Struct({
  payload: Schema.String,
  state: Schema.String,
  claim_token: Schema.NullOr(Schema.String),
})
const RetryBuildResponse = Schema.Struct({
  outcome: Schema.Literal('accepted'),
  replayed: Schema.Boolean,
  effect: Schema.Literal('buildRetryQueued'),
  projection: ProcessingProjection,
})

export function processSnapshot(
  database: DatabaseSync,
  identity: LocalIdentity,
) {
  const projection = projectProcessingProjection(read(database), {
    role: identity.role ?? 'viewer',
    capability: identity.capability,
  })
  const projects = processingProjects(database)
  const authority = {
    role: identity.role ?? 'viewer',
    capability: identity.capability,
  } as const
  return Schema.decodeUnknownSync(ProcessingProjection)({
    ...projection,
    projects,
    projectActions: projectProcessingProjectActions(projects, authority),
    ...(projects.length === 0
      ? {}
      : { selectedProjectId: projects.at(-1)?.projectId }),
    work: database
      .prepare(
        'SELECT session_id,kind,state,stage,checkpoint,attempts FROM processing_work ORDER BY rowid',
      )
      .all()
      .map((row) => {
        const value = row as Record<string, unknown>
        return {
          sessionId: value.session_id,
          kind: value.kind,
          state: value.state,
          ...(value.stage === null ? {} : { stage: value.stage }),
          ...(value.checkpoint === null
            ? {}
            : { checkpoint: value.checkpoint }),
          attempts: value.attempts,
        }
      }),
  })
}

export function prepareProcessingWorkspaceAfterRestart(database: DatabaseSync) {
  const stored = Schema.decodeUnknownSync(Schema.optional(Stored))(
    database.prepare('SELECT state FROM processing_workspace WHERE id=1').get(),
  )
  if (stored === undefined) return false
  const state = read(database)
  const selected = state.sessions.find(
    (session) => session.sessionId === state.selectedSessionId,
  )
  if (selected?.lifecycle !== 'active') return false
  const transition = leaveProcessingSessionUnfinished(selected)
  if (!('session' in transition)) return false
  persist(database, {
    ...state,
    sessions: state.sessions.map((session) =>
      session.sessionId === transition.session.sessionId
        ? transition.session
        : session,
    ),
    snapshotVersion: SnapshotVersion.make(state.snapshotVersion + 1),
  })
  return true
}

export function recordProcessPressure(
  database: DatabaseSync,
  measurement: typeof HostPressure.Type,
) {
  const processor = service(database)
  const decision = Effect.runSync(processor.evaluatePressure(measurement))
  persist(database, Effect.runSync(processor.readState()))
  return decision
}

export function executeProcessCommand(
  database: DatabaseSync,
  raw: unknown,
  identity: LocalIdentity,
) {
  if (identity.role !== 'owner' || identity.capability !== 'controlCapable')
    return { outcome: 'rejected' as const, reason: 'OwnerRequired' }
  try {
    const envelope = Schema.decodeUnknownSync(CommandEnvelope)(raw)
    const command = Schema.decodeUnknownSync(Command)(envelope.command)
    if (isProcessingProjectCommand(command))
      return executeProcessingProjectCommand(database, command, identity)
    if (Command.guards.RetryProcessingBuild(command))
      return retryBuild(database, command, identity)
    let selection: ReturnType<typeof processRecommendedSet> | undefined
    let comparisonGroupId: string | undefined
    if (
      Command.guards.StartProcessingSession(command) &&
      command.selection === 'recommended'
    ) {
      const firstAssetId = command.sourceAssetIds[0]
      const group = Schema.decodeUnknownSync(
        Schema.optional(ComparisonGroupRow),
      )(
        database
          .prepare(
            'SELECT comparison_group_id FROM library_assets WHERE asset_id=?',
          )
          .get(firstAssetId),
      )
      if (group === undefined)
        return {
          outcome: 'rejected' as const,
          reason: 'SourceSelectionInvalid',
        }
      comparisonGroupId = group.comparison_group_id
      selection = processRecommendedSet(database, comparisonGroupId)
      if (selection.needsReviewCount > 0)
        return { outcome: 'rejected' as const, reason: 'SourceReviewRequired' }
      const included = selection.candidates
        .filter((candidate) => candidate.effectiveDecision === 'include')
        .map((candidate) => candidate.assetId)
      if (
        included.length === 0 ||
        included.length !== command.sourceAssetIds.length ||
        included.some(
          (assetId, index) => assetId !== command.sourceAssetIds[index],
        )
      )
        return {
          outcome: 'rejected' as const,
          reason: 'SourceSelectionInvalid',
        }
    }
    const processor = service(database)
    const actor = ActorContext.cases.Member.make({
      personId: PersonId.make(identity.personId),
      clientId: ClientId.make(identity.clientId),
      role: 'owner',
      capability: 'controlCapable',
    })
    const outboxLength = Effect.runSync(processor.readState()).outbox.length
    const result = Effect.runSync(processor.execute(raw, actor))
    let state = Effect.runSync(processor.readState())
    if (selection !== undefined && comparisonGroupId !== undefined) {
      const sessionId = state.selectedSessionId
      state = {
        ...state,
        sessions: state.sessions.map((session) =>
          session.sessionId !== sessionId
            ? session
            : {
                ...session,
                selection: Schema.decodeUnknownSync(FrozenProcessingSelection)({
                  comparisonGroupId,
                  candidateCount: selection.candidateCount,
                  includedCount: selection.includedCount,
                  excludedCount: selection.excludedCount,
                  candidates: selection.candidates.map((candidate) => ({
                    assetId: candidate.assetId,
                    assetRevision: candidate.assetRevision,
                    platformDecision: candidate.platformDecision,
                    manualDecision: candidate.manualDecision,
                    effectiveDecision:
                      candidate.effectiveDecision === 'include'
                        ? ('include' as const)
                        : ('exclude' as const),
                    hardIneligible: candidate.hardIneligible,
                    measuredSharpness: candidate.measuredSharpness,
                    reason: candidate.reason,
                  })),
                }),
              },
        ),
      }
    }
    const work = state.outbox.slice(outboxLength)
    database.exec('BEGIN IMMEDIATE')
    try {
      persist(database, state)
      for (const item of work) enqueue(database, item)
      database.exec('COMMIT')
    } catch (cause) {
      database.exec('ROLLBACK')
      throw cause
    }
    return { outcome: 'accepted' as const, ...result }
  } catch {
    return { outcome: 'rejected' as const, reason: 'InvalidInput' }
  }
}

function retryBuild(
  database: DatabaseSync,
  command: Extract<typeof Command.Type, { _tag: 'RetryProcessingBuild' }>,
  identity: LocalIdentity,
) {
  const existing = Schema.decodeUnknownSync(Schema.optional(WorkReceiptRow))(
    database
      .prepare(
        'SELECT response FROM processing_work_receipts WHERE idempotency_key=?',
      )
      .get(command.idempotencyKey),
  )
  if (existing !== undefined)
    return Schema.decodeUnknownSync(RetryBuildResponse)(
      JSON.parse(existing.response),
    )
  const state = read(database)
  const session = state.sessions.find(
    (candidate) => candidate.sessionId === command.sessionId,
  )
  const work = Schema.decodeUnknownSync(Schema.optional(FailedBuildWorkRow))(
    database
      .prepare(
        "SELECT work_id,checkpoint FROM processing_work WHERE session_id=? AND kind='build' AND state='failed' ORDER BY rowid DESC LIMIT 1",
      )
      .get(command.sessionId),
  )
  if (
    session === undefined ||
    session.phase !== 'build' ||
    session.revision !== command.expectedProcessingRevision ||
    work === undefined ||
    work.checkpoint !== command.checkpoint
  )
    return { outcome: 'rejected' as const, reason: 'InvalidInput' }
  const revised = {
    ...state,
    sessions: state.sessions.map((candidate) =>
      candidate.sessionId === session.sessionId
        ? {
            ...candidate,
            revision: ProcessingRevision.make(candidate.revision + 1),
          }
        : candidate,
    ),
    snapshotVersion: SnapshotVersion.make(state.snapshotVersion + 1),
    eventCursor: EventCursor.make(state.eventCursor + 1),
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    const changed = database
      .prepare(
        "UPDATE processing_work SET state='pending',claim_token=NULL,claimed_at=NULL,last_error=NULL WHERE work_id=? AND state='failed' AND checkpoint=?",
      )
      .run(work.work_id, command.checkpoint)
    if (changed.changes !== 1) throw new Error('stale build retry')
    persist(database, revised)
    const response = {
      outcome: 'accepted' as const,
      replayed: false,
      effect: 'buildRetryQueued',
      projection: processSnapshot(database, identity),
    }
    database
      .prepare('INSERT INTO processing_work_receipts VALUES (?,?)')
      .run(command.idempotencyKey, JSON.stringify(response))
    database.exec('COMMIT')
    return response
  } catch {
    database.exec('ROLLBACK')
    return { outcome: 'rejected' as const, reason: 'InvalidInput' }
  }
}

export function settleProcessWork(
  database: DatabaseSync,
  workId: string,
  claimToken: string,
  result: {
    readonly outcome: 'completed' | 'failed'
    readonly checksum: string
    readonly artifacts?: ReadonlyArray<{
      readonly path: string
      readonly checksum: string
    }>
  },
) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const row = Schema.decodeUnknownSync(Schema.optional(ClaimedWorkRow))(
      database
        .prepare(
          'SELECT payload,state,claim_token FROM processing_work WHERE work_id=?',
        )
        .get(workId),
    )
    if (
      row === undefined ||
      row.state !== 'claimed' ||
      row.claim_token !== claimToken
    ) {
      database.exec('ROLLBACK')
      return { outcome: 'stale' as const }
    }
    const work = Schema.decodeUnknownSync(ProcessingWork)(
      JSON.parse(row.payload),
    )
    const processor = service(database)
    if (ProcessingWork.guards.BuildLinearMaster(work))
      assertAcceptedTransition(
        Effect.runSync(
          processor.completeBuild(
            work.sessionId,
            ProcessingOutputId.make(`linear-${work.sessionId}`),
            result.checksum,
          ),
        ),
      )
    else if (ProcessingWork.guards.ComputePreview(work))
      assertAcceptedTransition(
        Effect.runSync(
          processor.completePreview(
            work.sessionId,
            work.previewId,
            ProcessingOutputId.make(`preview-${work.previewId}`),
          ),
        ),
      )
    else if (
      ProcessingWork.guards.RunAppliedOperation(work) ||
      ProcessingWork.guards.RetryProcessingStage(work)
    ) {
      if (result.outcome === 'failed')
        assertAcceptedTransition(
          Effect.runSync(
            processor.failApply(
              work.sessionId,
              work.attemptId,
              CheckpointId.make(`checkpoint-${work.attemptId}`),
              'deterministic-adapter-failure',
            ),
          ),
        )
      else
        assertAcceptedTransition(
          Effect.runSync(
            processor.completeApply(
              work.sessionId,
              work.attemptId,
              ProcessingOutputId.make(`output-${work.attemptId}`),
              result.checksum,
              CheckpointId.make(`checkpoint-${work.attemptId}`),
            ),
          ),
        )
    } else if (ProcessingWork.guards.MaterializeProcessingArtifacts(work))
      assertAcceptedSave(
        Effect.runSync(
          processor
            .completeSave(
              work.operationId,
              work.artifacts.map((artifact, index) =>
                StagedArtifact.make({
                  assetId: AssetId.make(
                    `asset-process-${stableUuid(`${workId}:${index}`)}`,
                  ),
                  outputId: artifact.outputId,
                  role: artifact.role,
                  format: artifact.format,
                  checksum:
                    result.artifacts?.[index]?.checksum ?? result.checksum,
                  permanentBytesReady: true,
                }),
              ),
            )
            .pipe(Effect.exit),
        ),
      )
    const changed = database
      .prepare(
        "UPDATE processing_work SET state='settled',settled_at=?,checkpoint=COALESCE(checkpoint,'complete') WHERE work_id=? AND state='claimed' AND claim_token=?",
      )
      .run(new Date().toISOString(), workId, claimToken)
    if (changed.changes !== 1) throw new StaleProcessCompletion()
    persist(database, Effect.runSync(processor.readState()))
    const outputId = processingOutputId(work)
    for (const [index, artifact] of (result.artifacts ?? []).entries()) {
      database
        .prepare(
          'INSERT OR REPLACE INTO processing_artifacts VALUES (?,?,?,?,?,?,?)',
        )
        .run(
          `${workId}:${index}`,
          work.sessionId,
          workId,
          ProcessingWork.guards.MaterializeProcessingArtifacts(work)
            ? (work.artifacts[index]?.outputId ?? null)
            : outputId,
          artifact.path,
          artifact.checksum,
          ProcessingWork.guards.MaterializeProcessingArtifacts(work) ? 1 : 0,
        )
    }
    if (ProcessingWork.guards.MaterializeProcessingArtifacts(work)) {
      for (const artifact of work.artifacts)
        database
          .prepare(
            'UPDATE processing_artifacts SET saved=1 WHERE session_id=? AND output_id=?',
          )
          .run(work.sessionId, artifact.outputId)
    }
    database.exec('COMMIT')
    return { outcome: 'settled' as const }
  } catch (cause) {
    database.exec('ROLLBACK')
    if (!(cause instanceof StaleProcessCompletion))
      return { outcome: 'unavailable' as const }
    database
      .prepare(
        "UPDATE processing_work SET state='superseded',settled_at=? WHERE work_id=? AND claim_token=?",
      )
      .run(new Date().toISOString(), workId, claimToken)
    return { outcome: 'stale' as const }
  }
}

function assertAcceptedTransition(transition: { readonly _tag: string }) {
  Match.value(transition).pipe(
    Match.when({ _tag: 'Rejected' }, () => {
      throw new StaleProcessCompletion()
    }),
    Match.orElse(() => undefined),
  )
}

function assertAcceptedSave(completion: Exit.Exit<unknown, unknown>) {
  if (Exit.isFailure(completion)) throw new StaleProcessCompletion()
}

class StaleProcessCompletion extends Error {}

function processingOutputId(work: typeof ProcessingWork.Type) {
  if (ProcessingWork.guards.BuildLinearMaster(work))
    return `linear-${work.sessionId}`
  if (ProcessingWork.guards.ComputePreview(work))
    return `preview-${work.previewId}`
  if (
    ProcessingWork.guards.RunAppliedOperation(work) ||
    ProcessingWork.guards.RetryProcessingStage(work)
  )
    return `output-${work.attemptId}`
  return null
}

function stableUuid(value: string) {
  const hash = createHash('sha256').update(value).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function enqueue(database: DatabaseSync, work: typeof ProcessingWork.Type) {
  const kind = ProcessingWork.match(work, {
    BuildLinearMaster: () => 'build' as const,
    ComputePreview: () => 'preview' as const,
    RunAppliedOperation: () => 'apply' as const,
    RetryProcessingStage: () => 'retry' as const,
    MaterializeProcessingArtifacts: () => 'save' as const,
    CleanupDiscardedSession: () => 'cleanup' as const,
  })
  database
    .prepare(
      'INSERT INTO processing_work(work_id,session_id,kind,payload,state,stage,enqueued_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      randomUUID(),
      work.sessionId,
      kind,
      JSON.stringify(work),
      'pending',
      ProcessingWork.guards.BuildLinearMaster(work) ? 'validate' : null,
      new Date().toISOString(),
    )
}

function service(database: DatabaseSync) {
  return Effect.runSync(
    makeProcessingServerSimulation({
      initialState: read(database),
      occurredAt: '2026-08-04T00:00:00.000Z',
      discardConfirmation: (sessionId) => `discard-${sessionId}`,
    }),
  )
}

function read(database: DatabaseSync): ProcessingSimulationState {
  const stored = Schema.decodeUnknownSync(Schema.optional(Stored))(
    database.prepare('SELECT state FROM processing_workspace WHERE id=1').get(),
  )
  if (stored !== undefined)
    // The service writes this complete aggregate and reads it back unchanged.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return JSON.parse(stored.state) as ProcessingSimulationState
  const rows = Schema.decodeUnknownSync(Schema.Array(Asset))(
    database
      .prepare(
        "SELECT asset_id,revision,role,availability FROM library_assets WHERE role IN ('original','linearMaster')",
      )
      .all(),
  )
  return {
    sessions: [],
    sourceCatalog: rows
      .filter((row) => row.availability === 'availableLocally')
      .map((row) =>
        ProcessingSourceRef.make({
          assetId: AssetId.make(row.asset_id),
          assetRevision: AssetRevision.make(row.revision),
          role: row.role === 'linearMaster' ? 'linearMaster' : 'original',
          checksum: `sha256:${row.asset_id}`,
          locallyAvailable: true,
        }),
      ),
    pendingSaves: [],
    assets: [],
    viewedFindings: [],
    pressure: { state: 'normal' },
    snapshotVersion: SnapshotVersion.make(0),
    eventCursor: EventCursor.make(0),
    receipts: [],
    results: [],
    events: [],
    outbox: [],
  }
}

function persist(database: DatabaseSync, state: ProcessingSimulationState) {
  database
    .prepare(
      'INSERT INTO processing_workspace(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
    )
    .run(JSON.stringify(state))
  for (const asset of state.assets) {
    const capturedAt = '2026-08-04T00:00:00.000Z'
    const detail = {
      assetId: asset.assetId,
      revision: asset.revision,
      role: asset.role,
      format: asset.format,
      checksum: asset.checksum,
      availability: asset.localAvailable
        ? 'availableLocally'
        : 'temporarilyUnavailable',
      capturedAt,
      comparisonGroupId: asset.lineage.comparisonGroupId,
      lineage: {
        sourceAssetIds: asset.lineage.sourceAssetIds,
        ...(asset.lineage.processingSessionId === undefined
          ? {}
          : { processingSessionId: asset.lineage.processingSessionId }),
        ...(asset.lineage.processingOutputId === undefined
          ? {}
          : { processingOutputId: asset.lineage.processingOutputId }),
        operationIds: asset.lineage.operationIds,
      },
      representations: [
        { label: 'Permanent local Process output', state: 'available' },
      ],
    }
    database
      .prepare(
        'INSERT OR IGNORE INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        asset.assetId,
        asset.revision,
        asset.role,
        asset.format,
        detail.availability,
        detail.comparisonGroupId,
        capturedAt,
        capturedAt,
        0,
        JSON.stringify(detail),
      )
  }
}
