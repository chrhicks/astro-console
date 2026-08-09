import { Data, Schema } from 'effect'
import { ProcessingArtifactSelection, ProcessingParameter } from './commands.js'
import {
  AssetId,
  AssetRevision,
  AttemptId,
  CheckpointId,
  FindingId,
  NonNegativeInt,
  NonNegativeNumber,
  OperationId,
  PreviewId,
  ProcessingOutputId,
  ProcessingRevision,
  ProcessingSessionId,
} from './primitives.js'

export const ProcessingSourceRef = Schema.Struct({
  assetId: AssetId,
  assetRevision: AssetRevision,
  role: Schema.Literals(['original', 'linearMaster']),
  checksum: Schema.NonEmptyString,
  locallyAvailable: Schema.Boolean,
})

export const ProcessingImageRef = Schema.TaggedUnion({
  SourceAsset: { assetId: AssetId, checksum: Schema.NonEmptyString },
  DerivedOutput: {
    outputId: ProcessingOutputId,
    checksum: Schema.NonEmptyString,
  },
})

export const AppliedProcessingOperation = Schema.Struct({
  operationId: OperationId,
  attemptId: AttemptId,
  operation: Schema.NonEmptyString,
  toolId: Schema.NonEmptyString,
  parameters: Schema.Array(ProcessingParameter),
  input: ProcessingImageRef,
  output: ProcessingImageRef.cases.DerivedOutput,
  checkpointId: CheckpointId,
})

export const ProcessingPreviewSpec = Schema.Struct({
  previewId: PreviewId,
  clientPreviewSequence: NonNegativeInt,
  operation: Schema.NonEmptyString,
  toolId: Schema.NonEmptyString,
  parameters: Schema.Array(ProcessingParameter),
  input: ProcessingImageRef,
  baseHistoryPosition: NonNegativeInt,
  state: Schema.Literals(['queued', 'computing', 'ready', 'failed']),
  progress: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  ),
  previewOutputId: Schema.optionalKey(ProcessingOutputId),
  suggestionFindingId: Schema.optionalKey(FindingId),
})

export const ProcessingAttempt = Schema.Struct({
  attemptId: AttemptId,
  operationId: OperationId,
  operation: Schema.NonEmptyString,
  toolId: Schema.NonEmptyString,
  parameters: Schema.Array(ProcessingParameter),
  input: ProcessingImageRef,
  baseHistoryPosition: NonNegativeInt,
  state: Schema.Literals(['queued', 'running']),
  retryOfAttemptId: Schema.optionalKey(AttemptId),
})

export const FailedProcessingAttemptRecord = Schema.Struct({
  attemptId: AttemptId,
  operationId: OperationId,
  operation: Schema.NonEmptyString,
  toolId: Schema.NonEmptyString,
  parameters: Schema.Array(ProcessingParameter),
  input: ProcessingImageRef,
  baseHistoryPosition: NonNegativeInt,
  checkpointId: CheckpointId,
  diagnosticRef: Schema.NonEmptyString,
})

export const AssistantFinding = Schema.Struct({
  findingId: FindingId,
  version: NonNegativeInt,
  operation: Schema.NonEmptyString,
  toolId: Schema.NonEmptyString,
  parameters: Schema.Array(ProcessingParameter),
  input: ProcessingImageRef,
})

export const FrozenProcessingSelection = Schema.Struct({
  comparisonGroupId: Schema.NonEmptyString,
  candidateCount: NonNegativeInt,
  includedCount: NonNegativeInt,
  excludedCount: NonNegativeInt,
  candidates: Schema.Array(
    Schema.Struct({
      assetId: AssetId,
      assetRevision: AssetRevision,
      platformDecision: Schema.Literals(['include', 'exclude', 'review']),
      manualDecision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
      effectiveDecision: Schema.Literals(['include', 'exclude']),
      hardIneligible: Schema.Boolean,
      measuredSharpness: NonNegativeNumber,
      reason: Schema.NonEmptyString,
    }),
  ),
})

