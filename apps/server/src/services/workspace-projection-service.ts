import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import {
  ObserveWorkspaceProjection,
  PlanWorkspaceProjection,
  AcquireSession,
  AcquireEvidence,
  AcquireActiveWork,
  PointingSolveResult,
  AcquireSnapshot,
  RunDefinition,
} from '@astro-console/v2-contracts'
import type { Snapshot } from './domain-state.ts'
import type { LocalIdentity } from '../auth/identity.ts'
import { planWorkspaceProjection } from './runtime-bootstrap.ts'

const StoredRunDefinition = Schema.Struct({
  id: Schema.String,
  definition: RunDefinition,
  plan: PlanWorkspaceProjection,
})
const StoredMutationPreview = Schema.Struct({
  preview_id: Schema.String,
  run_id: Schema.String,
  run_revision: Schema.Int,
  owner_person_id: Schema.String,
  mutation: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
  consequences: Schema.String,
  classification: Schema.Literals(['nonDisruptive', 'notice', 'disruptive']),
  expires_at: Schema.String,
  applied_at: Schema.NullOr(Schema.String),
})
const LifecycleEventRow = Schema.Struct({
  type: Schema.String,
  snapshot: Schema.String,
})
const LifecycleEventPayload = Schema.Struct({
  run: Schema.Struct({ id: Schema.String }),
})
const StoredAcquireSession = Schema.Struct({ session: Schema.String })
const ExecutorWorkRow = Schema.Struct({
  work_id: Schema.String,
  kind: Schema.Literals([
    'BeginRun',
    'StartExposure',
    'RetrieveFrame',
    'AbortExposure',
  ]),
  state: Schema.Literals([
    'pending',
    'commandAttempted',
    'observing',
    'reconciling',
    'completed',
    'rejected',
    'cancelled',
  ]),
  command_attempted_at: Schema.NullOr(Schema.String),
  acknowledged_at: Schema.NullOr(Schema.String),
  settled_at: Schema.NullOr(Schema.String),
  last_error: Schema.NullOr(Schema.String),
})
const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
const CapturedAssetRow = Schema.Struct({
  asset_id: Schema.String,
  detail: Schema.String,
})
const CapturedAssetDetail = Schema.Struct({
  lineage: Schema.Struct({ runId: Schema.optionalKey(Schema.String) }),
})

