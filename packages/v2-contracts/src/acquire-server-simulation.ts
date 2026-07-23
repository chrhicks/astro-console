import { Effect, Schema } from "effect"
import {
  AcquireActiveWork,
  AcquireSession,
  AcquireSkipDecision,
  CorrectionAcknowledgementDecision,
  CorrectionCommandDecision,
  PolarDecision,
  PointingVector,
  RecoverySeriesId,
  RecoverySeriesDecision,
  SolveCompletion,
  SolveCompletionDecision,
  acceptLatestPolarMeasurement,
  approveCorrectionProposal,
  openRecoverySeries,
  recordCorrectionAcknowledgement,
  recordPolarMeasurementEvidence,
  recordSolveCompletion,
  requestPolarMeasurement,
  reviseCorrectionProposal,
  skipPausedAcquireTarget,
} from "./acquire.js"
import { AtomicCommit, makeAtomicServerSimulation } from "./atomic-server-simulation.js"
import { Command, CommandEnvelope, commandRequiresIdempotency } from "./commands.js"
import { CommandFailure } from "./failures.js"
import { ActorContext, CommandGateDecision, IdempotencyState, evaluateCommandGate } from "./gate.js"
import { IdempotencyClassification, IdempotencyReceipt, IdempotencyRequest, classifyIdempotency } from "./idempotency.js"
import {
  AcquireRevision,
  AttemptId,
  ClientId,
  CommandResultRef,
  EventCursor,
  LeaseRevision,
  NonNegativeInt,
  OperationId,
  RunRevision,
  SnapshotVersion,
} from "./primitives.js"
import { versionedSemanticHash } from "./semantic-hash.js"

const AcquireCommand = Schema.Union([
  Command.cases.RetryPlateSolveWithParameters,
  Command.cases.SkipAcquireTarget,
  Command.cases.ApprovePointingCorrection,
  Command.cases.RevisePointingCorrection,
  Command.cases.CapturePolarAlignmentMeasurement,
  Command.cases.AcceptPolarAlignmentEvidence,
]).pipe(Schema.toTaggedUnion("_tag"))

type AcquireCommand = typeof AcquireCommand.Type
type MemberActor = Extract<typeof ActorContext.Type, { readonly _tag: "Member" }>

export const AcquireWork = Schema.TaggedUnion({
  CaptureAndSolve: {
    operationId: OperationId,
    attemptId: AttemptId,
    purpose: Schema.Literals(["initial", "retry", "verification"]),
  },
  MovePointingCorrection: {
    operationId: OperationId,
    correctionAttemptId: AttemptId,
    correction: PointingVector,
  },
  CapturePolarMeasurement: {
    operationId: OperationId,
    attemptId: AttemptId,
  },
  ContinueToCapture: { operationId: OperationId },
  AdvanceAfterSkippedTarget: {
    operationId: OperationId,
    nextSequenceId: Schema.NonEmptyString,
  },
})

export type AcquireWork = typeof AcquireWork.Type

export const AcquireRecordedEvent = Schema.Struct({
  eventId: Schema.NonEmptyString,
  eventCursor: EventCursor,
  revision: AcquireRevision,
  kind: Schema.Literals([
    "SolveRecorded",
    "SolveRetryScheduled",
    "RecoveryStarted",
    "CorrectionProposed",
    "CorrectionRevised",
    "CorrectionStarted",
    "CorrectionAcknowledged",
    "CorrectionVerified",
    "AcquirePaused",
    "AcquireCompleted",
    "AcquireTargetSkipped",
    "PolarMeasurementRequested",
    "PolarMeasurementRecorded",
    "PolarAlignmentCompleted",
  ]),
  evidenceAttemptIds: Schema.Array(AttemptId),
})

export interface AcquireRecordedEvent extends Schema.Schema.Type<typeof AcquireRecordedEvent> {}

export const AcquireProjection = Schema.Struct({
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  session: AcquireSession,
})

export interface AcquireProjection extends Schema.Schema.Type<typeof AcquireProjection> {}

export const AcquireResponse = Schema.Struct({
  replayed: Schema.Boolean,
  resultRef: Schema.optionalKey(CommandResultRef),
  projection: AcquireProjection,
})

export interface AcquireResponse extends Schema.Schema.Type<typeof AcquireResponse> {}

export class AcquireCommandRejected extends Schema.TaggedErrorClass<AcquireCommandRejected>()(
  "AcquireServer.CommandRejected",
  { failure: CommandFailure },
) {}

