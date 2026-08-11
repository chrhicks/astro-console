import { Schema } from 'effect'
import { CaptureMetric, PointingVector } from './acquire.js'
import { FrameInspection, AssetReview } from './asset-domain.js'
import {
  AcquireRevision,
  AttemptId,
  AssetId,
  AssetRevision,
  CaptureSetId,
  ExpiresAt,
  LibraryCursor,
  LibraryQueryId,
  NonNegativeInt,
  NonNegativeNumber,
  ObservedAt,
  OperationId,
  PositiveInt,
  PositiveNumber,
  ProcessingProjectId,
  ProcessingStageAttemptId,
  ProcessingStageResultId,
  ProcessingOutputId,
  ProposalId,
  RepresentationId,
  SnapshotVersion,
} from './primitives.js'

const ActionAvailabilityReason = Schema.Literals([
  'ApprovalRequired',
  'ClientReadOnly',
  'ConnectionStale',
  'FreshnessConflict',
  'LeaseRequired',
  'OperationInProgress',
  'PreconditionUnavailable',
  'ResourceUnavailable',
  'SafetyInterlock',
])

const AcquireActionTag = Schema.Literals([
  'RetryPlateSolveWithParameters',
  'SkipAcquireTarget',
  'AbortAcquire',
  'ApprovePointingCorrection',
  'CaptureTargetAcquisitionEvidence',
  'RecordLiveFrameEvidence',
  'StartManagedCapture',
  'PauseManagedCapture',
  'StopManagedCapture',
  'RecenterManagedCapture',
  'CapturePolarAlignmentMeasurement',
  'AcceptPolarAlignmentEvidence',
])

const ActionAvailabilityDetails = {
  reason: ActionAvailabilityReason,
  safeNextActions: Schema.Array(AcquireActionTag),
  blockingSubsystem: Schema.optionalKey(
    Schema.Literals([
      'service',
      'rig',
      'tunnel',
      'processing',
      'publication',
      'storage',
    ]),
  ),
  expiresAt: Schema.optionalKey(ExpiresAt),
  refreshRequired: Schema.optionalKey(Schema.Boolean),
}

const ActionAvailability = Schema.TaggedUnion({
  Available: { action: AcquireActionTag },
  Unavailable: { action: AcquireActionTag, ...ActionAvailabilityDetails },
  RequiresApproval: { action: AcquireActionTag, ...ActionAvailabilityDetails },
})

