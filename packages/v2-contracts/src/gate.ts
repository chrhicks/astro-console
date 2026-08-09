import { Data, Schema } from 'effect'
import { CommandEnvelope, commandRequiresIdempotency } from './commands.js'
import { CommandFailure } from './failures.js'
import {
  AcquireRevision,
  AssetRevision,
  ClientCapability,
  ClientId,
  LeaseRevision,
  MembershipRole,
  PersonId,
  PlanRevision,
  ProcessingRevision,
  RunRevision,
  SnapshotVersion,
  OperationId,
} from './primitives.js'

export const ActorContext = Schema.TaggedUnion({
  Anonymous: {},
  AuthenticatedWithoutMembership: { personId: PersonId },
  Member: {
    personId: PersonId,
    clientId: ClientId,
    role: MembershipRole,
    capability: ClientCapability,
  },
})

export const CurrentRevisions = Schema.Struct({
  plan: Schema.optionalKey(PlanRevision),
  run: Schema.optionalKey(RunRevision),
  lease: Schema.optionalKey(LeaseRevision),
  acquire: Schema.optionalKey(AcquireRevision),
  processing: Schema.optionalKey(ProcessingRevision),
  asset: Schema.optionalKey(AssetRevision),
})

export const IdempotencyState = Schema.TaggedUnion({
  Fresh: {},
  PendingMatch: { operationId: Schema.optionalKey(OperationId) },
  RecordedMatch: {},
  Conflict: {},
})

export const CommandGateInput = Schema.Struct({
  envelope: CommandEnvelope,
  actor: ActorContext,
  connected: Schema.Boolean,
  snapshotVersion: SnapshotVersion,
  currentRevisions: CurrentRevisions,
  leaseHolderClientId: Schema.optionalKey(ClientId),
  idempotency: IdempotencyState,
})

export interface CommandGateInput extends Schema.Schema.Type<
  typeof CommandGateInput
> {}

type Authority = 'member' | 'owner' | 'controller'

interface CommandPolicy {
  readonly authority: Authority
  readonly requiresDesktop: boolean
}

export const commandPolicies = {
  StartRunFromPlan: { authority: 'controller', requiresDesktop: true },
  PreviewRunMutation: { authority: 'owner', requiresDesktop: true },
  ApplyRunMutation: { authority: 'controller', requiresDesktop: true },
  ApproveDisruptiveRunMutation: {
    authority: 'controller',
    requiresDesktop: true,
  },
  PauseRun: { authority: 'controller', requiresDesktop: true },
  ResumeRun: { authority: 'controller', requiresDesktop: true },
  StopRun: { authority: 'controller', requiresDesktop: true },
  RequestControl: { authority: 'member', requiresDesktop: true },
  GrantControl: { authority: 'owner', requiresDesktop: true },
  DeclineControl: { authority: 'owner', requiresDesktop: true },
  ReleaseControl: { authority: 'controller', requiresDesktop: true },
  TakeControl: { authority: 'owner', requiresDesktop: true },
  RetryPlateSolveWithParameters: {
    authority: 'controller',
    requiresDesktop: true,
  },
  SkipAcquireTarget: { authority: 'controller', requiresDesktop: true },
  AbortAcquire: { authority: 'controller', requiresDesktop: true },
  ApprovePointingCorrection: { authority: 'controller', requiresDesktop: true },
  RevisePointingCorrection: { authority: 'controller', requiresDesktop: true },
  CaptureTargetAcquisitionEvidence: {
    authority: 'controller',
    requiresDesktop: true,
  },
  RecordLiveFrameEvidence: {
    authority: 'controller',
    requiresDesktop: true,
  },
  StartManagedCapture: { authority: 'controller', requiresDesktop: true },
  PauseManagedCapture: { authority: 'controller', requiresDesktop: true },
  StopManagedCapture: { authority: 'controller', requiresDesktop: true },
  RecenterManagedCapture: { authority: 'controller', requiresDesktop: true },
  CapturePolarAlignmentMeasurement: {
    authority: 'controller',
    requiresDesktop: true,
  },
  AcceptPolarAlignmentEvidence: {
    authority: 'controller',
    requiresDesktop: true,
  },
  StartProcessingSession: { authority: 'owner', requiresDesktop: true },
  ResumeProcessingSession: { authority: 'owner', requiresDesktop: true },
  SyncProcessingPreview: { authority: 'owner', requiresDesktop: true },
  ApplyProcessingPreview: { authority: 'owner', requiresDesktop: true },
  UndoProcessingStep: { authority: 'owner', requiresDesktop: true },
  RedoProcessingStep: { authority: 'owner', requiresDesktop: true },
  PreviewAssistantSuggestion: { authority: 'owner', requiresDesktop: true },
  MarkAssistantFindingViewed: { authority: 'owner', requiresDesktop: true },
  RetryProcessingStep: { authority: 'owner', requiresDesktop: true },
  RetryProcessingBuild: { authority: 'owner', requiresDesktop: true },
  SwitchProcessingContext: { authority: 'owner', requiresDesktop: true },
  SaveProcessingArtifacts: { authority: 'owner', requiresDesktop: true },
  DiscardProcessingSession: { authority: 'owner', requiresDesktop: true },
  RequestAssetDownload: { authority: 'member', requiresDesktop: false },
  RepublishAssetRepresentation: { authority: 'owner', requiresDesktop: true },
  OpenAssetInProcess: { authority: 'owner', requiresDesktop: true },
} satisfies Record<CommandEnvelope['command']['_tag'], CommandPolicy>

