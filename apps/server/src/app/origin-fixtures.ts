import type { DatabaseSync } from 'node:sqlite'
import { Effect } from 'effect'
import { AssetId, AttemptId } from '@astro-console/protocol'
import type { OriginServerConfig } from '../config/environment-config.ts'
import {
  acquireSqliteRepository,
  polarSession,
  targetAcquisitionSession,
} from '../persistence/acquire-sqlite-repository.ts'
import type { StateSqliteRepositoryShape } from '../persistence/state-sqlite-repository.ts'
import {
  RecoverySeriesId,
  recordCorrectionAcknowledgement,
  recordLiveFrameEvidence,
  recordManagedCapture,
  recordSolveCompletion,
} from '../services/acquire-domain.ts'
import type { PolarMeasurementProviderShape } from '../services/polar-service.ts'
import type { TargetAcquisitionProviderShape } from '../services/target-acquisition-service.ts'

export function installOriginFixtureState(
  database: DatabaseSync,
  stateRepository: StateSqliteRepositoryShape,
  fixture: OriginServerConfig['fixture'],
) {
  const acquireRepository = acquireSqliteRepository(database)
  if (fixture === 'polar') {
    const run = {
      id: 'run-polar-fixture',
      revision: 1,
      phase: 'acquire' as const,
      target: 'Polar alignment',
      progress: 0,
      sourceDefinitionId: 'run-definition-m27-fixture',
      activeSequenceIndex: 0,
      completedSequenceCount: 0,
      resumablePhase: 'acquire' as const,
      preflight: {
        observedAt: '2026-08-04T00:00:00.000Z',
        verdict: 'unavailable' as const,
        nextAction:
          'Polar fixture starts from deterministic solved-frame evidence only.',
        checks: [
          {
            key: 'fixture-preflight',
            state: 'unavailable' as const,
            observedAt: '2026-08-04T00:00:00.000Z',
            reason:
              'No real preflight provider read is part of the polar fixture.',
          },
        ],
      },
    }
    stateRepository.commit({ run })
    acquireRepository.install(polarSession(run.id))
  }
  if (
    fixture === 'target-deep-sky' ||
    fixture === 'target-lunar' ||
    fixture === 'target-correction' ||
    fixture === 'target-verification' ||
    fixture === 'live-frame' ||
    fixture === 'live-frame-library' ||
    fixture === 'managed-capture' ||
    fixture === 'acquire-recovery'
  ) {
    const acquisitionMethod =
      fixture === 'target-lunar' ? 'lunarDiskLimb' : 'deepSkyPlateSolve'
    const run = {
      id: `run-${acquisitionMethod}-fixture`,
      revision: 1,
      phase:
        fixture === 'live-frame' ||
        fixture === 'live-frame-library' ||
        fixture === 'managed-capture' ||
        fixture === 'acquire-recovery'
          ? ('capture' as const)
          : ('acquire' as const),
      target:
        acquisitionMethod === 'deepSkyPlateSolve'
          ? 'M27 Dumbbell Nebula'
          : 'Moon',
      progress: 0,
      sourceDefinitionId: 'run-definition-m27-fixture',
      activeSequenceIndex: 0,
      completedSequenceCount: 0,
      resumablePhase: 'acquire' as const,
      preflight: {
        observedAt: '2026-08-04T00:00:00.000Z',
        verdict: 'unavailable' as const,
        nextAction:
          'Target fixture records deterministic acquisition evidence only.',
        checks: [
          {
            key: 'fixture-preflight',
            state: 'unavailable' as const,
            observedAt: '2026-08-04T00:00:00.000Z',
            reason:
              'No live device or physical capture is part of this target fixture.',
          },
        ],
      },
    }
    stateRepository.commit({ run })
    const session = targetAcquisitionSession(run.id, acquisitionMethod)
    if (
      fixture === 'target-correction' ||
      fixture === 'target-verification' ||
      fixture === 'live-frame' ||
      fixture === 'live-frame-library' ||
      fixture === 'managed-capture'
    ) {
      const evidence = recordSolveCompletion(session, {
        attemptId: AttemptId.make('deepSkyPlateSolve-initial-1'),
        sourceFrameAssetId: AssetId.make('fixture-correction-proposal-frame'),
        capturedAtEpochMs: 1_722_729_600_100,
        solverId: 'fixture-plate-solver',
        solverVersion: '1.0.0',
        result: {
          _tag: 'Solved',
          desiredCenter: {
            rightAscensionDegrees: 299.901,
            declinationDegrees: 22.721,
          },
          solvedCenter: {
            rightAscensionDegrees: 299.901,
            declinationDegrees: 22.721,
          },
          correction: {
            rightAscensionArcsec:
              fixture === 'live-frame' ||
              fixture === 'live-frame-library' ||
              fixture === 'managed-capture'
                ? 0
                : fixture === 'target-verification'
                  ? 40
                  : 90,
            declinationArcsec: 0,
            convention: 'mountRaDec',
          },
          uncertaintyArcsec: 4,
        },
        nextAttemptId: AttemptId.make('fixture-correction-retry'),
        correctionAttemptId: AttemptId.make('fixture-correction-apply'),
        proposalId: 'fixture-correction-proposal',
        proposalExpiresAtEpochMs: 1_722_729_660_000,
      })
      const acquired = 'session' in evidence ? evidence.session : session
      const verifiedFixture =
        fixture === 'target-verification'
          ? recordCorrectionAcknowledgement(acquired, {
              correctionAttemptId: AttemptId.make('fixture-correction-apply'),
              accepted: true,
              occurredAtEpochMs: 1_722_729_600_200,
              acknowledgementRef: 'fixture-correction-acknowledged',
              verificationSeriesId: RecoverySeriesId.make(
                'fixture-correction-verification',
              ),
              verificationAttemptId: AttemptId.make(
                'fixture-correction-verification-1',
              ),
            })
          : undefined
      const currentLiveFrame =
        fixture === 'live-frame-library'
          ? recordLiveFrameEvidence(acquired, {
              sourceFrameAssetId: AssetId.make('asset-capture-live-001'),
              capturedAtEpochMs: 1_722_729_600_300,
              disposition: 'accepted',
              acceptedFrameCount: 1,
              rejectedFrameCount: 0,
              targetFraming: 'inFrame',
              driftArcsec: { _tag: 'Known', value: 1.2 },
              clipping: 'clear',
              exposure: 'usable',
              focus: { _tag: 'Known', value: 1.1 },
              shape: { _tag: 'Known', value: 1.8 },
              storageForecastMb: { _tag: 'Known', value: 1_730 },
            })
          : acquired
      acquireRepository.install(
        fixture === 'managed-capture'
          ? recordManagedCapture(
              recordLiveFrameEvidence(acquired, {
                sourceFrameAssetId: AssetId.make(
                  'fixture-managed-capture-frame',
                ),
                capturedAtEpochMs: 1_722_729_600_300,
                disposition: 'accepted',
                acceptedFrameCount: 1,
                rejectedFrameCount: 0,
                targetFraming: 'inFrame',
                driftArcsec: { _tag: 'Known', value: 3 },
                clipping: 'clear',
                exposure: 'usable',
                focus: { _tag: 'Known', value: 1 },
                shape: { _tag: 'Known', value: 1 },
                storageForecastMb: { _tag: 'Known', value: 2_048 },
              }),
              {
                state: 'active',
                exposureCount: 8,
                stackCount: 8,
                totalExposureCount: 24,
                elapsedSeconds: 1_440,
                remainingSeconds: 2_880,
                stopCondition: '24 usable 180-second exposures',
                storageReserveMb: 2_048,
                resourceProtection: 'available',
                quality: 'good',
              },
            )
          : verifiedFixture !== undefined && 'session' in verifiedFixture
            ? verifiedFixture.session
            : currentLiveFrame,
      )
      if (fixture === 'live-frame-library')
        installCurrentLibraryFrameFixture(database)
    } else if (fixture === 'acquire-recovery') {
      const first = recordSolveCompletion(session, {
        attemptId: AttemptId.make('deepSkyPlateSolve-initial-1'),
        sourceFrameAssetId: AssetId.make('fixture-recovery-frame-1'),
        capturedAtEpochMs: 1_722_729_600_100,
        solverId: 'fixture-plate-solver',
        solverVersion: '1.0.0',
        result: {
          _tag: 'NoSolution',
          category: 'stars-insufficient',
          retryable: true,
          diagnosticRef: 'fixture-recovery-diagnostic-1',
        },
        nextAttemptId: AttemptId.make('fixture-recovery-retry-2'),
        correctionAttemptId: AttemptId.make('fixture-recovery-correction'),
        proposalId: 'fixture-recovery-proposal',
        proposalExpiresAtEpochMs: 1_722_729_660_000,
      })
      const retry = 'session' in first ? first.session : session
      const paused = recordSolveCompletion(retry, {
        attemptId: AttemptId.make('fixture-recovery-retry-2'),
        sourceFrameAssetId: AssetId.make('fixture-recovery-frame-2'),
        capturedAtEpochMs: 1_722_729_600_200,
        solverId: 'fixture-plate-solver',
        solverVersion: '1.0.0',
        result: {
          _tag: 'NoSolution',
          category: 'stars-insufficient',
          retryable: true,
          diagnosticRef: 'fixture-recovery-diagnostic-2',
        },
        nextAttemptId: AttemptId.make('fixture-recovery-retry-3'),
        correctionAttemptId: AttemptId.make('fixture-recovery-correction-2'),
        proposalId: 'fixture-recovery-proposal-2',
        proposalExpiresAtEpochMs: 1_722_729_660_000,
      })
      acquireRepository.install('session' in paused ? paused.session : retry)
    } else acquireRepository.install(session)
  }
}