export const observeWorkspaceProjection = (
  db: DatabaseSync,
  identity: LocalIdentity,
  current: Snapshot,
  options: { readonly suppressTargetTerminalActions?: boolean } = {},
) => {
  const run = current.run
  if (run === null || run.sourceDefinitionId === undefined) return undefined
  const definitionRow = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(
    db
      .prepare(
        'SELECT definition FROM run_definitions WHERE run_definition_id=?',
      )
      .get(run.sourceDefinitionId),
  )
  if (definitionRow === undefined) return undefined
  const definition = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(definitionRow.definition),
  )
  const realExecutor = definition.definition.executor === 'real'
  const controller = current.control.holderClientId === identity.clientId
  const writable = identity.capability === 'controlCapable'
  const terminal =
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested'
  const eligible = (
    value: boolean,
    reason:
      | 'readOnlyClient'
      | 'controlRequired'
      | 'activeRunRequired'
      | 'pausedRunRequired'
      | 'terminalRun'
      | 'retryUsed'
      | 'policyUnavailable',
  ) =>
    value
      ? { _tag: 'Eligible' as const }
      : { _tag: 'Ineligible' as const, reason }
  const baseReason = !writable
    ? 'readOnlyClient'
    : !controller
      ? 'controlRequired'
      : terminal
        ? 'terminalRun'
        : 'activeRunRequired'
  const active = writable && controller && !terminal && run.phase !== 'paused'
  const pausedRecovery = writable && controller && run.phase === 'paused'
  const events = Schema.decodeUnknownSync(Schema.Array(LifecycleEventRow))(
    db
      .prepare(
        "SELECT type,snapshot FROM events WHERE type IN ('RunStarted','RunPaused','RunResumed','RunStopped','FakeSequenceSkipped','FakePhaseRetried','FakeParkRequested','RunCompleted','RunCaptureReady','RunAcquireRequired','RunExposureObserved','RunExposureCompletionObserved','RunFrameInspectionUpdated','RunFrameInspectionUnavailable','RunFrameRetrievalFailed','RunProviderOutcomeUnknown','RunProviderCommandRejected','RunReconciliationUnavailable','RunExposureAbortObserved') ORDER BY cursor",
      )
      .all(),
  )
    .filter(({ snapshot }) => lifecycleEventRunId(snapshot) === run.id)
    .map(
      ({ type }) =>
        `${realExecutor ? 'Supervised' : 'Fake/fixture'} lifecycle fact: ${type}.`,
    )
  const acquireRow = Schema.decodeUnknownSync(
    Schema.optional(StoredAcquireSession),
  )(
    db
      .prepare('SELECT session FROM acquire_sessions WHERE run_id=?')
      .get(run.id),
  )
  const acquire =
    acquireRow === undefined
      ? undefined
      : acquireSnapshot(
          Schema.decodeUnknownSync(AcquireSession)(
            JSON.parse(acquireRow.session),
          ),
          writable && controller,
          options.suppressTargetTerminalActions === true,
        )
  const executorWork = realExecutor
    ? Schema.decodeUnknownSync(Schema.Array(ExecutorWorkRow))(
        db
          .prepare(
            'SELECT work_id,kind,state,command_attempted_at,acknowledged_at,settled_at,last_error FROM run_executor_work WHERE run_id=? ORDER BY rowid',
          )
          .all(run.id),
      ).map((work) => ({
        workId: work.work_id,
        kind: work.kind,
        state: work.state,
        ...(work.command_attempted_at === null
          ? {}
          : { commandAttemptedAt: work.command_attempted_at }),
        ...(work.acknowledged_at === null
          ? {}
          : { acknowledgedAt: work.acknowledged_at }),
        ...(work.settled_at === null ? {} : { settledAt: work.settled_at }),
        ...(work.last_error === null ? {} : { lastError: work.last_error }),
      }))
    : []
  const workFacts = executorWork.map((work) => executorWorkFact(work))
  const latestCapturedAssetId = Schema.decodeUnknownSync(
    Schema.Array(CapturedAssetRow),
  )(
    db
      .prepare(
        "SELECT asset_id,detail FROM library_assets WHERE role='original' ORDER BY captured_at DESC,asset_id ASC",
      )
      .all(),
  ).find((asset) => {
    try {
      return (
        Schema.decodeUnknownSync(CapturedAssetDetail)(JSON.parse(asset.detail))
          .lineage.runId === run.id
      )
    } catch {
      return false
    }
  })?.asset_id
  const refreshPreflightReason = !writable
    ? 'readOnlyClient'
    : !controller
      ? 'controlRequired'
      : terminal
        ? 'terminalRun'
        : 'policyUnavailable'
  return Schema.decodeUnknownSync(ObserveWorkspaceProjection)({
    runId: run.id,
    revision: run.revision,
    executor: definition.definition.executor,
    phase: run.phase,
    ...(terminal ? { terminalOutcome: run.phase } : {}),
    target: run.target,
    currentSequence: run.activeSequenceIndex ?? 0,
    completedSequences: run.completedSequenceCount ?? 0,
    totalSequences: definition.definition.sequences.length,
    ...(run.resumablePhase === undefined
      ? {}
      : { resumablePhase: run.resumablePhase }),
    retryUsed: run.retryPhase !== undefined,
    ...(run.preflight === undefined ? {} : { preflight: run.preflight }),
    ...(acquire === undefined ? {} : { acquire }),
    ...(realExecutor ? { executorWork } : {}),
    ...(latestCapturedAssetId === undefined ? {} : { latestCapturedAssetId }),
    lifecycleFacts:
      events.length === 0
        ? [
            realExecutor
              ? 'Supervised lifecycle started from durable service work.'
              : 'Fake/fixture lifecycle started.',
          ]
        : events,
    attemptFacts: realExecutor
      ? [
          ...(workFacts.length === 0
            ? ['No durable executor work is recorded for this run.']
            : workFacts),
          latestCapturedAssetId !== undefined
            ? `The completed frame is retained as Library asset ${latestCapturedAssetId}.`
            : executorWork.some((work) => work.kind === 'RetrieveFrame')
              ? 'Camera completion was observed. Capture remains current until image bytes are retained for immutable Library intake.'
              : run.phase === 'verify'
                ? 'The camera was later observed idle. Captured bytes are being retrieved for immutable Library intake.'
                : 'No physical capture or captured bytes are claimed by this projection.',
        ]
      : [
          'All lifecycle and attempt evidence is fake/fixture only; no physical capture is claimed.',
          ...(run.retryPhase === undefined
            ? ['No fake/fixture phase retry has been used.']
            : [`Fake/fixture retry used for ${run.retryPhase}.`]),
          ...(run.phase === 'parkRequested'
            ? ['Park is policy only; no mount moved.']
            : []),
        ],
    actions: {
      refreshPreflight: eligible(
        writable && controller && !terminal && run.phase === 'preflight',
        refreshPreflightReason,
      ),
      pause: eligible(
        active && !(realExecutor && run.phase === 'verify'),
        realExecutor && run.phase === 'verify'
          ? 'policyUnavailable'
          : baseReason,
      ),
      resume: eligible(
        writable &&
          controller &&
          !realExecutor &&
          run.phase === 'paused' &&
          run.resumablePhase !== undefined,
        run.phase !== 'paused' ? 'pausedRunRequired' : baseReason,
      ),
      stop: eligible(active || pausedRecovery, baseReason),
      skip: eligible(
        active && !realExecutor,
        realExecutor || run.phase === 'paused'
          ? 'policyUnavailable'
          : baseReason,
      ),
      retry: eligible(
        active && !realExecutor && run.retryPhase === undefined,
        realExecutor || terminal || run.phase === 'paused'
          ? run.phase === 'paused'
            ? 'policyUnavailable'
            : baseReason
          : run.retryPhase === undefined
            ? baseReason
            : 'retryUsed',
      ),
      park: eligible(
        !realExecutor && (active || pausedRecovery),
        realExecutor ? 'policyUnavailable' : baseReason,
      ),
    },
  })
}

