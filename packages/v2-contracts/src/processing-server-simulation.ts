import { Effect, Schema } from 'effect'
import {
  LibraryAsset,
  SaveCompletionDecision,
  StagedArtifact,
  completeProcessingSave,
} from './asset-domain.js'
import {
  AtomicCommit,
  makeAtomicServerSimulation,
} from './atomic-server-simulation.js'
import {
  Command,
  CommandEnvelope,
  ProcessingArtifactSelection,
  ProcessingDestination,
  ProcessingSwitchDisposition,
} from './commands.js'
import { DomainEvent, DomainEventEnvelope } from './events.js'
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
  HostPressure,
  ProcessingPressureDecision,
  evaluateProcessingPressure,
} from './processing-pressure.js'
import {
  ProcessingSession,
  ProcessingImageRef,
  ProcessingSourceRef,
  ProcessingTransition,
  ProcessingWork,
  StartProcessingDecision,
  completeLinearMasterBuild,
  completeProcessingApply,
  completeProcessingPreview,
  currentProcessingImage,
  decideStartProcessingSession,
  discardHardenedProcessingSession,
  failProcessingApply,
  leaveProcessingSessionUnfinished,
  moveHardenedProcessingHistory,
  queueAssistantSuggestionPreview,
  queueProcessingPreview,
  retryHardenedProcessingStage,
  resumeProcessingSession,
  startProcessingApply,
} from './processing-domain.js'
import { ProcessingProject } from './processing-project-domain.js'
import {
  AssetId,
  AttemptId,
  CheckpointId,
  CommandResultRef,
  EventCursor,
  FindingId,
  NonNegativeInt,
  OperationId,
  PreviewId,
  ProcessingOutputId,
  ProcessingProjectId,
  ProcessingRevision,
  ProcessingSessionId,
  SnapshotVersion,
} from './primitives.js'
import { versionedSemanticHash } from './semantic-hash.js'

const ProcessCommand = Schema.TaggedUnion({
  StartProcessingSession: {
    sourceAssetIds: Command.cases.StartProcessingSession.fields.sourceAssetIds,
    selection: Command.cases.StartProcessingSession.fields.selection,
    idempotencyKey: Command.cases.StartProcessingSession.fields.idempotencyKey,
  },
  ResumeProcessingSession: {
    sessionId: Command.cases.ResumeProcessingSession.fields.sessionId,
    expectedProcessingRevision:
      Command.cases.ResumeProcessingSession.fields.expectedProcessingRevision,
  },
  SyncProcessingPreview: {
    sessionId: Command.cases.SyncProcessingPreview.fields.sessionId,
    expectedProcessingRevision:
      Command.cases.SyncProcessingPreview.fields.expectedProcessingRevision,
    operation: Command.cases.SyncProcessingPreview.fields.operation,
    toolId: Command.cases.SyncProcessingPreview.fields.toolId,
    parameters: Command.cases.SyncProcessingPreview.fields.parameters,
    baseHistoryPosition:
      Command.cases.SyncProcessingPreview.fields.baseHistoryPosition,
    clientPreviewSequence:
      Command.cases.SyncProcessingPreview.fields.clientPreviewSequence,
  },
  ApplyProcessingPreview: Command.cases.ApplyProcessingPreview.fields,
  UndoProcessingStep: Command.cases.UndoProcessingStep.fields,
  RedoProcessingStep: Command.cases.RedoProcessingStep.fields,
  PreviewAssistantSuggestion: Command.cases.PreviewAssistantSuggestion.fields,
  MarkAssistantFindingViewed: Command.cases.MarkAssistantFindingViewed.fields,
  RetryProcessingStep: Command.cases.RetryProcessingStep.fields,
  SwitchProcessingContext: Command.cases.SwitchProcessingContext.fields,
  SaveProcessingArtifacts: Command.cases.SaveProcessingArtifacts.fields,
  DiscardProcessingSession: Command.cases.DiscardProcessingSession.fields,
})

type ProcessCommand = typeof ProcessCommand.Type
type MemberActor = Extract<
  typeof ActorContext.Type,
  { readonly _tag: 'Member' }
>

const PressureProjection = Schema.Struct({
  state: Schema.Literals(['normal', 'throttled', 'paused']),
  reason: Schema.optionalKey(Schema.NonEmptyString),
  measurement: Schema.optionalKey(HostPressure),
})

export const ProcessingAction = Schema.Literals([
  'CreateProcessingProject',
  'AddProcessingProjectSources',
  'RemoveProcessingProjectSource',
  'AssignProcessingSourceRole',
  'NavigateProcessingProjectStage',
  'UpdateProcessingStageDraft',
  'UndoProcessingStageDraft',
  'RedoProcessingStageDraft',
  'SetCalibrationUseAnyway',
  'SetRegistrationFrameIncluded',
  'SetStackingFrameIncluded',
  'RunProcessingProjectStage',
  'SelectProcessingStageResult',
  'SaveProcessingProjectMaster',
  'OpenProcessingProjectDevelop',
  'UpdateProcessingDevelopDraft',
  'UndoProcessingDevelopDraft',
  'RedoProcessingDevelopDraft',
  'SyncProcessingDevelopPreview',
  'ApplyProcessingDevelopPreview',
  'UndoProcessingDevelopStep',
  'RedoProcessingDevelopStep',
  'RetryProcessingDevelopApply',
  'SaveProcessingDevelopResult',
  'StartProcessingSession',
  'ResumeProcessingSession',
  'SyncProcessingPreview',
  'ApplyProcessingPreview',
  'UndoProcessingStep',
  'RedoProcessingStep',
  'PreviewAssistantSuggestion',
  'MarkAssistantFindingViewed',
  'RetryProcessingStep',
  'RetryProcessingBuild',
  'SwitchProcessingContext',
  'SaveProcessingArtifacts',
  'DiscardProcessingSession',
])

export const ProcessingActionDenialReason = Schema.Literals([
  'ownerRequired',
  'readOnlyClient',
  'sourceRequired',
  'sessionActiveRequired',
  'sessionUnfinishedRequired',
  'sessionDiscarded',
  'currentImageRequired',
  'previewReadyRequired',
  'processingAttemptActive',
  'failedAttemptRequired',
  'undoUnavailable',
  'redoUnavailable',
  'outputRequired',
  'assistantFindingRequired',
  'saveInProgress',
  'projectStageRequired',
  'draftUndoUnavailable',
  'draftRedoUnavailable',
  'upstreamResultRequired',
  'stageAttemptActive',
  'stageResultUnavailable',
  'calibrationOverrideUnavailable',
  'calibrationLightsUnavailable',
  'registrationFrameChoiceUnavailable',
  'registrationReferenceUnavailable',
  'stackingFrameChoiceUnavailable',
  'stackingInputUnavailable',
  'stackResultRequired',
  'savedMasterRequired',
  'developBaseRequired',
  'developPreviewRequired',
  'developApplyActive',
  'developFailedAttemptRequired',
  'developAppliedResultRequired',
])

export const ProcessingActionEligibility = Schema.TaggedUnion({
  Eligible: { action: ProcessingAction },
  Ineligible: {
    action: ProcessingAction,
    reason: ProcessingActionDenialReason,
  },
})

