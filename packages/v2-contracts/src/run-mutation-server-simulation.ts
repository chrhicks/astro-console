import { Effect, Schema } from "effect"
import { AtomicCommit, makeAtomicServerSimulation } from "./atomic-server-simulation.js"
import { Command, CommandEnvelope } from "./commands.js"
import { DomainEventEnvelope } from "./events.js"
import { CommandFailure } from "./failures.js"
import { ActorContext, CommandGateDecision, IdempotencyState, evaluateCommandGate } from "./gate.js"
import { IdempotencyClassification, IdempotencyReceipt, IdempotencyRequest, classifyIdempotency } from "./idempotency.js"
import {
  ClientId,
  CommandResultRef,
  EventCursor,
  LeaseRevision,
  NormalizedInputHash,
  PreviewId,
  RunRevision,
  SnapshotVersion,
} from "./primitives.js"
import {
  ActiveRunState,
  RunDefinition,
  RunMutationDecision,
  RunMutationPreview,
  RunMutationPreviewDecision,
  RunWork,
  applyRunMutation,
  previewRunMutation,
} from "./run.js"

export const RunMutationProjection = Schema.Struct({
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  definition: RunDefinition,
  run: ActiveRunState,
})

export interface RunMutationProjection extends Schema.Schema.Type<typeof RunMutationProjection> {}

export const RunPreviewResponse = Schema.TaggedUnion({
  Previewed: { preview: RunMutationPreview, projection: RunMutationProjection },
  Ineligible: { consequences: Schema.NonEmptyArray(Schema.NonEmptyString), projection: RunMutationProjection },
})

export const RunMutationResponse = Schema.Struct({
  replayed: Schema.Boolean,
  resultRef: CommandResultRef,
  previewId: PreviewId,
  projection: RunMutationProjection,
})

export interface RunMutationResponse extends Schema.Schema.Type<typeof RunMutationResponse> {}

export class RunCommandRejected extends Schema.TaggedErrorClass<RunCommandRejected>()(
  "RunSimulation.CommandRejected",
  { failure: CommandFailure },
) {}

export class RunMutationRejected extends Schema.TaggedErrorClass<RunMutationRejected>()(
  "RunSimulation.MutationRejected",
  {
    reason: Schema.Literals(["PreviewUnavailable", "RequiresApproval", "MutationIneligible", "StalePreview", "ExpiredPreview", "ApprovalMismatch"]),
    currentRunRevision: RunRevision,
  },
) {}

interface StoredMutationResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly response: RunMutationResponse
}

export interface RunMutationSimulationState {
  readonly definition: RunDefinition
  readonly run: ActiveRunState
  readonly leaseRevision: typeof LeaseRevision.Type
  readonly leaseHolderClientId: typeof ClientId.Type
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly previews: ReadonlyArray<RunMutationPreview>
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredMutationResult>
  readonly events: ReadonlyArray<DomainEventEnvelope>
  readonly outbox: ReadonlyArray<typeof RunWork.Type>
}

type MemberActor = Extract<typeof ActorContext.Type, { readonly _tag: "Member" }>
type ApplyCommand = typeof Command.cases.ApplyRunMutation.Type | typeof Command.cases.ApproveDisruptiveRunMutation.Type

export interface RunMutationServerSimulation {
  readonly preview: (rawRequest: unknown, actor: MemberActor) => Effect.Effect<typeof RunPreviewResponse.Type, Schema.SchemaError | RunCommandRejected | RunMutationRejected>
  readonly apply: (rawRequest: unknown, actor: MemberActor) => Effect.Effect<RunMutationResponse, Schema.SchemaError | RunCommandRejected | RunMutationRejected>
  readonly approve: (rawRequest: unknown, actor: MemberActor) => Effect.Effect<RunMutationResponse, Schema.SchemaError | RunCommandRejected | RunMutationRejected>
  readonly readState: () => Effect.Effect<RunMutationSimulationState>
  readonly dispatchOutbox: <Error>(execute: (work: typeof RunWork.Type) => Effect.Effect<void, Error>) => Effect.Effect<void, Error>
}

