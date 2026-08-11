import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import {
  AcquireActiveWork,
  AcquireSession,
  ActiveRunState,
  DownloadRoutingDecision,
  LibraryAsset,
  AssetId,
  AppSnapshot,
  AttemptId,
  ClientId,
  ClientConnection,
  ClientProjectionState,
  Command,
  ControlLeaseState,
  ControlRequestResolution,
  EventCursor,
  IncrementalProjectionEvent,
  OperationId,
  PointingSolveResult,
  PolarDecision,
  projectSnapshotForClient,
  RepublicationStartDecision,
  RepresentationId,
  RunDefinition,
  RunMutationPreview,
  RunSequenceDefinition,
  RunStartReadiness,
  SnapshotVersion,
  RecoverySeriesDecision,
  RecoverySeriesId,
  SolveCompletionDecision,
  acceptLatestPolarMeasurement,
  applyRunMutation,
  decideAssetDownload,
  decideRepublishAsset,
  decideStartRun,
  expireControlGrace,
  installAuthoritativeSnapshot,
  markClientDisconnected,
  markControllerDisconnected,
  navigateWorkspace,
  receiveIncrementalEvent,
  openRecoverySeries,
  recordCorrectionAcknowledgement,
  recordPolarMeasurementEvidence,
  recordSolveCompletion,
  requestPolarMeasurement,
  releaseControl,
  requestControl,
  resolveControlRequest,
  routeAttention,
  takeControl,
} from './index.js'

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S['Type'] => Schema.decodeUnknownSync(schema)(input)

const run = () =>
  decode(ActiveRunState, {
    runId: 'run-1',
    revision: 12,
    phase: 'capture',
    activeSequenceId: 'm27',
    futureSequenceIds: ['m31', 'ngc7000'],
    acceptedMutations: [],
  })
const futureSequence = decode(RunSequenceDefinition, {
  sequenceId: 'sh2-101',
  targetName: 'Sh2-101',
  acquisitionMode: 'deepSkyPlateSolve',
  rightAscensionHours: 20.3,
  declinationDegrees: 40.7,
  exposureSeconds: 180,
  frameCount: 20,
  binning: 1,
  minimumAltitudeDegrees: 25,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 30,
  maxSolveAttempts: 3,
  maxCaptureRetries: 2,
  acquireFailure: 'pause',
  captureFailure: 'retry',
  estimatedDurationSeconds: 3600,
  estimatedStorageBytes: 800000000,
  priority: 0,
})
const runDefinition = () =>
  decode(RunDefinition, {
    runId: 'run-1',
    executor: 'real',
    sourcePlanId: 'plan-1',
    sourcePlanRevision: 7,
    acceptedAt: '2026-07-22T23:30:00Z',
    acceptedLimitations: [],
    executionContext: {
      rigId: 'rig-main',
      mountDeviceId: 'mount-asi',
      cameraDeviceId: 'camera-sony',
      latitudeDegrees: 39.95,
      longitudeDegrees: -75.16,
      elevationMeters: 30,
      completionBehavior: 'park',
      unsafeBehavior: 'pauseAndPark',
    },
    sequences: [
      { ...futureSequence, sequenceId: 'm27', targetName: 'M27' },
      { ...futureSequence, sequenceId: 'm31', targetName: 'M31' },
      { ...futureSequence, sequenceId: 'ngc7000', targetName: 'NGC 7000' },
    ],
  })
const runPreview = (
  impact: 'nonDisruptive' | 'notice' | 'disruptive' | 'ineligible',
  mutation: unknown = {
    _tag: 'AppendFutureSequence',
    sequence: futureSequence,
  },
) =>
  decode(RunMutationPreview, {
    previewId: 'preview-1',
    runId: 'run-1',
    basedOnRevision: 12,
    mutation,
    impact,
    consequences: ['forecast changes'],
    expiresAtEpochMs: 2000,
    ...(impact === 'disruptive' ? { approvalId: 'approve-1' } : {}),
  })
const lease = () =>
  decode(ControlLeaseState, {
    leaseId: 'lease-1',
    revision: 4,
    state: 'held',
    holderClientId: 'client-owner',
    requests: [],
  })
