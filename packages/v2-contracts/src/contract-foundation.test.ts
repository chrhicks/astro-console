import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Result, Schema } from 'effect'
import {
  AppSnapshot,
  ActionAvailability,
  Command,
  CommandEnvelope,
  DomainEvent,
  DomainEventEnvelope,
  EventCursorDecision,
  IncrementalProjectionEvent,
  LibraryPage,
  LibraryQuery,
  LibraryAssetDetail,
  ObserveLiveFrameReview,
  ProcessSourceHandoff,
  ProjectionNoticeEnvelope,
  acceptedCommandTags,
  commandFailureFamilies,
  commandTags,
  decideEventCursor,
} from './index.js'

const runFreshness = {
  runId: 'run-1',
  expectedRunRevision: 4,
  expectedLeaseRevision: 2,
}

const acquireFreshness = {
  ...runFreshness,
  expectedAcquireRevision: 3,
}

const processingFreshness = {
  sessionId: 'process-1',
  expectedProcessingRevision: 5,
}

const assetFreshness = {
  assetId: 'asset-1',
  expectedAssetRevision: 6,
}

const m31Sequence = {
  sequenceId: 'sequence-2',
  targetName: 'M31',
  acquisitionMode: 'deepSkyPlateSolve' as const,
  rightAscensionHours: 0.712,
  declinationDegrees: 41.269,
  exposureSeconds: 180,
  frameCount: 24,
  binning: 1,
  minimumAltitudeDegrees: 25,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 30,
  maxSolveAttempts: 3,
  maxCaptureRetries: 2,
  acquireFailure: 'pause',
  captureFailure: 'retry',
  estimatedDurationSeconds: 4320,
  estimatedStorageBytes: 960000000,
  priority: 0,
}

