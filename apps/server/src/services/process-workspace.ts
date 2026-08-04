import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { Effect, Schema } from 'effect'
import {
  ActorContext,
  AssetId,
  AssetRevision,
  CheckpointId,
  EventCursor,
  ProcessingOutputId,
  ProcessingSourceRef,
  SnapshotVersion,
  StagedArtifact,
} from '@astro-console/v2-contracts'
import {
  makeProcessingServerSimulation,
  type ProcessingSimulationState,
  ClientId,
  PersonId,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'

const Stored = Schema.Struct({ state: Schema.String })
const Asset = Schema.Struct({ asset_id: Schema.String, revision: Schema.Int, role: Schema.String, availability: Schema.String })

export function processSnapshot(database: DatabaseSync) {
  return Effect.runSync(service(database).snapshot())
}

export function executeProcessCommand(
  database: DatabaseSync,
  raw: unknown,
  identity: LocalIdentity,
) {
  if (identity.role !== 'owner' || identity.capability !== 'controlCapable')
    return { outcome: 'rejected' as const, reason: 'OwnerRequired' }
  try {
    const processor = service(database)
    const actor = ActorContext.cases.Member.make({
      personId: PersonId.make(identity.personId),
      clientId: ClientId.make(identity.clientId),
      role: 'owner',
      capability: 'controlCapable',
    })
    let result = Effect.runSync(processor.execute(raw, actor))
    const work = Effect.runSync(processor.readState()).outbox.at(-1)
    if (work?._tag === 'BuildLinearMaster')
      Effect.runSync(processor.completeBuild(work.sessionId, ProcessingOutputId.make(`linear-${work.sessionId}`), `sha256:linear-${work.sessionId}`))
    else if (work?._tag === 'ComputePreview')
      Effect.runSync(processor.completePreview(work.sessionId, work.previewId, ProcessingOutputId.make(`preview-${work.previewId}`)))
    else if (work?._tag === 'RunAppliedOperation' || work?._tag === 'RetryProcessingStage')
      Effect.runSync(
        work._tag === 'RunAppliedOperation' && Effect.runSync(processor.readState()).sessions.find(
          (session) => session.sessionId === work.sessionId,
        )?.activeAttempt?.toolId === 'deterministic-fail'
          ? processor.failApply(work.sessionId, work.attemptId, CheckpointId.make(`checkpoint-${work.attemptId}`), 'deterministic-stage-failure')
          : processor.completeApply(work.sessionId, work.attemptId, ProcessingOutputId.make(`output-${work.attemptId}`), `sha256:output-${work.attemptId}`, CheckpointId.make(`checkpoint-${work.attemptId}`)),
      )
    else if (work?._tag === 'MaterializeProcessingArtifacts') {
      const saved = Effect.runSync(processor.completeSave(work.operationId, work.artifacts.map((artifact) => StagedArtifact.make({ assetId: AssetId.make(`asset-${artifact.outputId}`), outputId: artifact.outputId, role: artifact.role, format: artifact.format, checksum: `sha256:${artifact.outputId}`, permanentBytesReady: true }))))
      result = saved
    }
    persist(database, Effect.runSync(processor.readState()))
    return { outcome: 'accepted' as const, ...result }
  } catch {
    return { outcome: 'rejected' as const, reason: 'InvalidInput' }
  }
}

function service(database: DatabaseSync) {
  return Effect.runSync(makeProcessingServerSimulation({
    initialState: read(database),
    occurredAt: '2026-08-04T00:00:00.000Z',
    discardConfirmation: (sessionId) => `discard-${sessionId}`,
  }))
}

function read(database: DatabaseSync): ProcessingSimulationState {
  const stored = Schema.decodeUnknownSync(Schema.optional(Stored))(database.prepare('SELECT state FROM processing_workspace WHERE id=1').get())
  if (stored !== undefined) return JSON.parse(stored.state) as ProcessingSimulationState
  const rows = Schema.decodeUnknownSync(Schema.Array(Asset))(database.prepare("SELECT asset_id,revision,role,availability FROM library_assets WHERE role IN ('original','linearMaster')").all())
  return {
    sessions: [], sourceCatalog: rows.filter((row) => row.availability === 'availableLocally').map((row) => ProcessingSourceRef.make({ assetId: AssetId.make(row.asset_id), assetRevision: AssetRevision.make(row.revision), role: row.role === 'linearMaster' ? 'linearMaster' : 'original', checksum: `sha256:${row.asset_id}`, locallyAvailable: true })), pendingSaves: [], assets: [], viewedFindings: [], pressure: { state: 'normal' }, snapshotVersion: SnapshotVersion.make(0), eventCursor: EventCursor.make(0), receipts: [], results: [], events: [], outbox: [],
  }
}

function persist(database: DatabaseSync, state: ProcessingSimulationState) {
  database.prepare('INSERT INTO processing_workspace(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(JSON.stringify(state))
  for (const asset of state.assets) {
    const capturedAt = '2026-08-04T00:00:00.000Z'
    const detail = {
      assetId: asset.assetId, revision: asset.revision, role: asset.role,
      format: asset.format,
      availability: asset.localAvailable ? 'availableLocally' : 'unavailable',
      capturedAt, comparisonGroupId: asset.lineage.comparisonGroupId,
      lineage: { sourceAssetIds: asset.lineage.sourceAssetIds, runId: 'process-session', solveAttemptId: 'deterministic-process' },
      representations: [],
    }
    database.prepare('INSERT OR IGNORE INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)').run(asset.assetId, asset.revision, asset.role, asset.format, detail.availability, detail.comparisonGroupId, capturedAt, capturedAt, 0, JSON.stringify(detail))
  }
}