const acquirePolicy = {
  centeringToleranceArcsec: 30,
  automaticCorrectionLimitArcsec: 300,
  hardCorrectionLimitArcsec: 1800,
  maxSolveAttemptsPerSeries: 3,
  maxCorrectionAttempts: 2,
  maxRecoverySeries: 1,
  polarToleranceArcsec: 120,
}
const acquire = () =>
  decode(AcquireSession, {
    runId: 'run-1',
    revision: 7,
    mode: 'pointing',
    phase: 'solving',
    policy: acquirePolicy,
    solveSeries: [
      {
        seriesId: 'series-1',
        purpose: 'initial',
        parameters: {
          exposureSeconds: 4,
          binning: 2,
          solverProfile: 'default',
        },
        maxAttempts: 3,
        verificationOfCorrectionAttemptId: null,
        completedAttemptIds: [],
      },
    ],
    evidence: [],
    activeWork: {
      _tag: 'SolveRequested',
      attemptId: 'solve-1',
      seriesId: 'series-1',
      attemptNumber: 1,
      purpose: 'initial',
      verificationOfCorrectionAttemptId: null,
    },
    pendingCorrectionProposal: null,
    latestPolarMeasurementAttemptId: null,
    acceptedPolarMeasurementAttemptId: null,
  })
const polarAcquire = () =>
  decode(AcquireSession, {
    runId: 'run-1',
    revision: 7,
    mode: 'polar',
    phase: 'polarGuidance',
    policy: acquirePolicy,
    solveSeries: [],
    evidence: [],
    activeWork: null,
    pendingCorrectionProposal: null,
    latestPolarMeasurementAttemptId: null,
    acceptedPolarMeasurementAttemptId: null,
  })
const solveResult = (rightAscensionArcsec: number, declinationArcsec: number) =>
  PointingSolveResult.cases.Solved.make({
    desiredCenter: { rightAscensionDegrees: 279.23, declinationDegrees: 38.78 },
    solvedCenter: { rightAscensionDegrees: 279.2, declinationDegrees: 38.75 },
    correction: {
      rightAscensionArcsec,
      declinationArcsec,
      convention: 'mountRaDec',
    },
    uncertaintyArcsec: 2,
  })
const solveCompletion = (
  attemptId: string,
  result: typeof PointingSolveResult.Type,
) => ({
  attemptId: AttemptId.make(attemptId),
  sourceFrameAssetId: AssetId.make(`frame-${attemptId}`),
  capturedAtEpochMs: 1_000,
  solverId: 'astrometry.net',
  solverVersion: '0.97',
  result,
  nextAttemptId: AttemptId.make(`${attemptId}-retry`),
  correctionAttemptId: AttemptId.make(`${attemptId}-correction`),
  proposalId: `${attemptId}-proposal`,
  proposalExpiresAtEpochMs: 61_000,
})
const asset = (
  role:
    | 'original'
    | 'linearMaster'
    | 'intermediate'
    | 'final'
    | 'preview'
    | 'diagnostic' = 'original',
  published = false,
) =>
  decode(LibraryAsset, {
    assetId: 'asset-1',
    revision: 2,
    role,
    format: 'fits',
    checksum: 'sha256:asset-1',
    localAvailable: true,
    lineage: {
      comparisonGroupId: 'capture-session-1',
      sourceAssetIds: ['asset-source'],
      operationIds: [],
    },
    representations: published
      ? [
          {
            _tag: 'Published',
            representationId: 'rep-1',
            format: 'fits',
            expiresAtEpochMs: 2_000,
          },
        ]
      : [],
  })
const downloadDecision = (
  candidate: LibraryAsset,
  accessPath: 'lan' | 'remote',
) =>
  decideAssetDownload({
    asset: candidate,
    accessPath,
    nowEpochMs: 1_000,
    assignedRepresentationId: RepresentationId.make('rep-assigned'),
    assignedOperationId: OperationId.make('publish-assigned'),
  })
const appSnapshot = (snapshotVersion = 10, eventCursor = 40) =>
  decode(AppSnapshot, {
    observatoryId: 'observatory-1',
    snapshotVersion,
    eventCursor,
    generatedAt: '2026-07-22T20:00:00Z',
    membership: {
      personId: 'person-1',
      role: 'owner',
      clientId: 'client-1',
      capability: 'controlCapable',
    },
    control: {
      leaseId: 'lease-1',
      revision: 4,
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
      actions: [{ _tag: 'Available', action: 'ReleaseControl' }],
    },
    run: {
      runId: 'run-1',
      revision: 12,
      sourcePlanId: 'plan-1',
      phase: 'capture',
      completedSequenceCount: 0,
      acceptedMutations: [],
      warnings: [],
      lastConfirmedAt: '2026-07-22T20:00:00Z',
      actions: [{ _tag: 'Available', action: 'PauseRun' }],
    },
    library: { assetCount: 0, selectedAssetIds: [], activeOperationIds: [] },
    selectedAssets: [],
    health: [
      {
        subsystem: 'service',
        state: 'healthy',
        observedAt: '2026-07-22T20:00:00Z',
      },
    ],
  })