export const ProcessingProjection = Schema.Struct({
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  selectedSessionId: Schema.optionalKey(ProcessingSessionId),
  selectedProjectId: Schema.optionalKey(ProcessingProjectId),
  projects: Schema.Array(ProcessingProject),
  actions: Schema.Array(ProcessingActionEligibility),
  sessions: Schema.Array(ProcessingSession),
  sessionActions: Schema.Array(
    Schema.Struct({
      sessionId: ProcessingSessionId,
      actions: Schema.Array(ProcessingActionEligibility),
    }),
  ),
  projectActions: Schema.Array(
    Schema.Struct({
      projectId: ProcessingProjectId,
      actions: Schema.Array(ProcessingActionEligibility),
    }),
  ),
  assets: Schema.Array(LibraryAsset),
  pressure: PressureProjection,
  work: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        sessionId: ProcessingSessionId,
        kind: Schema.Literals([
          'build',
          'preview',
          'apply',
          'retry',
          'save',
          'cleanup',
          'projectStage',
          'projectDevelopApply',
        ]),
        state: Schema.Literals([
          'pending',
          'claimed',
          'failed',
          'settled',
          'superseded',
        ]),
        stage: Schema.optionalKey(
          Schema.Literals([
            'validate',
            'calibrate',
            'debayer',
            'align',
            'evaluate',
            'stack',
            'Calibration',
            'Registration',
            'Stacking',
            'Develop',
          ]),
        ),
        checkpoint: Schema.optionalKey(Schema.NonEmptyString),
        attempts: NonNegativeInt,
      }),
    ),
  ),
})

export interface ProcessingProjection extends Schema.Schema.Type<
  typeof ProcessingProjection
> {}

export const ProcessingResponse = Schema.Struct({
  replayed: Schema.Boolean,
  effect: Schema.NonEmptyString,
  resultRef: Schema.optionalKey(CommandResultRef),
  operationId: Schema.optionalKey(OperationId),
  projection: ProcessingProjection,
})

export interface ProcessingResponse extends Schema.Schema.Type<
  typeof ProcessingResponse
> {}

export class ProcessingCommandRejected extends Schema.TaggedErrorClass<ProcessingCommandRejected>()(
  'ProcessingServerSimulation.CommandRejected',
  { failure: CommandFailure },
) {}

export class ProcessingTransitionRejected extends Schema.TaggedErrorClass<ProcessingTransitionRejected>()(
  'ProcessingServerSimulation.TransitionRejected',
  { reason: Schema.NonEmptyString },
) {}

interface StoredProcessingResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly effect: string
}

interface PendingProcessingSave {
  readonly operationId: typeof OperationId.Type
  readonly request: IdempotencyRequest
  readonly commandId: CommandEnvelope['commandId']
  readonly sessionId: typeof ProcessingSessionId.Type
  readonly expectedRevision: typeof ProcessingRevision.Type
  readonly artifacts: ReadonlyArray<typeof ProcessingArtifactSelection.Type>
  readonly switchToSessionId?: typeof ProcessingSessionId.Type
  readonly destinationSession?: ProcessingSession
  readonly destinationWork?: typeof ProcessingWork.Type
}

export interface ProcessingSimulationState {
  readonly sessions: ReadonlyArray<ProcessingSession>
  readonly selectedSessionId?: typeof ProcessingSessionId.Type
  readonly sourceCatalog: ReadonlyArray<typeof ProcessingSourceRef.Type>
  readonly pendingSaves: ReadonlyArray<PendingProcessingSave>
  readonly assets: ReadonlyArray<LibraryAsset>
  readonly viewedFindings: ReadonlyArray<{
    readonly findingId: typeof FindingId.Type
    readonly version: number
    readonly personId: string
  }>
  readonly pressure: typeof PressureProjection.Type
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredProcessingResult>
  readonly events: ReadonlyArray<DomainEventEnvelope>
  readonly outbox: ReadonlyArray<typeof ProcessingWork.Type>
}

export interface ProcessingSimulationConfig {
  readonly initialState: ProcessingSimulationState
  readonly occurredAt: string
  readonly discardConfirmation: (
    sessionId: typeof ProcessingSessionId.Type,
  ) => string
}

export interface ProcessingServerSimulation {
  readonly execute: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    ProcessingResponse,
    | Schema.SchemaError
    | ProcessingCommandRejected
    | ProcessingTransitionRejected
  >
  readonly completeBuild: (
    sessionId: typeof ProcessingSessionId.Type,
    outputId: typeof ProcessingOutputId.Type,
    checksum: string,
  ) => Effect.Effect<ProcessingTransition, ProcessingTransitionRejected>
  readonly completePreview: (
    sessionId: typeof ProcessingSessionId.Type,
    previewId: typeof PreviewId.Type,
    outputId: typeof ProcessingOutputId.Type,
  ) => Effect.Effect<ProcessingTransition, ProcessingTransitionRejected>
  readonly completeApply: (
    sessionId: typeof ProcessingSessionId.Type,
    attemptId: typeof AttemptId.Type,
    outputId: typeof ProcessingOutputId.Type,
    checksum: string,
    checkpointId: typeof CheckpointId.Type,
  ) => Effect.Effect<ProcessingTransition, ProcessingTransitionRejected>
  readonly failApply: (
    sessionId: typeof ProcessingSessionId.Type,
    attemptId: typeof AttemptId.Type,
    checkpointId: typeof CheckpointId.Type,
    diagnosticRef: string,
  ) => Effect.Effect<ProcessingTransition, ProcessingTransitionRejected>
  readonly completeSave: (
    operationId: typeof OperationId.Type,
    artifacts: ReadonlyArray<typeof StagedArtifact.Type>,
  ) => Effect.Effect<ProcessingResponse, ProcessingTransitionRejected>
  readonly evaluatePressure: (
    measurement: typeof HostPressure.Type,
  ) => Effect.Effect<ProcessingPressureDecision>
  readonly snapshot: () => Effect.Effect<ProcessingProjection>
  readonly readState: () => Effect.Effect<ProcessingSimulationState>
}

interface AcceptedChange {
  readonly session?: ProcessingSession
  readonly destinationSession?: ProcessingSession
  readonly selectedSessionId?: typeof ProcessingSessionId.Type
  readonly assets?: ReadonlyArray<LibraryAsset>
  readonly viewedFindings?: ProcessingSimulationState['viewedFindings']
  readonly events: ReadonlyArray<typeof DomainEvent.Type>
  readonly work: ReadonlyArray<typeof ProcessingWork.Type>
  readonly effect: string
  readonly pendingSave?: PendingProcessingSave
}

interface DestinationResolution {
  readonly sessionId: typeof ProcessingSessionId.Type
  readonly session?: ProcessingSession
  readonly work?: typeof ProcessingWork.Type
}