const commandFixtures: ReadonlyArray<unknown> = [
  {
    _tag: 'StartRunFromPlan',
    planId: 'plan-1',
    expectedPlanRevision: 2,
    expectedLeaseRevision: 1,
    preconditionToken: 'ready-1',
    acceptedPlanLimitationIds: [],
    idempotencyKey: 'i-1',
  },
  {
    _tag: 'PreviewRunMutation',
    runId: 'run-1',
    expectedRunRevision: 4,
    proposedChange: { _tag: 'AppendFutureSequence', sequence: m31Sequence },
  },
  {
    _tag: 'ApplyRunMutation',
    ...runFreshness,
    previewId: 'preview-1',
    idempotencyKey: 'i-9',
  },
  {
    _tag: 'ApproveDisruptiveRunMutation',
    ...runFreshness,
    previewId: 'preview-1',
    approvalId: 'approval-1',
    idempotencyKey: 'i-10',
  },
  { _tag: 'PauseRun', ...runFreshness, idempotencyKey: 'i-run-pause' },
  { _tag: 'ResumeRun', ...runFreshness, idempotencyKey: 'i-run-resume' },
  { _tag: 'StopRun', ...runFreshness, idempotencyKey: 'i-run-stop' },
  { _tag: 'RequestControl', expectedLeaseRevision: 2, idempotencyKey: 'i-2' },
  {
    _tag: 'GrantControl',
    expectedLeaseRevision: 2,
    requestId: 'request-1',
    targetClientId: 'client-2',
    idempotencyKey: 'i-3',
  },
  {
    _tag: 'DeclineControl',
    expectedLeaseRevision: 2,
    requestId: 'request-1',
    idempotencyKey: 'i-4',
  },
  { _tag: 'ReleaseControl', expectedLeaseRevision: 2, idempotencyKey: 'i-5' },
  { _tag: 'TakeControl', expectedLeaseRevision: 2, idempotencyKey: 'i-6' },
  {
    _tag: 'RetryPlateSolveWithParameters',
    ...acquireFreshness,
    parameters: { exposureSeconds: 8, binning: 2, solverProfile: 'wide-field' },
    idempotencyKey: 'i-11',
  },
  { _tag: 'SkipAcquireTarget', ...acquireFreshness, idempotencyKey: 'i-12' },
  { _tag: 'AbortAcquire', ...acquireFreshness, idempotencyKey: 'i-12a' },
  {
    _tag: 'ApprovePointingCorrection',
    ...acquireFreshness,
    proposalId: 'proposal-1',
    idempotencyKey: 'i-13',
  },
  {
    _tag: 'RevisePointingCorrection',
    ...acquireFreshness,
    proposalId: 'proposal-1',
    parameters: { rightAscensionArcsec: 120, declinationArcsec: -40 },
  },
  {
    _tag: 'CaptureTargetAcquisitionEvidence',
    ...acquireFreshness,
    idempotencyKey: 'i-24',
  },
  {
    _tag: 'RecordLiveFrameEvidence',
    ...acquireFreshness,
    idempotencyKey: 'i-25',
  },
  { _tag: 'StartManagedCapture', ...acquireFreshness, idempotencyKey: 'i-26' },
  { _tag: 'PauseManagedCapture', ...acquireFreshness, idempotencyKey: 'i-27' },
  { _tag: 'StopManagedCapture', ...acquireFreshness, idempotencyKey: 'i-28' },
  {
    _tag: 'RecenterManagedCapture',
    ...acquireFreshness,
    idempotencyKey: 'i-29',
  },
  {
    _tag: 'CapturePolarAlignmentMeasurement',
    ...acquireFreshness,
    idempotencyKey: 'i-14',
  },
  {
    _tag: 'AcceptPolarAlignmentEvidence',
    ...acquireFreshness,
    attemptId: 'attempt-1',
    idempotencyKey: 'i-15',
  },
  {
    _tag: 'StartProcessingSession',
    sourceAssetIds: ['asset-1'],
    idempotencyKey: 'i-7',
  },
  {
    _tag: 'CreateProcessingProject',
    name: 'M27 multi-night',
    selection: { assetIds: ['asset-1'], captureSetIds: [] },
    idempotencyKey: 'i-project-1',
  },
  {
    _tag: 'AddProcessingProjectSources',
    projectId: 'project-1',
    expectedProjectRevision: 0,
    selection: { assetIds: [], captureSetIds: ['capture-set-2'] },
    idempotencyKey: 'i-project-2',
  },
  {
    _tag: 'AssignProcessingSourceRole',
    projectId: 'project-1',
    expectedProjectRevision: 1,
    assetId: 'asset-1',
    role: 'Lights',
    idempotencyKey: 'i-project-3',
  },
  {
    _tag: 'NavigateProcessingProjectStage',
    projectId: 'project-1',
    expectedProjectRevision: 2,
    stage: 'Calibration',
    idempotencyKey: 'i-project-4',
  },
  {
    _tag: 'UpdateProcessingStageDraft',
    projectId: 'project-1',
    expectedProjectRevision: 3,
    stage: 'Calibration',
    settings: [{ key: 'mode', value: 'default' }],
    idempotencyKey: 'i-project-5',
  },
  {
    _tag: 'UndoProcessingStageDraft',
    projectId: 'project-1',
    expectedProjectRevision: 4,
    stage: 'Calibration',
    idempotencyKey: 'i-project-6',
  },
  {
    _tag: 'RedoProcessingStageDraft',
    projectId: 'project-1',
    expectedProjectRevision: 5,
    stage: 'Calibration',
    idempotencyKey: 'i-project-7',
  },
  {
    _tag: 'RunProcessingProjectStage',
    projectId: 'project-1',
    expectedProjectRevision: 6,
    stage: 'Calibration',
    idempotencyKey: 'i-project-8',
  },
  {
    _tag: 'SelectProcessingStageResult',
    projectId: 'project-1',
    expectedProjectRevision: 7,
    stage: 'Calibration',
    attemptId: 'stage-attempt-1',
    idempotencyKey: 'i-project-9',
  },
  {
    _tag: 'ResumeProcessingSession',
    sessionId: 'process-1',
    expectedProcessingRevision: 5,
  },
  {
    _tag: 'SyncProcessingPreview',
    sessionId: 'process-1',
    expectedProcessingRevision: 5,
    operation: 'stretch',
    toolId: 'siril',
    parameters: [{ key: 'amount', value: { _tag: 'NumberValue', value: 0.6 } }],
    baseHistoryPosition: 2,
    clientPreviewSequence: 9,
  },
  {
    _tag: 'ApplyProcessingPreview',
    ...processingFreshness,
    previewId: 'preview-2',
    idempotencyKey: 'i-16',
  },
  {
    _tag: 'UndoProcessingStep',
    ...processingFreshness,
    idempotencyKey: 'i-17',
  },
  {
    _tag: 'RedoProcessingStep',
    ...processingFreshness,
    idempotencyKey: 'i-18',
  },
  {
    _tag: 'PreviewAssistantSuggestion',
    sessionId: 'process-1',
    expectedProcessingRevision: 5,
    findingId: 'finding-1',
    findingVersion: 1,
  },
  {
    _tag: 'MarkAssistantFindingViewed',
    sessionId: 'process-1',
    findingId: 'finding-1',
    findingVersion: 1,
  },
  {
    _tag: 'RetryProcessingStep',
    ...processingFreshness,
    failedAttemptId: 'attempt-2',
    checkpointId: 'checkpoint-1',
    idempotencyKey: 'i-19',
  },
  {
    _tag: 'RetryProcessingBuild',
    ...processingFreshness,
    checkpoint: 'debayer',
    idempotencyKey: 'i-19-build',
  },
  {
    _tag: 'SwitchProcessingContext',
    ...processingFreshness,
    destination: { _tag: 'SavedAsset', assetId: 'asset-2' },
    disposition: { _tag: 'LeaveUnfinished' },
    idempotencyKey: 'i-20',
  },
  {
    _tag: 'SaveProcessingArtifacts',
    ...processingFreshness,
    artifacts: [
      { outputId: 'output-1', format: 'fits', role: 'final' },
      { outputId: 'output-1', format: 'png', role: 'preview' },
    ],
    idempotencyKey: 'i-21',
  },
  {
    _tag: 'DiscardProcessingSession',
    ...processingFreshness,
    confirmationId: 'discard-1',
    idempotencyKey: 'i-22',
  },
  { _tag: 'RequestAssetDownload', assetId: 'asset-1', idempotencyKey: 'i-8' },
  {
    _tag: 'RepublishAssetRepresentation',
    ...assetFreshness,
    representationId: 'representation-1',
    sourceChecksum: 'sha256:abc',
    idempotencyKey: 'i-23',
  },
  { _tag: 'OpenAssetInProcess', assetId: 'asset-1' },
]

