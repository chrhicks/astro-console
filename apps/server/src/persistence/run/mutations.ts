import { createHash, randomUUID } from 'node:crypto'
import { type CommandResult, type Run } from '../../services/domain-state.ts'
import { hasFakeExecutor } from './lifecycle.ts'
import {
  DatabaseSync,
  Schema,
  StoredRunDefinition,
  CommandResultSchema,
  type LocalIdentity,
  type PreviewRunMutation,
  type ApplyRunMutation,
  type ApproveDisruptiveRunMutation,
  type StateSqliteRepositoryShape,
  isOwner,
  reject,
} from './shared.ts'

const StoredMutationPreview = Schema.Struct({
  preview_id: Schema.String,
  run_id: Schema.String,
  run_revision: Schema.Int,
  owner_person_id: Schema.String,
  mutation: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
  consequences: Schema.String,
  classification: Schema.Literals(['nonDisruptive', 'notice', 'disruptive']),
  expires_at: Schema.String,
  applied_at: Schema.NullOr(Schema.String),
})

export function previewRunMutation(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: PreviewRunMutation,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired').body
  if (identity.capability === 'readOnly') return reject('ClientReadOnly').body
  if (!hasFakeExecutor(db, stateRepository))
    return reject('RunRevisionConflict').body
  const current = stateRepository.state()
  const run = current.run
  if (run === null || input.expectedRunRevision !== run.revision)
    return reject('RunRevisionConflict').body
  if (
    run.phase === 'paused' ||
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested' ||
    run.activeSequenceIndex !== 0
  )
    return reject('PolicyUnavailable').body
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        mutation: input.mutation,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_mutation_preview_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const receiptRow = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(receiptRaw)
  if (receiptRow !== undefined)
    return receiptRow.semantic_key === semanticKey
      ? JSON.parse(receiptRow.response)
      : reject('IdempotencyConflict').body
  const definition =
    run.sourceDefinitionId === undefined
      ? undefined
      : Schema.decodeUnknownSync(
          Schema.optional(Schema.Struct({ definition: Schema.String })),
        )(
          db
            .prepare(
              'SELECT definition FROM run_definitions WHERE run_definition_id=?',
            )
            .get(run.sourceDefinitionId),
        )
  const second =
    definition === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(definition.definition),
        ).plan.sequences[1]
  if (second === undefined) return reject('PolicyUnavailable').body
  const classification =
    input.mutation === 'reprioritizeSecond'
      ? ('nonDisruptive' as const)
      : input.mutation === 'shortenSecond'
        ? ('notice' as const)
        : ('disruptive' as const)
  const consequences =
    input.mutation === 'reprioritizeSecond'
      ? `The unstarted second fake sequence (${second.definition.targetName}) remains after the current sequence.`
      : input.mutation === 'shortenSecond'
        ? `The unstarted second fake sequence (${second.definition.targetName}) is shortened in this fake run.`
        : `Current fake sequence progress is discarded and ${second.definition.targetName} starts at preflight.`
  const preview = {
    previewId: `run-mutation-${randomUUID()}`,
    runId: run.id,
    runRevision: run.revision,
    mutation: input.mutation,
    classification,
    consequences,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    approvalRequired: classification === 'disruptive',
  }
  const result = {
    outcome: 'accepted' as const,
    preview,
    ...(classification === 'disruptive' &&
    current.control.holderClientId === identity.clientId
      ? {
          approvalToken: createHash('sha256')
            .update(`${preview.previewId}:${consequences}`)
            .digest('hex'),
        }
      : {}),
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
    })
    db.prepare(
      'INSERT INTO run_mutation_previews VALUES (?,?,?,?,?,?,?,?,NULL)',
    ).run(
      preview.previewId,
      run.id,
      run.revision,
      identity.personId,
      preview.mutation,
      consequences,
      classification,
      preview.expiresAt,
    )
    db.prepare(
      'INSERT INTO run_mutation_preview_receipts VALUES (?,?,?,?)',
    ).run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(result),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'RunMutationPreviewed',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      ...result,
      event: { type: 'RunMutationPreviewed', cursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function applyRunMutation(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: ApplyRunMutation | ApproveDisruptiveRunMutation,
  approved: boolean,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (!hasFakeExecutor(db, stateRepository))
    return reject('RunRevisionConflict')
  const current = stateRepository.state()
  const run = current.run
  if (
    input.expectedLeaseRevision !== current.control.revision ||
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        previewId: input.previewId,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
        approved,
      }),
    )
    .digest('hex')
  const priorRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_intervention_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const prior = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(priorRaw)
  if (prior !== undefined)
    return prior.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(prior.response),
          ),
        }
      : reject('IdempotencyConflict')
  if (run === null || input.expectedRunRevision !== run.revision)
    return reject('RunRevisionConflict')
  if (
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested'
  )
    return reject('PolicyUnavailable')
  const rowRaw: unknown = db
    .prepare(
      'SELECT preview_id,run_id,run_revision,owner_person_id,mutation,consequences,classification,expires_at,applied_at FROM run_mutation_previews WHERE preview_id=?',
    )
    .get(input.previewId)
  const preview = Schema.decodeUnknownSync(
    Schema.optional(StoredMutationPreview),
  )(rowRaw)
  if (preview === undefined || preview.run_id !== run.id)
    return reject('PreviewUnavailable')
  if (preview.applied_at !== null) return reject('PreviewUnavailable')
  if (Date.parse(preview.expires_at) <= Date.now())
    return reject('PreviewExpired')
  if (preview.run_revision !== run.revision)
    return reject('RunRevisionConflict')
  if (preview.classification === 'disruptive' && !approved)
    return reject('ApprovalRequired')
  if (preview.classification !== 'disruptive' && approved)
    return reject('ApprovalMismatch')
  if (
    preview.classification === 'disruptive' &&
    'approvalToken' in input &&
    input.approvalToken !==
      createHash('sha256')
        .update(`${preview.preview_id}:${preview.consequences}`)
        .digest('hex')
  )
    return reject('ApprovalMismatch')
  const nextRun: Run =
    preview.mutation === 'discardCurrent'
      ? {
          ...run,
          revision: run.revision + 1,
          phase: 'preflight',
          target: mutationNextTarget(db, run),
          progress: Math.floor(
            (((run.completedSequenceCount ?? 0) + 1) / 2) * 100,
          ),
          activeSequenceIndex: (run.activeSequenceIndex ?? 0) + 1,
          completedSequenceCount: (run.completedSequenceCount ?? 0) + 1,
          appliedMutations: [
            ...(run.appliedMutations ?? []),
            { previewId: preview.preview_id, kind: preview.mutation },
          ],
        }
      : {
          ...run,
          revision: run.revision + 1,
          appliedMutations: [
            ...(run.appliedMutations ?? []),
            { previewId: preview.preview_id, kind: preview.mutation },
          ],
        }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: nextRun,
    })
    db.prepare(
      'UPDATE run_mutation_previews SET applied_at=? WHERE preview_id=? AND applied_at IS NULL',
    ).run(new Date().toISOString(), preview.preview_id)
    const body: CommandResult = {
      outcome: 'accepted',
      eventType: 'RunMutationApplied',
      run: nextRun,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO run_intervention_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(body),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'RunMutationApplied',
      JSON.stringify(body),
    )
    db.exec('COMMIT')
    return { status: 202, body, event: { type: 'RunMutationApplied', cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function mutationNextTarget(db: DatabaseSync, run: Run) {
  const raw: unknown =
    run.sourceDefinitionId === undefined
      ? undefined
      : db
          .prepare(
            'SELECT definition FROM run_definitions WHERE run_definition_id=?',
          )
          .get(run.sourceDefinitionId)
  const definition = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  return definition === undefined
    ? run.target
    : (Schema.decodeUnknownSync(StoredRunDefinition)(
        JSON.parse(definition.definition),
      ).plan.sequences[(run.activeSequenceIndex ?? 0) + 1]?.definition
        .targetName ?? run.target)
}