export const makeProcessingServerSimulation = Effect.fn(
  'ProcessingServerSimulation.make',
)(function* (config: ProcessingSimulationConfig) {
  const simulation = yield* makeAtomicServerSimulation(
    config.initialState,
    (state) => state.outbox,
  )

  const execute: ProcessingServerSimulation['execute'] = Effect.fn(
    'ProcessingServerSimulation.execute',
  )(function* (rawRequest, actor) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(ProcessCommand)(
      envelope.command,
    )
    return yield* simulation.transact((current) =>
      Effect.gen(function* () {
        const session =
          'sessionId' in command
            ? current.sessions.find(
                (candidate) => candidate.sessionId === command.sessionId,
              )
            : undefined
        const receipt =
          'idempotencyKey' in command
            ? current.receipts.find(
                (candidate) =>
                  candidate.idempotencyKey === command.idempotencyKey,
              )
            : undefined
        const idempotencyRequest =
          'idempotencyKey' in command
            ? IdempotencyRequest.make({
                idempotencyKey: command.idempotencyKey,
                personId: actor.personId,
                commandTag: command._tag,
                normalizedInputHash: normalizedProcessCommandHash(command),
              })
            : undefined
        const classification =
          idempotencyRequest === undefined
            ? IdempotencyClassification.Fresh()
            : classifyIdempotency(idempotencyRequest, receipt)
        const gate = evaluateCommandGate({
          envelope,
          actor,
          connected: true,
          snapshotVersion: current.snapshotVersion,
          currentRevisions:
            session === undefined ? {} : { processing: session.revision },
          idempotency: gateIdempotency(classification),
        })
        return yield* CommandGateDecision.$match(gate, {
          Rejected: ({ failure }) =>
            Effect.fail(new ProcessingCommandRejected({ failure })),
          ReplayPending: ({ operationId }) =>
            replayPending(current, operationId),
          ReplayRecorded: () =>
            replay(current, receipt).pipe(
              Effect.map(
                (
                  result,
                ): AtomicCommit<
                  ProcessingSimulationState,
                  ProcessingResponse
                > => ({ state: current, result }),
              ),
            ),
          Accepted: () =>
            ProcessCommand.guards.MarkAssistantFindingViewed(command) &&
            current.viewedFindings.some(
              (viewed) =>
                viewed.findingId === command.findingId &&
                viewed.version === command.findingVersion &&
                viewed.personId === actor.personId,
            )
              ? Effect.succeed({
                  state: current,
                  result: ProcessingResponse.make({
                    replayed: true,
                    effect: 'findingAlreadyViewed',
                    projection: project(current),
                  }),
                } satisfies AtomicCommit<
                  ProcessingSimulationState,
                  ProcessingResponse
                >)
              : current.pendingSaves.some(
                    (pending) =>
                      'sessionId' in command &&
                      pending.sessionId === command.sessionId,
                  ) &&
                  !ProcessCommand.guards.ResumeProcessingSession(command) &&
                  !ProcessCommand.guards.MarkAssistantFindingViewed(command)
                ? Effect.fail(
                    new ProcessingTransitionRejected({
                      reason: 'ProcessingTransitionBusy',
                    }),
                  )
                : decideCommand(
                    current,
                    command,
                    actor,
                    envelope.commandId,
                    idempotencyRequest,
                    config,
                  ).pipe(
                    Effect.map((change) =>
                      commit(
                        current,
                        change,
                        envelope,
                        idempotencyRequest,
                        config.occurredAt,
                      ),
                    ),
                  ),
        })
      }),
    )
  })

  const serviceTransition = (
    sessionId: typeof ProcessingSessionId.Type,
    decide: (session: ProcessingSession) => ProcessingTransition,
    event: (
      transition: ProcessingTransition,
    ) => typeof DomainEvent.Type | undefined,
  ): Effect.Effect<ProcessingTransition, ProcessingTransitionRejected> =>
    simulation.transact((current) => {
      const session = current.sessions.find(
        (candidate) => candidate.sessionId === sessionId,
      )
      if (session === undefined)
        return Effect.fail(
          new ProcessingTransitionRejected({
            reason: 'ProcessingSessionUnavailable',
          }),
        )
      const transition = decide(session)
      return ProcessingTransition.$match(transition, {
        Rejected: () => Effect.succeed({ state: current, result: transition }),
        BuildCompleted: ({ session }) =>
          serviceCommit(
            current,
            transition,
            session,
            event(transition),
            config.occurredAt,
          ),
        PreviewQueued: () =>
          Effect.succeed({ state: current, result: transition }),
        PreviewCompleted: ({ session }) =>
          serviceCommit(
            current,
            transition,
            session,
            undefined,
            config.occurredAt,
          ),
        PreviewFailed: ({ session }) =>
          serviceCommit(
            current,
            transition,
            session,
            undefined,
            config.occurredAt,
          ),
        ApplyStarted: () =>
          Effect.succeed({ state: current, result: transition }),
        ApplyCompleted: ({ session }) =>
          serviceCommit(
            current,
            transition,
            session,
            event(transition),
            config.occurredAt,
          ),
        ApplyFailed: ({ session }) =>
          serviceCommit(
            current,
            transition,
            session,
            event(transition),
            config.occurredAt,
          ),
        RetryStarted: () =>
          Effect.succeed({ state: current, result: transition }),
        Resumed: () => Effect.succeed({ state: current, result: transition }),
        HistoryMoved: () =>
          Effect.succeed({ state: current, result: transition }),
        LeftUnfinished: () =>
          Effect.succeed({ state: current, result: transition }),
        Discarded: () => Effect.succeed({ state: current, result: transition }),
      })
    })

  return {
    execute,
    completeBuild: (sessionId, outputId, checksum) =>
      serviceTransition(
        sessionId,
        (session) => completeLinearMasterBuild(session, outputId, checksum),
        () => undefined,
      ),
    completePreview: (sessionId, previewId, outputId) =>
      serviceTransition(
        sessionId,
        (session) => completeProcessingPreview(session, previewId, outputId),
        () => undefined,
      ),
    completeApply: (sessionId, attemptId, outputId, checksum, checkpointId) =>
      serviceTransition(
        sessionId,
        (session) =>
          completeProcessingApply(
            session,
            attemptId,
            outputId,
            checksum,
            checkpointId,
          ),
        (transition) =>
          ProcessingTransition.$match(transition, {
            ApplyCompleted: ({ session }) => {
              const operation = session.history[session.historyPosition - 1]
              return operation === undefined
                ? undefined
                : DomainEvent.cases.ProcessingStepCompleted.make({
                    sessionId,
                    operationId: operation.operationId,
                    outputId,
                  })
            },
            BuildCompleted: () => undefined,
            PreviewQueued: () => undefined,
            PreviewCompleted: () => undefined,
            PreviewFailed: () => undefined,
            ApplyStarted: () => undefined,
            ApplyFailed: () => undefined,
            RetryStarted: () => undefined,
            Resumed: () => undefined,
            HistoryMoved: () => undefined,
            LeftUnfinished: () => undefined,
            Discarded: () => undefined,
            Rejected: () => undefined,
          }),
      ),
    failApply: (sessionId, attemptId, checkpointId, diagnosticRef) =>
      serviceTransition(
        sessionId,
        (session) =>
          failProcessingApply(session, attemptId, checkpointId, diagnosticRef),
        (transition) =>
          ProcessingTransition.$match(transition, {
            ApplyFailed: ({ session }) =>
              session.failedAttempt === undefined
                ? undefined
                : DomainEvent.cases.ProcessingStepFailed.make({
                    sessionId,
                    operationId: session.failedAttempt.operationId,
                    reason: 'toolFailed',
                    diagnosticRef,
                  }),
            BuildCompleted: () => undefined,
            PreviewQueued: () => undefined,
            PreviewCompleted: () => undefined,
            PreviewFailed: () => undefined,
            ApplyStarted: () => undefined,
            ApplyCompleted: () => undefined,
            RetryStarted: () => undefined,
            Resumed: () => undefined,
            HistoryMoved: () => undefined,
            LeftUnfinished: () => undefined,
            Discarded: () => undefined,
            Rejected: () => undefined,
          }),
      ),
    completeSave: (operationId, artifacts) =>
      simulation.transact((current) =>
        completePendingSave(current, operationId, artifacts, config.occurredAt),
      ),
    evaluatePressure: (measurement) =>
      simulation.transact((current) => {
        const decision = evaluateProcessingPressure(measurement)
        const pressure = ProcessingPressureDecision.$match(decision, {
          Continue: () =>
            PressureProjection.make({ state: 'normal', measurement }),
          Throttle: ({ reason }) =>
            PressureProjection.make({
              state: 'throttled',
              reason,
              measurement,
            }),
          Pause: ({ reason }) =>
            PressureProjection.make({ state: 'paused', reason, measurement }),
        })
        const next = {
          ...current,
          pressure,
          snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
        }
        return Effect.succeed({ state: next, result: decision })
      }),
    snapshot: () => simulation.readState().pipe(Effect.map(project)),
    readState: simulation.readState,
  } satisfies ProcessingServerSimulation
})

