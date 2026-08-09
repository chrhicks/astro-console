import { Option } from 'effect'
import {
  resumableRunPhase,
  type CommandResult,
  type ControlEvent,
  type Run,
} from '../../services/domain-state.ts'
import {
  createHash,
  DatabaseSync,
  Schema,
  StoredRunDefinition,
  CommandResultSchema,
  ReceiptRow,
  InterventionReceiptRow,
  operatorMessages,
  type LocalIdentity,
  type StartRun,
  type PauseRun,
  type ResumeRun,
  type FakePolicy,
  type StateSqliteRepositoryShape,
  reject,
} from './shared.ts'

export function acceptRun(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: StartRun,
  identity: LocalIdentity,
) {
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
      'SELECT semantic_key,response FROM run_start_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(receiptRaw)
  if (existing !== undefined)
    return existing.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(existing.response),
          ),
        }
      : reject('IdempotencyConflict')
  const definitionRaw: unknown = db
    .prepare(
      'SELECT definition FROM run_definitions WHERE source_plan_id=? AND source_plan_revision=?',
    )
    .get(input.planId, input.expectedPlanRevision)
  const definitionRow = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(definitionRaw)
  const definition =
    definitionRow === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(definitionRow.definition),
        )
  const legacy =
    definition === undefined
      ? legacyStartReplay(db, input, identity)
      : legacyStartReplay(db, input, identity, definition)
  if (legacy !== undefined) return legacy
  const current = stateRepository.state()
  if (current.plan.readiness !== 'ready' || !current.plan.runEligible)
    return reject('PlanUnavailable')
  if (
    input.planId !== current.plan.id ||
    input.expectedPlanRevision !== current.plan.revision ||
    input.expectedLeaseRevision !== current.control.revision
  )
    return reject('FreshnessConflict')
  if (current.control.holderClientId !== identity.clientId)
    return reject('ControlLeaseLost')
  if (definition === undefined) return reject('PlanUnavailable')
  if (current.run !== null) return reject('ActiveRunConflict')
  db.exec('BEGIN IMMEDIATE')
  try {
    const fixture = definition.definition.executor === 'fixture'
    const run: Run = fixture
      ? {
          id: 'run-m27-001',
          revision: 1,
          phase: 'capture',
          target:
            definition.definition.sequences[0]?.targetName ??
            current.plan.target,
          progress: 0,
          sourceDefinitionId: definition.id,
          activeSequenceIndex: 0,
          completedSequenceCount: 0,
        }
      : {
          id: definition.definition.runId,
          revision: 1,
          phase: 'preflight',
          target:
            definition.definition.sequences[0]?.targetName ??
            current.plan.target,
          progress: 0,
          sourceDefinitionId: definition.id,
          activeSequenceIndex: 0,
          completedSequenceCount: 0,
        }
    const next = {
      ...current,
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: current.eventCursor + 1,
      run,
    }
    stateRepository.commit({
      snapshotVersion: next.snapshotVersion,
      eventCursor: next.eventCursor,
      run: next.run,
    })
    const result: CommandResult = {
      outcome: 'accepted',
      run: next.run,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO run_start_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(result),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      next.eventCursor,
      'RunStarted',
      JSON.stringify(result),
    )
    if (definition.definition.executor === 'real')
      db.prepare(
        "INSERT INTO run_executor_work (work_id,run_id,kind,payload,state) VALUES (?,?,?,?, 'pending')",
      ).run(
        `${run.id}:begin`,
        run.id,
        'BeginRun',
        JSON.stringify({ sequenceIndex: 0 }),
      )
    db.exec('COMMIT')
    return {
      status: 202,
      body: result,
      event: { type: 'RunStarted', cursor: next.eventCursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function legacyStartReplay(
  db: DatabaseSync,
  input: StartRun,
  identity: LocalIdentity,
  definition?: typeof StoredRunDefinition.Type,
) {
  const raw: unknown = db
    .prepare('SELECT response FROM receipts WHERE idempotency_key=?')
    .get(input.idempotencyKey)
  const receipt = Schema.decodeUnknownSync(Schema.optional(ReceiptRow))(raw)
  if (receipt === undefined) return undefined
  const result = Schema.decodeUnknownOption(CommandResultSchema)(
    JSON.parse(receipt.response),
  )
  return Option.match(result, {
    onNone: () => reject('IdempotencyConflict'),
    onSome: (stored) =>
      stored.outcome === 'accepted' &&
      stored.snapshot.identity.personId === identity.personId &&
      stored.snapshot.identity.clientId === identity.clientId &&
      stored.snapshot.plan.id === input.planId &&
      stored.snapshot.plan.revision === input.expectedPlanRevision &&
      stored.snapshot.control.revision === input.expectedLeaseRevision &&
      definition !== undefined &&
      definition.definition.sourcePlanId === input.planId &&
      definition.definition.sourcePlanRevision === input.expectedPlanRevision &&
      stored.run?.sourceDefinitionId === definition.id
        ? { status: 200, body: stored }
        : reject('IdempotencyConflict'),
  })
}
export function advanceFakeRunState(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  identity: LocalIdentity,
) {
  const current = stateRepository.state()
  if (
    current.run?.sourceDefinitionId === undefined ||
    current.run.activeSequenceIndex === undefined ||
    current.run.completedSequenceCount === undefined
  )
    return undefined
  const definitionRaw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(current.run.sourceDefinitionId)
  const definitionRow = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(definitionRaw)
  if (definitionRow === undefined) return undefined
  const definition = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(definitionRow.definition),
  )
  if (definition.definition.executor !== 'fake') return undefined
  const transition = nextFakeRunTransition(current.run, definition)
  if (transition === undefined) return undefined
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: transition.run,
    })
    const body = {
      outcome: 'accepted' as const,
      run: transition.run,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      transition.eventType,
      JSON.stringify(body),
    )
    db.exec('COMMIT')
    return { body, event: { type: transition.eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function nextFakeRunTransition(
  run: Run,
  definition: typeof StoredRunDefinition.Type,
) {
  if (run.phase === 'preflight')
    return {
      eventType: 'RunPreflightCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'acquire' as const,
        progress: 10,
      },
    }
  if (run.phase === 'acquire')
    return {
      eventType: 'RunAcquireCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'capture' as const,
        progress: 25,
      },
    }
  if (run.phase === 'capture')
    return {
      eventType: 'RunCaptureCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'verify' as const,
        progress: 75,
      },
    }
  if (run.phase !== 'verify') return undefined
  const completedSequenceCount = run.completedSequenceCount
  const activeSequenceIndex = run.activeSequenceIndex
  if (completedSequenceCount === undefined || activeSequenceIndex === undefined)
    return undefined
  const completed = completedSequenceCount + 1
  const next = definition.definition.sequences[activeSequenceIndex + 1]
  if (next === undefined)
    return {
      eventType: 'RunCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'completed' as const,
        progress: 100,
        completedSequenceCount: completed,
      },
    }
  return {
    eventType: 'RunSequenceVerified',
    run: {
      ...run,
      revision: run.revision + 1,
      phase: 'preflight' as const,
      target: next.targetName,
      progress: Math.floor(
        (completed / definition.definition.sequences.length) * 100,
      ),
      activeSequenceIndex: activeSequenceIndex + 1,
      completedSequenceCount: completed,
    },
  }
}

