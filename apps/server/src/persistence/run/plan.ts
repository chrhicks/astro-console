import { createHash, randomUUID } from 'node:crypto'
import { PlanWorkspaceProjection } from '@astro-console/v2-contracts'
import {
  type RunDefinition,
  type SavePlanDraftResult,
  type AcceptRunDefinitionResult,
} from '../../services/domain-state.ts'
import {
  evaluatePlan,
  planWorkspaceProjection,
} from '../../services/runtime-bootstrap.ts'
import {
  DatabaseSync,
  Schema,
  PlanReceiptRow,
  RunDefinitionRow,
  RunDefinitionReceiptRow,
  type LocalIdentity,
  type SavePlanDraft,
  type AcceptRunDefinition,
  type StateSqliteRepositoryShape,
  isOwner,
  reject,
} from './shared.ts'

export function acceptPlanDraft(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: SavePlanDraft,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (
    input.sequences.length < 2 ||
    new Set(input.sequences.map((sequence) => sequence.sequenceId)).size !==
      input.sequences.length
  )
    return reject('InvalidInput')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        planId: input.planId,
        expectedPlanRevision: input.expectedPlanRevision,
        sequences: input.sequences,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT response FROM observing_plan_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(Schema.optional(PlanReceiptRow))(
    receiptRaw,
  )
  if (existing !== undefined) {
    const stored = Schema.decodeUnknownSync(
      Schema.Struct({ semanticKey: Schema.String, result: Schema.Unknown }),
    )(JSON.parse(existing.response))
    return stored.semanticKey === semanticKey
      ? { status: 200, body: stored.result }
      : reject('IdempotencyConflict')
  }
  const current = stateRepository.state()
  if (current.plan.readiness === 'unavailable') return reject('PlanUnavailable')
  if (
    input.planId !== current.plan.id ||
    input.expectedPlanRevision !== current.plan.revision ||
    current.run !== null
  )
    return reject('FreshnessConflict')
  const currentPlan = planWorkspaceProjection(db, 'plan')
  const currentSequences = currentPlan.sequences.map(
    ({ viability, ...sequence }) => sequence,
  )
  if (JSON.stringify(input.sequences) === JSON.stringify(currentSequences))
    return reject('DraftUnchanged')
  const plan = evaluatePlan({
    planId: input.planId,
    revision: current.plan.revision + 1,
    sequences: input.sequences,
  })
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    db.prepare(
      'UPDATE observing_plans SET revision=?,projection=?,run_eligible=0 WHERE plan_id=? AND revision=?',
    ).run(
      plan.revision,
      JSON.stringify(plan),
      plan.planId,
      current.plan.revision,
    )
    db.prepare(
      "UPDATE workspace_projections SET value=? WHERE name='plan'",
    ).run(JSON.stringify(plan))
    stateRepository.commit({
      planRevision: plan.revision,
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
    })
    const result: SavePlanDraftResult = {
      outcome: 'accepted',
      plan,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO observing_plan_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify({ semanticKey, result }),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'PlanDraftSaved',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      status: 202,
      body: result,
      event: { type: 'PlanDraftSaved', cursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export function acceptRunDefinition(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: AcceptRunDefinition,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        planId: input.planId,
        expectedPlanRevision: input.expectedPlanRevision,
        expectedLeaseRevision: input.expectedLeaseRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT response FROM run_definition_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(RunDefinitionReceiptRow),
  )(receiptRaw)
  if (existing !== undefined) {
    const stored = Schema.decodeUnknownSync(
      Schema.Struct({ semanticKey: Schema.String, result: Schema.Unknown }),
    )(JSON.parse(existing.response))
    return stored.semanticKey === semanticKey
      ? { status: 200, body: stored.result }
      : reject('IdempotencyConflict')
  }
  const current = stateRepository.state()
  if (current.plan.readiness === 'unavailable') return reject('PlanUnavailable')
  if (
    input.planId !== current.plan.id ||
    input.expectedPlanRevision !== current.plan.revision ||
    input.expectedLeaseRevision !== current.control.revision
  )
    return reject('FreshnessConflict')
  if (current.run !== null) return reject('ActiveRunConflict')
  if (current.plan.readiness !== 'ready') return reject('PlanNotReady')
  const definitionRaw: unknown = db
    .prepare(
      'SELECT run_definition_id,source_plan_id,source_plan_revision,definition,accepted_at FROM run_definitions WHERE source_plan_id=? AND source_plan_revision=?',
    )
    .get(input.planId, input.expectedPlanRevision)
  if (
    Schema.decodeUnknownSync(Schema.optional(RunDefinitionRow))(
      definitionRaw,
    ) !== undefined
  )
    return reject('RunDefinitionAlreadyAccepted')
  const planRaw: unknown = db
    .prepare(
      'SELECT projection FROM observing_plans WHERE plan_id=? AND revision=?',
    )
    .get(input.planId, input.expectedPlanRevision)
  const plan = Schema.decodeUnknownSync(
    Schema.Struct({ projection: Schema.String }),
  )(planRaw)
  const acceptedAt = new Date().toISOString()
  const definition: RunDefinition = {
    id: `run-definition-${randomUUID()}`,
    sourcePlanId: input.planId,
    sourcePlanRevision: input.expectedPlanRevision,
    acceptedAt,
    executor: 'fake',
    plan: Schema.decodeUnknownSync(PlanWorkspaceProjection)(
      JSON.parse(plan.projection),
    ),
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    const marked = db
      .prepare(
        'UPDATE observing_plans SET run_eligible=1 WHERE plan_id=? AND revision=? AND run_eligible=0',
      )
      .run(input.planId, input.expectedPlanRevision)
    if (marked.changes !== 1) {
      db.exec('ROLLBACK')
      return reject('RunDefinitionAlreadyAccepted')
    }
    db.prepare('INSERT INTO run_definitions VALUES (?,?,?,?,?)').run(
      definition.id,
      definition.sourcePlanId,
      definition.sourcePlanRevision,
      JSON.stringify(definition),
      definition.acceptedAt,
    )
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
    })
    const result: AcceptRunDefinitionResult = {
      outcome: 'accepted',
      runDefinition: definition,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO run_definition_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify({ semanticKey, result }),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'RunDefinitionAccepted',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      status: 202,
      body: result,
      event: { type: 'RunDefinitionAccepted', cursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