function decideCommand(
  current: ProcessingSimulationState,
  command: ProcessCommand,
  actor: MemberActor,
  commandId: CommandEnvelope['commandId'],
  idempotencyRequest: IdempotencyRequest | undefined,
  config: ProcessingSimulationConfig,
): Effect.Effect<AcceptedChange, ProcessingTransitionRejected> {
  return ProcessCommand.match(command, {
    StartProcessingSession: ({
      sourceAssetIds,
    }): Effect.Effect<AcceptedChange, ProcessingTransitionRejected> => {
      const sources = sourceAssetIds.map((assetId) =>
        processingSourceForAsset(current, assetId),
      )
      if (sources.some((source) => source === undefined))
        return rejected('SourceAssetUnavailable')
      const sessionId = ProcessingSessionId.make(`session-${commandId}`)
      const decision = decideStartProcessingSession(
        sessionId,
        sources.filter((source) => source !== undefined),
      )
      return StartProcessingDecision.$match(decision, {
        Rejected: ({ reason }) => rejected(reason),
        Started: ({ session, work }) =>
          Effect.succeed({
            session,
            selectedSessionId: session.sessionId,
            events: [
              DomainEvent.cases.ProcessingSessionStarted.make({
                sessionId,
                sourceAssetIds,
                phase: session.phase,
              }),
            ],
            work: work === undefined ? [] : [work],
            effect: 'started',
          }),
      })
    },
    ResumeProcessingSession: ({ sessionId }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(resumeProcessingSession(session), 'resumed').pipe(
          Effect.map((change) => ({ ...change, selectedSessionId: sessionId })),
        ),
      ),
    SyncProcessingPreview: (input) =>
      withSession(current, input.sessionId, (session) =>
        transitionChange(
          queueProcessingPreview(session, {
            previewId: PreviewId.make(`preview-${commandId}`),
            clientPreviewSequence: input.clientPreviewSequence,
            operation: input.operation,
            toolId: input.toolId,
            parameters: input.parameters,
            baseHistoryPosition: input.baseHistoryPosition,
          }),
          'previewSynced',
        ),
      ),
    ApplyProcessingPreview: ({ sessionId, previewId }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(
          startProcessingApply(
            session,
            AttemptId.make(`attempt-${commandId}`),
            OperationId.make(`operation-${commandId}`),
            previewId,
          ),
          'applyStarted',
          () =>
            DomainEvent.cases.ProcessingStepApplyStarted.make({
              sessionId,
              previewId,
              operationId: OperationId.make(`operation-${commandId}`),
            }),
        ),
      ),
    UndoProcessingStep: ({ sessionId }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(
          moveHardenedProcessingHistory(session, 'undo'),
          'undone',
          (next) =>
            DomainEvent.cases.ProcessingHistoryMoved.make({
              sessionId,
              historyPosition: next.historyPosition,
            }),
        ),
      ),
    RedoProcessingStep: ({ sessionId }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(
          moveHardenedProcessingHistory(session, 'redo'),
          'redone',
          (next) =>
            DomainEvent.cases.ProcessingHistoryMoved.make({
              sessionId,
              historyPosition: next.historyPosition,
            }),
        ),
      ),
    PreviewAssistantSuggestion: ({ sessionId, findingId, findingVersion }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(
          queueAssistantSuggestionPreview(
            session,
            findingId,
            findingVersion,
            PreviewId.make(`preview-${commandId}`),
            session.preview?.clientPreviewSequence === undefined
              ? 0
              : session.preview.clientPreviewSequence + 1,
          ),
          'assistantPreviewed',
        ),
      ),
    MarkAssistantFindingViewed: ({ sessionId, findingId, findingVersion }) =>
      withSession(current, sessionId, (session) => {
        const finding = session.assistantFindings.find(
          (candidate) => candidate.findingId === findingId,
        )
        if (finding === undefined)
          return rejected('AssistantFindingUnavailable')
        if (finding.version !== findingVersion)
          return rejected('AssistantFindingSuperseded')
        return Effect.succeed({
          viewedFindings: [
            ...current.viewedFindings,
            { findingId, version: findingVersion, personId: actor.personId },
          ],
          events: [
            DomainEvent.cases.AssistantFindingViewed.make({
              sessionId,
              findingId,
              findingVersion,
            }),
          ],
          work: [],
          effect: 'findingViewed',
        })
      }),
    RetryProcessingStep: ({ sessionId, failedAttemptId, checkpointId }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(
          retryHardenedProcessingStage(
            session,
            failedAttemptId,
            AttemptId.make(`attempt-${commandId}`),
            checkpointId,
          ),
          'retryStarted',
          (next) =>
            next.activeAttempt === undefined
              ? undefined
              : DomainEvent.cases.ProcessingStepRetryStarted.make({
                  sessionId,
                  failedAttemptId,
                  checkpointId,
                  operationId: next.activeAttempt.operationId,
                }),
        ),
      ),
    SaveProcessingArtifacts: ({ sessionId, artifacts }) =>
      withSession(current, sessionId, (session) =>
        queueSaveChange(session, artifacts, commandId, idempotencyRequest),
      ),
    DiscardProcessingSession: ({ sessionId, confirmationId }) =>
      withSession(current, sessionId, (session) =>
        transitionChange(
          discardHardenedProcessingSession(
            session,
            confirmationId,
            config.discardConfirmation(sessionId),
          ),
          'discarded',
          () =>
            DomainEvent.cases.ProcessingSessionDiscarded.make({
              sessionId,
              cleanupState: 'queued',
            }),
        ),
      ),
    SwitchProcessingContext: ({ sessionId, destination, disposition }) =>
      withSession(current, sessionId, (session) => {
        const destinationResult = resolveDestination(
          current,
          destination,
          commandId,
        )
        if (destinationResult === undefined)
          return rejected('DestinationUnavailable')
        return ProcessingSwitchDisposition.match(disposition, {
          LeaveUnfinished: () =>
            transitionChange(
              leaveProcessingSessionUnfinished(session),
              'leftUnfinished',
            ).pipe(
              Effect.map((change) =>
                withDestination(change, destinationResult),
              ),
            ),
          SaveAndSwitch: ({ artifacts }) =>
            queueSaveChange(
              session,
              artifacts,
              commandId,
              idempotencyRequest,
              destinationResult,
            ),
          DiscardAndSwitch: ({ confirmationId }) =>
            transitionChange(
              discardHardenedProcessingSession(
                session,
                confirmationId,
                config.discardConfirmation(sessionId),
              ),
              'discardedAndSwitched',
              () =>
                DomainEvent.cases.ProcessingSessionDiscarded.make({
                  sessionId,
                  cleanupState: 'queued',
                }),
            ).pipe(
              Effect.map((change) =>
                withDestination(change, destinationResult),
              ),
            ),
        })
      }),
  })
}

function withSession(
  current: ProcessingSimulationState,
  sessionId: typeof ProcessingSessionId.Type,
  use: (
    session: ProcessingSession,
  ) => Effect.Effect<AcceptedChange, ProcessingTransitionRejected>,
) {
  const session = current.sessions.find(
    (candidate) => candidate.sessionId === sessionId,
  )
  return session === undefined
    ? rejected('ProcessingSessionUnavailable')
    : use(session)
}

function transitionChange(
  transition: ProcessingTransition,
  effect: string,
  event?: (session: ProcessingSession) => typeof DomainEvent.Type | undefined,
): Effect.Effect<AcceptedChange, ProcessingTransitionRejected> {
  return ProcessingTransition.$match(transition, {
    Rejected: ({ reason }) => rejected(reason),
    BuildCompleted: ({ session }) => acceptedTransition(session, effect, event),
    PreviewQueued: ({ session, work }) =>
      acceptedTransition(session, effect, event, work),
    PreviewCompleted: ({ session }) =>
      acceptedTransition(session, effect, event),
    PreviewFailed: ({ session }) => acceptedTransition(session, effect, event),
    ApplyStarted: ({ session, work }) =>
      acceptedTransition(session, effect, event, work),
    ApplyCompleted: ({ session }) => acceptedTransition(session, effect, event),
    ApplyFailed: ({ session }) => acceptedTransition(session, effect, event),
    RetryStarted: ({ session, work }) =>
      acceptedTransition(session, effect, event, work),
    Resumed: ({ session }) => acceptedTransition(session, effect, event),
    HistoryMoved: ({ session }) => acceptedTransition(session, effect, event),
    LeftUnfinished: ({ session }) => acceptedTransition(session, effect, event),
    Discarded: ({ session, work }) =>
      acceptedTransition(session, effect, event, work),
  })
}