export const ProcessingSession = Schema.Struct({
  sessionId: ProcessingSessionId,
  revision: ProcessingRevision,
  lifecycle: Schema.Literals(['active', 'unfinished', 'discarded']),
  phase: Schema.Literals(['build', 'develop']),
  sources: Schema.NonEmptyArray(ProcessingSourceRef),
  selection: Schema.optionalKey(FrozenProcessingSelection),
  baseImage: Schema.optionalKey(ProcessingImageRef),
  history: Schema.Array(AppliedProcessingOperation),
  historyPosition: NonNegativeInt,
  preview: Schema.optionalKey(ProcessingPreviewSpec),
  activeAttempt: Schema.optionalKey(ProcessingAttempt),
  failedAttempt: Schema.optionalKey(FailedProcessingAttemptRecord),
  assistantFindings: Schema.Array(AssistantFinding),
  savedAssetIds: Schema.Array(AssetId),
}).check(
  Schema.makeFilter((session) => {
    if (session.historyPosition > session.history.length) {
      return {
        path: ['historyPosition'],
        issue: 'history position must not exceed applied history length',
      }
    }
    if (session.phase === 'develop' && session.baseImage === undefined) {
      return {
        path: ['baseImage'],
        issue: 'Develop requires a durable base image',
      }
    }
    if (
      session.lifecycle === 'discarded' &&
      (session.preview !== undefined || session.activeAttempt !== undefined)
    ) {
      return {
        path: ['lifecycle'],
        issue:
          'discarded sessions cannot retain preview or active attempt state',
      }
    }
  }),
)

export interface ProcessingSession extends Schema.Schema.Type<
  typeof ProcessingSession
> {}

export const ProcessingWork = Schema.TaggedUnion({
  BuildLinearMaster: {
    sessionId: ProcessingSessionId,
    sourceAssetIds: Schema.NonEmptyArray(AssetId),
  },
  ComputePreview: {
    sessionId: ProcessingSessionId,
    previewId: PreviewId,
    input: ProcessingImageRef,
  },
  RunAppliedOperation: {
    sessionId: ProcessingSessionId,
    attemptId: AttemptId,
    input: ProcessingImageRef,
  },
  RetryProcessingStage: {
    sessionId: ProcessingSessionId,
    attemptId: AttemptId,
    checkpointId: CheckpointId,
    input: ProcessingImageRef,
  },
  MaterializeProcessingArtifacts: {
    sessionId: ProcessingSessionId,
    operationId: OperationId,
    artifacts: Schema.NonEmptyArray(ProcessingArtifactSelection),
  },
  CleanupDiscardedSession: {
    sessionId: ProcessingSessionId,
    protectedAssetIds: Schema.Array(AssetId),
  },
})

export type StartProcessingDecision = Data.TaggedEnum<{
  Started: {
    readonly session: ProcessingSession
    readonly work?: typeof ProcessingWork.Type
  }
  Rejected: {
    readonly reason:
      | 'SourceAssetUnavailable'
      | 'SourceSelectionInvalid'
      | 'SourceRoleUnsupported'
  }
}>

export const StartProcessingDecision =
  Data.taggedEnum<StartProcessingDecision>()

export const decideStartProcessingSession = (
  sessionId: typeof ProcessingSessionId.Type,
  sources: ReadonlyArray<typeof ProcessingSourceRef.Type>,
): StartProcessingDecision => {
  const first = sources[0]
  if (first === undefined)
    return StartProcessingDecision.Rejected({
      reason: 'SourceSelectionInvalid',
    })
  if (sources.some((source) => !source.locallyAvailable))
    return StartProcessingDecision.Rejected({
      reason: 'SourceAssetUnavailable',
    })
  if (sources.every((source) => source.role === 'original')) {
    const sourceIds = sources.map((source) => source.assetId)
    const [, ...rest] = sources
    return StartProcessingDecision.Started({
      session: ProcessingSession.make({
        sessionId,
        revision: ProcessingRevision.make(0),
        lifecycle: 'active',
        phase: 'build',
        sources: [first, ...rest],
        history: [],
        historyPosition: NonNegativeInt.make(0),
        assistantFindings: [],
        savedAssetIds: [],
      }),
      work: ProcessingWork.cases.BuildLinearMaster.make({
        sessionId,
        sourceAssetIds: [first.assetId, ...sourceIds.slice(1)],
      }),
    })
  }
  if (sources.length === 1 && first.role === 'linearMaster') {
    const source = first
    return StartProcessingDecision.Started({
      session: ProcessingSession.make({
        sessionId,
        revision: ProcessingRevision.make(0),
        lifecycle: 'active',
        phase: 'develop',
        sources: [source],
        baseImage: ProcessingImageRef.cases.SourceAsset.make({
          assetId: source.assetId,
          checksum: source.checksum,
        }),
        history: [],
        historyPosition: NonNegativeInt.make(0),
        assistantFindings: [],
        savedAssetIds: [],
      }),
    })
  }
  return StartProcessingDecision.Rejected({ reason: 'SourceRoleUnsupported' })
}