export const fixturePolarMeasurementProvider = (
  fixture: OriginServerConfig['fixture'],
) => (fixture === 'polar' ? deterministicPolarMeasurementProvider : undefined)

export const fixtureTargetAcquisitionProvider = (
  fixture: OriginServerConfig['fixture'],
) =>
  fixture === 'target-deep-sky' ||
  fixture === 'target-lunar' ||
  fixture === 'live-frame' ||
  fixture === 'live-frame-library' ||
  fixture === 'managed-capture'
    ? deterministicTargetAcquisitionProvider
    : undefined

export const deterministicPolarMeasurementProvider: PolarMeasurementProviderShape =
  {
    measure: (attemptId) =>
      Effect.succeed({
        sourceFrameAssetId: AssetId.make(`fixture-polar-${attemptId}`),
        measuredAtEpochMs: 1_722_729_600_000,
        desiredPole: { rightAscensionDegrees: 0, declinationDegrees: 90 },
        measuredMountAxis: { rightAscensionDegrees: 0, declinationDegrees: 90 },
        altitudeErrorArcsec: 12,
        azimuthErrorArcsec: 0,
        uncertaintyArcsec: 4,
      }),
  }

function installCurrentLibraryFrameFixture(
  database: import('node:sqlite').DatabaseSync,
) {
  const capturedAt = '2024-08-04T01:00:00.000Z'
  const detail = {
    assetId: 'asset-capture-live-001',
    revision: 1,
    role: 'original',
    format: 'fits',
    availability: 'availableLocally',
    capturedAt,
    comparisonGroupId: 'run-deepSkyPlateSolve-fixture-sequence-l',
    lineage: {
      sourceAssetIds: [],
      runId: 'run-deepSkyPlateSolve-fixture',
      solveAttemptId: 'acquire-live-001',
      sequenceId: 'sequence-l',
      acquisitionId: 'acquire-live-001',
    },
    capture: {
      frameId: 'frame-live-001',
      exposureSeconds: 180,
      filter: 'L',
      binning: 1,
      frameType: 'light',
    },
    inspection: {
      _tag: 'Available',
      preview: {
        format: 'png',
        checksum: 'fixture-preview-live-001',
        provenance: {
          algorithm: 'deterministic-fixture-v1',
          sourceChecksum: 'fixture-original-live-001',
        },
      },
      metrics: {
        clippingPercent: 0,
        framing: 'inFrame',
        sharpness: 92,
        shape: 8,
        driftArcsec: 1,
      },
      rationale: {
        decision: 'accepted',
        summary:
          'Deterministic fixture metrics are within the configured bounds.',
      },
    },
    review: {
      revision: 1,
      decision: 'accepted',
      updatedAt: capturedAt,
    },
    representations: [
      { label: 'Immutable captured original retained', state: 'available' },
      { label: 'Deterministic inspection preview', state: 'available' },
    ],
  }
  database
    .prepare(
      'INSERT OR IGNORE INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      detail.assetId,
      detail.revision,
      detail.role,
      detail.format,
      detail.availability,
      detail.comparisonGroupId,
      capturedAt,
      capturedAt,
      detail.inspection.metrics.sharpness,
      JSON.stringify(detail),
    )
  database
    .prepare('INSERT OR IGNORE INTO asset_reviews VALUES (?,?,?)')
    .run(detail.assetId, detail.review.revision, JSON.stringify(detail.review))
}