function acceptedTransition(
  session: ProcessingSession,
  effect: string,
  event?: (session: ProcessingSession) => typeof DomainEvent.Type | undefined,
  work?: typeof ProcessingWork.Type,
): Effect.Effect<AcceptedChange> {
  const domainEvent = event?.(session)
  return Effect.succeed({
    session,
    events: domainEvent === undefined ? [] : [domainEvent],
    work: work === undefined ? [] : [work],
    effect,
  })
}

function queueSaveChange(
  session: ProcessingSession,
  selections: ReadonlyArray<typeof ProcessingArtifactSelection.Type>,
  commandId: CommandEnvelope['commandId'],
  request: IdempotencyRequest | undefined,
  destination?: DestinationResolution,
): Effect.Effect<AcceptedChange, ProcessingTransitionRejected> {
  if (request === undefined) return rejected('IdempotencyRequired')
  const [first, ...rest] = selections
  if (first === undefined) return rejected('SaveSelectionInvalid')
  const operationId = OperationId.make(`materialize-${commandId}`)
  const pendingSave: PendingProcessingSave = {
    operationId,
    request,
    commandId,
    sessionId: session.sessionId,
    expectedRevision: session.revision,
    artifacts: [first, ...rest],
    ...(destination === undefined
      ? {}
      : {
          switchToSessionId: destination.sessionId,
          ...(destination.session === undefined
            ? {}
            : { destinationSession: destination.session }),
          ...(destination.work === undefined
            ? {}
            : { destinationWork: destination.work }),
        }),
  }
  return Effect.succeed({
    events: [],
    work: [
      ProcessingWork.cases.MaterializeProcessingArtifacts.make({
        sessionId: session.sessionId,
        operationId,
        artifacts: [first, ...rest],
      }),
    ],
    effect: 'savePreparing',
    pendingSave,
  })
}

function resolveDestination(
  current: ProcessingSimulationState,
  destination: (typeof Command.cases.SwitchProcessingContext.Type)['destination'],
  commandId: CommandEnvelope['commandId'],
): DestinationResolution | undefined {
  return ProcessingDestination.match(destination, {
    ExistingSession: ({ sessionId }) =>
      current.sessions.some(
        (session) =>
          session.sessionId === sessionId && session.lifecycle !== 'discarded',
      )
        ? { sessionId }
        : undefined,
    SourceAssets: ({ assetIds }) =>
      startDestination(current, assetIds, commandId),
    SavedAsset: ({ assetId }) =>
      startSavedAssetDestination(current, assetId, commandId),
  })
}

function startSavedAssetDestination(
  current: ProcessingSimulationState,
  assetId: typeof AssetId.Type,
  commandId: CommandEnvelope['commandId'],
): DestinationResolution | undefined {
  const source = processingSourceForAsset(current, assetId)
  return source === undefined
    ? undefined
    : startDestinationFromSources([source], commandId)
}

function processingSourceForAsset(
  current: ProcessingSimulationState,
  assetId: typeof AssetId.Type,
): typeof ProcessingSourceRef.Type | undefined {
  const catalogSource = current.sourceCatalog.find(
    (source) => source.assetId === assetId,
  )
  if (catalogSource !== undefined) return catalogSource
  const saved = current.assets.find((asset) => asset.assetId === assetId)
  if (
    saved === undefined ||
    saved.role !== 'linearMaster' ||
    !saved.localAvailable
  )
    return undefined
  return ProcessingSourceRef.make({
    assetId: saved.assetId,
    assetRevision: saved.revision,
    role: 'linearMaster',
    checksum: saved.checksum,
    locallyAvailable: true,
  })
}

function startDestination(
  current: ProcessingSimulationState,
  assetIds: ReadonlyArray<typeof AssetId.Type>,
  commandId: CommandEnvelope['commandId'],
): DestinationResolution | undefined {
  const sources = assetIds.map((assetId) =>
    current.sourceCatalog.find((source) => source.assetId === assetId),
  )
  if (sources.some((source) => source === undefined)) return undefined
  return startDestinationFromSources(
    sources.filter((source) => source !== undefined),
    commandId,
  )
}

function startDestinationFromSources(
  sources: ReadonlyArray<typeof ProcessingSourceRef.Type>,
  commandId: CommandEnvelope['commandId'],
): DestinationResolution | undefined {
  const decision = decideStartProcessingSession(
    ProcessingSessionId.make(`session-switch-${commandId}`),
    sources,
  )
  return StartProcessingDecision.$match(decision, {
    Rejected: () => undefined,
    Started: ({ session, work }) => ({
      sessionId: session.sessionId,
      session,
      ...(work === undefined ? {} : { work }),
    }),
  })
}

function withDestination(
  change: AcceptedChange,
  destination: DestinationResolution,
): AcceptedChange {
  return {
    ...change,
    selectedSessionId: destination.sessionId,
    ...(destination.session === undefined
      ? {}
      : { destinationSession: destination.session }),
    work:
      destination.work === undefined
        ? change.work
        : [...change.work, destination.work],
  }
}

function commit(
  current: ProcessingSimulationState,
  change: AcceptedChange,
  envelope: CommandEnvelope,
  idempotencyRequest: IdempotencyRequest | undefined,
  occurredAt: string,
): AtomicCommit<ProcessingSimulationState, ProcessingResponse> {
  if (change.pendingSave !== undefined) {
    const next: ProcessingSimulationState = {
      ...current,
      pendingSaves: [...current.pendingSaves, change.pendingSave],
      snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
      receipts: [
        ...current.receipts,
        IdempotencyReceipt.cases.Pending.make({
          ...change.pendingSave.request,
          operationId: change.pendingSave.operationId,
        }),
      ],
      outbox: [...current.outbox, ...change.work],
    }
    return {
      state: next,
      result: ProcessingResponse.make({
        replayed: false,
        effect: change.effect,
        operationId: change.pendingSave.operationId,
        projection: project(next),
      }),
    }
  }
  const sessions =
    change.session === undefined
      ? current.sessions
      : [
          ...current.sessions.filter(
            (session) => session.sessionId !== change.session?.sessionId,
          ),
          change.session,
        ]
  const nextSessions =
    change.destinationSession === undefined
      ? sessions
      : [
          ...sessions.filter(
            (session) =>
              session.sessionId !== change.destinationSession?.sessionId,
          ),
          change.destinationSession,
        ]
  const eventCursor = EventCursor.make(
    current.eventCursor +
      change.events.length +
      (change.destinationSession === undefined ? 0 : 1),
  )
  const resultRef =
    idempotencyRequest === undefined
      ? undefined
      : CommandResultRef.make(`result-${envelope.commandId}`)
  const selectedSessionId =
    change.selectedSessionId ?? current.selectedSessionId
  const next: ProcessingSimulationState = {
    ...current,
    sessions: nextSessions,
    ...(selectedSessionId === undefined ? {} : { selectedSessionId }),
    assets: change.assets ?? current.assets,
    viewedFindings: change.viewedFindings ?? current.viewedFindings,
    snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
    eventCursor,
    receipts:
      resultRef === undefined || idempotencyRequest === undefined
        ? current.receipts
        : [
            ...current.receipts,
            IdempotencyReceipt.cases.Recorded.make({
              ...idempotencyRequest,
              resultRef,
            }),
          ],
    results:
      resultRef === undefined
        ? current.results
        : [...current.results, { resultRef, effect: change.effect }],
    events: [
      ...current.events,
      ...change.events.map((event, index) =>
        DomainEventEnvelope.make({
          eventId: `event-${current.eventCursor + index + 1}`,
          aggregateKind: 'ProcessingSession',
          aggregateId:
            change.session?.sessionId ??
            current.selectedSessionId ??
            'processing',
          aggregateRevision: change.session?.revision ?? NonNegativeInt.make(0),
          occurredAt,
          commandId: envelope.commandId,
          event,
          schemaVersion: 1,
        }),
      ),
      ...(change.destinationSession === undefined
        ? []
        : [
            DomainEventEnvelope.make({
              eventId: `event-${eventCursor}`,
              aggregateKind: 'ProcessingSession',
              aggregateId: change.destinationSession.sessionId,
              aggregateRevision: change.destinationSession.revision,
              occurredAt,
              commandId: envelope.commandId,
              event: DomainEvent.cases.ProcessingSessionStarted.make({
                sessionId: change.destinationSession.sessionId,
                sourceAssetIds: [
                  change.destinationSession.sources[0].assetId,
                  ...change.destinationSession.sources
                    .slice(1)
                    .map((source) => source.assetId),
                ],
                phase: change.destinationSession.phase,
              }),
              schemaVersion: 1,
            }),
          ]),
    ],
    outbox: [...current.outbox, ...change.work],
  }
  return {
    state: next,
    result: ProcessingResponse.make({
      replayed: false,
      effect: change.effect,
      ...(resultRef === undefined ? {} : { resultRef }),
      projection: project(next),
    }),
  }
}

