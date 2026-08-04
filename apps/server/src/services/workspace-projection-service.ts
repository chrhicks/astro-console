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
} from '@astro-console/v2-contracts'
import type { Snapshot } from './domain-state.ts'
import type { LocalIdentity } from '../auth/identity.ts'
import { planWorkspaceProjection } from './runtime-bootstrap.ts'

const StoredRunDefinition = Schema.Struct({
  id: Schema.String,
  sourcePlanId: Schema.String,
  sourcePlanRevision: Schema.Int,
  acceptedAt: Schema.String,
  executor: Schema.Literals(['fake', 'fixture']),
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
const isOwner = (identity: LocalIdentity) => identity.role === 'owner'

export const observeWorkspaceProjection = (
  db: DatabaseSync,
  identity: LocalIdentity,
  current: Snapshot,
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
        "SELECT type,snapshot FROM events WHERE type IN ('RunStarted','RunPaused','RunResumed','RunStopped','FakeSequenceSkipped','FakePhaseRetried','FakeParkRequested','RunCompleted') ORDER BY cursor",
      )
      .all(),
  )
    .filter(({ snapshot }) => lifecycleEventRunId(snapshot) === run.id)
    .map(({ type }) => `Fake/fixture lifecycle fact: ${type}.`)
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
        )
  return Schema.decodeUnknownSync(ObserveWorkspaceProjection)({
    runId: run.id,
    revision: run.revision,
    executor: definition.executor,
    phase: run.phase,
    ...(terminal ? { terminalOutcome: run.phase } : {}),
    target: run.target,
    currentSequence: run.activeSequenceIndex ?? 0,
    completedSequences: run.completedSequenceCount ?? 0,
    totalSequences: definition.plan.sequences.length,
    ...(run.resumablePhase === undefined
      ? {}
      : { resumablePhase: run.resumablePhase }),
    retryUsed: run.retryPhase !== undefined,
    ...(run.preflight === undefined ? {} : { preflight: run.preflight }),
    ...(acquire === undefined ? {} : { acquire }),
    lifecycleFacts:
      events.length === 0 ? ['Fake/fixture lifecycle started.'] : events,
    attemptFacts: [
      'All lifecycle and attempt evidence is fake/fixture only; no physical capture is claimed.',
      ...(run.retryPhase === undefined
        ? ['No fake/fixture phase retry has been used.']
        : [`Fake/fixture retry used for ${run.retryPhase}.`]),
      ...(run.phase === 'parkRequested'
        ? ['Park is policy only; no mount moved.']
        : []),
    ],
    actions: {
      pause: eligible(active, baseReason),
      resume: eligible(
        writable &&
          controller &&
          run.phase === 'paused' &&
          run.resumablePhase !== undefined,
        run.phase !== 'paused' ? 'pausedRunRequired' : baseReason,
      ),
      stop: eligible(active || pausedRecovery, baseReason),
      skip: eligible(
        active,
        run.phase === 'paused' ? 'policyUnavailable' : baseReason,
      ),
      retry: eligible(
        active && run.retryPhase === undefined,
        terminal || run.phase === 'paused'
          ? run.phase === 'paused'
            ? 'policyUnavailable'
            : baseReason
          : run.retryPhase === undefined
            ? baseReason
            : 'retryUsed',
      ),
      park: eligible(active || pausedRecovery, baseReason),
    },
  })
}

function acquireSnapshot(
  session: typeof AcquireSession.Type,
  writable: boolean,
) {
  const latest = session.evidence.findLast(
    (evidence) =>
      AcquireEvidence.guards.SolveAttempt(evidence) ||
      AcquireEvidence.guards.PolarMeasurement(evidence) ||
      AcquireEvidence.guards.LunarDiskLimbMeasurement(evidence),
  )
  const liveFrame = session.evidence.findLast(AcquireEvidence.guards.LiveFrame)
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
            session.phase === 'solving'
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
            sourcePlanRevision: accepted.sourcePlanRevision,
            acceptedAt: accepted.acceptedAt,
            executor: 'fake' as const,
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
      .executor === 'fake'
  )
}