export const deterministicTargetAcquisitionProvider: TargetAcquisitionProviderShape =
  {
    capture: (method) =>
      Effect.succeed({
        _tag: 'Captured' as const,
        slewAcknowledgement: {
          acknowledgedAtEpochMs: 1_722_729_600_000,
          acknowledgementRef: `fixture-${method}-slew-acknowledged`,
        },
        evidence:
          method === 'deepSkyPlateSolve'
            ? {
                sourceFrameAssetId: 'fixture-deep-sky-solve-frame',
                capturedAtEpochMs: 1_722_729_600_100,
                solverId: 'fixture-plate-solver',
                solverVersion: '1.0.0',
                result: {
                  _tag: 'Solved',
                  desiredCenter: {
                    rightAscensionDegrees: 299.901,
                    declinationDegrees: 22.721,
                  },
                  solvedCenter: {
                    rightAscensionDegrees: 299.901,
                    declinationDegrees: 22.721,
                  },
                  correction: {
                    rightAscensionArcsec: 0,
                    declinationArcsec: 0,
                    convention: 'mountRaDec',
                  },
                  uncertaintyArcsec: 4,
                },
              }
            : {
                sourceFrameAssetId: 'fixture-lunar-disk-frame',
                capturedAtEpochMs: 1_722_729_600_100,
                detectorId: 'fixture-lunar-disk-limb',
                detectorVersion: '1.0.0',
                desiredCenter: {
                  rightAscensionDegrees: 0,
                  declinationDegrees: 0,
                },
                measuredCenter: {
                  rightAscensionDegrees: 0,
                  declinationDegrees: 0,
                },
                correction: {
                  rightAscensionArcsec: 0,
                  declinationArcsec: 0,
                  convention: 'imageAxis',
                },
                uncertaintyArcsec: 2,
              },
      }),
    correct: (correctionAttemptId) =>
      Effect.succeed({
        _tag: 'Accepted' as const,
        acknowledgedAtEpochMs: 1_722_729_600_200,
        acknowledgementRef: `fixture-${correctionAttemptId}-acknowledged`,
      }),
    frame: () =>
      Effect.succeed({
        sourceFrameAssetId: 'asset-capture-live-001',
        capturedAtEpochMs: 1_722_729_600_300,
        disposition: 'accepted' as const,
        acceptedFrameCount: 1,
        rejectedFrameCount: 0,
        targetFraming: 'inFrame' as const,
        driftArcsec: { _tag: 'Known' as const, value: 1.2 },
        clipping: 'clear' as const,
        exposure: 'usable' as const,
        focus: {
          _tag: 'Unknown' as const,
          reason: 'Focus metric is unavailable.',
        },
        shape: { _tag: 'Known' as const, value: 1.8 },
        storageForecastMb: { _tag: 'Known' as const, value: 1730 },
      }),
  }