export const currentProcessingImage = (
  session: ProcessingSession,
): typeof ProcessingImageRef.Type | undefined => {
  if (session.historyPosition === 0) return session.baseImage
  return session.history[session.historyPosition - 1]?.output
}

export type ProcessingTransition = Data.TaggedEnum<{
  BuildCompleted: { readonly session: ProcessingSession }
  PreviewQueued: {
    readonly session: ProcessingSession
    readonly work: typeof ProcessingWork.Type
  }
  PreviewCompleted: { readonly session: ProcessingSession }
  PreviewFailed: { readonly session: ProcessingSession }
  ApplyStarted: {
    readonly session: ProcessingSession
    readonly work: typeof ProcessingWork.Type
  }
  ApplyCompleted: { readonly session: ProcessingSession }
  ApplyFailed: { readonly session: ProcessingSession }
  RetryStarted: {
    readonly session: ProcessingSession
    readonly work: typeof ProcessingWork.Type
  }
  Resumed: { readonly session: ProcessingSession }
  HistoryMoved: { readonly session: ProcessingSession }
  LeftUnfinished: { readonly session: ProcessingSession }
  Discarded: {
    readonly session: ProcessingSession
    readonly work: typeof ProcessingWork.Type
  }
  Rejected: {
    readonly reason:
      | 'SessionDiscarded'
      | 'CurrentImageUnavailable'
      | 'PreviewInputSuperseded'
      | 'PreviewSequenceSuperseded'
      | 'PreviewNotReady'
      | 'ProcessingAttemptBusy'
      | 'AttemptSuperseded'
      | 'UndoUnavailable'
      | 'RedoUnavailable'
      | 'ProcessingStepNotFailed'
      | 'RetryInputChanged'
      | 'AssistantFindingUnavailable'
      | 'AssistantFindingSuperseded'
      | 'DiscardConfirmationMismatch'
      | 'BuildCompletionSuperseded'
      | 'SessionUnfinishedRequired'
  }
}>

export const ProcessingTransition = Data.taggedEnum<ProcessingTransition>()

const revised = (
  previous: ProcessingSession,
  next: Omit<ProcessingSession, 'revision'>,
): ProcessingSession =>
  ProcessingSession.make({
    ...next,
    revision: ProcessingRevision.make(previous.revision + 1),
  })

export const completeLinearMasterBuild = (
  session: ProcessingSession,
  outputId: typeof ProcessingOutputId.Type,
  outputChecksum: string,
): ProcessingTransition => {
  if (
    session.lifecycle === 'discarded' ||
    session.phase !== 'build' ||
    session.baseImage !== undefined
  ) {
    return ProcessingTransition.Rejected({
      reason: 'BuildCompletionSuperseded',
    })
  }
  return ProcessingTransition.BuildCompleted({
    session: revised(session, {
      ...session,
      phase: 'develop',
      baseImage: ProcessingImageRef.cases.DerivedOutput.make({
        outputId,
        checksum: outputChecksum,
      }),
    }),
  })
}

