import { Effect, Schema } from "effect"
import { AtomicCommit, makeAtomicServerSimulation } from "./atomic-server-simulation.js"
import { Command, CommandEnvelope } from "./commands.js"
import {
  ControlDecision,
  ControlLeaseState,
  ControlRequestResolution,
  ControlTarget,
  expireControlGrace,
  markControllerDisconnected,
  markControllerReconnected,
  releaseControl,
  requestControl,
  resolveControlRequest,
  takeControl,
} from "./control.js"
import { DomainEvent, DomainEventEnvelope } from "./events.js"
import { CommandFailure } from "./failures.js"
import { ActorContext, CommandGateDecision, IdempotencyState, evaluateCommandGate } from "./gate.js"
import { IdempotencyClassification, IdempotencyReceipt, IdempotencyRequest, classifyIdempotency } from "./idempotency.js"
import {
  ClientId,
  CommandResultRef,
  EventCursor,
  LeaseRevision,
  SnapshotVersion,
} from "./primitives.js"
import { versionedSemanticHash } from "./semantic-hash.js"

const ControlCommand = Schema.TaggedUnion({
  RequestControl: {
    expectedLeaseRevision: Command.cases.RequestControl.fields.expectedLeaseRevision,
    idempotencyKey: Command.cases.RequestControl.fields.idempotencyKey,
  },
  GrantControl: {
    expectedLeaseRevision: Command.cases.GrantControl.fields.expectedLeaseRevision,
    requestId: Command.cases.GrantControl.fields.requestId,
    targetClientId: Command.cases.GrantControl.fields.targetClientId,
    idempotencyKey: Command.cases.GrantControl.fields.idempotencyKey,
  },
  DeclineControl: {
    expectedLeaseRevision: Command.cases.DeclineControl.fields.expectedLeaseRevision,
    requestId: Command.cases.DeclineControl.fields.requestId,
    idempotencyKey: Command.cases.DeclineControl.fields.idempotencyKey,
  },
  ReleaseControl: {
    expectedLeaseRevision: Command.cases.ReleaseControl.fields.expectedLeaseRevision,
    idempotencyKey: Command.cases.ReleaseControl.fields.idempotencyKey,
  },
  TakeControl: {
    expectedLeaseRevision: Command.cases.TakeControl.fields.expectedLeaseRevision,
    idempotencyKey: Command.cases.TakeControl.fields.idempotencyKey,
  },
})

type ControlCommand = typeof ControlCommand.Type
type MemberActor = Extract<typeof ActorContext.Type, { readonly _tag: "Member" }>

export const ControlProjection = Schema.Struct({
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  lease: ControlLeaseState,
  targets: Schema.Array(ControlTarget),
})

export interface ControlProjection extends Schema.Schema.Type<typeof ControlProjection> {}

export const ControlResponse = Schema.Struct({
  replayed: Schema.Boolean,
  resultRef: CommandResultRef,
  effect: Schema.Literals(["requested", "declined", "granted", "released", "taken"]),
  requestId: Schema.optionalKey(Schema.NonEmptyString),
  projection: ControlProjection,
})

export interface ControlResponse extends Schema.Schema.Type<typeof ControlResponse> {}

export class ControlCommandRejected extends Schema.TaggedErrorClass<ControlCommandRejected>()(
  "ControlServerSimulation.CommandRejected",
  { failure: CommandFailure },
) {}

export class ControlTransitionRejected extends Schema.TaggedErrorClass<ControlTransitionRejected>()(
  "ControlServerSimulation.TransitionRejected",
  {
    reason: Schema.Literals([
      "AlreadyController",
      "AlreadyReconnecting",
      "RequestAlreadyPending",
      "RequestIdentityConflict",
      "RequestExpiryInvalid",
      "RequestUnavailable",
      "RequestExpired",
      "RequestSuperseded",
      "ControlTargetMismatch",
      "ControlTargetUnavailable",
      "NotController",
      "NotReconnecting",
      "GraceNotExpired",
    ]),
  },
) {}