export const makeRunMutationServerSimulation = Effect.fn("RunSimulation.make")(
  function* (initialState: RunMutationSimulationState, nowEpochMs: number) {
    const simulation = yield* makeAtomicServerSimulation(initialState, (state) => state.outbox)

    const preview: RunMutationServerSimulation["preview"] = Effect.fn("RunSimulation.preview")(function* (rawRequest, actor) {
      const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
      const command = yield* Schema.decodeUnknownEffect(Command.cases.PreviewRunMutation)(envelope.command)

      return yield* simulation.transact((current) => Effect.gen(function* () {
        const gate = gateCommand(current, envelope, actor, IdempotencyState.cases.Fresh.make({}))
        yield* requireAcceptedGate(gate)
        const decision = previewRunMutation({
          state: current.run,
          definition: current.definition,
          mutation: command.proposedChange,
          previewId: PreviewId.make(`preview-${current.previews.length + 1}`),
          nowEpochMs,
          expiresAtEpochMs: nowEpochMs + 60_000,
          approvalId: `approval-${current.previews.length + 1}`,
          forecast: { completionDeltaSeconds: 1_620, viabilityChanges: ["M31 loses 14 minutes of useful altitude"] },
        })

        return yield* commitPreviewDecision(current, decision)
      }))
    })

    const apply: RunMutationServerSimulation["apply"] = Effect.fn("RunSimulation.apply")(function* (rawRequest, actor) {
      const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
      const command = yield* Schema.decodeUnknownEffect(Command.cases.ApplyRunMutation)(envelope.command)
      return yield* simulation.transact((current) => acceptMutationTransaction(current, envelope, command, actor, nowEpochMs))
    })
    const approve: RunMutationServerSimulation["approve"] = Effect.fn("RunSimulation.approve")(function* (rawRequest, actor) {
      const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
      const command = yield* Schema.decodeUnknownEffect(Command.cases.ApproveDisruptiveRunMutation)(envelope.command)
      return yield* simulation.transact((current) => acceptMutationTransaction(current, envelope, command, actor, nowEpochMs))
    })

    return { preview, apply, approve, readState: simulation.readState, dispatchOutbox: simulation.dispatchOutbox } satisfies RunMutationServerSimulation
  },
)

function commitPreviewDecision(
  current: RunMutationSimulationState,
  decision: RunMutationPreviewDecision,
): Effect.Effect<AtomicCommit<RunMutationSimulationState, typeof RunPreviewResponse.Type>> {
  return RunMutationPreviewDecision.$match(decision, {
    Ineligible: ({ consequences }) => Effect.succeed({
      state: current,
      result: RunPreviewResponse.cases.Ineligible.make({ consequences: nonEmpty(consequences), projection: project(current) }),
    }),
    Previewed: ({ preview }) => {
      const next = { ...current, previews: [...current.previews, preview] }
      return Effect.succeed({
        state: next,
        result: RunPreviewResponse.cases.Previewed.make({ preview, projection: project(next) }),
      })
    },
  })
}

function acceptMutationTransaction(
  current: RunMutationSimulationState,
  envelope: CommandEnvelope,
  command: ApplyCommand,
  actor: MemberActor,
  nowEpochMs: number,
): Effect.Effect<AtomicCommit<RunMutationSimulationState, RunMutationResponse>, RunCommandRejected | RunMutationRejected> {
  const request = IdempotencyRequest.make({
    idempotencyKey: command.idempotencyKey,
    personId: actor.personId,
    commandTag: command._tag,
    normalizedInputHash: mutationInputHash(command),
  })
  const receipt = current.receipts.find((candidate) => candidate.idempotencyKey === request.idempotencyKey)
  const classification = classifyIdempotency(request, receipt)
  const gate = gateCommand(current, envelope, actor, gateIdempotency(classification))

  return CommandGateDecision.$match(gate, {
    Rejected: ({ failure }) => Effect.fail(new RunCommandRejected({ failure })),
    ReplayPending: () => Effect.fail(new RunMutationRejected({ reason: "PreviewUnavailable", currentRunRevision: current.run.revision })),
    ReplayRecorded: () => replayMutation(current, receipt),
    Accepted: () => {
      const preview = current.previews.find((candidate) => candidate.previewId === command.previewId)
      if (preview === undefined) {
        return Effect.fail(new RunMutationRejected({ reason: "PreviewUnavailable", currentRunRevision: current.run.revision }))
      }
      const approvalId = Command.guards.ApproveDisruptiveRunMutation(command) ? command.approvalId : undefined
      return commitMutation(current, envelope, command, request, preview, nowEpochMs, approvalId)
    },
  })
}

