import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Context, Layer, Option, Schema } from 'effect'
import {
  PlanIntent,
  PlanWorkspaceProjection,
  type ObserveIntent,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  resumableRunPhase,
  type AcceptRunDefinitionResult,
  type CommandResult,
  type ControlEvent,
  type FailureReason,
  type Run,
  type RunDefinition,
  type SavePlanDraftResult,
} from '../services/domain-state.ts'
import {
  evaluatePlan,
  planWorkspaceProjection,
} from '../services/runtime-bootstrap.ts'
import type { StateSqliteRepositoryShape } from './state-sqlite-repository.ts'

type StartRun = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'StartAcceptedRun' }
>
type AcceptRunDefinition = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'AcceptRunDefinition' }
>
type PauseRun = Extract<
  typeof ObserveIntent.Type,
  { readonly _tag: 'PauseRun' }
>
type ResumeRun = Extract<
  typeof ObserveIntent.Type,
  { readonly _tag: 'ResumeRun' }
>
type FakePolicy = Extract<
  typeof ObserveIntent.Type,
  | { readonly _tag: 'StopRun' }
  | { readonly _tag: 'SkipSequence' }
  | { readonly _tag: 'RetryPhase' }
  | { readonly _tag: 'RequestPark' }
>
type PreviewRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'PreviewRunMutation' }
>
type ApplyRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'ApplyRunMutation' }
>
type ApproveDisruptiveRunMutation = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'ApproveDisruptiveRunMutation' }
>
type SavePlanDraft = Extract<
  typeof PlanIntent.Type,
  { readonly _tag: 'SaveDraft' }
>
const StoredRunDefinition = Schema.Struct({
  id: Schema.String,
  sourcePlanId: Schema.String,
  sourcePlanRevision: Schema.Int,
  acceptedAt: Schema.String,
  executor: Schema.Literals(['fake', 'fixture']),
  plan: PlanWorkspaceProjection,
})
const PlanReceiptRow = Schema.Struct({ response: Schema.String })
const RunDefinitionRow = Schema.Struct({
  run_definition_id: Schema.String,
  source_plan_id: Schema.String,
  source_plan_revision: Schema.Int,
  definition: Schema.String,
  accepted_at: Schema.String,
})
const RunDefinitionReceiptRow = Schema.Struct({ response: Schema.String })
const ReceiptRow = Schema.Struct({ response: Schema.String })
const InterventionReceiptRow = Schema.Struct({
  semantic_key: Schema.String,
  response: Schema.String,
})
const CommandResultSchema = Schema.Any
const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
const operatorMessages: Record<string, string> = {
  Unauthenticated: 'A verified member identity is required.',
  FreshnessConflict:
    'The plan or control changed. Review the current plan before accepting it.',
  PlanUnavailable: 'No observation plan is installed.',
  PlanNotReady: 'The plan is not ready for RunDefinition acceptance.',
  RunDefinitionAlreadyAccepted:
    'This plan revision already has an immutable RunDefinition.',
  ClientReadOnly: 'Monitoring is read-only on this client.',
  ControlLeaseLost:
    'Control changed hands. Your command was not sent to the observatory; the accepted run continues.',
  OwnerRequired: 'Only the owner can accept a RunDefinition.',
  ActiveRunConflict: 'A run is already active. Return to Observe.',
  RunRevisionConflict:
    'The active run changed. Refresh Observe before trying again.',
  AlreadyPaused: 'This run is already paused.',
  AlreadyTerminal: 'This run is terminal and cannot be paused.',
  NotPaused: 'This run is not paused.',
  ResumePhaseUnavailable: 'The paused run has no resumable phase.',
  IdempotencyConflict:
    'This idempotency key was already used for a different command.',
  InvalidInput: 'The service could not read that action.',
  DraftUnchanged: 'The displayed draft does not contain any changes to save.',
  RunPaused: 'Pause was accepted by the service.',
  RunResumed: 'Resume was accepted by the service.',
  RunStopped: 'Stop was accepted by the service. This run cannot be resumed.',
  FakeSequenceSkipped: 'The remaining fake sequence was skipped.',
  FakePhaseRetried: 'The fake phase will retry once.',
  FakeParkRequested: 'Fake park was requested; no mount moved.',
  RunMutationApplied: 'The fake-run mutation was applied.',
  PreviewUnavailable: 'The requested fake-run preview is unavailable.',
  PreviewExpired: 'The requested fake-run preview expired.',
  ApprovalRequired: 'This fake-run mutation requires approval.',
  ApprovalMismatch: 'The fake-run approval does not match the preview.',
  RetryExhausted: 'The fake phase has already retried once.',
  PolicyUnavailable: 'This fake-run policy is unavailable.',
}
export type RunTransition = {
  readonly status: number
  readonly body: unknown
  readonly event?: { readonly type: string; readonly cursor: number }
}
export type RunReject = (reason: FailureReason) => RunTransition
export interface RunSqliteRepositoryShape {
  readonly saveDraft: (
    input: SavePlanDraft,
    identity: LocalIdentity,
  ) => RunTransition
  readonly acceptRunDefinition: (
    input: AcceptRunDefinition,
    identity: LocalIdentity,
  ) => RunTransition
  readonly startAcceptedRun: (
    input: StartRun,
    identity: LocalIdentity,
  ) => RunTransition
  readonly previewRunMutation: (
    input: PreviewRunMutation,
    identity: LocalIdentity,
  ) => RunTransition
  readonly applyRunMutation: (
    input: ApplyRunMutation | ApproveDisruptiveRunMutation,
    identity: LocalIdentity,
  ) => RunTransition
  readonly pause: (input: PauseRun, identity: LocalIdentity) => RunTransition
  readonly resume: (input: ResumeRun, identity: LocalIdentity) => RunTransition
  readonly stop: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly skip: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly retry: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly park: (input: FakePolicy, identity: LocalIdentity) => RunTransition
  readonly advance: (identity: LocalIdentity) =>
    | {
        readonly body: unknown
        readonly event: { readonly type: string; readonly cursor: number }
      }
    | undefined
}
export class RunSqliteRepository extends Context.Service<
  RunSqliteRepository,
  RunSqliteRepositoryShape