export class AcquireDecisionRejected extends Schema.TaggedErrorClass<AcquireDecisionRejected>()(
  "AcquireServer.DecisionRejected",
  { reason: Schema.NonEmptyString },
) {}

export class AcquireWorkerResultRejected extends Schema.TaggedErrorClass<AcquireWorkerResultRejected>()(
  "AcquireServer.WorkerResultRejected",
  { reason: Schema.NonEmptyString },
) {}

export class AcquireReplayUnavailable extends Schema.TaggedErrorClass<AcquireReplayUnavailable>()(
  "AcquireServer.ReplayUnavailable",
  {},
) {}

interface StoredAcquireResult {
  readonly resultRef: typeof CommandResultRef.Type
}

export interface AcquireServerState {
  readonly session: AcquireSession
  readonly runRevision: typeof RunRevision.Type
  readonly leaseRevision: typeof LeaseRevision.Type
  readonly leaseHolderClientId: typeof ClientId.Type
  readonly nextSequenceId?: string
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredAcquireResult>
  readonly events: ReadonlyArray<AcquireRecordedEvent>
  readonly outbox: ReadonlyArray<typeof AcquireWork.Type>
}

export interface AcquireServerSimulation {
  readonly submit: (
    rawRequest: unknown,
    actor: MemberActor,
    nowEpochMs: number,
  ) => Effect.Effect<AcquireResponse, Schema.SchemaError | AcquireCommandRejected | AcquireDecisionRejected | AcquireReplayUnavailable>
  readonly completeSolve: (
    rawCompletion: unknown,
  ) => Effect.Effect<AcquireProjection, Schema.SchemaError | AcquireWorkerResultRejected>
  readonly acknowledgeCorrection: (input: {
    readonly correctionAttemptId: typeof AttemptId.Type
    readonly accepted: boolean
    readonly occurredAtEpochMs: number
    readonly acknowledgementRef: string
  }) => Effect.Effect<AcquireProjection, AcquireWorkerResultRejected>
  readonly completePolarMeasurement: (input: {
    readonly attemptId: typeof AttemptId.Type
    readonly sourceFrameAssetId: string
    readonly measuredAtEpochMs: number
    readonly desiredPole: { readonly rightAscensionDegrees: number; readonly declinationDegrees: number }
    readonly measuredMountAxis: { readonly rightAscensionDegrees: number; readonly declinationDegrees: number }
    readonly altitudeErrorArcsec: number
    readonly azimuthErrorArcsec: number
    readonly uncertaintyArcsec: number
  }) => Effect.Effect<AcquireProjection, AcquireWorkerResultRejected>
  readonly readState: () => Effect.Effect<AcquireServerState>
  readonly dispatchOutbox: <E>(execute: (work: typeof AcquireWork.Type) => Effect.Effect<void, E>) => Effect.Effect<void, E>
}

type AcquireServiceError = AcquireCommandRejected | AcquireDecisionRejected | AcquireReplayUnavailable
type AcquireCommit = AtomicCommit<AcquireServerState, AcquireResponse>