export const AcquireSnapshot = Schema.Struct({
  revision: AcquireRevision,
  mode: Schema.Literals(['pointing', 'polar']),
  acquisitionMethod: Schema.optionalKey(
    Schema.Literals(['deepSkyPlateSolve', 'lunarDiskLimb']),
  ),
  phase: Schema.Literals([
    'solving',
    'correcting',
    'verifying',
    'awaitingApproval',
    'polarMeasuring',
    'polarGuidance',
    'paused',
    'skipped',
    'aborted',
    'completed',
  ]),
  recoverySeries: NonNegativeInt,
  attemptCount: NonNegativeInt,
  recovery: Schema.optionalKey(
    Schema.Struct({
      remainingAttempts: NonNegativeInt,
      remainingRecoverySeries: NonNegativeInt,
      priorVerifiedState: Schema.Literals(['retained', 'unverified']),
      reconciliation: Schema.NonEmptyString,
    }),
  ),
  correctionAttemptsRemaining: Schema.optionalKey(NonNegativeInt),
  activeAttemptId: Schema.optionalKey(AttemptId),
  pendingProposal: Schema.optionalKey(
    Schema.Struct({
      proposalId: ProposalId,
      correction: PointingVector,
      expiresAtEpochMs: NonNegativeInt,
    }),
  ),
  latestEvidence: Schema.optionalKey(
    Schema.TaggedUnion({
      Solved: {
        attemptId: AttemptId,
        sourceFrameAssetId: AssetId,
        correction: PointingVector,
        magnitudeArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
        uncertaintyArcsec: Schema.Finite.check(
          Schema.isGreaterThanOrEqualTo(0),
        ),
        verificationOfCorrectionAttemptId: Schema.optionalKey(AttemptId),
      },
      NoSolution: {
        attemptId: AttemptId,
        sourceFrameAssetId: AssetId,
        category: Schema.NonEmptyString,
        diagnosticRef: Schema.NonEmptyString,
      },
      PolarMeasurement: {
        attemptId: AttemptId,
        sourceFrameAssetId: AssetId,
        altitudeErrorArcsec: Schema.Finite,
        azimuthErrorArcsec: Schema.Finite,
        totalErrorArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
        uncertaintyArcsec: Schema.Finite.check(
          Schema.isGreaterThanOrEqualTo(0),
        ),
        withinTolerance: Schema.Boolean,
      },
      LunarDiskLimbMeasurement: {
        attemptId: AttemptId,
        sourceFrameAssetId: AssetId,
        correction: PointingVector,
        magnitudeArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
        uncertaintyArcsec: Schema.Finite.check(
          Schema.isGreaterThanOrEqualTo(0),
        ),
      },
    }),
  ),
  managedCapture: Schema.optionalKey(
    Schema.Struct({
      state: Schema.Literals(['active', 'paused', 'stopped', 'completed']),
      exposureCount: NonNegativeInt,
      stackCount: NonNegativeInt,
      totalExposureCount: PositiveInt,
      elapsedSeconds: NonNegativeInt,
      remainingSeconds: NonNegativeInt,
      stopCondition: Schema.NonEmptyString,
      storageReserveMb: NonNegativeNumber,
      resourceProtection: Schema.Literals(['available', 'protected']),
      quality: Schema.Literals(['good', 'attention', 'unknown']),
    }),
  ),
  liveFrame: Schema.optionalKey(
    Schema.Struct({
      sourceFrameAssetId: AssetId,
      capturedAtEpochMs: NonNegativeInt,
      disposition: Schema.Literals(['accepted', 'rejected']),
      acceptedFrameCount: NonNegativeInt,
      rejectedFrameCount: NonNegativeInt,
      targetFraming: Schema.Literals([
        'inFrame',
        'nearEdge',
        'outside',
        'unknown',
      ]),
      driftArcsec: CaptureMetric,
      clipping: Schema.Literals(['clear', 'clipped', 'unknown']),
      exposure: Schema.Literals([
        'usable',
        'underexposed',
        'overexposed',
        'unknown',
      ]),
      focus: CaptureMetric,
      shape: CaptureMetric,
      storageForecastMb: CaptureMetric,
    }),
  ),
  attention: Schema.optionalKey(Schema.NonEmptyString),
  actions: Schema.Array(ActionAvailability),
})

const AssetRepresentationSnapshot = Schema.Struct({
  representationId: RepresentationId,
  storage: Schema.Literals(['local', 'r2']),
  state: Schema.Literals([
    'available',
    'preparing',
    'published',
    'expired',
    'failed',
  ]),
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  operationId: Schema.optionalKey(OperationId),
  purpose: Schema.optionalKey(
    Schema.Literals(['remoteDownload', 'republication']),
  ),
  expiresAt: Schema.optionalKey(ExpiresAt),
  diagnosticRef: Schema.optionalKey(Schema.NonEmptyString),
})

const AssetSnapshot = Schema.Struct({
  assetId: AssetId,
  revision: AssetRevision,
  role: Schema.Literals([
    'original',
    'linearMaster',
    'intermediate',
    'final',
    'preview',
    'diagnostic',
  ]),
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  checksum: Schema.NonEmptyString,
  localAvailable: Schema.Boolean,
  comparisonGroupId: Schema.NonEmptyString,
  sourceAssetIds: Schema.NonEmptyArray(AssetId),
  processingProjectId: Schema.optionalKey(ProcessingProjectId),
  processingAttemptIds: Schema.optionalKey(
    Schema.Array(ProcessingStageAttemptId),
  ),
  processingResultId: Schema.optionalKey(ProcessingStageResultId),
  processingOutputId: Schema.optionalKey(ProcessingOutputId),
  operationIds: Schema.Array(OperationId),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  representationCount: NonNegativeInt,
  representations: Schema.optionalKey(
    Schema.Array(AssetRepresentationSnapshot),
  ),
  actions: Schema.Array(ActionAvailability),
})