>()('@astro-console/server/RunSqliteRepository') {}
function acceptRun(
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
    const fixture = definition.executor === 'fixture'
    const run: Run = fixture
      ? {
          id: 'run-m27-001',
          revision: 1,
          phase: 'capture',
          target: definition.plan.sequences[0]?.target ?? current.plan.target,
          progress: 0,
          sourceDefinitionId: definition.id,
          activeSequenceIndex: 0,
          completedSequenceCount: 0,
        }
      : {
          id: `run-${definition.id}`,
          revision: 1,
          phase: 'preflight',
          target: definition.plan.sequences[0]?.target ?? current.plan.target,
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
      definition.sourcePlanId === input.planId &&
      definition.sourcePlanRevision === input.expectedPlanRevision &&
      stored.run?.sourceDefinitionId === definition.id
        ? { status: 200, body: stored }
        : reject('IdempotencyConflict'),
  })
}
function advanceFakeRunState(
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
  if (definition.executor !== 'fake') return undefined
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
  const next = definition.plan.sequences[activeSequenceIndex + 1]
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
      target: next.target,
      progress: Math.floor(
        (completed / definition.plan.sequences.length) * 100,
      ),
      activeSequenceIndex: activeSequenceIndex + 1,
      completedSequenceCount: completed,
    },
  }
}

function hasFakeRunDefinition(
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
  const definition = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(row.definition),
  )
  return definition.executor === 'fake' || definition.executor === 'fixture'
}
function hasFakeExecutor(
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
      .executor === 'fake'
  )
}

function acceptRunIntervention(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: PauseRun | ResumeRun,
  intent: 'pause' | 'resume',
  identity: LocalIdentity,
) {
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (!hasFakeRunDefinition(db, stateRepository))
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
    db.exec('COMMIT')
    return { status: 202, body: result, event: { type: eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function acceptFakePolicy(
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  input: FakePolicy,
  path: string,
  identity: LocalIdentity,
) {
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (!hasFakeRunDefinition(db, stateRepository))
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

function previewRunMutation(
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
      ? `The unstarted second fake sequence (${second.target}) remains after the current sequence.`
      : input.mutation === 'shortenSecond'
        ? `The unstarted second fake sequence (${second.target}) is shortened in this fake run.`
        : `Current fake sequence progress is discarded and ${second.target} starts at preflight.`
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

function applyRunMutation(
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
      ).plan.sequences[(run.activeSequenceIndex ?? 0) + 1]?.target ??
        run.target)
}

function reject(reason: FailureReason) {
  return {
    status:
      reason === 'Unauthenticated'
        ? 401
        : reason === 'FreshnessConflict' ||
            reason === 'PlanUnavailable' ||
            reason === 'PlanNotReady' ||
            reason === 'RunDefinitionAlreadyAccepted' ||
            reason === 'ActiveRunConflict' ||
            reason === 'RunRevisionConflict' ||
            reason === 'AlreadyPaused' ||
            reason === 'AlreadyTerminal' ||
            reason === 'NotPaused' ||
            reason === 'ResumePhaseUnavailable' ||
            reason === 'IdempotencyConflict' ||
            reason === 'PreviewUnavailable' ||
            reason === 'PreviewExpired' ||
            reason === 'RetryExhausted' ||
            reason === 'PolicyUnavailable' ||
            reason === 'DraftUnchanged'
          ? 409
          : reason === 'InvalidInput'
            ? 400
            : 403,
    body: {
      outcome: 'rejected' as const,
      reason,
      message:
        operatorMessages[reason] ??
        'The requested fake-run action is unavailable.',
    },
  }
}
function acceptPlanDraft(
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
function acceptRunDefinition(
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
export const runSqliteRepositoryLayer = (
  db: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  reject: RunReject,
) =>
  Layer.sync(RunSqliteRepository, () =>
    RunSqliteRepository.of({
      saveDraft: (input, identity) =>
        acceptPlanDraft(db, stateRepository, input, identity),
      acceptRunDefinition: (input, identity) =>
        acceptRunDefinition(db, stateRepository, input, identity),
      startAcceptedRun: (input, identity) =>
        acceptRun(db, stateRepository, input, identity),
      previewRunMutation: (input, identity) => {
        const body = previewRunMutation(db, stateRepository, input, identity)
        return {
          status:
            body.outcome === 'rejected' ? reject(body.reason).status : 202,
          body,
          ...('event' in body ? { event: body.event } : {}),
        }
      },
      applyRunMutation: (input, identity) =>
        applyRunMutation(
          db,
          stateRepository,
          input,
          PlanIntent.guards.ApproveDisruptiveRunMutation(input),
          identity,
        ),
      pause: (input, identity) =>
        acceptRunIntervention(db, stateRepository, input, 'pause', identity),
      resume: (input, identity) =>
        acceptRunIntervention(db, stateRepository, input, 'resume', identity),
      stop: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'stop', identity),
      skip: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'skip', identity),
      retry: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'retry', identity),
      park: (input, identity) =>
        acceptFakePolicy(db, stateRepository, input, 'park', identity),
      advance: (identity) => advanceFakeRunState(db, stateRepository, identity),
    }),
  )
