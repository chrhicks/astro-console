import { Schema } from 'effect'
import { CommandTag } from './commands.js'
import { CaptureMetric, PointingVector } from './acquire.js'
import { DeliveryRepresentation, LibraryAsset } from './asset-domain.js'
import {
  AssistantFinding,
  FailedProcessingAttemptRecord,
  ProcessingAttempt,
  ProcessingImageRef,
  ProcessingPreviewSpec,
  ProcessingSession,
  currentProcessingImage,
} from './processing-domain.js'
import {
  AcquireRevision,
  AttemptId,
  AssetId,
  AssetRevision,
  ClientCapability,
  ClientId,
  ExpiresAt,
  EventCursor,
  GeneratedAt,
  LeaseId,
  LeaseRevision,
  LibraryCursor,
  LibraryQueryId,
  MembershipRole,
  NonNegativeInt,
  ObservedAt,
  ObservatoryId,
  OperationId,
  PersonId,
  PlanId,
  PlanRevision,
  PositiveInt,
  ProcessingRevision,
  ProcessingSessionId,
  ProcessingOutputId,
  ProposalId,
  RepresentationId,
  RunId,
  RunRevision,
  SnapshotVersion,
} from './primitives.js'

export const ActionAvailabilityReason = Schema.Literals([
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

const ActionAvailabilityDetails = {
  reason: ActionAvailabilityReason,
  safeNextActions: Schema.Array(CommandTag),
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

export const ActionAvailability = Schema.TaggedUnion({
  Available: { action: CommandTag },
  Unavailable: { action: CommandTag, ...ActionAvailabilityDetails },
  RequiresApproval: { action: CommandTag, ...ActionAvailabilityDetails },
})

export const MembershipSnapshot = Schema.Struct({
  personId: PersonId,
  role: MembershipRole,
  clientId: ClientId,
  capability: ClientCapability,
})

export const PlanSnapshot = Schema.Struct({
  planId: PlanId,
  revision: PlanRevision,
  sequenceCount: NonNegativeInt,
  validation: Schema.Literals([
    'unvalidated',
    'ready',
    'readyWithLimitations',
    'blocked',
  ]),
  sequences: Schema.Array(
    Schema.Struct({
      sequenceId: Schema.NonEmptyString,
      targetName: Schema.NonEmptyString,
      state: Schema.Literals([
        'pending',
        'active',
        'completed',
        'skipped',
        'blocked',
      ]),
    }),
  ),
  limitations: Schema.Array(Schema.NonEmptyString),
  startConditions: Schema.Array(Schema.NonEmptyString),
  actions: Schema.Array(ActionAvailability),
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
    'completed',
  ]),
  recoverySeries: NonNegativeInt,
  attemptCount: NonNegativeInt,
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

export const RunSnapshot = Schema.Struct({
  runId: RunId,
  revision: RunRevision,
  sourcePlanId: PlanId,
  phase: Schema.Literals([
    'preflight',
    'acquire',
    'capture',
    'verify',
    'recover',
    'paused',
    'completed',
    'failed',
    'stopped',
  ]),
  currentTarget: Schema.optionalKey(Schema.NonEmptyString),
  completedSequenceCount: NonNegativeInt,
  estimatedCompletionAt: Schema.optionalKey(ExpiresAt),
  acceptedMutations: Schema.Array(
    Schema.Struct({
      mutationId: Schema.NonEmptyString,
      summary: Schema.NonEmptyString,
    }),
  ),
  warnings: Schema.Array(Schema.NonEmptyString),
  lastConfirmedAt: ObservedAt,
  acquire: Schema.optionalKey(AcquireSnapshot),
  actions: Schema.Array(ActionAvailability),
})

export const ControlSnapshot = Schema.Struct({
  leaseId: LeaseId,
  revision: LeaseRevision,
  state: Schema.Literals(['available', 'held', 'reconnecting']),
  holderClientId: Schema.optionalKey(ClientId),
  holderPersonId: Schema.optionalKey(PersonId),
  holderDeviceLabel: Schema.optionalKey(Schema.NonEmptyString),
  reconnectGraceDeadline: Schema.optionalKey(ExpiresAt),
  pendingRequestCount: NonNegativeInt,
  pendingRequests: Schema.Array(
    Schema.Struct({
      requestId: Schema.NonEmptyString,
      personId: PersonId,
      clientId: ClientId,
      deviceLabel: Schema.NonEmptyString,
      requestedAt: ObservedAt,
    }),
  ),
  presence: Schema.Array(
    Schema.Struct({
      personId: PersonId,
      clientId: ClientId,
      deviceLabel: Schema.NonEmptyString,
      observedAt: ObservedAt,
    }),
  ),
  actions: Schema.Array(ActionAvailability),
})

export const ProcessingSessionSnapshot = Schema.Struct({
  sessionId: ProcessingSessionId,
  revision: ProcessingRevision,
  lifecycle: Schema.Literals(['active', 'unfinished', 'discarded']),
  phase: Schema.Literals(['build', 'develop']),
  sourceAssetIds: Schema.NonEmptyArray(AssetId),
  baseImage: Schema.optionalKey(ProcessingImageRef),
  currentImage: Schema.optionalKey(ProcessingImageRef),
  historyPosition: NonNegativeInt,
  historyLength: NonNegativeInt,
  currentOutputId: Schema.optionalKey(ProcessingOutputId),
  preview: Schema.optionalKey(ProcessingPreviewSpec),
  previewState: Schema.Literals([
    'none',
    'queued',
    'computing',
    'ready',
    'failed',
  ]),
  previewAgeSeconds: Schema.optionalKey(NonNegativeInt),
  activeAttempt: Schema.optionalKey(ProcessingAttempt),
  failedAttempt: Schema.optionalKey(FailedProcessingAttemptRecord),
  assistantFindings: Schema.Array(AssistantFinding),
  savedAssetIds: Schema.Array(AssetId),
  pressureState: Schema.Literals(['normal', 'throttled', 'paused']),
  pressureReason: Schema.optionalKey(Schema.NonEmptyString),
  retryScope: Schema.optionalKey(Schema.NonEmptyString),
  unreadAssistantFindings: Schema.optionalKey(NonNegativeInt),
  actions: Schema.Array(ActionAvailability),
})

export const AssetRepresentationSnapshot = Schema.Struct({
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

export const AssetSnapshot = Schema.Struct({
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
  processingSessionId: Schema.optionalKey(ProcessingSessionId),
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
  availability: AssetSnapshot.fields.availability,
  capturedAt: ObservedAt,
  comparisonGroupId: Schema.NonEmptyString,
  lineage: Schema.Struct({
    sourceAssetIds: Schema.Array(AssetId),
    runId: Schema.NonEmptyString,
    solveAttemptId: Schema.NonEmptyString,
  }),
  representations: Schema.Array(
    Schema.Struct({
      label: Schema.NonEmptyString,
      state: Schema.NonEmptyString,
    }),
  ),
  actions: Schema.Array(LibraryAssetAction),
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
    runId: Schema.NonEmptyString,
    solveAttemptId: Schema.NonEmptyString,
  }),
  processing: Schema.Struct({
    availability: Schema.Literal('unavailable'),
    currentFixtureFacts: Schema.Array(Schema.NonEmptyString),
  }),
})

export const LibraryPage = Schema.Struct({
  queryId: LibraryQueryId,
  querySnapshotVersion: SnapshotVersion,
  results: Schema.Array(LibraryAssetSummary),
  nextCursor: Schema.optionalKey(LibraryCursor),
  catalogChanged: Schema.Boolean,
})

export const AssetDetail = AssetSnapshot

export const SubsystemHealth = Schema.Struct({
  subsystem: Schema.Literals([
    'service',
    'rig',
    'tunnel',
    'processing',
    'publication',
    'storage',
  ]),
  state: Schema.Literals(['healthy', 'degraded', 'unavailable', 'stale']),
  observedAt: ObservedAt,
  reason: Schema.optionalKey(Schema.NonEmptyString),
})

export const AppSnapshot = Schema.Struct({
  observatoryId: ObservatoryId,
  snapshotVersion: SnapshotVersion,
  eventCursor: EventCursor,
  generatedAt: GeneratedAt,
  membership: MembershipSnapshot,
  control: ControlSnapshot,
  plan: Schema.optionalKey(PlanSnapshot),
  run: Schema.optionalKey(RunSnapshot),
  processingSessions: Schema.Array(ProcessingSessionSnapshot),
  library: Schema.Struct({
    assetCount: NonNegativeInt,
    selectedAssetIds: Schema.Array(AssetId),
    activeOperationIds: Schema.Array(OperationId),
  }),
  selectedAssets: Schema.Array(AssetSnapshot),
  health: Schema.Array(SubsystemHealth),
})

export interface AppSnapshot extends Schema.Schema.Type<typeof AppSnapshot> {}

export interface ProcessingPressureSnapshotInput {
  readonly state: 'normal' | 'throttled' | 'paused'
  readonly reason?: string
}

export function projectProcessingSessionSnapshot(
  session: ProcessingSession,
  pressure: ProcessingPressureSnapshotInput,
): typeof ProcessingSessionSnapshot.Type {
  const currentImage = currentProcessingImage(session)
  const currentOutputId =
    currentImage !== undefined &&
    ProcessingImageRef.guards.DerivedOutput(currentImage)
      ? currentImage.outputId
      : undefined
  return ProcessingSessionSnapshot.make({
    sessionId: session.sessionId,
    revision: session.revision,
    lifecycle: session.lifecycle,
    phase: session.phase,
    sourceAssetIds: [
      session.sources[0].assetId,
      ...session.sources.slice(1).map((source) => source.assetId),
    ],
    ...(session.baseImage === undefined
      ? {}
      : { baseImage: session.baseImage }),
    ...(currentImage === undefined ? {} : { currentImage }),
    historyPosition: session.historyPosition,
    historyLength: NonNegativeInt.make(session.history.length),
    ...(currentOutputId === undefined ? {} : { currentOutputId }),
    ...(session.preview === undefined ? {} : { preview: session.preview }),
    previewState: session.preview?.state ?? 'none',
    ...(session.activeAttempt === undefined
      ? {}
      : { activeAttempt: session.activeAttempt }),
    ...(session.failedAttempt === undefined
      ? {}
      : { failedAttempt: session.failedAttempt }),
    assistantFindings: session.assistantFindings,
    savedAssetIds: session.savedAssetIds,
    pressureState: pressure.state,
    ...(pressure.reason === undefined
      ? {}
      : { pressureReason: pressure.reason }),
    actions: [],
  })
}

export function projectAssetSnapshot(
  asset: LibraryAsset,
  nowEpochMs: number,
  expiringWindowMs: number,
  actions: ReadonlyArray<typeof ActionAvailability.Type> = [],
): typeof AssetSnapshot.Type {
  const representationSnapshots: ReadonlyArray<
    typeof AssetRepresentationSnapshot.Type
  > = asset.representations.map((representation) =>
    DeliveryRepresentation.match(representation, {
      Preparing: ({
        representationId,
        operationId,
        format,
        purpose,
      }): typeof AssetRepresentationSnapshot.Type => ({
        representationId,
        storage: 'r2' as const,
        state: 'preparing' as const,
        format,
        operationId,
        purpose,
      }),
      Published: ({
        representationId,
        operationId,
        format,
        expiresAtEpochMs,
      }): typeof AssetRepresentationSnapshot.Type => ({
        representationId,
        storage: 'r2' as const,
        state:
          expiresAtEpochMs <= nowEpochMs
            ? ('expired' as const)
            : ('published' as const),
        format,
        ...(operationId === undefined ? {} : { operationId }),
        expiresAt: new Date(expiresAtEpochMs).toISOString(),
      }),
      Expired: ({
        representationId,
        format,
      }): typeof AssetRepresentationSnapshot.Type => ({
        representationId,
        storage: 'r2' as const,
        state: 'expired' as const,
        format,
      }),
      Failed: ({
        representationId,
        operationId,
        format,
        diagnosticRef,
      }): typeof AssetRepresentationSnapshot.Type => ({
        representationId,
        storage: 'r2' as const,
        state: 'failed' as const,
        format,
        ...(operationId === undefined ? {} : { operationId }),
        diagnosticRef,
      }),
    }),
  )
  const availability = asset.representations.some(
    (representation) =>
      DeliveryRepresentation.guards.Preparing(representation) &&
      representation.purpose === 'republication',
  )
    ? ('republishing' as const)
    : asset.representations.some(DeliveryRepresentation.guards.Preparing)
      ? ('preparing' as const)
      : asset.representations.some(DeliveryRepresentation.guards.Failed)
        ? ('failedPublication' as const)
        : asset.representations.some(
              (representation) =>
                DeliveryRepresentation.guards.Published(representation) &&
                representation.expiresAtEpochMs > nowEpochMs,
            )
          ? asset.representations.some(
              (representation) =>
                DeliveryRepresentation.guards.Published(representation) &&
                representation.expiresAtEpochMs > nowEpochMs &&
                representation.expiresAtEpochMs - nowEpochMs <=
                  expiringWindowMs,
            )
            ? ('expiring' as const)
            : ('published' as const)
          : asset.representations.some(
                (representation) =>
                  DeliveryRepresentation.guards.Expired(representation) ||
                  (DeliveryRepresentation.guards.Published(representation) &&
                    representation.expiresAtEpochMs <= nowEpochMs),
              )
            ? ('expired' as const)
            : asset.localAvailable
              ? ('availableLocally' as const)
              : ('temporarilyUnavailable' as const)

  return AssetSnapshot.make({
    assetId: asset.assetId,
    revision: asset.revision,
    role: asset.role,
    format: asset.format,
    checksum: asset.checksum,
    localAvailable: asset.localAvailable,
    comparisonGroupId: asset.lineage.comparisonGroupId,
    sourceAssetIds: asset.lineage.sourceAssetIds,
    ...(asset.lineage.processingSessionId === undefined
      ? {}
      : { processingSessionId: asset.lineage.processingSessionId }),
    ...(asset.lineage.processingOutputId === undefined
      ? {}
      : { processingOutputId: asset.lineage.processingOutputId }),
    operationIds: asset.lineage.operationIds,
    availability,
    representationCount: NonNegativeInt.make(asset.representations.length),
    representations: representationSnapshots,
    actions,
  })
}