export const LibraryQuery = Schema.Struct({
  queryId: LibraryQueryId,
  cursor: Schema.optionalKey(LibraryCursor),
  pageSize: PositiveInt.check(Schema.isLessThanOrEqualTo(100)),
  role: Schema.optionalKey(AssetSnapshot.fields.role),
  sort: Schema.Literals([
    'capturedAtDescending',
    'sharpestFirst',
    'recentlyUpdated',
  ]),
})

export const LibraryAssetSummary = Schema.Struct({
  assetId: AssetId,
  revision: AssetRevision,
  role: AssetSnapshot.fields.role,
  format: AssetSnapshot.fields.format,
  availability: AssetSnapshot.fields.availability,
  comparisonGroupId: Schema.NonEmptyString,
  captureSetId: Schema.optionalKey(CaptureSetId),
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  review: Schema.Struct({
    decision: AssetReview.fields.decision,
    rating: AssetReview.fields.rating,
  }),
})

export const LibraryAssetAction = Schema.TaggedUnion({
  Eligible: {
    action: Schema.Literals(['download', 'openInProcess']),
  },
  Unavailable: {
    action: Schema.Literals(['download', 'openInProcess']),
    reason: Schema.Literals([
      'AssetNotPublished',
      'AssetNotAvailableLocally',
      'PublicationUnavailable',
    ]),
  },
})

export const LibraryAssetDetail = Schema.Struct({
  assetId: AssetId,
  revision: AssetRevision,
  role: AssetSnapshot.fields.role,
  format: AssetSnapshot.fields.format,
  checksum: Schema.optionalKey(Schema.NonEmptyString),
  availability: AssetSnapshot.fields.availability,
  capturedAt: ObservedAt,
  comparisonGroupId: Schema.NonEmptyString,
  captureSetId: Schema.optionalKey(CaptureSetId),
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  equipment: Schema.optionalKey(
    Schema.Struct({
      rigId: Schema.NonEmptyString,
      cameraDeviceId: Schema.NonEmptyString,
    }),
  ),
  lineage: Schema.Struct({
    sourceAssetIds: Schema.Array(AssetId),
    runId: Schema.optionalKey(Schema.NonEmptyString),
    solveAttemptId: Schema.optionalKey(Schema.NonEmptyString),
    sequenceId: Schema.optionalKey(Schema.NonEmptyString),
    acquisitionId: Schema.optionalKey(Schema.NonEmptyString),
    processingProjectId: Schema.optionalKey(ProcessingProjectId),
    processingAttemptIds: Schema.optionalKey(
      Schema.Array(ProcessingStageAttemptId),
    ),
    processingResultId: Schema.optionalKey(ProcessingStageResultId),
    processingOutputId: Schema.optionalKey(ProcessingOutputId),
    operationIds: Schema.optionalKey(Schema.Array(OperationId)),
  }),
  capture: Schema.optionalKey(
    Schema.Struct({
      frameId: Schema.NonEmptyString,
      exposureSeconds: PositiveNumber,
      filter: Schema.NonEmptyString,
      binning: NonNegativeInt,
      frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
    }),
  ),
  provenance: Schema.optionalKey(
    Schema.Struct({
      source: Schema.Literal('alpaca-imagearray'),
      checksum: Schema.NonEmptyString,
      fitsHeader: Schema.optionalKey(
        Schema.Struct({
          SIMPLE: Schema.optionalKey(Schema.Boolean),
          BITPIX: Schema.optionalKey(Schema.Number),
          NAXIS: Schema.optionalKey(Schema.Number),
          NAXIS1: Schema.optionalKey(Schema.Number),
          NAXIS2: Schema.optionalKey(Schema.Number),
          EXPTIME: Schema.optionalKey(Schema.Number),
          'DATE-OBS': Schema.optionalKey(Schema.NonEmptyString),
          INSTRUME: Schema.optionalKey(Schema.NonEmptyString),
          FILTER: Schema.optionalKey(Schema.NonEmptyString),
        }),
      ),
      imageBytesHeader: Schema.optionalKey(
        Schema.Struct({
          headerVersion: Schema.Number,
          dataStart: Schema.Number,
          imageElementType: Schema.Number,
          transmissionElementType: Schema.Number,
          rank: Schema.Number,
        }),
      ),
    }),
  ),
  inspection: Schema.optionalKey(FrameInspection),
  review: Schema.optionalKey(AssetReview),
  representations: Schema.Array(
    Schema.Struct({
      label: Schema.NonEmptyString,
      state: Schema.NonEmptyString,
    }),
  ),
  actions: Schema.Array(LibraryAssetAction),
})