export type CommandGateDecision = Data.TaggedEnum<{
  Accepted: {}
  ReplayPending: { readonly operationId?: typeof OperationId.Type }
  ReplayRecorded: {}
  Rejected: { readonly failure: CommandFailure }
}>

export const CommandGateDecision = Data.taggedEnum<CommandGateDecision>()

export const evaluateCommandGate = (
  input: CommandGateInput,
): CommandGateDecision =>
  ActorContext.match(input.actor, {
    Anonymous: () =>
      reject(
        input,
        CommandFailure.cases.AuthenticationFailure.make({
          ...failureFields(input, 'Authentication is required', false, false),
          reason: 'Unauthenticated',
        }),
      ),
    AuthenticatedWithoutMembership: () =>
      reject(
        input,
        CommandFailure.cases.AuthenticationFailure.make({
          ...failureFields(
            input,
            'Local observatory membership is required',
            false,
            false,
          ),
          reason: 'MembershipRequired',
        }),
      ),
    Member: (actor) => evaluateMemberCommandGate(input, actor),
  })

type MemberActor = Extract<
  typeof ActorContext.Type,
  { readonly _tag: 'Member' }
>

function evaluateMemberCommandGate(
  input: CommandGateInput,
  actor: MemberActor,
): CommandGateDecision {
  const command = input.envelope.command
  const policy = commandPolicies[command._tag]

  if (commandRequiresIdempotency(command)) {
    const replay = IdempotencyState.match(input.idempotency, {
      Fresh: (): CommandGateDecision | undefined => undefined,
      PendingMatch: ({ operationId }): CommandGateDecision =>
        operationId === undefined
          ? CommandGateDecision.ReplayPending({})
          : CommandGateDecision.ReplayPending({ operationId }),
      RecordedMatch: (): CommandGateDecision =>
        CommandGateDecision.ReplayRecorded(),
      Conflict: (): CommandGateDecision =>
        reject(
          input,
          CommandFailure.cases.IdempotencyConflict.make({
            ...failureFields(
              input,
              'The idempotency key was already used for different input',
              false,
              false,
            ),
          }),
        ),
    })
    if (replay !== undefined) return replay
  }

  if (!input.connected) {
    return reject(
      input,
      CommandFailure.cases.FreshnessConflict.make({
        ...failureFields(
          input,
          'Reconnect and refresh current observatory state',
          true,
          true,
        ),
        reason: 'ReconnectRequired',
      }),
    )
  }

  if (policy.requiresDesktop && actor.capability !== 'controlCapable') {
    return reject(
      input,
      CommandFailure.cases.AuthorizationFailure.make({
        ...failureFields(input, 'This client is read-only', false, false),
        reason: 'ClientReadOnly',
      }),
    )
  }

  if (policy.authority === 'owner' && actor.role !== 'owner') {
    return reject(
      input,
      CommandFailure.cases.AuthorizationFailure.make({
        ...failureFields(input, 'Owner membership is required', false, false),
        reason: 'OwnerRequired',
      }),
    )
  }

  if (policy.authority === 'controller') {
    if (input.leaseHolderClientId === undefined) {
      return reject(
        input,
        CommandFailure.cases.AuthorizationFailure.make({
          ...failureFields(
            input,
            'The observing control lease is required',
            true,
            true,
          ),
          reason: 'ControlLeaseRequired',
        }),
      )
    }
    if (input.leaseHolderClientId !== actor.clientId) {
      return reject(
        input,
        CommandFailure.cases.AuthorizationFailure.make({
          ...failureFields(
            input,
            'Control moved to another client before this command arrived',
            false,
            true,
          ),
          reason: 'ControlLeaseLost',
        }),
      )
    }
  }

  if (
    'expectedPlanRevision' in command &&
    command.expectedPlanRevision !== input.currentRevisions.plan
  ) {
    return freshnessConflict(
      input,
      'PlanRevisionConflict',
      'The observing plan changed',
    )
  }
  if (
    'expectedLeaseRevision' in command &&
    command.expectedLeaseRevision !== input.currentRevisions.lease
  ) {
    return reject(
      input,
      CommandFailure.cases.AuthorizationFailure.make({
        ...failureFields(input, 'The control lease changed', true, true),
        reason: 'ControlLeaseConflict',
      }),
    )
  }
  if (
    'expectedRunRevision' in command &&
    command.expectedRunRevision !== input.currentRevisions.run
  ) {
    return freshnessConflict(
      input,
      'RunRevisionConflict',
      'The active run changed',
    )
  }
  if (
    'expectedAcquireRevision' in command &&
    command.expectedAcquireRevision !== input.currentRevisions.acquire
  ) {
    return freshnessConflict(
      input,
      'AcquireRevisionConflict',
      'Acquire evidence or recovery state changed',
    )
  }
  if (
    'expectedProcessingRevision' in command &&
    command.expectedProcessingRevision !== input.currentRevisions.processing
  ) {
    return freshnessConflict(
      input,
      'ProcessingSessionRevisionConflict',
      'The processing session changed',
    )
  }
  if (
    'expectedAssetRevision' in command &&
    command.expectedAssetRevision !== input.currentRevisions.asset
  ) {
    return freshnessConflict(
      input,
      'AssetRevisionConflict',
      'The asset representation state changed',
    )
  }

  return CommandGateDecision.Accepted()
}

function failureFields(
  input: CommandGateInput,
  summary: string,
  retryable: boolean,
  refreshFromSnapshot: boolean,
) {
  return {
    commandId: input.envelope.commandId,
    summary,
    retryable,
    refreshFromSnapshot,
    snapshotVersion: input.snapshotVersion,
    safeAlternatives: [],
  }
}

function freshnessConflict(
  input: CommandGateInput,
  reason:
    | 'PlanRevisionConflict'
    | 'RunRevisionConflict'
    | 'AcquireRevisionConflict'
    | 'ProcessingSessionRevisionConflict'
    | 'AssetRevisionConflict',
  summary: string,
) {
  return reject(
    input,
    CommandFailure.cases.FreshnessConflict.make({
      ...failureFields(input, summary, true, true),
      reason,
    }),
  )
}

function reject(_input: CommandGateInput, failure: CommandFailure) {
  return CommandGateDecision.Rejected({ failure })
}