export class ControlReplayInvariantViolation extends Schema.TaggedErrorClass<ControlReplayInvariantViolation>()(
  "ControlServerSimulation.ReplayInvariantViolation",
  { message: Schema.NonEmptyString },
) {}

interface StoredControlResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly effect: ControlResponse["effect"]
  readonly requestId?: string
}

export interface ControlSimulationState {
  readonly lease: ControlLeaseState
  readonly persistenceVersion: number
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly targets: ReadonlyArray<ControlTarget>
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredControlResult>
  readonly events: ReadonlyArray<DomainEventEnvelope>
  readonly outbox: ReadonlyArray<string>
}

export interface ControlSimulationConfig {
  readonly initialState: ControlSimulationState
  readonly nowEpochMs: number
  readonly requestTtlMs: number
  readonly occurredAt: string
}

export interface ControlServerSimulation {
  readonly execute: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    ControlResponse,
    | Schema.SchemaError
    | ControlCommandRejected
    | ControlTransitionRejected
    | ControlReplayInvariantViolation
  >
  readonly disconnectController: (
    clientId: typeof ClientId.Type,
    deadlineEpochMs: number,
  ) => Effect.Effect<ControlDecision>
  readonly reconnectController: (clientId: typeof ClientId.Type) => Effect.Effect<ControlDecision>
  readonly expireGrace: (nowEpochMs: number) => Effect.Effect<ControlDecision>
  readonly readState: () => Effect.Effect<ControlSimulationState>
}

type ControlCommit = AtomicCommit<ControlSimulationState, ControlResponse>

export const makeControlServerSimulation = Effect.fn("ControlServerSimulation.make")(
  function* (config: ControlSimulationConfig) {
    const simulation = yield* makeAtomicServerSimulation(config.initialState, (state) => state.outbox)

    const execute: ControlServerSimulation["execute"] = Effect.fn("ControlServerSimulation.execute")(function* (
      rawRequest: unknown,
      actor: MemberActor,
    ) {
      const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
      const command = yield* Schema.decodeUnknownEffect(ControlCommand)(envelope.command)

      return yield* simulation.transact((current) => Effect.gen(function* () {
        const request = IdempotencyRequest.make({
          idempotencyKey: command.idempotencyKey,
          personId: actor.personId,
          commandTag: command._tag,
          normalizedInputHash: versionedSemanticHash(`${command._tag}.v1`, command),
        })
        const receipt = current.receipts.find((candidate) => candidate.idempotencyKey === request.idempotencyKey)
        const idempotency = classifyIdempotency(request, receipt)
        const gate = evaluateCommandGate({
          envelope,
          actor,
          connected: true,
          snapshotVersion: current.snapshotVersion,
          currentRevisions: { lease: current.lease.revision },
          ...(current.lease.holderClientId === undefined ? {} : { leaseHolderClientId: current.lease.holderClientId }),
          idempotency: gateIdempotency(idempotency),
        })

        return yield* acceptGateDecision(gate, current, envelope, command, actor, request, receipt, config)
      }))
    })

    const transition = (
      decide: (state: ControlLeaseState) => ControlDecision,
      durableEvent?: (previous: ControlLeaseState, next: ControlLeaseState) => typeof DomainEvent.Type | undefined,
    ) => simulation.transact((current) => {
      const decision = decide(current.lease)
      return ControlDecision.$match(decision, {
        Unchanged: () => Effect.succeed({ state: current, result: decision }),
        Updated: ({ state }) => {
          const event = durableEvent?.(current.lease, state)
          const eventCursor = event === undefined ? current.eventCursor : EventCursor.make(current.eventCursor + 1)
          const next: ControlSimulationState = {
            ...current,
            lease: state,
            persistenceVersion: current.persistenceVersion + 1,
            snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
            eventCursor,
            events: event === undefined
              ? current.events
              : [...current.events, eventEnvelope(current, state, event, config.occurredAt)],
          }
          return Effect.succeed({ state: next, result: decision })
        },
      })
    })

    return {
      execute,
      disconnectController: (clientId, deadlineEpochMs) => transition(
        (state) => markControllerDisconnected(state, clientId, deadlineEpochMs),
      ),
      reconnectController: (clientId) => transition(
        (state) => markControllerReconnected(state, clientId),
      ),
      expireGrace: (nowEpochMs) => transition(
        (state) => expireControlGrace(state, nowEpochMs),
        (previous) => previous.holderClientId === undefined
          ? undefined
          : DomainEvent.cases.ControlLeaseExpired.make({ previousHolderClientId: previous.holderClientId }),
      ),
      readState: simulation.readState,
    } satisfies ControlServerSimulation
  },
)