function commitMutation(
  current: RunMutationSimulationState,
  envelope: CommandEnvelope,
  command: ApplyCommand,
  request: IdempotencyRequest,
  preview: RunMutationPreview,
  nowEpochMs: number,
  approvalId: string | undefined,
): Effect.Effect<AtomicCommit<RunMutationSimulationState, RunMutationResponse>, RunMutationRejected> {
  const decision = applyRunMutation(current.run, current.definition, preview, nowEpochMs, approvalId)
  return RunMutationDecision.$match(decision, {
    RequiresApproval: () => rejectMutation(current, "RequiresApproval"),
    Ineligible: () => rejectMutation(current, "MutationIneligible"),
    StalePreview: () => rejectMutation(current, "StalePreview"),
    ExpiredPreview: () => rejectMutation(current, "ExpiredPreview"),
    ApprovalMismatch: () => rejectMutation(current, "ApprovalMismatch"),
    Applied: ({ state, definition, impact, consequences, work }) => {
      const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
      const snapshotVersion = SnapshotVersion.make(current.snapshotVersion + 1)
      const eventCursor = EventCursor.make(current.eventCursor + 1)
      const nextWithoutResult: RunMutationSimulationState = {
        ...current,
        definition,
        run: state,
        snapshotVersion,
        eventCursor,
        receipts: [...current.receipts, IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef })],
        results: current.results,
        events: [...current.events, DomainEventEnvelope.make({
          eventId: `event-${eventCursor}`,
          aggregateKind: "ActiveRun",
          aggregateId: state.runId,
          aggregateRevision: state.revision,
          occurredAt: new Date(nowEpochMs).toISOString(),
          commandId: envelope.commandId,
          event: {
            _tag: "RunMutationApplied",
            previewId: preview.previewId,
            impact,
            consequences: nonEmpty(consequences),
            ...(approvalId === undefined ? {} : { approvalId }),
          },
          schemaVersion: 1,
        })],
        outbox: [...current.outbox, ...work],
      }
      const response = RunMutationResponse.make({
        replayed: false,
        resultRef,
        previewId: preview.previewId,
        projection: project(nextWithoutResult),
      })
      return Effect.succeed({
        state: { ...nextWithoutResult, results: [...current.results, { resultRef, response }] },
        result: response,
      })
    },
  })
}

function rejectMutation(current: RunMutationSimulationState, reason: RunMutationRejected["reason"]) {
  return Effect.fail(new RunMutationRejected({ reason, currentRunRevision: current.run.revision }))
}

function replayMutation(current: RunMutationSimulationState, receipt: typeof IdempotencyReceipt.Type | undefined) {
  if (receipt === undefined || !IdempotencyReceipt.guards.Recorded(receipt)) {
    return rejectMutation(current, "PreviewUnavailable")
  }
  const stored = current.results.find((candidate) => candidate.resultRef === receipt.resultRef)
  if (stored === undefined) return rejectMutation(current, "PreviewUnavailable")
  return Effect.succeed({
    state: current,
    result: RunMutationResponse.make({ ...stored.response, replayed: true, projection: project(current) }),
  })
}

function gateCommand(
  state: RunMutationSimulationState,
  envelope: CommandEnvelope,
  actor: MemberActor,
  idempotency: typeof IdempotencyState.Type,
) {
  return evaluateCommandGate({
    envelope,
    actor,
    connected: true,
    snapshotVersion: state.snapshotVersion,
    currentRevisions: { run: state.run.revision, lease: state.leaseRevision },
    leaseHolderClientId: state.leaseHolderClientId,
    idempotency,
  })
}

function requireAcceptedGate(gate: CommandGateDecision) {
  return CommandGateDecision.$match(gate, {
    Accepted: () => Effect.void,
    Rejected: ({ failure }) => Effect.fail(new RunCommandRejected({ failure })),
    ReplayPending: () => Effect.fail(new RunMutationRejected({ reason: "PreviewUnavailable", currentRunRevision: RunRevision.make(0) })),
    ReplayRecorded: () => Effect.fail(new RunMutationRejected({ reason: "PreviewUnavailable", currentRunRevision: RunRevision.make(0) })),
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

function mutationInputHash(command: ApplyCommand) {
  return NormalizedInputHash.make(JSON.stringify([
    `${command._tag}.v1`,
    command.runId,
    command.expectedRunRevision,
    command.expectedLeaseRevision,
    command.previewId,
    ...(Command.guards.ApproveDisruptiveRunMutation(command) ? [command.approvalId] : []),
  ]))
}

function project(state: RunMutationSimulationState): RunMutationProjection {
  return RunMutationProjection.make({
    snapshotVersion: state.snapshotVersion,
    eventCursor: state.eventCursor,
    definition: state.definition,
    run: state.run,
  })
}

function nonEmpty(values: ReadonlyArray<string>): [string, ...Array<string>] {
  const [first, ...rest] = values
  return first === undefined ? ["No additional detail"] : [first, ...rest]
}
