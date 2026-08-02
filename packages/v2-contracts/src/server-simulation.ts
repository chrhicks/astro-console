import { Effect, Schema } from 'effect'
import {
  AtomicCommit,
  makeAtomicServerSimulation,
} from './atomic-server-simulation.js'
import { Command, CommandEnvelope } from './commands.js'
import { DomainEventEnvelope } from './events.js'
import { CommandFailure } from './failures.js'
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
  CommandResultRef,
  ClientId,
  EventCursor,
  LeaseRevision,
  NormalizedInputHash,
  RunId,
  SnapshotVersion,
} from './primitives.js'
import {
  ActiveRunState,
  RunDefinition,
  RunStartReadiness,
  RunWork,
  StartRunDecision,
  ValidatedObservingPlan,
  decideStartRun,
} from './run.js'

export const RunStartProjection = Schema.Struct({
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  activeRun: Schema.optionalKey(
    Schema.Struct({
      definition: RunDefinition,
      state: ActiveRunState,
    }),
  ),
})

export interface RunStartProjection extends Schema.Schema.Type<
  typeof RunStartProjection
> {}

export const RunStartResponse = Schema.Struct({
  replayed: Schema.Boolean,
  resultRef: CommandResultRef,
  runId: RunId,
  projection: RunStartProjection,
})

export interface RunStartResponse extends Schema.Schema.Type<
  typeof RunStartResponse
> {}

export class CommandRejected extends Schema.TaggedErrorClass<CommandRejected>()(
  'ServerSimulation.CommandRejected',
  { failure: CommandFailure },
) {}

export class RunStartRejected extends Schema.TaggedErrorClass<RunStartRejected>()(
  'ServerSimulation.RunStartRejected',
  {
    reason: Schema.Literals([
      'PlanNotReady',
      'PlanLimitationsNotAccepted',
      'PlanRevisionConflict',
      'ActiveRunConflict',
      'CriticalStateUnknown',
      'PreconditionExpired',
    ]),
    explanations: Schema.Array(Schema.String),
  },
) {}

export class CommandAlreadyPending extends Schema.TaggedErrorClass<CommandAlreadyPending>()(
  'ServerSimulation.CommandAlreadyPending',
  {},
) {}

export class SimulationInvariantViolation extends Schema.TaggedErrorClass<SimulationInvariantViolation>()(
  'ServerSimulation.InvariantViolation',
  { message: Schema.NonEmptyString },
) {}

interface StoredRunStartResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly runId: typeof RunId.Type
}

export interface RunStartSimulationState {
  readonly plan: ValidatedObservingPlan
  readonly readiness: typeof RunStartReadiness.Type
  readonly leaseRevision: typeof LeaseRevision.Type
  readonly leaseHolderClientId: typeof ClientId.Type
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly activeRun?: {
    readonly definition: RunDefinition
    readonly state: ActiveRunState
  }
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredRunStartResult>
  readonly events: ReadonlyArray<DomainEventEnvelope>
  readonly outbox: ReadonlyArray<typeof RunWork.Type>
}

export interface RunStartSimulationConfig {
  readonly initialState: RunStartSimulationState
  readonly acceptedAt: string
}

export interface RunStartServerSimulation {
  readonly startRun: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    RunStartResponse,
    | Schema.SchemaError
    | CommandRejected
    | RunStartRejected
    | CommandAlreadyPending
    | SimulationInvariantViolation
  >
  readonly readState: () => Effect.Effect<RunStartSimulationState>
  readonly dispatchOutbox: <E>(
    execute: (work: typeof RunWork.Type) => Effect.Effect<void, E>,
  ) => Effect.Effect<void, E>
}

type RunStartServiceError =
  | CommandRejected
  | RunStartRejected
  | CommandAlreadyPending
  | SimulationInvariantViolation
type RunStartCommit = AtomicCommit<RunStartSimulationState, RunStartResponse>

export const makeRunStartServerSimulation = Effect.fn(
  'ServerSimulation.makeRunStart',
)(function* (config: RunStartSimulationConfig) {
  const simulation = yield* makeAtomicServerSimulation(
    config.initialState,
    (state) => state.outbox,
  )

  const startRun: RunStartServerSimulation['startRun'] = Effect.fn(
    'ServerSimulation.startRun',
  )(function* (rawRequest: unknown, actor: MemberActor) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(
      Command.cases.StartRunFromPlan,
    )(envelope.command)

    return yield* simulation.transact((current) =>
      Effect.gen(function* () {
        const request = IdempotencyRequest.make({
          idempotencyKey: command.idempotencyKey,
          personId: actor.personId,
          commandTag: 'StartRunFromPlan',
          normalizedInputHash: normalizedInputHash(command),
        })
        const receipt = current.receipts.find(
          (candidate) => candidate.idempotencyKey === request.idempotencyKey,
        )
        const idempotency = classifyIdempotency(request, receipt)
        const gate = evaluateCommandGate({
          envelope,
          actor,
          connected: true,
          snapshotVersion: current.snapshotVersion,
          currentRevisions: {
            plan: current.plan.revision,
            lease: current.leaseRevision,
          },
          leaseHolderClientId: current.leaseHolderClientId,
          idempotency: gateIdempotency(idempotency),
        })

        return yield* acceptGateDecision(
          gate,
          current,
          envelope,
          command,
          request,
          receipt,
          config.acceptedAt,
        )
      }),
    )
  })

  return {
    startRun,
    readState: simulation.readState,
    dispatchOutbox: simulation.dispatchOutbox,
  } satisfies RunStartServerSimulation
})