function serviceCommit(
  current: ProcessingSimulationState,
  transition: ProcessingTransition,
  session: ProcessingSession,
  event: typeof DomainEvent.Type | undefined,
  occurredAt: string,
): Effect.Effect<
  AtomicCommit<ProcessingSimulationState, ProcessingTransition>
> {
  const cursor =
    event === undefined
      ? current.eventCursor
      : EventCursor.make(current.eventCursor + 1)
  const next: ProcessingSimulationState = {
    ...current,
    sessions: [
      ...current.sessions.filter(
        (candidate) => candidate.sessionId !== session.sessionId,
      ),
      session,
    ],
    snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
    eventCursor: cursor,
    events:
      event === undefined
        ? current.events
        : [
            ...current.events,
            DomainEventEnvelope.make({
              eventId: `event-${cursor}`,
              aggregateKind: 'ProcessingSession',
              aggregateId: session.sessionId,
              aggregateRevision: session.revision,
              occurredAt,
              event,
              schemaVersion: 1,
            }),
          ],
  }
  return Effect.succeed({ state: next, result: transition })
}

function completePendingSave(
  current: ProcessingSimulationState,
  operationId: typeof OperationId.Type,
  artifacts: ReadonlyArray<typeof StagedArtifact.Type>,
  occurredAt: string,
): Effect.Effect<
  AtomicCommit<ProcessingSimulationState, ProcessingResponse>,
  ProcessingTransitionRejected
> {
  const pending = current.pendingSaves.find(
    (candidate) => candidate.operationId === operationId,
  )
  if (pending === undefined) return rejected('SaveOperationUnavailable')
  const session = current.sessions.find(
    (candidate) => candidate.sessionId === pending.sessionId,
  )
  if (session === undefined || session.revision !== pending.expectedRevision)
    return rejected('ProcessingSessionRevisionConflict')
  if (
    artifacts.length !== pending.artifacts.length ||
    pending.artifacts.some(
      (selection) =>
        !artifacts.some(
          (artifact) =>
            artifact.outputId === selection.outputId &&
            artifact.format === selection.format &&
            artifact.role === selection.role,
        ),
    )
  ) {
    return rejected('ArtifactMaterializationMismatch')
  }
  const assetIds = new Set(artifacts.map((artifact) => artifact.assetId))
  if (
    assetIds.size !== artifacts.length ||
    artifacts.some((artifact) =>
      current.assets.some((asset) => asset.assetId === artifact.assetId),
    )
  ) {
    return rejected('AssetIdentityConflict')
  }
  const decision = completeProcessingSave(
    session,
    `comparison-${session.sessionId}`,
    artifacts,
    current.assets.map((asset) => asset.assetId),
  )
  return SaveCompletionDecision.$match(decision, {
    Rejected: ({ reason }) => rejected(reason),
    Saved: ({ session, assets }) => {
      const [firstAsset, ...otherAssets] = assets
      if (firstAsset === undefined) return rejected('SaveSelectionInvalid')
      const resultRef = CommandResultRef.make(`result-${pending.commandId}`)
      const assetEvents = assets.map((asset, index) =>
        DomainEventEnvelope.make({
          eventId: `event-${current.eventCursor + index + 1}`,
          aggregateKind: 'Asset',
          aggregateId: asset.assetId,
          aggregateRevision: asset.revision,
          occurredAt,
          commandId: pending.commandId,
          operationId,
          event: DomainEvent.cases.AssetCreated.make({
            assetId: asset.assetId,
            role: asset.role,
          }),
          schemaVersion: 1,
        }),
      )
      const savedEventCursor = EventCursor.make(
        current.eventCursor + assetEvents.length + 1,
      )
      const destinationEvent =
        pending.destinationSession === undefined
          ? undefined
          : DomainEventEnvelope.make({
              eventId: `event-${current.eventCursor + assetEvents.length + 2}`,
              aggregateKind: 'ProcessingSession',
              aggregateId: pending.destinationSession.sessionId,
              aggregateRevision: pending.destinationSession.revision,
              occurredAt,
              commandId: pending.commandId,
              operationId,
              event: DomainEvent.cases.ProcessingSessionStarted.make({
                sessionId: pending.destinationSession.sessionId,
                sourceAssetIds: [
                  pending.destinationSession.sources[0].assetId,
                  ...pending.destinationSession.sources
                    .slice(1)
                    .map((source) => source.assetId),
                ],
                phase: pending.destinationSession.phase,
              }),
              schemaVersion: 1,
            })
      const eventCursor = EventCursor.make(
        current.eventCursor +
          assetEvents.length +
          1 +
          (destinationEvent === undefined ? 0 : 1),
      )
      const sessions = [
        ...current.sessions.filter(
          (candidate) => candidate.sessionId !== session.sessionId,
        ),
        session,
      ]
      const next: ProcessingSimulationState = {
        ...current,
        sessions:
          pending.destinationSession === undefined
            ? sessions
            : [
                ...sessions.filter(
                  (candidate) =>
                    candidate.sessionId !==
                    pending.destinationSession?.sessionId,
                ),
                pending.destinationSession,
              ],
        ...(pending.switchToSessionId === undefined
          ? {}
          : { selectedSessionId: pending.switchToSessionId }),
        pendingSaves: current.pendingSaves.filter(
          (candidate) => candidate.operationId !== operationId,
        ),
        assets: [...current.assets, ...assets],
        snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
        eventCursor,
        receipts: [
          ...current.receipts.filter(
            (receipt) =>
              receipt.idempotencyKey !== pending.request.idempotencyKey,
          ),
          IdempotencyReceipt.cases.Recorded.make({
            ...pending.request,
            resultRef,
          }),
        ],
        results: [
          ...current.results,
          {
            resultRef,
            effect:
              pending.switchToSessionId === undefined
                ? 'saved'
                : 'savedAndSwitched',
          },
        ],
        events: [
          ...current.events,
          ...assetEvents,
          DomainEventEnvelope.make({
            eventId: `event-${savedEventCursor}`,
            aggregateKind: 'ProcessingSession',
            aggregateId: session.sessionId,
            aggregateRevision: session.revision,
            occurredAt,
            commandId: pending.commandId,
            operationId,
            event: DomainEvent.cases.ProcessingArtifactsSaved.make({
              sessionId: session.sessionId,
              assetIds: [
                firstAsset.assetId,
                ...otherAssets.map((asset) => asset.assetId),
              ],
            }),
            schemaVersion: 1,
          }),
          ...(destinationEvent === undefined ? [] : [destinationEvent]),
        ],
        outbox:
          pending.destinationWork === undefined
            ? current.outbox
            : [...current.outbox, pending.destinationWork],
      }
      return Effect.succeed({
        state: next,
        result: ProcessingResponse.make({
          replayed: false,
          resultRef,
          effect:
            pending.switchToSessionId === undefined
              ? 'saved'
              : 'savedAndSwitched',
          projection: project(next),
        }),
      })
    },
  })
}