export const queueProcessingPreview = (
  session: ProcessingSession,
  preview: Omit<typeof ProcessingPreviewSpec.Type, 'input' | 'state'>,
): ProcessingTransition => {
  if (session.lifecycle === 'discarded')
    return ProcessingTransition.Rejected({ reason: 'SessionDiscarded' })
  const input = currentProcessingImage(session)
  if (input === undefined)
    return ProcessingTransition.Rejected({ reason: 'CurrentImageUnavailable' })
  if (preview.baseHistoryPosition !== session.historyPosition)
    return ProcessingTransition.Rejected({ reason: 'PreviewInputSuperseded' })
  if (
    session.preview !== undefined &&
    preview.clientPreviewSequence <= session.preview.clientPreviewSequence
  ) {
    return ProcessingTransition.Rejected({
      reason: 'PreviewSequenceSuperseded',
    })
  }
  const queued = ProcessingPreviewSpec.make({
    ...preview,
    input,
    state: 'queued',
    progress: 0,
  })
  return ProcessingTransition.PreviewQueued({
    session: revised(session, { ...session, preview: queued }),
    work: ProcessingWork.cases.ComputePreview.make({
      sessionId: session.sessionId,
      previewId: preview.previewId,
      input,
    }),
  })
}

export const queueAssistantSuggestionPreview = (
  session: ProcessingSession,
  findingId: typeof FindingId.Type,
  findingVersion: number,
  previewId: typeof PreviewId.Type,
  clientPreviewSequence: number,
): ProcessingTransition => {
  const finding = session.assistantFindings.find(
    (candidate) => candidate.findingId === findingId,
  )
  if (finding === undefined)
    return ProcessingTransition.Rejected({
      reason: 'AssistantFindingUnavailable',
    })
  if (
    finding.version !== findingVersion ||
    !sameProcessingImage(finding.input, currentProcessingImage(session))
  ) {
    return ProcessingTransition.Rejected({
      reason: 'AssistantFindingSuperseded',
    })
  }
  return queueProcessingPreview(session, {
    previewId,
    clientPreviewSequence: NonNegativeInt.make(clientPreviewSequence),
    operation: finding.operation,
    toolId: finding.toolId,
    parameters: finding.parameters,
    baseHistoryPosition: session.historyPosition,
    suggestionFindingId: finding.findingId,
  })
}

export const completeProcessingPreview = (
  session: ProcessingSession,
  previewId: typeof PreviewId.Type,
  outputId: typeof ProcessingOutputId.Type,
): ProcessingTransition => {
  const preview = session.preview
  if (
    preview === undefined ||
    preview.previewId !== previewId ||
    preview.baseHistoryPosition !== session.historyPosition ||
    (preview.state !== 'queued' && preview.state !== 'computing')
  ) {
    return ProcessingTransition.Rejected({ reason: 'PreviewInputSuperseded' })
  }
  return ProcessingTransition.PreviewCompleted({
    session: revised(session, {
      ...session,
      preview: ProcessingPreviewSpec.make({
        ...preview,
        state: 'ready',
        progress: 1,
        previewOutputId: outputId,
      }),
    }),
  })
}

export const failProcessingPreview = (
  session: ProcessingSession,
  previewId: typeof PreviewId.Type,
): ProcessingTransition => {
  const preview = session.preview
  if (
    preview === undefined ||
    preview.previewId !== previewId ||
    preview.baseHistoryPosition !== session.historyPosition ||
    (preview.state !== 'queued' && preview.state !== 'computing')
  ) {
    return ProcessingTransition.Rejected({ reason: 'PreviewInputSuperseded' })
  }
  const { previewOutputId: _output, ...unchangedPreview } = preview
  return ProcessingTransition.PreviewFailed({
    session: revised(session, {
      ...session,
      preview: ProcessingPreviewSpec.make({
        ...unchangedPreview,
        state: 'failed',
      }),
    }),
  })
}