function executorWorkFact(work: {
  readonly kind:
    'BeginRun' | 'StartExposure' | 'RetrieveFrame' | 'AbortExposure'
  readonly state:
    | 'pending'
    | 'commandAttempted'
    | 'observing'
    | 'reconciling'
    | 'completed'
    | 'rejected'
    | 'cancelled'
  readonly lastError?: string
}) {
  const subject = `${work.kind} ${work.state}`
  const fact =
    work.state === 'pending'
      ? `${subject}: durable work was persisted before any provider command.`
      : work.state === 'commandAttempted'
        ? work.kind === 'RetrieveFrame'
          ? `${subject}: the service is performing an idempotent, read-only image retrieval.`
          : `${subject}: the provider write was attempted and will not be replayed until later observation resolves it.`
        : work.state === 'observing'
          ? `${subject}: provider acknowledgement was followed by an active camera observation.`
          : work.state === 'reconciling'
            ? `${subject}: the service is using read-only observation and will not replay the provider command.`
            : work.state === 'completed'
              ? work.kind === 'RetrieveFrame'
                ? `${subject}: the immutable original and inspection outcome were persisted.`
                : `${subject}: later observation settled this durable work.`
              : work.state === 'cancelled'
                ? `${subject}: the intervention settled this work before a provider command was sent.`
                : `${subject}: the provider rejected this durable work.`
  return work.lastError === undefined ? fact : `${fact} ${work.lastError}`
}