function replayPending(
  current: ProcessingSimulationState,
  operationId: typeof OperationId.Type | undefined,
): Effect.Effect<
  AtomicCommit<ProcessingSimulationState, ProcessingResponse>,
  ProcessingTransitionRejected
> {
  if (
    operationId === undefined ||
    !current.pendingSaves.some((pending) => pending.operationId === operationId)
  ) {
    return rejected('PendingOperationUnavailable')
  }
  return Effect.succeed({
    state: current,
    result: ProcessingResponse.make({
      replayed: true,
      effect: 'savePreparing',
      operationId,
      projection: project(current),
    }),
  })
}

function replay(
  current: ProcessingSimulationState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
): Effect.Effect<ProcessingResponse, ProcessingTransitionRejected> {
  if (receipt === undefined || !IdempotencyReceipt.guards.Recorded(receipt))
    return rejected('RecordedResultUnavailable')
  const result = current.results.find(
    (candidate) => candidate.resultRef === receipt.resultRef,
  )
  return result === undefined
    ? rejected('RecordedResultUnavailable')
    : Effect.succeed(
        ProcessingResponse.make({
          replayed: true,
          effect: result.effect,
          resultRef: result.resultRef,
          projection: project(current),
        }),
      )
}

export function projectProcessingProjection(
  state: ProcessingSimulationState,
  authority: {
    readonly role: 'owner' | 'viewer'
    readonly capability: 'controlCapable' | 'readOnly'
  } = { role: 'owner', capability: 'controlCapable' },
): ProcessingProjection {
  return ProcessingProjection.make({
    snapshotVersion: state.snapshotVersion,
    eventCursor: state.eventCursor,
    ...(state.selectedSessionId === undefined
      ? {}
      : { selectedSessionId: state.selectedSessionId }),
    projects: [],
    actions: [
      eligibility('CreateProcessingProject', authorityReason(authority)),
      eligibility(
        'StartProcessingSession',
        authorityReason(authority) ??
          (state.sourceCatalog.length === 0 ? 'sourceRequired' : undefined),
      ),
    ],
    sessions: state.sessions,
    sessionActions: state.sessions.map((session) => ({
      sessionId: session.sessionId,
      actions: projectSessionActions(state, session, authority),
    })),
    projectActions: [],
    assets: state.assets,
    pressure: state.pressure,
  })
}

const project = projectProcessingProjection

type ProcessingAuthority = Parameters<typeof projectProcessingProjection>[1]
type ProcessingDenial = typeof ProcessingActionDenialReason.Type
type ProcessingActionName = typeof ProcessingAction.Type

function authorityReason(
  authority: ProcessingAuthority,
): ProcessingDenial | undefined {
  if (authority?.role !== 'owner') return 'ownerRequired'
  return authority.capability !== 'controlCapable'
    ? 'readOnlyClient'
    : undefined
}

function eligibility(
  action: ProcessingActionName,
  reason: ProcessingDenial | undefined,
): typeof ProcessingActionEligibility.Type {
  return reason === undefined
    ? { _tag: 'Eligible', action }
    : { _tag: 'Ineligible', action, reason }
}

function projectSessionActions(
  state: ProcessingSimulationState,
  session: ProcessingSession,
  authority: ProcessingAuthority,
): ReadonlyArray<typeof ProcessingActionEligibility.Type> {
  const authorityDenied = authorityReason(authority)
  const discarded = session.lifecycle === 'discarded'
  const inactive = session.lifecycle !== 'active'
  const activeAttempt = session.activeAttempt !== undefined
  const currentImage = currentProcessingImage(session)
  const pendingSave = state.pendingSaves.some(
    (pending) => pending.sessionId === session.sessionId,
  )
  const sessionReason = (): ProcessingDenial | undefined =>
    authorityDenied ??
    (discarded
      ? 'sessionDiscarded'
      : inactive
        ? 'sessionActiveRequired'
        : undefined)
  const attemptReason = (): ProcessingDenial | undefined =>
    sessionReason() ?? (activeAttempt ? 'processingAttemptActive' : undefined)
  return [
    eligibility(
      'ResumeProcessingSession',
      authorityDenied ??
        (discarded
          ? 'sessionDiscarded'
          : session.lifecycle !== 'unfinished'
            ? 'sessionUnfinishedRequired'
            : undefined),
    ),
    eligibility(
      'SyncProcessingPreview',
      attemptReason() ??
        (currentImage === undefined ? 'currentImageRequired' : undefined),
    ),
    eligibility(
      'ApplyProcessingPreview',
      attemptReason() ??
        (currentImage === undefined
          ? 'currentImageRequired'
          : session.preview?.state !== 'ready' ||
              session.preview.previewOutputId === undefined
            ? 'previewReadyRequired'
            : undefined),
    ),
    eligibility(
      'UndoProcessingStep',
      attemptReason() ??
        (session.historyPosition === 0 ? 'undoUnavailable' : undefined),
    ),
    eligibility(
      'RedoProcessingStep',
      attemptReason() ??
        (session.historyPosition === session.history.length
          ? 'redoUnavailable'
          : undefined),
    ),
    eligibility(
      'PreviewAssistantSuggestion',
      attemptReason() ??
        (session.assistantFindings.length === 0
          ? 'assistantFindingRequired'
          : undefined),
    ),
    eligibility(
      'MarkAssistantFindingViewed',
      sessionReason() ??
        (session.assistantFindings.length === 0
          ? 'assistantFindingRequired'
          : undefined),
    ),
    eligibility(
      'RetryProcessingStep',
      attemptReason() ??
        (session.failedAttempt === undefined
          ? 'failedAttemptRequired'
          : undefined),
    ),
    eligibility('SwitchProcessingContext', attemptReason()),
    eligibility(
      'SaveProcessingArtifacts',
      sessionReason() ??
        (pendingSave
          ? 'saveInProgress'
          : currentImage === undefined ||
              !ProcessingImageRef.guards.DerivedOutput(currentImage)
            ? 'outputRequired'
            : undefined),
    ),
    eligibility('DiscardProcessingSession', attemptReason()),
  ]
}