export const startProcessingApply = (
  session: ProcessingSession,
  attemptId: typeof AttemptId.Type,
  operationId: typeof OperationId.Type,
  previewId: typeof PreviewId.Type,
): ProcessingTransition => {
  if (session.activeAttempt !== undefined)
    return ProcessingTransition.Rejected({ reason: 'ProcessingAttemptBusy' })
  const preview = session.preview
  if (preview?.state !== 'ready' || preview.previewOutputId === undefined)
    return ProcessingTransition.Rejected({ reason: 'PreviewNotReady' })
  if (preview.previewId !== previewId)
    return ProcessingTransition.Rejected({ reason: 'PreviewInputSuperseded' })
  const input = currentProcessingImage(session)
  if (input === undefined)
    return ProcessingTransition.Rejected({ reason: 'CurrentImageUnavailable' })
  if (preview.baseHistoryPosition !== session.historyPosition)
    return ProcessingTransition.Rejected({ reason: 'PreviewInputSuperseded' })
  const attempt = ProcessingAttempt.make({
    attemptId,
    operationId,
    operation: preview.operation,
    toolId: preview.toolId,
    parameters: preview.parameters,
    input,
    baseHistoryPosition: preview.baseHistoryPosition,
    state: 'queued',
  })
  return ProcessingTransition.ApplyStarted({
    session: revised(session, { ...session, activeAttempt: attempt }),
    work: ProcessingWork.cases.RunAppliedOperation.make({
      sessionId: session.sessionId,
      attemptId,
      input,
    }),
  })
}

export const completeProcessingApply = (
  session: ProcessingSession,
  attemptId: typeof AttemptId.Type,
  outputId: typeof ProcessingOutputId.Type,
  outputChecksum: string,
  checkpointId: typeof CheckpointId.Type,
): ProcessingTransition => {
  const attempt = session.activeAttempt
  if (attempt === undefined || attempt.attemptId !== attemptId)
    return ProcessingTransition.Rejected({ reason: 'AttemptSuperseded' })
  const kept = session.history.slice(0, attempt.baseHistoryPosition)
  const operation = AppliedProcessingOperation.make({
    operationId: attempt.operationId,
    attemptId,
    operation: attempt.operation,
    toolId: attempt.toolId,
    parameters: attempt.parameters,
    input: attempt.input,
    output: ProcessingImageRef.cases.DerivedOutput.make({
      outputId,
      checksum: outputChecksum,
    }),
    checkpointId,
  })
  const {
    activeAttempt: _active,
    preview: _preview,
    failedAttempt: _failed,
    revision: _revision,
    ...unchanged
  } = session
  return ProcessingTransition.ApplyCompleted({
    session: revised(session, {
      ...unchanged,
      history: [...kept, operation],
      historyPosition: NonNegativeInt.make(kept.length + 1),
    }),
  })
}

export const failProcessingApply = (
  session: ProcessingSession,
  attemptId: typeof AttemptId.Type,
  checkpointId: typeof CheckpointId.Type,
  diagnosticRef: string,
): ProcessingTransition => {
  const attempt = session.activeAttempt
  if (attempt === undefined || attempt.attemptId !== attemptId) {
    return ProcessingTransition.Rejected({ reason: 'AttemptSuperseded' })
  }
  const failedAttempt = FailedProcessingAttemptRecord.make({
    attemptId: attempt.attemptId,
    operationId: attempt.operationId,
    operation: attempt.operation,
    toolId: attempt.toolId,
    parameters: attempt.parameters,
    input: attempt.input,
    baseHistoryPosition: attempt.baseHistoryPosition,
    checkpointId,
    diagnosticRef,
  })
  const { activeAttempt: _active, revision: _revision, ...unchanged } = session
  return ProcessingTransition.ApplyFailed({
    session: revised(session, { ...unchanged, failedAttempt }),
  })
}

export const moveHardenedProcessingHistory = (
  session: ProcessingSession,
  direction: 'undo' | 'redo',
): ProcessingTransition => {
  if (session.activeAttempt !== undefined)
    return ProcessingTransition.Rejected({ reason: 'ProcessingAttemptBusy' })
  if (direction === 'undo' && session.historyPosition === 0)
    return ProcessingTransition.Rejected({ reason: 'UndoUnavailable' })
  if (
    direction === 'redo' &&
    session.historyPosition === session.history.length
  )
    return ProcessingTransition.Rejected({ reason: 'RedoUnavailable' })
  const { preview: _preview, revision: _revision, ...unchanged } = session
  return ProcessingTransition.HistoryMoved({
    session: revised(session, {
      ...unchanged,
      historyPosition: NonNegativeInt.make(
        direction === 'undo'
          ? session.historyPosition - 1
          : session.historyPosition + 1,
      ),
    }),
  })
}

