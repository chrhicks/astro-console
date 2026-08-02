import { Data, Effect, Schema } from 'effect'
import {
  AtomicCommit,
  makeAtomicServerSimulation,
} from './atomic-server-simulation.js'
import { Command, CommandEnvelope } from './commands.js'
import { DomainEvent, DomainEventEnvelope } from './events.js'
import {
  ActorContext,
  CommandGateDecision,
  IdempotencyState,
  evaluateCommandGate,
} from './gate.js'
import {
  IdempotencyClassification,
  IdempotencyReceipt,
  IdempotencyRequest,
  classifyIdempotency,
} from './idempotency.js'
import {
  ClientId,
  CommandResultRef,
  EventCursor,
  LeaseRevision,
  NormalizedInputHash,
  RunRevision,
  SnapshotVersion,
} from './primitives.js'
import {
  ActiveRunState,
  RunDefinition,
  RunInterventionDecision,
  RunWork,
  decideRunIntervention,
} from './run.js'
import {
  RunCommandRejected,
  RunMutationProjection,
} from './run-mutation-server-simulation.js'

export const RunInterventionResponse = Schema.Struct({
  replayed: Schema.Boolean,
  resultRef: CommandResultRef,
  intervention: Schema.Literals(['pause', 'resume', 'stop']),
  projection: RunMutationProjection,
})

export interface RunInterventionResponse extends Schema.Schema.Type<
  typeof RunInterventionResponse
> {}

export class RunInterventionRejected extends Schema.TaggedErrorClass<RunInterventionRejected>()(
  'RunSimulation.InterventionRejected',
  {
    reason: Schema.Literals([
      'AlreadyPaused',
      'NotPaused',
      'AlreadyTerminal',
      'ResumePhaseUnavailable',
      'ResultUnavailable',
    ]),
    currentRunRevision: RunRevision,
  },
) {}

interface StoredInterventionResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly response: RunInterventionResponse
}

export interface RunInterventionSimulationState {
  readonly definition: RunDefinition
  readonly run: ActiveRunState
  readonly leaseRevision: typeof LeaseRevision.Type
  readonly leaseHolderClientId: typeof ClientId.Type
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredInterventionResult>
  readonly events: ReadonlyArray<DomainEventEnvelope>
  readonly outbox: ReadonlyArray<typeof RunWork.Type>
}

type MemberActor = Extract<
  typeof ActorContext.Type,
  { readonly _tag: 'Member' }
>
type InterventionCommand =
  | typeof Command.cases.PauseRun.Type
  | typeof Command.cases.ResumeRun.Type
  | typeof Command.cases.StopRun.Type

type Intervention = Data.TaggedEnum<{
  Pause: {}
  Resume: {}
  Stop: {}
}>

const Intervention = Data.taggedEnum<Intervention>()

export interface RunInterventionServerSimulation {
  readonly pause: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    RunInterventionResponse,
    Schema.SchemaError | RunCommandRejected | RunInterventionRejected
  >
  readonly resume: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    RunInterventionResponse,
    Schema.SchemaError | RunCommandRejected | RunInterventionRejected
  >
  readonly stop: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    RunInterventionResponse,
    Schema.SchemaError | RunCommandRejected | RunInterventionRejected
  >
  readonly readState: () => Effect.Effect<RunInterventionSimulationState>
}

export const makeRunInterventionServerSimulation = Effect.fn(
  'RunInterventionSimulation.make',
)(function* (initialState: RunInterventionSimulationState, occurredAt: string) {
  const simulation = yield* makeAtomicServerSimulation(
    initialState,
    (state) => state.outbox,
  )

  const pause: RunInterventionServerSimulation['pause'] = Effect.fn(
    'RunInterventionSimulation.pause',
  )(function* (rawRequest, actor) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(Command.cases.PauseRun)(
      envelope.command,
    )
    return yield* simulation.transact((current) =>
      acceptIntervention(
        current,
        envelope,
        command,
        actor,
        Intervention.Pause(),
        occurredAt,
      ),
    )
  })
  const resume: RunInterventionServerSimulation['resume'] = Effect.fn(
    'RunInterventionSimulation.resume',
  )(function* (rawRequest, actor) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(Command.cases.ResumeRun)(
      envelope.command,
    )
    return yield* simulation.transact((current) =>
      acceptIntervention(
        current,
        envelope,
        command,
        actor,
        Intervention.Resume(),
        occurredAt,
      ),
    )
  })
  const stop: RunInterventionServerSimulation['stop'] = Effect.fn(
    'RunInterventionSimulation.stop',
  )(function* (rawRequest, actor) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(Command.cases.StopRun)(
      envelope.command,
    )
    return yield* simulation.transact((current) =>
      acceptIntervention(
        current,
        envelope,
        command,
        actor,
        Intervention.Stop(),
        occurredAt,
      ),
    )
  })

  return {
    pause,
    resume,
    stop,
    readState: simulation.readState,
  } satisfies RunInterventionServerSimulation
})

function acceptIntervention(
  current: RunInterventionSimulationState,
  envelope: CommandEnvelope,
  command: InterventionCommand,
  actor: MemberActor,
  intervention: Intervention,
  occurredAt: string,
): Effect.Effect<
  AtomicCommit<RunInterventionSimulationState, RunInterventionResponse>,
  RunCommandRejected | RunInterventionRejected