describe('Gate 5 contract foundation', () => {
  it('keeps the accepted command vocabulary closed', () => {
    assert.equal(commandTags.length, 50)
    assert.deepEqual(commandTags, acceptedCommandTags)
    assert.deepEqual(
      commandTags,
      commandFixtures.map(
        (fixture) => Schema.decodeUnknownSync(Command)(fixture)._tag,
      ),
    )
  })

  it('decodes one fixture for every accepted command', () => {
    const decode = Schema.decodeUnknownResult(Command)
    commandFixtures.forEach((fixture) =>
      assert.equal(Result.isSuccess(decode(fixture)), true),
    )
  })

  it('rejects an unknown command and a non-integer aggregate revision', () => {
    const decode = Schema.decodeUnknownResult(Command)
    assert.equal(
      Result.isFailure(decode({ _tag: 'ReplayDisconnectedCommands' })),
      true,
    )
    assert.equal(
      Result.isFailure(
        decode({
          _tag: 'PreviewRunMutation',
          runId: 'run-1',
          expectedRunRevision: '4',
          proposedChange: {},
        }),
      ),
      true,
    )
    assert.equal(
      Result.isFailure(
        decode({
          _tag: 'ResumeProcessingSession',
          sessionId: 'process-1',
          expectedProcessingRevision: -1,
        }),
      ),
      true,
    )
  })

  it('decodes the shared command envelope without caller authority', () => {
    const decoded = Schema.decodeUnknownSync(CommandEnvelope)({
      commandId: 'command-1',
      command: commandFixtures[0],
    })
    assert.equal(decoded.command._tag, 'StartRunFromPlan')
    assert.equal('actorId' in decoded, false)
  })

  it('keeps failures to the nine accepted families', () => {
    assert.deepEqual(commandFailureFamilies, [
      'AuthenticationFailure',
      'AuthorizationFailure',
      'FreshnessConflict',
      'InvalidInput',
      'ActionIneligible',
      'ReferenceUnavailable',
      'CapabilityUnavailable',
      'ResourceProtected',
      'IdempotencyConflict',
    ])
  })

  it('installs one complete snapshot with separate subsystem health', () => {
    const snapshot = Schema.decodeUnknownSync(AppSnapshot)({
      observatoryId: 'observatory-1',
      snapshotVersion: 10,
      eventCursor: 40,
      generatedAt: '2026-07-22T20:00:00Z',
      membership: {
        personId: 'person-1',
        role: 'owner',
        clientId: 'client-1',
        capability: 'controlCapable',
      },
      control: {
        leaseId: 'lease-1',
        revision: 2,
        state: 'held',
        holderClientId: 'client-1',
        holderPersonId: 'person-1',
        holderDeviceLabel: 'Observatory desktop',
        pendingRequestCount: 0,
        pendingRequests: [],
        presence: [
          {
            personId: 'person-1',
            clientId: 'client-1',
            deviceLabel: 'Observatory desktop',
            observedAt: '2026-07-22T20:00:00Z',
          },
        ],
        actions: [],
      },
      run: {
        runId: 'run-1',
        revision: 4,
        sourcePlanId: 'plan-1',
        phase: 'capture',
        completedSequenceCount: 0,
        acceptedMutations: [],
        warnings: [],
        lastConfirmedAt: '2026-07-22T20:00:00Z',
        actions: [],
      },
      processingSessions: [],
      library: { assetCount: 0, selectedAssetIds: [], activeOperationIds: [] },
      selectedAssets: [],
      health: [
        {
          subsystem: 'service',
          state: 'healthy',
          observedAt: '2026-07-22T20:00:00Z',
        },
        {
          subsystem: 'tunnel',
          state: 'unavailable',
          observedAt: '2026-07-22T19:59:58Z',
          reason: 'cloudflared disconnected',
        },
      ],
    })
    assert.equal(snapshot.run?.phase, 'capture')
    assert.equal(snapshot.health[1]?.subsystem, 'tunnel')
  })

  it('keeps Library pages bounded and details outside the reconnect snapshot', () => {
    const query = Schema.decodeUnknownSync(LibraryQuery)({
      queryId: 'library-query-1',
      pageSize: 100,
      sort: 'recentlyUpdated',
    })
    const page = Schema.decodeUnknownSync(LibraryPage)({
      queryId: query.queryId,
      querySnapshotVersion: 10,
      results: [
        {
          assetId: 'asset-1',
          revision: 2,
          role: 'final',
          format: 'fits',
          availability: 'published',
          comparisonGroupId: 'm27',
          review: { decision: 'accepted', rating: 4 },
        },
      ],
      nextCursor: 'cursor-2',
      catalogChanged: false,
    })
    assert.equal(page.results[0]?.assetId, 'asset-1')
    assert.deepEqual(page.results[0]?.review, {
      decision: 'accepted',
      rating: 4,
    })
    assert.equal(
      Schema.decodeUnknownResult(LibraryQuery)({
        queryId: 'library-query-too-large',
        pageSize: 101,
        sort: 'recentlyUpdated',
      })._tag,
      'Failure',
    )
  })

  it('projects Library delivery and Process eligibility without bearer data', () => {
    const detail = Schema.decodeUnknownSync(LibraryAssetDetail)({
      assetId: 'asset-1',
      revision: 2,
      role: 'final',
      format: 'fits',
      availability: 'published',
      capturedAt: '2026-07-22T20:00:00Z',
      comparisonGroupId: 'm27',
      lineage: {
        sourceAssetIds: ['asset-source-1'],
        runId: 'run-1',
        solveAttemptId: 'solve-1',
      },
      representations: [{ label: 'R2 download', state: 'published' }],
      actions: [
        { _tag: 'Eligible', action: 'download' },
        {
          _tag: 'Unavailable',
          action: 'openInProcess',
          reason: 'AssetNotAvailableLocally',
        },
      ],
    })
    assert.equal(detail.actions[0]?._tag, 'Eligible')
    assert.equal(
      Schema.decodeUnknownResult(LibraryAssetDetail)({
        ...detail,
        checksum: 'secret',
      })._tag,
      'Success',
    )
  })

  it('keeps current Observe review to one Library-backed frame or explicit unavailability', () => {
    const unavailable = Schema.decodeUnknownSync(ObserveLiveFrameReview)({
      _tag: 'Unavailable',
      reason: 'LibraryAssetNotFound',
      message: 'The current frame has not materialized in Library yet.',
    })
    assert.equal(unavailable._tag, 'Unavailable')
    assert.equal(
      Schema.decodeUnknownResult(ObserveLiveFrameReview)({
        _tag: 'Unavailable',
        reason: 'CatalogUnavailable',
        message: 'No catalog.',
      })._tag,
      'Failure',
    )
  })

  it('keeps a Process source handoff separate from a processing session', () => {
    const handoff = Schema.decodeUnknownSync(ProcessSourceHandoff)({
      sourceAssetId: 'asset-source-1',
      revision: 1,
      role: 'original',
      format: 'fits',
      availability: 'availableLocally',
      comparisonGroupId: 'group-1',
      lineage: {
        sourceAssetIds: ['asset-raw-1'],
        runId: 'run-1',
        solveAttemptId: 'solve-1',
      },
      processing: {
        availability: 'unavailable',
        currentFixtureFacts: [
          'Interactive processing is not available in this workspace.',
        ],
      },
    })
    assert.equal(handoff.sourceAssetId, 'asset-source-1')
    assert.equal(handoff.processing.availability, 'unavailable')
    assert.equal('sessionId' in handoff, false)
    assert.equal('preview' in handoff, false)
  })

  it('keeps projected action explanations typed and actionable', () => {
    const availability = Schema.decodeUnknownSync(ActionAvailability)({
      _tag: 'Unavailable',
      action: 'PauseRun',
      reason: 'SafetyInterlock',
      safeNextActions: ['StopRun'],
      blockingSubsystem: 'rig',
      refreshRequired: true,
    })
    assert.equal(ActionAvailability.guards.Unavailable(availability), true)
    if (ActionAvailability.guards.Unavailable(availability))
      assert.equal(availability.reason, 'SafetyInterlock')
    assert.equal(
      Schema.decodeUnknownResult(ActionAvailability)({
        _tag: 'Unavailable',
        action: 'PauseRun',
        reason: 'arbitrary',
        safeNextActions: [],
      })._tag,
      'Failure',
    )
  })

  it('applies only the next event cursor and refreshes on a gap', () => {
    assert.equal(
      EventCursorDecision.$is('IgnoreAlreadyApplied')(
        decideEventCursor(40, 40),
      ),
      true,
    )
    assert.equal(
      EventCursorDecision.$is('Apply')(decideEventCursor(40, 41)),
      true,
    )
    const gap = decideEventCursor(40, 43)
    assert.equal(EventCursorDecision.$is('RefreshSnapshot')(gap), true)
    assert.deepEqual(
      gap,
      EventCursorDecision.RefreshSnapshot({
        expectedNextCursor: 41,
        receivedCursor: 43,
      }),
    )
  })

  it('rejects malformed projection events before client state advances', () => {
    const decoded = Schema.decodeUnknownResult(IncrementalProjectionEvent)({
      _tag: 'RunProjected',
      eventCursor: 41,
      snapshotVersion: 10,
      generatedAt: '2026-07-22T20:00:01Z',
      run: { runId: 'run-1', phase: 'capture' },
    })
    assert.equal(Result.isFailure(decoded), true)
  })

  it('keeps progress notices explicitly outside authoritative cursor state', () => {
    const notice = Schema.decodeUnknownSync(ProjectionNoticeEnvelope)({
      observedAt: '2026-07-22T20:00:01Z',
      notice: {
        _tag: 'OperationProgressed',
        operationId: 'operation-1',
        state: 'running',
        progress: 0.4,
      },
    })
    assert.equal(notice.notice._tag, 'OperationProgressed')
    assert.equal('eventCursor' in notice, false)
    assert.equal('snapshotVersion' in notice, false)
  })

  it('keeps durable events closed and their payloads typed', () => {
    assert.equal(Object.keys(DomainEvent.cases).length, 38)
    const event = Schema.decodeUnknownSync(DomainEventEnvelope)({
      eventId: 'event-1',
      aggregateKind: 'ProcessingSession',
      aggregateId: 'process-1',
      aggregateRevision: 6,
      occurredAt: '2026-07-22T20:01:00Z',
      commandId: 'command-1',
      event: {
        _tag: 'ProcessingStepFailed',
        sessionId: 'process-1',
        operationId: 'operation-1',
        reason: 'tool exited 1',
        diagnosticRef: 'diagnostic-1',
      },
      schemaVersion: 1,
    })
    assert.equal(event.event._tag, 'ProcessingStepFailed')
    assert.throws(() =>
      Schema.decodeUnknownSync(DomainEventEnvelope)({
        ...event,
        event: { _tag: 'ProcessingStepFailed', payload: { arbitrary: true } },
      }),
    )
    assert.equal(
      Result.isFailure(
        Schema.decodeUnknownResult(DomainEventEnvelope)({
          ...event,
          aggregateKind: 'Asset',
        }),
      ),
      true,
    )
  })
})