/**
 * The current Observe frame resolved through its authoritative Library record.
 * This is deliberately one record, not a Library catalog projection.
 */
export const ObserveLiveFrameReview = Schema.TaggedUnion({
  Available: {
    capturedAtEpochMs: NonNegativeInt,
    disposition: Schema.Literals(['accepted', 'rejected']),
    asset: LibraryAssetDetail,
  },
  Unavailable: {
    reason: Schema.Literals([
      'NoCurrentFrame',
      'LibraryAssetNotFound',
      'LibraryUnavailable',
    ]),
    message: Schema.NonEmptyString,
  },
})

export const ProcessSourceHandoff = Schema.Struct({
  sourceAssetId: AssetId,
  revision: AssetRevision,
  role: AssetSnapshot.fields.role,
  format: AssetSnapshot.fields.format,
  availability: AssetSnapshot.fields.availability,
  comparisonGroupId: Schema.NonEmptyString,
  lineage: Schema.Struct({
    sourceAssetIds: Schema.Array(AssetId),
    runId: Schema.optionalKey(Schema.NonEmptyString),
    solveAttemptId: Schema.optionalKey(Schema.NonEmptyString),
    sequenceId: Schema.optionalKey(Schema.NonEmptyString),
    acquisitionId: Schema.optionalKey(Schema.NonEmptyString),
    processingProjectId: Schema.optionalKey(ProcessingProjectId),
    processingAttemptIds: Schema.optionalKey(
      Schema.Array(ProcessingStageAttemptId),
    ),
    processingResultId: Schema.optionalKey(ProcessingStageResultId),
    processingOutputId: Schema.optionalKey(ProcessingOutputId),
    operationIds: Schema.optionalKey(Schema.Array(OperationId)),
  }),
  processing: Schema.Struct({
    availability: Schema.Literals(['available', 'unavailable']),
    currentFixtureFacts: Schema.Array(Schema.NonEmptyString),
  }),
  recommendedSet: Schema.optionalKey(
    Schema.Struct({
      candidateCount: NonNegativeInt,
      includedCount: NonNegativeInt,
      excludedCount: NonNegativeInt,
      needsReviewCount: NonNegativeInt,
      frozen: Schema.Boolean,
      candidates: Schema.Array(
        Schema.Struct({
          assetId: AssetId,
          assetRevision: AssetRevision,
          reviewRevision: AssetRevision,
          platformDecision: Schema.Literals(['include', 'exclude', 'review']),
          manualDecision: Schema.Literals([
            'accepted',
            'rejected',
            'unreviewed',
          ]),
          effectiveDecision: Schema.Literals([
            'include',
            'exclude',
            'needsReview',
          ]),
          hardIneligible: Schema.Boolean,
          measuredSharpness: NonNegativeNumber,
          reason: Schema.NonEmptyString,
        }),
      ),
    }),
  ),
})

export const LibraryPage = Schema.Struct({
  queryId: LibraryQueryId,
  querySnapshotVersion: SnapshotVersion,
  results: Schema.Array(LibraryAssetSummary),
  nextCursor: Schema.optionalKey(LibraryCursor),
  catalogChanged: Schema.Boolean,
})

export const LibraryRouteFailure = Schema.TaggedUnion({
  InvalidInput: { message: Schema.NonEmptyString },
  AssetNotFound: {},
  AssetUnavailable: { message: Schema.NonEmptyString },
  LibraryUnavailable: {},
})

export type LibraryRouteFailure = typeof LibraryRouteFailure.Type

export const LibraryPageResponse = Schema.Union([
  LibraryPage,
  LibraryRouteFailure,
])

export const LibraryDetailResponse = Schema.Union([
  LibraryAssetDetail,
  LibraryRouteFailure,
])

export const ProcessSourceHandoffResponse = Schema.Union([
  ProcessSourceHandoff,
  LibraryRouteFailure,
])