const client = () =>
  decode(ClientProjectionState, {
    connection: { _tag: 'Current', lastConfirmedAt: '2026-07-22T20:00:00Z' },
    snapshot: appSnapshot(),
    changesWhileAway: [],
  })

const scenarioIds = [
  'SHELL-01',
  'SHELL-02',
  'CLIENT-01',
  'CLIENT-02',
  'CLIENT-03',
  'PHONE-01',
  'RUN-01',
  'RUN-02',
  'RUN-03',
  'RUN-04',
  'RUN-05',
  'RUN-06',
  'LEASE-01',
  'LEASE-02',
  'LEASE-03',
  'LEASE-04',
  'LEASE-05',
  'LEASE-06',
  'ACQ-01',
  'ACQ-02',
  'ACQ-03',
  'ACQ-04',
  'ACQ-05',
  'ACQ-06',
  'ACQ-07',
  'LIB-01',
  'LIB-02',
  'LIB-03',
] as const

type ScenarioId = (typeof scenarioIds)[number]

const checks: Record<ScenarioId, () => void> = {
  'SHELL-01': () => {
    const next = navigateWorkspace(
      { workspace: 'observe', activeRunId: run().runId },
      'library',
    )
    assert.equal(next.activeRunId, run().runId)
  },
  'SHELL-02': () =>
    assert.equal(
      routeAttention({ workspace: 'plan' }, 'process').attentionWorkspace,
      'process',
    ),
  'CLIENT-01': () => {
    const stale = markClientDisconnected(client(), '2026-07-22T20:00:05Z')
    assert.equal(ClientConnection.guards.Stale(stale.connection), true)
    assert.equal(stale.snapshot.snapshotVersion, 10)
  },
  'CLIENT-02': () => {
    const fresh = installAuthoritativeSnapshot(client(), appSnapshot(12, 52))
    assert.deepEqual(
      [fresh.snapshot.snapshotVersion, fresh.snapshot.eventCursor],
      [12, 52],
    )
  },
  'CLIENT-03': () =>
    assert.equal(
      receiveIncrementalEvent(
        client(),
        IncrementalProjectionEvent.cases.HealthProjected.make({
          eventCursor: EventCursor.make(39),
          snapshotVersion: SnapshotVersion.make(9),
          generatedAt: '2026-07-22T19:59:59Z',
          health: [],
        }),
      )._tag,
      'Ignored',
    ),
  'PHONE-01': () => {
    const phone = projectSnapshotForClient(appSnapshot(), {
      ...appSnapshot().membership,
      clientId: ClientId.make('phone-1'),
      capability: 'readOnly',
    })
    assert.equal(phone.run?.actions[0]?._tag, 'Unavailable')
  },
  'RUN-01': () => {
    const command = decode(Command.cases.StartRunFromPlan, {
      _tag: 'StartRunFromPlan',
      planId: 'plan-1',
      expectedPlanRevision: 3,
      expectedLeaseRevision: 4,
      preconditionToken: 'ready',
      acceptedPlanLimitationIds: [],
      idempotencyKey: 'run-start',
    })
    const result = decideStartRun({
      command,
      plan: {
        planId: command.planId,
        revision: command.expectedPlanRevision,
        validation: 'ready',
        limitations: [],
        executionContext: runDefinition().executionContext,
        sequences: [
          { ...futureSequence, sequenceId: 'm27', targetName: 'M27' },
        ],
      },
      readiness: RunStartReadiness.cases.Ready.make({
        preconditionToken: 'ready',
      }),
      assignedRunId: run().runId,
      acceptedAt: '2026-07-22T23:30:00Z',
    })
    assert.equal(result._tag, 'Started')
    if (result._tag === 'Started') {
      assert.equal(result.definition.sourcePlanRevision, 3)
      assert.equal(result.work._tag, 'BeginRun')
    }
  },
  'RUN-02': () => {
    const result = applyRunMutation(
      run(),
      runDefinition(),
      runPreview('nonDisruptive'),
      1000,
    )
    assert.equal(result._tag, 'Applied')
    if (result._tag === 'Applied') assert.equal(result.state.revision, 13)
  },
  'RUN-03': () =>
    assert.equal(
      applyRunMutation(
        run(),
        runDefinition(),
        runPreview('notice', {
          _tag: 'ReorderFutureSequences',
          sequenceIds: ['ngc7000', 'm31'],
        }),
        1000,
      )._tag,
      'Applied',
    ),
  'RUN-04': () => {
    const preview = runPreview('disruptive', {
      _tag: 'SwitchTargetNow',
      sequenceId: 'm31',
    })
    assert.equal(
      applyRunMutation(run(), runDefinition(), preview, 1000)._tag,
      'RequiresApproval',
    )
    assert.equal(
      applyRunMutation(run(), runDefinition(), preview, 1000, 'approve-1')._tag,
      'Applied',
    )
  },
  'RUN-05': () =>
    assert.equal(
      applyRunMutation(run(), runDefinition(), runPreview('ineligible'), 1000)
        ._tag,
      'Ineligible',
    ),
  'RUN-06': () => {
    const preview = decode(RunMutationPreview, {
      ...runPreview('notice'),
      basedOnRevision: 11,
    })
    assert.equal(
      applyRunMutation(run(), runDefinition(), preview, 1000)._tag,
      'StalePreview',
    )
  },
  'LEASE-01': () =>
    assert.equal(
      requestControl(
        lease(),
        'request-1',
        ClientId.make('client-friend'),
        1_000,
        61_000,
      )._tag,
      'Updated',
    ),
  'LEASE-02': () => {
    const requested = requestControl(
      lease(),
      'request-1',
      ClientId.make('client-friend'),
      1_000,
      61_000,
    )
    assert.equal(requested._tag, 'Updated')
    if (requested._tag === 'Updated')
      assert.equal(
        resolveControlRequest(
          requested.state,
          ControlRequestResolution.cases.Grant.make({
            requestId: 'request-1',
            nowEpochMs: 2_000,
            target: {
              clientId: ClientId.make('client-friend'),
              capability: 'controlCapable',
              connection: 'current',
            },
          }),
        )._tag,
        'Updated',
      )
  },
  'LEASE-03': () => {
    const grace = markControllerDisconnected(
      lease(),
      ClientId.make('client-owner'),
      1000,
    )
    assert.equal(grace._tag, 'Updated')
    if (grace._tag === 'Updated')
      assert.equal(expireControlGrace(grace.state, 1001)._tag, 'Updated')
  },
  'LEASE-04': () => {
    const result = takeControl(lease(), ClientId.make('client-owner-2'))
    assert.equal(result._tag, 'Updated')
  },
  'LEASE-05': () => {
    const taken = takeControl(lease(), ClientId.make('client-owner-2'))
    assert.equal(taken._tag, 'Updated')
    if (taken._tag === 'Updated')
      assert.equal(
        releaseControl(taken.state, ClientId.make('client-owner'))._tag,
        'Unchanged',
      )
  },
  'LEASE-06': () => {
    const phone = projectSnapshotForClient(appSnapshot(), {
      ...appSnapshot().membership,
      clientId: ClientId.make('phone-1'),
      capability: 'readOnly',
    })
    assert.equal(phone.control.actions[0]?._tag, 'Unavailable')
  },
  'ACQ-01': () =>
    assert.equal(
      SolveCompletionDecision.$is('AutomaticCorrectionStarted')(
        recordSolveCompletion(
          acquire(),
          solveCompletion('solve-1', solveResult(120, -40)),
        ),
      ),
      true,
    ),
  'ACQ-02': () =>
    assert.equal(
      SolveCompletionDecision.$is('RetryScheduled')(
        recordSolveCompletion(
          acquire(),
          solveCompletion(
            'solve-1',
            PointingSolveResult.cases.NoSolution.make({
              category: 'starsNotFound',
              retryable: true,
              diagnosticRef: 'diag-1',
            }),
          ),
        ),
      ),
      true,
    ),
  'ACQ-03': () => {
    const paused = decode(AcquireSession, {
      ...acquire(),
      phase: 'paused',
      activeWork: null,
    })
    const result = openRecoverySeries(paused, {
      seriesId: RecoverySeriesId.make('recovery-1'),
      attemptId: AttemptId.make('recovery-solve-1'),
      parameters: { exposureSeconds: 10, binning: 2, solverProfile: 'deep' },
    })
    assert.equal(RecoverySeriesDecision.$is('Started')(result), true)
  },
  'ACQ-04': () =>
    assert.equal(
      SolveCompletionDecision.$is('CorrectionApprovalRequired')(
        recordSolveCompletion(
          acquire(),
          solveCompletion('solve-1', solveResult(900, 100)),
        ),
      ),
      true,
    ),
  'ACQ-05': () => {
    const started = recordSolveCompletion(
      acquire(),
      solveCompletion('solve-1', solveResult(120, -40)),
    )
    assert.equal(
      SolveCompletionDecision.$is('AutomaticCorrectionStarted')(started),
      true,
    )
    if (!SolveCompletionDecision.$is('AutomaticCorrectionStarted')(started))
      return
    const active = started.session.activeWork
    assert.ok(AcquireActiveWork.guards.CorrectionRequested(active))
    if (!AcquireActiveWork.guards.CorrectionRequested(active)) return
    const acknowledged = recordCorrectionAcknowledgement(started.session, {
      correctionAttemptId: active.correctionAttemptId,
      accepted: true,
      occurredAtEpochMs: 2_000,
      acknowledgementRef: 'driver-ack',
      verificationSeriesId: RecoverySeriesId.make('verification-1'),
      verificationAttemptId: AttemptId.make('verification-solve-1'),
    })
    assert.equal(acknowledged._tag, 'VerificationScheduled')
  },
  'ACQ-06': () => {
    const requested = requestPolarMeasurement(
      polarAcquire(),
      AttemptId.make('polar-1'),
    )
    assert.equal(PolarDecision.$is('MeasurementScheduled')(requested), true)
    if (!PolarDecision.$is('MeasurementScheduled')(requested)) return
    const recorded = recordPolarMeasurementEvidence(requested.session, {
      attemptId: AttemptId.make('polar-1'),
      sourceFrameAssetId: AssetId.make('polar-frame-1'),
      measuredAtEpochMs: 1_000,
      desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
      measuredMountAxis: {
        rightAscensionDegrees: 0.01,
        declinationDegrees: 89.98,
      },
      altitudeErrorArcsec: 80,
      azimuthErrorArcsec: -40,
      uncertaintyArcsec: 5,
    })
    assert.equal(PolarDecision.$is('GuidanceUpdated')(recorded), true)
  },
  'ACQ-07': () => {
    const requested = requestPolarMeasurement(
      polarAcquire(),
      AttemptId.make('polar-2'),
    )
    assert.equal(PolarDecision.$is('MeasurementScheduled')(requested), true)
    if (!PolarDecision.$is('MeasurementScheduled')(requested)) return
    const recorded = recordPolarMeasurementEvidence(requested.session, {
      attemptId: AttemptId.make('polar-2'),
      sourceFrameAssetId: AssetId.make('polar-frame-2'),
      measuredAtEpochMs: 1_000,
      desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
      measuredMountAxis: {
        rightAscensionDegrees: 0,
        declinationDegrees: 89.999,
      },
      altitudeErrorArcsec: 5,
      azimuthErrorArcsec: -4,
      uncertaintyArcsec: 2,
    })
    assert.equal(PolarDecision.$is('GuidanceUpdated')(recorded), true)
    if (PolarDecision.$is('GuidanceUpdated')(recorded)) {
      assert.equal(
        PolarDecision.$is('Accepted')(
          acceptLatestPolarMeasurement(
            recorded.session,
            AttemptId.make('polar-2'),
          ),
        ),
        true,
      )
    }
  },
  'LIB-01': () => assert.equal(asset('final').assetId, 'asset-1'),
  'LIB-02': () => {
    assert.equal(
      DownloadRoutingDecision.$is('StreamLocal')(
        downloadDecision(asset(), 'lan'),
      ),
      true,
    )
    assert.equal(
      DownloadRoutingDecision.$is('PreparationStarted')(
        downloadDecision(asset(), 'remote'),
      ),
      true,
    )
    assert.equal(
      DownloadRoutingDecision.$is('PublishedRepresentationEligible')(
        downloadDecision(asset('original', true), 'remote'),
      ),
      true,
    )
  },
  'LIB-03': () => {
    const result = decideRepublishAsset(
      asset('final'),
      RepresentationId.make('rep-expired'),
      OperationId.make('republish-1'),
      'sha256:asset-1',
      1_000,
    )
    assert.equal(RepublicationStartDecision.$is('Started')(result), true)
    if (RepublicationStartDecision.$is('Started')(result))
      assert.equal(result.asset.assetId, 'asset-1')
  },
}

describe('Gate 5 scenario evidence catalog', () => {
  it('contains the exact retained non-Process scenario baseline', () => {
    assert.equal(scenarioIds.length, 28)
    assert.deepEqual(Object.keys(checks), scenarioIds)
  })

  for (const scenarioId of scenarioIds) {
    it(
      `${scenarioId} executes its current graded contract evidence`,
      checks[scenarioId],
    )
  }
})