export const makeAcquireServerSimulation = Effect.fn("AcquireServer.make")(function* (initialState: AcquireServerState) {
  const simulation = yield* makeAtomicServerSimulation(initialState, (state) => state.outbox)

  const submit: AcquireServerSimulation["submit"] = Effect.fn("AcquireServer.submit")(function* (
    rawRequest,
    actor,
    nowEpochMs,
  ) {
    const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(AcquireCommand)(envelope.command)
    return yield* simulation.transact((current) => Effect.gen(function* () {
      const request = commandRequiresIdempotency(command)
        ? IdempotencyRequest.make({
          idempotencyKey: command.idempotencyKey,
          personId: actor.personId,
          commandTag: command._tag,
          normalizedInputHash: versionedSemanticHash(`${command._tag}.v1`, command),
        })
        : undefined
      const receipt = request === undefined
        ? undefined
        : current.receipts.find(({ idempotencyKey }) => idempotencyKey === request.idempotencyKey)
      const classification = request === undefined
        ? IdempotencyClassification.Fresh()
        : classifyIdempotency(request, receipt)
      const gate = evaluateCommandGate({
        envelope,
        actor,
        connected: true,
        snapshotVersion: current.snapshotVersion,
        currentRevisions: {
          run: current.runRevision,
          lease: current.leaseRevision,
          acquire: current.session.revision,
        },
        leaseHolderClientId: current.leaseHolderClientId,
        idempotency: gateIdempotency(classification),
      })
      return yield* acceptGate(gate, current, command, envelope.commandId, request, receipt, nowEpochMs)
    }))
  })

  const completeSolve: AcquireServerSimulation["completeSolve"] = Effect.fn("AcquireServer.completeSolve")(function* (rawCompletion) {
    const completion = yield* Schema.decodeUnknownEffect(SolveCompletion)(rawCompletion)
    return yield* simulation.transact((current) => Effect.gen(function* () {
      const decision = recordSolveCompletion(current.session, completion)
      return yield* SolveCompletionDecision.$match(decision, {
        Rejected: ({ reason }) => Effect.fail(new AcquireWorkerResultRejected({ reason })),
        Centered: ({ session }) => Effect.succeed(workerCommit(current, session, "AcquireCompleted", [completion.attemptId], [AcquireWork.cases.ContinueToCapture.make({
          operationId: OperationId.make(`continue-after-${completion.attemptId}`),
        })])),
        RetryScheduled: ({ session }) => Effect.succeed(workerCommit(current, session, "SolveRetryScheduled", [completion.attemptId], workFromActive(session))),
        AutomaticCorrectionStarted: ({ session }) => Effect.succeed(workerCommit(current, session, "CorrectionStarted", [completion.attemptId], workFromActive(session))),
        CorrectionApprovalRequired: ({ session }) => Effect.succeed(workerCommit(current, session, "CorrectionProposed", [completion.attemptId], [])),
        Paused: ({ session }) => Effect.succeed(workerCommit(current, session, "AcquirePaused", [completion.attemptId], [])),
      })
    }))
  })

  const acknowledgeCorrection: AcquireServerSimulation["acknowledgeCorrection"] = Effect.fn("AcquireServer.acknowledgeCorrection")(function* (input) {
    return yield* simulation.transact((current) => Effect.gen(function* () {
      const suffix = current.eventCursor + 1
      const decision = recordCorrectionAcknowledgement(current.session, {
        ...input,
        verificationSeriesId: RecoverySeriesId.make(`verification-series-${suffix}`),
        verificationAttemptId: AttemptId.make(`verification-attempt-${suffix}`),
      })
      return yield* CorrectionAcknowledgementDecision.$match(decision, {
        Rejected: ({ reason }) => Effect.fail(new AcquireWorkerResultRejected({ reason })),
        VerificationScheduled: ({ session }) => Effect.succeed(workerCommit(current, session, "CorrectionAcknowledged", [input.correctionAttemptId], workFromActive(session))),
        Paused: ({ session }) => Effect.succeed(workerCommit(current, session, "AcquirePaused", [input.correctionAttemptId], [])),
      })
    }))
  })

  const completePolarMeasurement: AcquireServerSimulation["completePolarMeasurement"] = Effect.fn("AcquireServer.completePolar")(function* (input) {
    return yield* simulation.transact((current) => Effect.gen(function* () {
      const decision = recordPolarMeasurementEvidence(current.session, {
        ...input,
        sourceFrameAssetId: Schema.NonEmptyString.pipe(Schema.brand("AssetId")).make(input.sourceFrameAssetId),
      })
      return yield* PolarDecision.$match(decision, {
        Rejected: ({ reason }) => Effect.fail(new AcquireWorkerResultRejected({ reason })),
        GuidanceUpdated: ({ session }) => Effect.succeed(workerCommit(current, session, "PolarMeasurementRecorded", [input.attemptId], [])),
        MeasurementScheduled: () => Effect.fail(new AcquireWorkerResultRejected({ reason: "UnexpectedMeasurementScheduled" })),
        Accepted: () => Effect.fail(new AcquireWorkerResultRejected({ reason: "UnexpectedPolarAcceptance" })),
      })
    }))
  })

  return {
    submit,
    completeSolve,
    acknowledgeCorrection,
    completePolarMeasurement,
    readState: simulation.readState,
    dispatchOutbox: simulation.dispatchOutbox,
  } satisfies AcquireServerSimulation
})

function acceptGate(
  gate: CommandGateDecision,
  current: AcquireServerState,
  command: AcquireCommand,
  commandId: string,
  request: IdempotencyRequest | undefined,
  receipt: typeof IdempotencyReceipt.Type | undefined,
  nowEpochMs: number,
): Effect.Effect<AcquireCommit, AcquireServiceError> {
  return CommandGateDecision.$match(gate, {
    Rejected: ({ failure }) => Effect.fail(new AcquireCommandRejected({ failure })),
    ReplayPending: () => Effect.fail(new AcquireReplayUnavailable()),
    ReplayRecorded: () => replay(current, receipt),
    Accepted: () => decideCommand(current, command, commandId, request, nowEpochMs),
  })
}