export const leaveProcessingSessionUnfinished = (
  session: ProcessingSession,
): ProcessingTransition => {
  if (session.lifecycle === 'discarded')
    return ProcessingTransition.Rejected({ reason: 'SessionDiscarded' })
  if (session.activeAttempt !== undefined)
    return ProcessingTransition.Rejected({ reason: 'ProcessingAttemptBusy' })
  return ProcessingTransition.LeftUnfinished({
    session: revised(session, { ...session, lifecycle: 'unfinished' }),
  })
}

export const resumeProcessingSession = (
  session: ProcessingSession,
): ProcessingTransition => {
  if (session.lifecycle !== 'unfinished')
    return ProcessingTransition.Rejected({
      reason:
        session.lifecycle === 'discarded'
          ? 'SessionDiscarded'
          : 'SessionUnfinishedRequired',
    })
  return ProcessingTransition.Resumed({
    session: revised(session, { ...session, lifecycle: 'active' }),
  })
}

export const retryHardenedProcessingStage = (
  session: ProcessingSession,
  failedAttemptId: typeof AttemptId.Type,
  assignedAttemptId: typeof AttemptId.Type,
  checkpointId: typeof CheckpointId.Type,
): ProcessingTransition => {
  if (session.activeAttempt !== undefined)
    return ProcessingTransition.Rejected({ reason: 'ProcessingAttemptBusy' })
  const failed = session.failedAttempt
  if (failed === undefined)
    return ProcessingTransition.Rejected({ reason: 'ProcessingStepNotFailed' })
  if (
    failed.attemptId !== failedAttemptId ||
    failed.checkpointId !== checkpointId
  ) {
    return ProcessingTransition.Rejected({ reason: 'RetryInputChanged' })
  }
  const attempt = ProcessingAttempt.make({
    attemptId: assignedAttemptId,
    operationId: failed.operationId,
    operation: failed.operation,
    toolId: failed.toolId,
    parameters: failed.parameters,
    input: failed.input,
    baseHistoryPosition: failed.baseHistoryPosition,
    state: 'queued',
    retryOfAttemptId: failed.attemptId,
  })
  const { failedAttempt: _failed, revision: _revision, ...unchanged } = session
  return ProcessingTransition.RetryStarted({
    session: revised(session, { ...unchanged, activeAttempt: attempt }),
    work: ProcessingWork.cases.RetryProcessingStage.make({
      sessionId: session.sessionId,
      attemptId: assignedAttemptId,
      checkpointId,
      input: failed.input,
    }),
  })
}

export const discardHardenedProcessingSession = (
  session: ProcessingSession,
  confirmationId: string,
  expectedConfirmationId: string,
): ProcessingTransition => {
  if (confirmationId !== expectedConfirmationId)
    return ProcessingTransition.Rejected({
      reason: 'DiscardConfirmationMismatch',
    })
  if (session.lifecycle === 'discarded')
    return ProcessingTransition.Rejected({ reason: 'SessionDiscarded' })
  if (session.activeAttempt !== undefined)
    return ProcessingTransition.Rejected({ reason: 'ProcessingAttemptBusy' })
  const {
    preview: _preview,
    activeAttempt: _attempt,
    failedAttempt: _failed,
    revision: _revision,
    ...unchanged
  } = session
  return ProcessingTransition.Discarded({
    session: revised(session, {
      ...unchanged,
      lifecycle: 'discarded',
      history: [],
      historyPosition: NonNegativeInt.make(0),
    }),
    work: ProcessingWork.cases.CleanupDiscardedSession.make({
      sessionId: session.sessionId,
      protectedAssetIds: session.savedAssetIds,
    }),
  })
}

function sameProcessingImage(
  left: typeof ProcessingImageRef.Type,
  right: typeof ProcessingImageRef.Type | undefined,
): boolean {
  if (right === undefined) return false
  return ProcessingImageRef.match(left, {
    SourceAsset: ({ assetId, checksum }) =>
      ProcessingImageRef.guards.SourceAsset(right) &&
      right.assetId === assetId &&
      right.checksum === checksum,
    DerivedOutput: ({ outputId, checksum }) =>
      ProcessingImageRef.guards.DerivedOutput(right) &&
      right.outputId === outputId &&
      right.checksum === checksum,
  })
}