type MemberActor = Extract<
  typeof ActorContext.Type,
  { readonly _tag: 'Member' }
>
type StartRunCommand = typeof Command.cases.StartRunFromPlan.Type

function acceptStart(
  current: RunStartSimulationState,
  envelope: CommandEnvelope,
  command: StartRunCommand,
  request: IdempotencyRequest,
  acceptedAt: string,
): Effect.Effect<RunStartCommit, RunStartRejected> {
  const runId = RunId.make(`run-${current.results.length + 1}`)
  const decision = decideStartRun({
    command,
    plan: current.plan,
    readiness: current.readiness,
    ...(current.activeRun === undefined
      ? {}
      : { activeRunId: current.activeRun.state.runId }),
    assignedRunId: runId,
    acceptedAt,
  })

  return StartRunDecision.$match(decision, {
    Rejected: ({ reason, explanations }) =>
      Effect.fail(new RunStartRejected({ reason, explanations })),
    Started: ({ definition, state, work }) => {
      const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
      const snapshotVersion = SnapshotVersion.make(current.snapshotVersion + 1)
      const eventCursor = EventCursor.make(current.eventCursor + 1)
      const next: RunStartSimulationState = {
        ...current,
        snapshotVersion,
        eventCursor,
        activeRun: { definition, state },
        receipts: [
          ...current.receipts,
          IdempotencyReceipt.cases.Recorded.make({
            ...request,
            resultRef,
          }),
        ],
        results: [...current.results, { resultRef, runId }],
        events: [
          ...current.events,
          DomainEventEnvelope.make({
            eventId: `event-${eventCursor}`,
            aggregateKind: 'ActiveRun',
            aggregateId: runId,
            aggregateRevision: state.revision,
            occurredAt: acceptedAt,
            commandId: envelope.commandId,
            event: {
              _tag: 'RunStarted',
              runId,
              sourcePlanId: definition.sourcePlanId,
            },
            schemaVersion: 1,
          }),
        ],
        outbox: [...current.outbox, work],
      }
      return Effect.succeed({
        state: next,
        result: RunStartResponse.make({
          replayed: false,
          resultRef,
          runId,
          projection: project(next),
        }),
      } satisfies AtomicCommit<RunStartSimulationState, RunStartResponse>)
    },
  })
}

function replayStart(
  current: RunStartSimulationState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
): Effect.Effect<RunStartResponse, SimulationInvariantViolation> {
  if (receipt === undefined) {
    return Effect.fail(
      new SimulationInvariantViolation({
        message: 'Recorded idempotency result has no receipt',
      }),
    )
  }

  return IdempotencyReceipt.match(receipt, {
    Pending: () =>
      Effect.fail(
        new SimulationInvariantViolation({
          message: 'Recorded idempotency result is still pending',
        }),
      ),
    Recorded: ({ resultRef }) => {
      const result = current.results.find(
        (candidate) => candidate.resultRef === resultRef,
      )
      if (result === undefined) {
        return Effect.fail(
          new SimulationInvariantViolation({
            message: 'Recorded idempotency result is unavailable',
          }),
        )
      }
      return Effect.succeed(
        RunStartResponse.make({
          replayed: true,
          resultRef,
          runId: result.runId,
          projection: project(current),
        }),
      )
    },
  })
}

function acceptGateDecision(
  gate: CommandGateDecision,
  current: RunStartSimulationState,
  envelope: CommandEnvelope,
  command: StartRunCommand,
  request: IdempotencyRequest,
  receipt: typeof IdempotencyReceipt.Type | undefined,
  acceptedAt: string,
): Effect.Effect<RunStartCommit, RunStartServiceError> {
  return CommandGateDecision.$match(gate, {
    Accepted: () =>
      acceptStart(current, envelope, command, request, acceptedAt),
    ReplayPending: () => Effect.fail(new CommandAlreadyPending()),
    ReplayRecorded: () =>
      replayStart(current, receipt).pipe(
        Effect.map((result): RunStartCommit => ({ state: current, result })),
      ),
    Rejected: ({ failure }) => Effect.fail(new CommandRejected({ failure })),
  })
}

function project(state: RunStartSimulationState): RunStartProjection {
  return RunStartProjection.make({
    snapshotVersion: state.snapshotVersion,
    eventCursor: state.eventCursor,
    ...(state.activeRun === undefined ? {} : { activeRun: state.activeRun }),
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

function normalizedInputHash(command: StartRunCommand) {
  return NormalizedInputHash.make(
    JSON.stringify([
      'StartRunFromPlan.v1',
      command.planId,
      command.expectedPlanRevision,
      command.expectedLeaseRevision,
      command.preconditionToken,
      [...command.acceptedPlanLimitationIds].sort(),
    ]),
  )
}