function decideCommand(
  current: AcquireServerState,
  command: AcquireCommand,
  commandId: string,
  request: IdempotencyRequest | undefined,
  nowEpochMs: number,
): Effect.Effect<AcquireCommit, AcquireDecisionRejected> {
  const suffix = current.eventCursor + 1
  return AcquireCommand.match(command, {
    RetryPlateSolveWithParameters: ({ parameters }) => RecoverySeriesDecision.$match(
      openRecoverySeries(current.session, {
        seriesId: RecoverySeriesId.make(`recovery-series-${suffix}`),
        attemptId: AttemptId.make(`recovery-attempt-${suffix}`),
        parameters,
      }),
      {
        Rejected: ({ reason }) => rejectDecision(reason),
        Started: ({ session }) => acceptCommand(current, session, commandId, request, "RecoveryStarted", [], workFromActive(session)),
      },
    ),
    SkipAcquireTarget: () => AcquireSkipDecision.$match(skipPausedAcquireTarget(current.session, current.nextSequenceId), {
      Rejected: ({ reason }) => rejectDecision(reason),
      Skipped: ({ session, nextSequenceId }) => acceptCommand(current, session, commandId, request, "AcquireTargetSkipped", [], [
        AcquireWork.cases.AdvanceAfterSkippedTarget.make({
          operationId: OperationId.make(`advance-after-${commandId}`),
          nextSequenceId,
        }),
      ]),
    }),
    ApprovePointingCorrection: ({ proposalId }) => CorrectionCommandDecision.$match(
      approveCorrectionProposal(current.session, {
        proposalId,
        correctionAttemptId: AttemptId.make(`correction-attempt-${suffix}`),
        nowEpochMs,
      }),
      {
        Rejected: ({ reason }) => rejectDecision(reason),
        Started: ({ session }) => acceptCommand(current, session, commandId, request, "CorrectionStarted", [], workFromActive(session)),
        Revised: () => rejectDecision("UnexpectedProposalRevision"),
      },
    ),
    RevisePointingCorrection: ({ proposalId, parameters }) => {
      const convention = current.session.pendingCorrectionProposal?.correction.convention ?? "mountRaDec"
      return CorrectionCommandDecision.$match(reviseCorrectionProposal(current.session, {
        currentProposalId: proposalId,
        nextProposalId: `proposal-revision-${suffix}`,
        correction: PointingVector.make({ ...parameters, convention }),
        nowEpochMs,
        expiresAtEpochMs: NonNegativeInt.make(nowEpochMs + 60_000),
      }), {
        Rejected: ({ reason }) => rejectDecision(reason),
        Revised: ({ session }) => acceptCommand(current, session, commandId, request, "CorrectionRevised", [], []),
        Started: () => rejectDecision("UnexpectedCorrectionStart"),
      })
    },
    CapturePolarAlignmentMeasurement: () => PolarDecision.$match(
      requestPolarMeasurement(current.session, AttemptId.make(`polar-attempt-${suffix}`)),
      {
        Rejected: ({ reason }) => rejectDecision(reason),
        MeasurementScheduled: ({ session }) => acceptCommand(current, session, commandId, request, "PolarMeasurementRequested", [], workFromActive(session)),
        GuidanceUpdated: () => rejectDecision("UnexpectedPolarGuidance"),
        Accepted: () => rejectDecision("UnexpectedPolarAcceptance"),
      },
    ),
    AcceptPolarAlignmentEvidence: ({ attemptId }) => PolarDecision.$match(
      acceptLatestPolarMeasurement(current.session, attemptId),
      {
        Rejected: ({ reason }) => rejectDecision(reason),
        Accepted: ({ session }) => acceptCommand(current, session, commandId, request, "PolarAlignmentCompleted", [attemptId], [AcquireWork.cases.ContinueToCapture.make({
          operationId: OperationId.make(`continue-after-${attemptId}`),
        })]),
        MeasurementScheduled: () => rejectDecision("UnexpectedMeasurementScheduled"),
        GuidanceUpdated: () => rejectDecision("UnexpectedPolarGuidance"),
      },
    ),
  })
}