function acceptGateDecision(
  gate: CommandGateDecision,
  current: ControlSimulationState,
  envelope: CommandEnvelope,
  command: ControlCommand,
  actor: MemberActor,
  request: IdempotencyRequest,
  receipt: typeof IdempotencyReceipt.Type | undefined,
  config: ControlSimulationConfig,
): Effect.Effect<ControlCommit, ControlCommandRejected | ControlTransitionRejected | ControlReplayInvariantViolation> {
  return CommandGateDecision.$match(gate, {
    Accepted: () => acceptControlCommand(current, envelope, command, actor, request, config),
    ReplayPending: () => Effect.fail(new ControlReplayInvariantViolation({ message: "control command is unexpectedly pending" })),
    ReplayRecorded: () => replayControlCommand(current, receipt).pipe(
      Effect.map((result): ControlCommit => ({ state: current, result })),
    ),
    Rejected: ({ failure }) => Effect.fail(new ControlCommandRejected({ failure })),
  })
}

function acceptControlCommand(
  current: ControlSimulationState,
  envelope: CommandEnvelope,
  command: ControlCommand,
  actor: MemberActor,
  request: IdempotencyRequest,
  config: ControlSimulationConfig,
): Effect.Effect<ControlCommit, ControlTransitionRejected> {
  const assignedRequestId = `request-${envelope.commandId}`
  const transition = decideControlCommand(current, command, actor, assignedRequestId, config)
  return ControlDecision.$match(transition, {
    Unchanged: ({ reason }) => Effect.fail(new ControlTransitionRejected({ reason })),
    Updated: ({ state }) => {
      const effect = controlCommandEffect(command)
      const requestId = ControlCommand.guards.RequestControl(command) ? assignedRequestId : undefined
      const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
      const eventCursor = EventCursor.make(current.eventCursor + 1)
      const result: StoredControlResult = {
        resultRef,
        effect,
        ...(requestId === undefined ? {} : { requestId }),
      }
      const next: ControlSimulationState = {
        ...current,
        lease: state,
        persistenceVersion: current.persistenceVersion + 1,
        snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
        eventCursor,
        receipts: [...current.receipts, IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef })],
        results: [...current.results, result],
        events: [...current.events, eventEnvelope(
          current,
          state,
          controlEvent(command, actor, assignedRequestId),
          config.occurredAt,
          envelope.commandId,
        )],
      }
      return Effect.succeed({
        state: next,
        result: response(next, result, false),
      })
    },
  })
}

function decideControlCommand(
  current: ControlSimulationState,
  command: ControlCommand,
  actor: MemberActor,
  assignedRequestId: string,
  config: ControlSimulationConfig,
): ControlDecision {
  return ControlCommand.match(command, {
    RequestControl: () => requestControl(
      current.lease,
      assignedRequestId,
      actor.clientId,
      config.nowEpochMs,
      config.nowEpochMs + config.requestTtlMs,
    ),
    GrantControl: ({ requestId, targetClientId }) => {
      const target = current.targets.find((candidate) => candidate.clientId === targetClientId)
      if (target === undefined) return ControlDecision.Unchanged({ reason: "ControlTargetUnavailable" })
      return resolveControlRequest(current.lease, ControlRequestResolution.cases.Grant.make({
        requestId,
        nowEpochMs: config.nowEpochMs,
        target,
      }))
    },
    DeclineControl: ({ requestId }) => resolveControlRequest(
      current.lease,
      ControlRequestResolution.cases.Decline.make({ requestId, nowEpochMs: config.nowEpochMs }),
    ),
    ReleaseControl: () => releaseControl(current.lease, actor.clientId),
    TakeControl: () => takeControl(current.lease, actor.clientId),
  })
}