function acquireSnapshot(
  session: typeof AcquireSession.Type,
  writable: boolean,
  suppressTargetTerminalActions = false,
) {
  const latest = session.evidence.findLast(
    (evidence) =>
      AcquireEvidence.guards.SolveAttempt(evidence) ||
      AcquireEvidence.guards.PolarMeasurement(evidence) ||
      AcquireEvidence.guards.LunarDiskLimbMeasurement(evidence),
  )
  const liveFrame = session.evidence.findLast(AcquireEvidence.guards.LiveFrame)
  const currentSeries = session.solveSeries.at(-1)
  const latestSolved = session.evidence.findLast(
    (evidence) =>
      AcquireEvidence.guards.SolveAttempt(evidence) &&
      PointingSolveResult.guards.Solved(evidence.result),
  )
  let latestEvidence: (typeof AcquireSnapshot.Type)['latestEvidence']
  if (latest !== undefined && AcquireEvidence.guards.SolveAttempt(latest)) {
    latestEvidence = PointingSolveResult.guards.Solved(latest.result)
      ? {
          _tag: 'Solved',
          attemptId: latest.attemptId,
          sourceFrameAssetId: latest.sourceFrameAssetId,
          correction: latest.result.correction,
          magnitudeArcsec: Math.hypot(
            latest.result.correction.rightAscensionArcsec,
            latest.result.correction.declinationArcsec,
          ),
          uncertaintyArcsec: latest.result.uncertaintyArcsec,
        }
      : {
          _tag: 'NoSolution',
          attemptId: latest.attemptId,
          sourceFrameAssetId: latest.sourceFrameAssetId,
          category: latest.result.category,
          diagnosticRef: latest.result.diagnosticRef,
        }
  } else if (
    latest !== undefined &&
    AcquireEvidence.guards.PolarMeasurement(latest)
  ) {
    latestEvidence = {
      _tag: 'PolarMeasurement',
      attemptId: latest.attemptId,
      sourceFrameAssetId: latest.sourceFrameAssetId,
      altitudeErrorArcsec: latest.altitudeErrorArcsec,
      azimuthErrorArcsec: latest.azimuthErrorArcsec,
      totalErrorArcsec: latest.totalErrorArcsec,
      uncertaintyArcsec: latest.uncertaintyArcsec,
      withinTolerance: latest.withinTolerance,
    }
  } else if (
    latest !== undefined &&
    AcquireEvidence.guards.LunarDiskLimbMeasurement(latest)
  ) {
    latestEvidence = {
      _tag: 'LunarDiskLimbMeasurement',
      attemptId: latest.attemptId,
      sourceFrameAssetId: latest.sourceFrameAssetId,
      correction: latest.correction,
      magnitudeArcsec: Math.hypot(
        latest.correction.rightAscensionArcsec,
        latest.correction.declinationArcsec,
      ),
      uncertaintyArcsec: latest.uncertaintyArcsec,
    }
  }
  return {
    revision: session.revision,
    mode: session.mode,
    ...(session.acquisitionMethod === undefined
      ? {}
      : { acquisitionMethod: session.acquisitionMethod }),
    phase: session.phase,
    recoverySeries: 0,
    attemptCount: session.evidence.length,
    ...(currentSeries === undefined
      ? {}
      : {
          recovery: {
            remainingAttempts: Math.max(
              0,
              currentSeries.maxAttempts -
                currentSeries.completedAttemptIds.length,
            ),
            remainingRecoverySeries: Math.max(
              0,
              session.policy.maxRecoverySeries -
                session.solveSeries.filter(
                  ({ purpose }) => purpose === 'operatorRecovery',
                ).length,
            ),
            priorVerifiedState:
              latestSolved === undefined
                ? ('unverified' as const)
                : ('retained' as const),
            reconciliation:
              latestSolved === undefined
                ? 'No verified pointing result is available; rejected or unverified work stays separate.'
                : 'Prior solved image evidence is retained while rejected or unverified work is reconciled.',
          },
        }),
    ...(session.acquisitionMethod === undefined
      ? {}
      : {
          correctionAttemptsRemaining: Math.max(
            0,
            session.policy.maxCorrectionAttempts -
              session.evidence.filter(AcquireEvidence.guards.CorrectionAccepted)
                .length,
          ),
        }),
    ...(session.activeWork === null
      ? {}
      : AcquireActiveWork.match(session.activeWork, {
          CorrectionRequested: () => ({}),
          SolveRequested: ({ attemptId }) => ({ activeAttemptId: attemptId }),
          PolarMeasurementRequested: ({ attemptId }) => ({
            activeAttemptId: attemptId,
          }),
        })),
    ...(latestEvidence === undefined ? {} : { latestEvidence }),
    ...(liveFrame === undefined
      ? {}
      : {
          liveFrame: {
            sourceFrameAssetId: liveFrame.sourceFrameAssetId,
            capturedAtEpochMs: liveFrame.capturedAtEpochMs,
            disposition: liveFrame.disposition,
            acceptedFrameCount: liveFrame.acceptedFrameCount,
            rejectedFrameCount: liveFrame.rejectedFrameCount,
            targetFraming: liveFrame.targetFraming,
            driftArcsec: liveFrame.driftArcsec,
            clipping: liveFrame.clipping,
            exposure: liveFrame.exposure,
            focus: liveFrame.focus,
            shape: liveFrame.shape,
            storageForecastMb: liveFrame.storageForecastMb,
          },
        }),
    ...(session.managedCapture === undefined
      ? {}
      : { managedCapture: session.managedCapture }),
    ...(session.phase === 'polarGuidance'
      ? {
          attention:
            latestEvidence === undefined
              ? 'Capture a solved polar measurement.'
              : AcquireEvidence.guards.PolarMeasurement(latestEvidence) &&
                  latestEvidence.withinTolerance
                ? 'Accept the current in-tolerance measurement.'
                : 'Adjust Alt/Az manually, then capture a new measurement.',
        }
      : {}),
    ...(session.acquisitionMethod !== undefined && session.phase === 'solving'
      ? {
          attention:
            session.acquisitionMethod === 'deepSkyPlateSolve'
              ? 'Capture and plate-solve a fresh target frame.'
              : 'Capture a fresh lunar frame and measure its disk and limb.',
        }
      : {}),
    ...(session.pendingCorrectionProposal !== null
      ? {
          pendingProposal: {
            proposalId: session.pendingCorrectionProposal.proposalId,
            correction: session.pendingCorrectionProposal.correction,
            expiresAtEpochMs:
              session.pendingCorrectionProposal.expiresAtEpochMs,
          },
          attention:
            'Review and approve the exact pointing correction before it is sent.',
        }
      : session.phase === 'verifying'
        ? {
            attention:
              'The provider acknowledgement is provisional. Capture a fresh solved frame to verify pointing.',
          }
        : {}),
    ...(session.phase === 'paused'
      ? {
          attention:
            'Acquire is paused after bounded work. Choose one recovery action; previous verified evidence remains available.',
        }
      : session.phase === 'skipped'
        ? { attention: 'This target was skipped after bounded recovery.' }
        : session.phase === 'aborted'
          ? {
              attention:
                'Acquire was aborted; no unverified result was accepted.',
            }
          : {}),
    actions:
      writable && session.mode === 'polar' && session.phase === 'polarGuidance'
        ? [
            {
              _tag: 'Available' as const,
              action:
                latestEvidence === undefined
                  ? ('CapturePolarAlignmentMeasurement' as const)
                  : ('AcceptPolarAlignmentEvidence' as const),
            },
          ]
        : writable &&
            session.acquisitionMethod !== undefined &&
            (session.phase === 'solving' || session.phase === 'verifying')
          ? [
              {
                _tag: 'Available' as const,
                action: 'CaptureTargetAcquisitionEvidence' as const,
              },
            ]
          : writable &&
              session.acquisitionMethod !== undefined &&
              session.phase === 'awaitingApproval' &&
              session.pendingCorrectionProposal !== null
            ? [
                {
                  _tag: 'Available' as const,
                  action: 'ApprovePointingCorrection' as const,
                },
              ]
            : writable &&
                session.acquisitionMethod === 'deepSkyPlateSolve' &&
                session.phase === 'paused'
              ? [
                  {
                    _tag: 'Available' as const,
                    action: 'RetryPlateSolveWithParameters' as const,
                  },
                  ...(suppressTargetTerminalActions
                    ? []
                    : [
                        {
                          _tag: 'Available' as const,
                          action: 'SkipAcquireTarget' as const,
                        },
                        {
                          _tag: 'Available' as const,
                          action: 'AbortAcquire' as const,
                        },
                      ]),
                ]
              : writable &&
                  session.acquisitionMethod !== undefined &&
                  session.phase !== 'completed' &&
                  session.phase !== 'skipped' &&
                  session.phase !== 'aborted'
                ? suppressTargetTerminalActions
                  ? []
                  : [
                      {
                        _tag: 'Available' as const,
                        action: 'AbortAcquire' as const,
                      },
                    ]
                : writable &&
                    session.acquisitionMethod !== undefined &&
                    session.phase === 'completed'
                  ? [
                      ...(session.managedCapture === undefined
                        ? [
                            {
                              _tag: 'Available' as const,
                              action: 'RecordLiveFrameEvidence' as const,
                            },
                            ...(liveFrame === undefined
                              ? []
                              : [
                                  {
                                    _tag: 'Available' as const,
                                    action: 'StartManagedCapture' as const,
                                  },
                                ]),
                          ]
                        : session.managedCapture.state === 'active'
                          ? [
                              {
                                _tag: 'Available' as const,
                                action: 'PauseManagedCapture' as const,
                              },
                              {
                                _tag: 'Available' as const,
                                action: 'StopManagedCapture' as const,
                              },
                              ...(session.managedCapture.quality === 'attention'
                                ? [
                                    {
                                      _tag: 'Available' as const,
                                      action: 'RecenterManagedCapture' as const,
                                    },
                                  ]
                                : []),
                            ]
                          : session.managedCapture.state === 'paused'
                            ? [
                                {
                                  _tag: 'Available' as const,
                                  action: 'StopManagedCapture' as const,
                                },
                              ]
                            : []),
                    ]
                  : [],
  }
}