> {
  const request = IdempotencyRequest.make({
    idempotencyKey: command.idempotencyKey,
    personId: actor.personId,
    commandTag: command._tag,
    normalizedInputHash: NormalizedInputHash.make(
      JSON.stringify([
        `${command._tag}.v1`,
        command.runId,
        command.expectedRunRevision,
        command.expectedLeaseRevision,
      ]),
    ),
  })
  const receipt = current.receipts.find(
    (candidate) => candidate.idempotencyKey === request.idempotencyKey,
  )
  const classification = classifyIdempotency(request, receipt)
  const gate = evaluateCommandGate({
    envelope,
    actor,
    connected: true,
    snapshotVersion: current.snapshotVersion,
    currentRevisions: {
      run: current.run.revision,
      lease: current.leaseRevision,
    },
    leaseHolderClientId: current.leaseHolderClientId,
    idempotency: gateIdempotency(classification),
  })

  return CommandGateDecision.$match(gate, {
    Rejected: ({ failure }) => Effect.fail(new RunCommandRejected({ failure })),
    ReplayPending: () => reject(current, 'ResultUnavailable'),
    ReplayRecorded: () => replay(current, receipt),
    Accepted: () =>
      commitIntervention(current, envelope, request, intervention, occurredAt),
  })
}

function commitIntervention(
  current: RunInterventionSimulationState,
  envelope: CommandEnvelope,
  request: IdempotencyRequest,
  intervention: Intervention,
  occurredAt: string,
): Effect.Effect<
  AtomicCommit<RunInterventionSimulationState, RunInterventionResponse>,
  RunInterventionRejected
> {
  const intent = Intervention.$match(intervention, {
    Pause: () => 'pause' as const,
    Resume: () => 'resume' as const,
    Stop: () => 'stop' as const,
  })
  const decision = decideRunIntervention(current.run, intent)
  return RunInterventionDecision.$match(decision, {
    Ineligible: ({ reason }) => reject(current, reason),
    Applied: ({ state, work }) => {
      const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
      const snapshotVersion = SnapshotVersion.make(current.snapshotVersion + 1)
      const eventCursor = EventCursor.make(current.eventCursor + 1)
      const event = interventionEvent(
        intervention,
        current.run.phase,
        state.phase,
        state.runId,
      )
      const nextWithoutResult: RunInterventionSimulationState = {
        ...current,
        run: state,
        snapshotVersion,
        eventCursor,
        receipts: [
          ...current.receipts,
          IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef }),
        ],
        results: current.results,
        events: [
          ...current.events,
          DomainEventEnvelope.make({
            eventId: `event-${eventCursor}`,
            aggregateKind: 'ActiveRun',
            aggregateId: state.runId,
            aggregateRevision: state.revision,
            occurredAt,
            commandId: envelope.commandId,
            event,
            schemaVersion: 1,
          }),
        ],
        outbox: [...current.outbox, work],
      }
      const response = RunInterventionResponse.make({
        replayed: false,
        resultRef,
        intervention: intent,
        projection: project(nextWithoutResult),
      })
      return Effect.succeed({
        state: {
          ...nextWithoutResult,
          results: [...current.results, { resultRef, response }],
        },
        result: response,
      })
    },
  })
}

function interventionEvent(
  intervention: Intervention,
  previousPhase: ActiveRunState['phase'],
  nextPhase: ActiveRunState['phase'],
  runId: ActiveRunState['runId'],
): typeof DomainEvent.Type {
  return Intervention.$match(intervention, {
    Pause: () => DomainEvent.cases.RunPaused.make({ runId, previousPhase }),
    Resume: () =>
      DomainEvent.cases.RunResumed.make({ runId, resumedPhase: nextPhase }),
    Stop: () => DomainEvent.cases.RunStopped.make({ runId, previousPhase }),
  })
}

function replay(
  current: RunInterventionSimulationState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
) {
  if (receipt === undefined || !IdempotencyReceipt.guards.Recorded(receipt))
    return reject(current, 'ResultUnavailable')
  const result = current.results.find(
    (candidate) => candidate.resultRef === receipt.resultRef,
  )
  if (result === undefined) return reject(current, 'ResultUnavailable')
  return Effect.succeed({
    state: current,
    result: RunInterventionResponse.make({
      ...result.response,
      replayed: true,
      projection: project(current),
    }),
  })
}

function reject(
  current: RunInterventionSimulationState,
  reason: RunInterventionRejected['reason'],
) {
  return Effect.fail(
    new RunInterventionRejected({
      reason,
      currentRunRevision: current.run.revision,
    }),
  )
}

function project(state: RunInterventionSimulationState): RunMutationProjection {
  return RunMutationProjection.make({
    snapshotVersion: state.snapshotVersion,
    eventCursor: state.eventCursor,
    definition: state.definition,
    run: state.run,
  })
}

function gateIdempotency(
  classification: IdempotencyClassification,
): typeof IdempotencyState.Type {
  return IdempotencyClassification.$match(classification, {
    Fresh: () => IdempotencyState.cases.Fresh.make({}),
    PendingMatch: ({ operationId }) =>
      operationId === undefined
        ? IdempotencyState.cases.PendingMatch.make({})
        : IdempotencyState.cases.PendingMatch.make({ operationId }),
    RecordedMatch: () => IdempotencyState.cases.RecordedMatch.make({}),
    Conflict: () => IdempotencyState.cases.Conflict.make({}),
  })
}