function controlCommandEffect(command: ControlCommand): ControlResponse["effect"] {
  return ControlCommand.match(command, {
    RequestControl: () => "requested" as const,
    GrantControl: () => "granted" as const,
    DeclineControl: () => "declined" as const,
    ReleaseControl: () => "released" as const,
    TakeControl: () => "taken" as const,
  })
}

function controlEvent(
  command: ControlCommand,
  actor: MemberActor,
  assignedRequestId: string,
): typeof DomainEvent.Type {
  return ControlCommand.match(command, {
    RequestControl: (): typeof DomainEvent.Type => DomainEvent.cases.ControlRequested.make({
      requestId: assignedRequestId,
      requesterClientId: actor.clientId,
    }),
    GrantControl: ({ requestId, targetClientId }): typeof DomainEvent.Type => DomainEvent.cases.ControlGranted.make({
      requestId,
      holderClientId: targetClientId,
    }),
    DeclineControl: ({ requestId }): typeof DomainEvent.Type => DomainEvent.cases.ControlDeclined.make({ requestId }),
    ReleaseControl: (): typeof DomainEvent.Type => DomainEvent.cases.ControlReleased.make({ previousHolderClientId: actor.clientId }),
    TakeControl: (): typeof DomainEvent.Type => DomainEvent.cases.OwnerTookControl.make({ holderClientId: actor.clientId }),
  })
}

function replayControlCommand(
  current: ControlSimulationState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
): Effect.Effect<ControlResponse, ControlReplayInvariantViolation> {
  if (receipt === undefined) {
    return Effect.fail(new ControlReplayInvariantViolation({ message: "recorded control result has no receipt" }))
  }
  return IdempotencyReceipt.match(receipt, {
    Pending: () => Effect.fail(new ControlReplayInvariantViolation({ message: "recorded control result is still pending" })),
    Recorded: ({ resultRef }) => {
      const result = current.results.find((candidate) => candidate.resultRef === resultRef)
      return result === undefined
        ? Effect.fail(new ControlReplayInvariantViolation({ message: "recorded control result is unavailable" }))
        : Effect.succeed(response(current, result, true))
    },
  })
}

function response(state: ControlSimulationState, result: StoredControlResult, replayed: boolean): ControlResponse {
  return ControlResponse.make({
    replayed,
    resultRef: result.resultRef,
    effect: result.effect,
    ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
    projection: project(state),
  })
}

function project(state: ControlSimulationState): ControlProjection {
  return ControlProjection.make({
    snapshotVersion: state.snapshotVersion,
    eventCursor: state.eventCursor,
    lease: state.lease,
    targets: state.targets,
  })
}

function eventEnvelope(
  previous: ControlSimulationState,
  lease: ControlLeaseState,
  event: typeof DomainEvent.Type,
  occurredAt: string,
  commandId?: CommandEnvelope["commandId"],
): DomainEventEnvelope {
  return DomainEventEnvelope.make({
    eventId: `event-${previous.eventCursor + 1}`,
    aggregateKind: "ControlLease",
    aggregateId: lease.leaseId,
    aggregateRevision: lease.revision,
    occurredAt,
    ...(commandId === undefined ? {} : { commandId }),
    event,
    schemaVersion: 1,
  })
}

function gateIdempotency(classification: IdempotencyClassification): typeof IdempotencyState.Type {
  return IdempotencyClassification.$match(classification, {
    Fresh: () => IdempotencyState.cases.Fresh.make({}),
    PendingMatch: ({ operationId }) => operationId === undefined
      ? IdempotencyState.cases.PendingMatch.make({})
      : IdempotencyState.cases.PendingMatch.make({ operationId }),
    RecordedMatch: () => IdempotencyState.cases.RecordedMatch.make({}),
    Conflict: () => IdempotencyState.cases.Conflict.make({}),
  })
}