export const bootstrapPlanWorkspaceProjection = (
  db: DatabaseSync,
  identity: LocalIdentity,
  current: Snapshot,
) => {
  const plan = planWorkspaceProjection(db, 'plan')
  const currentDefinitionRaw: unknown = db
    .prepare(
      'SELECT definition FROM run_definitions WHERE source_plan_id=? AND source_plan_revision=?',
    )
    .get(plan.planId, plan.revision)
  const currentDefinition = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(currentDefinitionRaw)
  const acceptedForCurrentRevision =
    currentDefinition === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(currentDefinition.definition),
        )
  const acceptedRaw: unknown = db
    .prepare(
      'SELECT definition FROM run_definitions WHERE source_plan_id=? ORDER BY accepted_at DESC LIMIT 1',
    )
    .get(plan.planId)
  const acceptedDefinition = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(acceptedRaw)
  const accepted =
    acceptedDefinition === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(acceptedDefinition.definition),
        )
  const owner = isOwner(identity)
  const controller = current.control.holderClientId === identity.clientId
  const writable = identity.capability === 'controlCapable'
  const reason = <Unavailable>(eligible: boolean, unavailable: Unavailable) =>
    eligible ? { _tag: 'Eligible' as const } : unavailable
  const ownerWrite = owner && writable
  const activeFake = current.run !== null && hasFakeExecutor(db, current)
  const paused = current.run?.phase === 'paused'
  const advanced = (current.run?.activeSequenceIndex ?? 0) !== 0
  const terminal =
    current.run?.phase === 'completed' ||
    current.run?.phase === 'stopped' ||
    current.run?.phase === 'parkRequested'
  const previewRaw: unknown =
    current.run === null
      ? undefined
      : db
          .prepare(
            'SELECT preview_id,run_id,run_revision,owner_person_id,mutation,consequences,classification,expires_at,applied_at FROM run_mutation_previews WHERE run_id=? AND run_revision=? AND applied_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 1',
          )
          .get(current.run.id, current.run.revision, new Date().toISOString())
  const preview = Schema.decodeUnknownSync(
    Schema.optional(StoredMutationPreview),
  )(previewRaw)
  const previewVisible =
    preview !== undefined &&
    owner &&
    writable &&
    (controller || preview.owner_person_id === identity.personId)
  return {
    ...plan,
    ...(accepted === undefined
      ? {}
      : {
          acceptedRunDefinition: {
            id: accepted.id,
            sourcePlanRevision: accepted.definition.sourcePlanRevision,
            acceptedAt: accepted.definition.acceptedAt,
            executor: accepted.definition.executor,
          },
        }),
    ...(previewVisible
      ? {
          runMutationPreview: {
            previewId: preview.preview_id,
            classification: preview.classification,
            consequences: preview.consequences,
            expiresAt: preview.expires_at,
            approvalRequired: preview.classification === 'disruptive',
            ...(preview.classification === 'disruptive' && controller
              ? {
                  approvalToken: createHash('sha256')
                    .update(`${preview.preview_id}:${preview.consequences}`)
                    .digest('hex'),
                }
              : {}),
          },
        }
      : {}),
    actions: {
      saveDraft: reason(
        ownerWrite && current.run === null,
        !owner
          ? { _tag: 'Ineligible' as const, reason: 'ownerRequired' }
          : !writable
            ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
            : { _tag: 'Ineligible' as const, reason: 'activeRunPresent' },
      ),
      acceptRunDefinition: reason(
        ownerWrite &&
          current.run === null &&
          plan.readiness === 'ready' &&
          acceptedForCurrentRevision === undefined,
        !owner
          ? { _tag: 'Ineligible' as const, reason: 'ownerRequired' }
          : !writable
            ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
            : plan.readiness !== 'ready'
              ? { _tag: 'Ineligible' as const, reason: 'planNotReady' }
              : current.run !== null
                ? { _tag: 'Ineligible' as const, reason: 'activeRunPresent' }
                : {
                    _tag: 'Ineligible' as const,
                    reason: 'definitionAlreadyAccepted',
                  },
      ),
      startAcceptedRun: reason(
        writable &&
          controller &&
          current.run === null &&
          acceptedForCurrentRevision !== undefined,
        !writable
          ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
          : !controller
            ? { _tag: 'Ineligible' as const, reason: 'controlRequired' }
            : current.run !== null
              ? { _tag: 'Ineligible' as const, reason: 'activeRunPresent' }
              : {
                  _tag: 'Ineligible' as const,
                  reason: 'acceptedDefinitionRequired',
                },
      ),
      previewRunMutation: reason(
        activeFake && !terminal && !paused && !advanced && ownerWrite,
        !owner
          ? { _tag: 'Ineligible' as const, reason: 'ownerRequired' }
          : !writable
            ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
            : terminal
              ? { _tag: 'Ineligible' as const, reason: 'terminalRun' }
              : paused
                ? { _tag: 'Ineligible' as const, reason: 'pausedRun' }
                : advanced
                  ? { _tag: 'Ineligible' as const, reason: 'runAdvanced' }
                  : {
                      _tag: 'Ineligible' as const,
                      reason: 'activeRunRequired',
                    },
      ),
      applyRunMutation: reason(
        activeFake &&
          !terminal &&
          !paused &&
          !advanced &&
          writable &&
          owner &&
          controller &&
          previewVisible &&
          preview.classification !== 'disruptive',
        !writable
          ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
          : !controller
            ? { _tag: 'Ineligible' as const, reason: 'controlRequired' }
            : terminal
              ? { _tag: 'Ineligible' as const, reason: 'terminalRun' }
              : paused
                ? { _tag: 'Ineligible' as const, reason: 'pausedRun' }
                : advanced
                  ? { _tag: 'Ineligible' as const, reason: 'runAdvanced' }
                  : activeFake
                    ? { _tag: 'Ineligible' as const, reason: 'previewRequired' }
                    : {
                        _tag: 'Ineligible' as const,
                        reason: 'activeRunRequired',
                      },
      ),
      approveDisruptiveRunMutation: reason(
        activeFake &&
          !terminal &&
          !paused &&
          !advanced &&
          writable &&
          owner &&
          controller &&
          previewVisible &&
          preview.classification === 'disruptive',
        !writable
          ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
          : !controller
            ? { _tag: 'Ineligible' as const, reason: 'controlRequired' }
            : terminal
              ? { _tag: 'Ineligible' as const, reason: 'terminalRun' }
              : paused
                ? { _tag: 'Ineligible' as const, reason: 'pausedRun' }
                : advanced
                  ? { _tag: 'Ineligible' as const, reason: 'runAdvanced' }
                  : activeFake
                    ? { _tag: 'Ineligible' as const, reason: 'previewRequired' }
                    : {
                        _tag: 'Ineligible' as const,
                        reason: 'activeRunRequired',
                      },
      ),
    },
  }
}

function lifecycleEventRunId(snapshot: string) {
  try {
    const payload: unknown = JSON.parse(snapshot)
    return Schema.is(LifecycleEventPayload)(payload)
      ? payload.run.id
      : undefined
  } catch {
    return undefined
  }
}

function hasFakeExecutor(db: DatabaseSync, current: Snapshot) {
  const run = current.run
  if (run?.sourceDefinitionId === undefined) return false
  const raw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(run.sourceDefinitionId)
  const row = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  if (row === undefined) return false
  return (
    Schema.decodeUnknownSync(StoredRunDefinition)(JSON.parse(row.definition))
      .definition.executor === 'fake'
  )
}