function acceptCommand(
  current: AcquireServerState,
  session: AcquireSession,
  commandId: string,
  request: IdempotencyRequest | undefined,
  kind: AcquireRecordedEvent["kind"],
  evidenceAttemptIds: ReadonlyArray<typeof AttemptId.Type>,
  work: ReadonlyArray<typeof AcquireWork.Type>,
): Effect.Effect<AcquireCommit> {
  const resultRef = request === undefined ? undefined : CommandResultRef.make(`result-${commandId}`)
  const committed = commitState(current, session, kind, evidenceAttemptIds, work, commandId, request, resultRef)
  return Effect.succeed({
    state: committed,
    result: AcquireResponse.make({
      replayed: false,
      ...(resultRef === undefined ? {} : { resultRef }),
      projection: project(committed),
    }),
  })
}

function workerCommit(
  current: AcquireServerState,
  session: AcquireSession,
  kind: AcquireRecordedEvent["kind"],
  evidenceAttemptIds: ReadonlyArray<typeof AttemptId.Type>,
  work: ReadonlyArray<typeof AcquireWork.Type>,
): AtomicCommit<AcquireServerState, AcquireProjection> {
  const state = commitState(current, session, kind, evidenceAttemptIds, work)
  return { state, result: project(state) }
}

function commitState(
  current: AcquireServerState,
  session: AcquireSession,
  kind: AcquireRecordedEvent["kind"],
  evidenceAttemptIds: ReadonlyArray<typeof AttemptId.Type>,
  work: ReadonlyArray<typeof AcquireWork.Type>,
  commandId?: string,
  request?: IdempotencyRequest,
  resultRef?: typeof CommandResultRef.Type,
): AcquireServerState {
  const eventCursor = EventCursor.make(current.eventCursor + 1)
  const snapshotVersion = SnapshotVersion.make(current.snapshotVersion + 1)
  return {
    ...current,
    session,
    eventCursor,
    snapshotVersion,
    events: [...current.events, AcquireRecordedEvent.make({
      eventId: commandId === undefined ? `worker-event-${eventCursor}` : `command-event-${commandId}`,
      eventCursor,
      revision: session.revision,
      kind,
      evidenceAttemptIds,
    })],
    outbox: [...current.outbox, ...work],
    receipts: request === undefined || resultRef === undefined ? current.receipts : [...current.receipts,
      IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef }),
    ],
    results: resultRef === undefined ? current.results : [...current.results, { resultRef }],
  }
}

function replay(
  current: AcquireServerState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
): Effect.Effect<AcquireCommit, AcquireReplayUnavailable> {
  if (receipt === undefined) return Effect.fail(new AcquireReplayUnavailable())
  return IdempotencyReceipt.match(receipt, {
    Pending: () => Effect.fail(new AcquireReplayUnavailable()),
    Recorded: ({ resultRef }) => current.results.some((result) => result.resultRef === resultRef)
      ? Effect.succeed({
        state: current,
        result: AcquireResponse.make({ replayed: true, resultRef, projection: project(current) }),
      })
      : Effect.fail(new AcquireReplayUnavailable()),
  })
}

function rejectDecision(reason: string): Effect.Effect<never, AcquireDecisionRejected> {
  return Effect.fail(new AcquireDecisionRejected({ reason }))
}

function workFromActive(session: AcquireSession): ReadonlyArray<typeof AcquireWork.Type> {
  if (session.activeWork === null) return []
  return AcquireActiveWork.match(session.activeWork, {
    SolveRequested: ({ attemptId, purpose }): ReadonlyArray<typeof AcquireWork.Type> => [AcquireWork.cases.CaptureAndSolve.make({
      operationId: OperationId.make(`solve-${attemptId}`),
      attemptId,
      purpose,
    })],
    CorrectionRequested: ({ correctionAttemptId, correction }): ReadonlyArray<typeof AcquireWork.Type> => [AcquireWork.cases.MovePointingCorrection.make({
      operationId: OperationId.make(`correction-${correctionAttemptId}`),
      correctionAttemptId,
      correction,
    })],
    PolarMeasurementRequested: ({ attemptId }): ReadonlyArray<typeof AcquireWork.Type> => [AcquireWork.cases.CapturePolarMeasurement.make({
      operationId: OperationId.make(`polar-${attemptId}`),
      attemptId,
    })],
  })
}

function project(state: AcquireServerState): AcquireProjection {
  return AcquireProjection.make({
    snapshotVersion: state.snapshotVersion,
    eventCursor: state.eventCursor,
    session: state.session,
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