function activeExecutor(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
) {
  const run = stateRepository.state().run
  if (run?.sourceDefinitionId === undefined) return undefined
  const raw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(run.sourceDefinitionId)
  const row = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  if (row === undefined) return undefined
  const definition = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(row.definition),
  )
  return definition.definition.executor
}
export function hasFakeExecutor(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
) {
  const run = stateRepository.state().run
  if (run?.sourceDefinitionId === undefined) return false
  const raw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(run.sourceDefinitionId)
  const row = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  if (row === undefined) return false
  return (
    Schema.decodeUnknownSync(StoredRunDefinition)(JSON.parse(row.definition))
      .definition.executor === 'fake'
  )
}

export function acceptRunIntervention(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: PauseRun | ResumeRun,
  intent: 'pause' | 'resume',
  identity: LocalIdentity,
) {
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  const executor = activeExecutor(db, stateRepository)
  if (executor === undefined || (executor === 'real' && intent !== 'pause'))
    return reject('RunRevisionConflict')
  stateRepository.expireReconnectGrace()
  const current = stateRepository.state()
  if (input.expectedLeaseRevision !== current.control.revision)
    return reject('ControlLeaseLost')
  if (current.control.holderClientId !== identity.clientId)
    return reject('ControlLeaseLost')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        intent,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_intervention_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(receiptRaw)
  if (existing !== undefined)
    return existing.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(existing.response),
          ),
        }
      : reject('IdempotencyConflict')
  if (current.run === null) return reject('RunRevisionConflict')
  if (
    executor === 'real' &&
    intent === 'pause' &&
    current.run.phase === 'verify'
  )
    return reject('PolicyUnavailable')
  if (
    current.run.phase === 'completed' ||
    current.run.phase === 'stopped' ||
    current.run.phase === 'parkRequested'
  )
    return reject('AlreadyTerminal')
  if (intent === 'pause') {
    if (input.expectedRunRevision !== current.run.revision)
      return reject('RunRevisionConflict')
    if (current.run.phase === 'paused') return reject('AlreadyPaused')
  }
  if (intent === 'resume') {
    if (current.run.phase !== 'paused') return reject('NotPaused')
    if (input.expectedRunRevision !== current.run.revision)
      return reject('RunRevisionConflict')
    if (current.run.resumablePhase === undefined)
      return reject('ResumePhaseUnavailable')
  }
  const run = current.run
  if (run === null) return reject('RunRevisionConflict')
  let nextRun: Run
  if (intent === 'pause') {
    const resumablePhase = resumableRunPhase(run.phase)
    if (resumablePhase === undefined) return reject('AlreadyTerminal')
    nextRun = {
      ...run,
      revision: run.revision + 1,
      phase: 'paused',
      resumablePhase,
    }
  } else {
    const { resumablePhase, ...resumed } = run
    if (resumablePhase === undefined) return reject('ResumePhaseUnavailable')
    nextRun = {
      ...resumed,
      revision: run.revision + 1,
      phase: resumablePhase,
    }
  }
  const eventType: ControlEvent =
    intent === 'pause' ? 'RunPaused' : 'RunResumed'
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: nextRun,
    })
    const result: CommandResult = {
      outcome: 'accepted',
      eventType,
      message: operatorMessages[eventType] ?? '',
      run: nextRun,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO run_intervention_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(result),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      eventType,
      JSON.stringify(result),
    )
    if (intent === 'pause') enqueueExposureAbort(db, nextRun.id)
    db.exec('COMMIT')
    return { status: 202, body: result, event: { type: eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function acceptFakePolicy(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: FakePolicy,
  path: string,
  identity: LocalIdentity,
) {
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  const executor = activeExecutor(db, stateRepository)
  if (executor === undefined || (executor === 'real' && path !== 'stop'))
    return reject('RunRevisionConflict')
  const current = stateRepository.state()
  if (
    input.expectedLeaseRevision !== current.control.revision ||
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  const run = current.run
  if (run === null) return reject('RunRevisionConflict')
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
  if (definition === undefined) return reject('RunRevisionConflict')
  const sequences = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(definition.definition),
  ).plan.sequences
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        path,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
      }),
    )
    .digest('hex')
  const priorRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_intervention_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const prior = Schema.decodeUnknownSync(
    Schema.optional(InterventionReceiptRow),
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
  if (input.expectedRunRevision !== run.revision)
    return reject('RunRevisionConflict')
  if (
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested'
  )
    return reject('AlreadyTerminal')
  if (run.phase === 'paused' && path !== 'stop' && path !== 'park')
    return reject('PolicyUnavailable')
  const policyPhase = resumableRunPhase(run.phase)
  if (path === 'retry' && policyPhase === undefined)
    return reject('PolicyUnavailable')
  const activeSequenceIndex = run.activeSequenceIndex
  const completedSequenceCount = run.completedSequenceCount
  if (activeSequenceIndex === undefined || completedSequenceCount === undefined)
    return reject('PolicyUnavailable')
  const nextSequence = sequences[activeSequenceIndex + 1]
  if (path === 'retry' && run.retryPhase !== undefined)
    return reject('RetryExhausted')
  let nextRun: Run
  if (path === 'stop')
    nextRun = { ...run, revision: run.revision + 1, phase: 'stopped' }
  else if (path === 'skip')
    nextRun =
      nextSequence === undefined
        ? {
            ...run,
            revision: run.revision + 1,
            phase: 'completed',
            progress: 100,
            completedSequenceCount: completedSequenceCount + 1,
          }
        : {
            ...run,
            revision: run.revision + 1,
            phase: 'preflight',
            target: nextSequence.target,
            progress: Math.floor(
              ((completedSequenceCount + 1) / sequences.length) * 100,
            ),
            activeSequenceIndex: activeSequenceIndex + 1,
            completedSequenceCount: completedSequenceCount + 1,
          }
  else if (path === 'retry') {
    if (policyPhase === undefined) return reject('PolicyUnavailable')
    nextRun = { ...run, revision: run.revision + 1, retryPhase: policyPhase }
  } else
    nextRun = { ...run, revision: run.revision + 1, phase: 'parkRequested' }
  const eventType: ControlEvent =
    path === 'stop'
      ? 'RunStopped'
      : path === 'skip'
        ? 'FakeSequenceSkipped'
        : path === 'retry'
          ? 'FakePhaseRetried'
          : 'FakeParkRequested'
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    stateRepository.commit({
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: nextRun,
    })
    const body: CommandResult = {
      outcome: 'accepted',
      eventType,
      run: nextRun,
      snapshot: stateRepository.snapshot(identity),
    }
    db.prepare('INSERT INTO run_intervention_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(body),
    )
    if (path === 'stop')
      db.prepare('INSERT INTO receipts VALUES (?,?)').run(
        input.idempotencyKey,
        JSON.stringify(body),
      )
    if (path === 'stop') enqueueExposureAbort(db, nextRun.id)
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      eventType,
      JSON.stringify(body),
    )
    db.exec('COMMIT')
    return { status: 202, body, event: { type: eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function enqueueExposureAbort(db: DatabaseSync, runId: string) {
  const settledAt = new Date().toISOString()
  db.prepare(
    "UPDATE run_executor_work SET state='cancelled',settled_at=?,last_error='Cancelled by run intervention before provider command.' WHERE run_id=? AND kind IN ('BeginRun','StartExposure') AND state='pending'",
  ).run(settledAt, runId)
  db.prepare(
    "INSERT OR IGNORE INTO run_executor_work (work_id,run_id,kind,payload,state) SELECT ?,?,'AbortExposure',?,'pending' WHERE EXISTS (SELECT 1 FROM run_executor_work WHERE run_id=? AND kind='StartExposure' AND state IN ('commandAttempted','observing','reconciling'))",
  ).run(`${runId}:abort`, runId, JSON.stringify({ sequenceIndex: 0 }), runId)
}