export function projectProcessingProjectActions(
  projects: ReadonlyArray<ProcessingProject | typeof ProcessingProjectId.Type>,
  authority: ProcessingAuthority,
) {
  const reason = authorityReason(authority)
  return projects.map((value) => {
    const project = typeof value === 'string' ? undefined : value
    const projectId = typeof value === 'string' ? value : value.projectId
    const stage = project?.stages.find(
      (item) => item.stage === project.currentStage,
    )
    const executable = stage !== undefined
    const active =
      stage?.attempts.some(
        (attempt) => attempt.state === 'queued' || attempt.state === 'running',
      ) ?? false
    const upstreamStage =
      stage?.stage === 'Registration'
        ? project?.stages.find((item) => item.stage === 'Calibration')
        : stage?.stage === 'Stacking'
          ? project?.stages.find((item) => item.stage === 'Registration')
          : undefined
    const upstreamAttempt = upstreamStage?.attempts.find(
      (attempt) => attempt.attemptId === upstreamStage.selectedAttemptId,
    )
    const upstreamReady =
      stage?.stage === 'Calibration' ||
      (upstreamAttempt?.state === 'succeeded' &&
        !upstreamAttempt.basedOnEarlierUpstream)
    const latestCurrentAttempt = stage?.attempts
      .filter(
        (attempt) =>
          attempt.state === 'succeeded' && !attempt.basedOnEarlierUpstream,
      )
      .at(-1)
    const referenceAssetId = stage?.draft.settings.find(
      (setting) => setting.key === 'referenceAssetId',
    )?.value
    const registrationReferenceReady =
      stage?.stage !== 'Registration' ||
      referenceAssetId === undefined ||
      referenceAssetId === 'auto' ||
      (upstreamAttempt?.outputs.some(
        (output) => output.sourceAssetId === referenceAssetId,
      ) ??
        false)
    const stackingStage = project?.stages.find(
      (item) => item.stage === 'Stacking',
    )
    const selectedStack = stackingStage?.attempts.find(
      (attempt) => attempt.attemptId === stackingStage.selectedAttemptId,
    )
    const develop = project?.develop
    const developActive =
      develop?.attempts.some(
        (attempt) => attempt.state === 'queued' || attempt.state === 'running',
      ) ?? false
    const currentDevelopEntry =
      develop === undefined || develop.historyCursor === 0
        ? undefined
        : develop.history[develop.historyCursor - 1]
    return {
      projectId,
      actions: [
        eligibility('AddProcessingProjectSources', reason),
        eligibility('RemoveProcessingProjectSource', reason),
        eligibility('AssignProcessingSourceRole', reason),
        eligibility('NavigateProcessingProjectStage', reason),
        eligibility(
          'UpdateProcessingStageDraft',
          reason ?? (executable ? undefined : 'projectStageRequired'),
        ),
        eligibility(
          'UndoProcessingStageDraft',
          reason ??
            (!executable
              ? 'projectStageRequired'
              : stage.draft.undo.length === 0
                ? 'draftUndoUnavailable'
                : undefined),
        ),
        eligibility(
          'RedoProcessingStageDraft',
          reason ??
            (!executable
              ? 'projectStageRequired'
              : stage.draft.redo.length === 0
                ? 'draftRedoUnavailable'
                : undefined),
        ),
        eligibility(
          'SetCalibrationUseAnyway',
          reason ??
            (stage?.stage !== 'Calibration' ||
            !stage.calibrationRecommendations.some(
              (recommendation) =>
                recommendation.compatibility === 'Advisory mismatch',
            )
              ? 'calibrationOverrideUnavailable'
              : undefined),
        ),
        eligibility(
          'SetRegistrationFrameIncluded',
          reason ??
            (stage?.stage !== 'Registration' ||
            !latestCurrentAttempt?.frameOutcomes.some(
              (outcome) =>
                outcome.outcome === 'Warning' &&
                latestCurrentAttempt.registrationTransforms.some(
                  (transform) =>
                    transform.assetId === outcome.assetId && transform.usable,
                ),
            )
              ? 'registrationFrameChoiceUnavailable'
              : undefined),
        ),
        eligibility(
          'SetStackingFrameIncluded',
          reason ??
            (stage?.stage !== 'Stacking' ||
            !stage.stackingRecommendations.some(
              (recommendation) => recommendation.technicallyUsable,
            )
              ? 'stackingFrameChoiceUnavailable'
              : undefined),
        ),
        eligibility(
          'RunProcessingProjectStage',
          reason ??
            (!executable
              ? 'projectStageRequired'
              : active
                ? 'stageAttemptActive'
                : stage.stage === 'Calibration' &&
                    !project?.sources.some(
                      (source) =>
                        source.role === 'Lights' &&
                        source.libraryRole === 'original' &&
                        (source.libraryFormat === 'cameraRaw' ||
                          source.libraryFormat === 'fits') &&
                        (source.availability === 'availableLocally' ||
                          source.availability === 'published'),
                    )
                  ? 'calibrationLightsUnavailable'
                  : !registrationReferenceReady
                    ? 'registrationReferenceUnavailable'
                    : stage.stage === 'Stacking' &&
                        stage.stackingRecommendations.every(
                          (recommendation) =>
                            !recommendation.technicallyUsable ||
                            (stage.draft.stackingFrameChoices.find(
                              (choice) =>
                                choice.assetId === recommendation.assetId,
                            )?.decision ?? recommendation.decision) !==
                              'Include',
                        )
                      ? 'stackingInputUnavailable'
                      : !upstreamReady
                        ? 'upstreamResultRequired'
                        : undefined),
        ),
        eligibility(
          'SelectProcessingStageResult',
          reason ??
            (!executable
              ? 'projectStageRequired'
              : stage.attempts.some((attempt) => attempt.state === 'succeeded')
                ? undefined
                : 'stageResultUnavailable'),
        ),
        eligibility(
          'SaveProcessingProjectMaster',
          reason ??
            (selectedStack?.state === 'succeeded' &&
            selectedStack.stackingOutput !== undefined
              ? undefined
              : 'stackResultRequired'),
        ),
        eligibility(
          'OpenProcessingProjectDevelop',
          reason ??
            (selectedStack?.savedMaster === undefined
              ? 'savedMasterRequired'
              : undefined),
        ),
        eligibility(
          'UpdateProcessingDevelopDraft',
          reason ?? (develop === undefined ? 'developBaseRequired' : undefined),
        ),
        eligibility(
          'UndoProcessingDevelopDraft',
          reason ??
            (develop === undefined
              ? 'developBaseRequired'
              : develop.draft.undo.length === 0
                ? 'draftUndoUnavailable'
                : undefined),
        ),
        eligibility(
          'RedoProcessingDevelopDraft',
          reason ??
            (develop === undefined
              ? 'developBaseRequired'
              : develop.draft.redo.length === 0
                ? 'draftRedoUnavailable'
                : undefined),
        ),
        eligibility(
          'SyncProcessingDevelopPreview',
          reason ?? (develop === undefined ? 'developBaseRequired' : undefined),
        ),
        eligibility(
          'ApplyProcessingDevelopPreview',
          reason ??
            (develop === undefined
              ? 'developBaseRequired'
              : developActive
                ? 'developApplyActive'
                : develop.preview === undefined ||
                    develop.preview.draftRevision !== develop.draft.revision
                  ? 'developPreviewRequired'
                  : undefined),
        ),
        eligibility(
          'UndoProcessingDevelopStep',
          reason ??
            (develop === undefined || develop.historyCursor === 0
              ? 'undoUnavailable'
              : undefined),
        ),
        eligibility(
          'RedoProcessingDevelopStep',
          reason ??
            (develop === undefined ||
            develop.historyCursor >= develop.history.length
              ? 'redoUnavailable'
              : undefined),
        ),
        eligibility(
          'RetryProcessingDevelopApply',
          reason ??
            (develop === undefined || develop.failedAttemptId === undefined
              ? 'developFailedAttemptRequired'
              : developActive
                ? 'developApplyActive'
                : undefined),
        ),
        eligibility(
          'SaveProcessingDevelopResult',
          reason ??
            (develop === undefined || currentDevelopEntry === undefined
              ? 'developAppliedResultRequired'
              : undefined),
        ),
      ],
    }
  })
}

function rejected(
  reason: string,
): Effect.Effect<never, ProcessingTransitionRejected> {
  return Effect.fail(new ProcessingTransitionRejected({ reason }))
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

function normalizedProcessCommandHash(command: ProcessCommand) {
  return versionedSemanticHash('processing-command:v1', command)
}
