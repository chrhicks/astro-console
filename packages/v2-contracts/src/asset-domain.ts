import { Data, Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  NonNegativeInt,
  PositiveNumber,
  OperationId,
  ProcessingOutputId,
  ProcessingProjectId,
  ProcessingStageAttemptId,
  ProcessingStageResultId,
  RepresentationId,
  RunId,
} from './primitives.js'

export const AssetFormat = Schema.Literals([
  'cameraRaw',
  'fits',
  'tiff',
  'png',
  'jpeg',
])

/**
 * The metadata that a capture adapter supplies with original bytes. The bytes
 * stay behind the server-owned intake port; they are deliberately not part of
 * a browser command contract.
 */
export const CapturedFrameIntake = Schema.Struct({
  assetId: AssetId,
  frameId: Schema.NonEmptyString,
  capturedAt: Schema.NonEmptyString,
  targetName: Schema.optionalKey(Schema.NonEmptyString),
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff']),
  equipment: Schema.Struct({
    rigId: Schema.NonEmptyString,
    cameraDeviceId: Schema.NonEmptyString,
  }),
  capture: Schema.Struct({
    exposureSeconds: PositiveNumber,
    filter: Schema.NonEmptyString,
    binning: NonNegativeInt,
    frameType: Schema.Literals(['light', 'dark', 'flat', 'bias']),
  }),
  lineage: Schema.Struct({
    runId: RunId,
    sequenceId: Schema.NonEmptyString,
    acquisitionId: Schema.NonEmptyString,
  }),
  idempotencyKey: Schema.NonEmptyString,
})
export interface CapturedFrameIntake extends Schema.Schema.Type<
  typeof CapturedFrameIntake
> {}

export const FrameInspection = Schema.TaggedUnion({
  Available: {
    preview: Schema.Struct({
      format: Schema.Literal('png'),
      checksum: Schema.NonEmptyString,
      provenance: Schema.Struct({
        algorithm: Schema.Literals([
          'deterministic-fixture-v1',
          'bounded-pixel-preview-v1',
        ]),
        sourceChecksum: Schema.NonEmptyString,
      }),
    }),
    metrics: Schema.Struct({
      clippingPercent: NonNegativeInt,
      framing: Schema.Literals(['inFrame', 'attention']),
      sharpness: NonNegativeInt,
      shape: NonNegativeInt,
      driftArcsec: NonNegativeInt,
    }),
    rationale: Schema.Struct({
      decision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
      summary: Schema.NonEmptyString,
    }),
  },
  Unavailable: { summary: Schema.NonEmptyString },
  Failed: {
    summary: Schema.NonEmptyString,
    diagnosticRef: Schema.NonEmptyString,
  },
})
export type FrameInspection = typeof FrameInspection.Type

export const AssetReview = Schema.Struct({
  revision: AssetRevision,
  decision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
  rating: Schema.optionalKey(NonNegativeInt),
  annotation: Schema.optionalKey(Schema.NonEmptyString),
  updatedAt: Schema.NonEmptyString,
})
export interface AssetReview extends Schema.Schema.Type<typeof AssetReview> {}

export const ReviewAssetRequest = Schema.Struct({
  expectedAssetRevision: AssetRevision,
  expectedReviewRevision: AssetRevision,
  decision: Schema.Literals(['accepted', 'rejected', 'unreviewed']),
  rating: Schema.optionalKey(NonNegativeInt),
  annotation: Schema.optionalKey(Schema.NonEmptyString),
  idempotencyKey: Schema.NonEmptyString,
})

export const AssetLineage = Schema.Struct({
  comparisonGroupId: Schema.NonEmptyString,
  sourceAssetIds: Schema.NonEmptyArray(AssetId),
  processingProjectId: Schema.optionalKey(ProcessingProjectId),
  processingAttemptIds: Schema.optionalKey(
    Schema.Array(ProcessingStageAttemptId),
  ),
  processingResultId: Schema.optionalKey(ProcessingStageResultId),
  processingOutputId: Schema.optionalKey(ProcessingOutputId),
  operationIds: Schema.Array(OperationId),
})

export const DeliveryRepresentation = Schema.TaggedUnion({
  Preparing: {
    representationId: RepresentationId,
    operationId: OperationId,
    format: AssetFormat,
    purpose: Schema.Literals(['remoteDownload', 'republication']),
  },
  Published: {
    representationId: RepresentationId,
    operationId: Schema.optionalKey(OperationId),
    format: AssetFormat,
    expiresAtEpochMs: NonNegativeInt,
  },
  Expired: {
    representationId: RepresentationId,
    format: AssetFormat,
    expiredAtEpochMs: NonNegativeInt,
  },
  Failed: {
    representationId: RepresentationId,
    operationId: Schema.optionalKey(OperationId),
    format: AssetFormat,
    diagnosticRef: Schema.NonEmptyString,
  },
})

export const LibraryAsset = Schema.Struct({
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
  format: AssetFormat,
  checksum: Schema.NonEmptyString,
  localAvailable: Schema.Boolean,
  lineage: AssetLineage,
  representations: Schema.Array(DeliveryRepresentation),
}).check(
  Schema.makeFilter((asset) => {
    const representationIds = asset.representations.map(
      (representation) => representation.representationId,
    )
    if (new Set(representationIds).size !== representationIds.length) {
      return {
        path: ['representations'],
        issue: 'representation identities must be unique within an asset',
      }
    }
    if (
      asset.representations.some(
        (representation) => representation.format !== asset.format,
      )
    ) {
      return {
        path: ['representations'],
        issue: 'representation format must match its asset',
      }
    }
    if (
      new Set(asset.lineage.sourceAssetIds).size !==
      asset.lineage.sourceAssetIds.length
    ) {
      return {
        path: ['lineage', 'sourceAssetIds'],
        issue: 'source asset identities must be unique',
      }
    }
    if (
      new Set(asset.lineage.operationIds).size !==
      asset.lineage.operationIds.length
    ) {
      return {
        path: ['lineage', 'operationIds'],
        issue: 'lineage operation identities must be unique',
      }
    }
    if (
      (asset.lineage.processingProjectId === undefined) !==
      (asset.lineage.processingOutputId === undefined)
    ) {
      return {
        path: ['lineage'],
        issue:
          'Processing Project and output identities must be recorded together',
      }
    }
    if (
      asset.lineage.processingResultId !== undefined &&
      asset.lineage.processingProjectId === undefined
    ) {
      return {
        path: ['lineage'],
        issue: 'a Processing Result requires its Processing Project identity',
      }
    }
  }),
)

export interface LibraryAsset extends Schema.Schema.Type<typeof LibraryAsset> {}

export const AssetDeliveryWork = Schema.TaggedUnion({
  StageForRemoteDownload: {
    assetId: AssetId,
    representationId: RepresentationId,
    operationId: OperationId,
    expectedChecksum: Schema.NonEmptyString,
  },
  RepublishRepresentation: {
    assetId: AssetId,
    representationId: RepresentationId,
    operationId: OperationId,
    expectedChecksum: Schema.NonEmptyString,
  },
})

export type RepublicationStartDecision = Data.TaggedEnum<{
  Started: {
    readonly asset: LibraryAsset
    readonly work: typeof AssetDeliveryWork.Type
  }
  Reused: {
    readonly asset: LibraryAsset
    readonly operationId: typeof OperationId.Type
  }
  Rejected: {
    readonly reason:
      | 'LocalSourceUnavailable'
      | 'SourceChecksumChanged'
      | 'RepresentationAlreadyPublished'
  }
}>

export const RepublicationStartDecision =
  Data.taggedEnum<RepublicationStartDecision>()

export const decideRepublishAsset = (
  asset: LibraryAsset,
  representationId: typeof RepresentationId.Type,
  operationId: typeof OperationId.Type,
  sourceChecksum: string,
  nowEpochMs: number,
): RepublicationStartDecision => {
  if (!asset.localAvailable)
    return RepublicationStartDecision.Rejected({
      reason: 'LocalSourceUnavailable',
    })
  if (asset.checksum !== sourceChecksum)
    return RepublicationStartDecision.Rejected({
      reason: 'SourceChecksumChanged',
    })
  const existing = asset.representations.find(
    (candidate) => candidate.representationId === representationId,
  )
  if (
    existing !== undefined &&
    DeliveryRepresentation.guards.Preparing(existing) &&
    existing.purpose === 'republication'
  ) {
    return RepublicationStartDecision.Reused({
      asset,
      operationId: existing.operationId,
    })
  }
  if (
    existing !== undefined &&
    DeliveryRepresentation.guards.Published(existing) &&
    existing.expiresAtEpochMs > nowEpochMs
  ) {
    return RepublicationStartDecision.Rejected({
      reason: 'RepresentationAlreadyPublished',
    })
  }
  const preparing = DeliveryRepresentation.cases.Preparing.make({
    representationId,
    operationId,
    format: asset.format,
    purpose: 'republication',
  })
  return RepublicationStartDecision.Started({
    asset: LibraryAsset.make({
      ...asset,
      revision: AssetRevision.make(asset.revision + 1),
      representations: [
        ...asset.representations.filter(
          (candidate) => candidate.representationId !== representationId,
        ),
        preparing,
      ],
    }),
    work: AssetDeliveryWork.cases.RepublishRepresentation.make({
      assetId: asset.assetId,
      representationId,
      operationId,
      expectedChecksum: asset.checksum,
    }),
  })
}

export type DownloadRoutingDecision = Data.TaggedEnum<{
  StreamLocal: { readonly assetId: typeof AssetId.Type }
  PublishedRepresentationEligible: {
    readonly representationId: typeof RepresentationId.Type
  }
  PreparationStarted: {
    readonly asset: LibraryAsset
    readonly work: typeof AssetDeliveryWork.Type
  }
  PreparationPending: { readonly operationId: typeof OperationId.Type }
  Rejected: {
    readonly reason:
      'LocalOriginalUnavailable' | 'AssetRepresentationUnavailable'
  }
}>

export const DownloadRoutingDecision =
  Data.taggedEnum<DownloadRoutingDecision>()

export interface DownloadRoutingInput {
  readonly asset: LibraryAsset
  readonly accessPath: 'lan' | 'remote'
  readonly requestedRepresentationId?: typeof RepresentationId.Type
  readonly nowEpochMs: number
  readonly assignedRepresentationId: typeof RepresentationId.Type
  readonly assignedOperationId: typeof OperationId.Type
}

export const decideAssetDownload = (
  input: DownloadRoutingInput,
): DownloadRoutingDecision => {
  if (input.accessPath === 'lan') {
    return input.asset.localAvailable
      ? DownloadRoutingDecision.StreamLocal({ assetId: input.asset.assetId })
      : DownloadRoutingDecision.Rejected({
          reason: 'LocalOriginalUnavailable',
        })
  }
  const selected =
    input.requestedRepresentationId === undefined
      ? (input.asset.representations.find(
          (representation) =>
            DeliveryRepresentation.guards.Published(representation) &&
            representation.expiresAtEpochMs > input.nowEpochMs,
        ) ??
        input.asset.representations.find(
          (representation) =>
            DeliveryRepresentation.guards.Preparing(representation) &&
            representation.purpose === 'remoteDownload',
        ))
      : input.asset.representations.find(
          (representation) =>
            representation.representationId === input.requestedRepresentationId,
        )
  if (selected !== undefined) {
    return DeliveryRepresentation.match(selected, {
      Preparing: ({ operationId }) =>
        DownloadRoutingDecision.PreparationPending({ operationId }),
      Published: ({ representationId, expiresAtEpochMs }) =>
        expiresAtEpochMs > input.nowEpochMs
          ? DownloadRoutingDecision.PublishedRepresentationEligible({
              representationId,
            })
          : startPreparation(input),
      Expired: () => startPreparation(input),
      Failed: () => startPreparation(input),
    })
  }
  if (input.requestedRepresentationId !== undefined) {
    return DownloadRoutingDecision.Rejected({
      reason: 'AssetRepresentationUnavailable',
    })
  }
  return startPreparation(input)
}

function startPreparation(
  input: DownloadRoutingInput,
): DownloadRoutingDecision {
  if (!input.asset.localAvailable)
    return DownloadRoutingDecision.Rejected({
      reason: 'LocalOriginalUnavailable',
    })
  const representationId =
    input.requestedRepresentationId ?? input.assignedRepresentationId
  const representation = DeliveryRepresentation.cases.Preparing.make({
    representationId,
    operationId: input.assignedOperationId,
    format: input.asset.format,
    purpose: 'remoteDownload',
  })
  return DownloadRoutingDecision.PreparationStarted({
    asset: LibraryAsset.make({
      ...input.asset,
      revision: AssetRevision.make(input.asset.revision + 1),
      representations: [
        ...input.asset.representations.filter(
          (candidate) => candidate.representationId !== representationId,
        ),
        representation,
      ],
    }),
    work: AssetDeliveryWork.cases.StageForRemoteDownload.make({
      assetId: input.asset.assetId,
      representationId,
      operationId: input.assignedOperationId,
      expectedChecksum: input.asset.checksum,
    }),
  })
}

export type PublicationCompletionDecision = Data.TaggedEnum<{
  Published: { readonly asset: LibraryAsset }
  AlreadyPublished: { readonly asset: LibraryAsset }
  Rejected: {
    readonly reason:
      'PublicationOperationSuperseded' | 'InvalidPublicationExpiry'
  }
}>

export const PublicationCompletionDecision =
  Data.taggedEnum<PublicationCompletionDecision>()

export const completeAssetPublication = (
  asset: LibraryAsset,
  operationId: typeof OperationId.Type,
  expiresAtEpochMs: number,
  nowEpochMs = 0,
): PublicationCompletionDecision => {
  const completed = asset.representations.find(
    (representation) =>
      DeliveryRepresentation.guards.Published(representation) &&
      representation.operationId === operationId,
  )
  if (
    completed !== undefined &&
    DeliveryRepresentation.guards.Published(completed) &&
    completed.expiresAtEpochMs === expiresAtEpochMs
  ) {
    return PublicationCompletionDecision.AlreadyPublished({ asset })
  }
  if (expiresAtEpochMs <= nowEpochMs) {
    return PublicationCompletionDecision.Rejected({
      reason: 'InvalidPublicationExpiry',
    })
  }
  const preparing = asset.representations.find(
    (representation) =>
      DeliveryRepresentation.guards.Preparing(representation) &&
      representation.operationId === operationId,
  )
  if (preparing === undefined)
    return PublicationCompletionDecision.Rejected({
      reason: 'PublicationOperationSuperseded',
    })
  const published = DeliveryRepresentation.cases.Published.make({
    representationId: preparing.representationId,
    operationId,
    format: preparing.format,
    expiresAtEpochMs: NonNegativeInt.make(expiresAtEpochMs),
  })
  return PublicationCompletionDecision.Published({
    asset: LibraryAsset.make({
      ...asset,
      revision: AssetRevision.make(asset.revision + 1),
      representations: [
        ...asset.representations.filter(
          (representation) =>
            representation.representationId !== preparing.representationId,
        ),
        published,
      ],
    }),
  })
}

export type PublicationFailureDecision = Data.TaggedEnum<{
  Failed: { readonly asset: LibraryAsset }
  AlreadyFailed: { readonly asset: LibraryAsset }
  Rejected: { readonly reason: 'PublicationOperationSuperseded' }
}>

export const PublicationFailureDecision =
  Data.taggedEnum<PublicationFailureDecision>()

export const failAssetPublication = (
  asset: LibraryAsset,
  operationId: typeof OperationId.Type,
  diagnosticRef: string,
): PublicationFailureDecision => {
  const completedFailure = asset.representations.find(
    (representation) =>
      DeliveryRepresentation.guards.Failed(representation) &&
      representation.operationId === operationId &&
      representation.diagnosticRef === diagnosticRef,
  )
  if (completedFailure !== undefined)
    return PublicationFailureDecision.AlreadyFailed({ asset })
  const preparing = asset.representations.find(
    (representation) =>
      DeliveryRepresentation.guards.Preparing(representation) &&
      representation.operationId === operationId,
  )
  if (preparing === undefined)
    return PublicationFailureDecision.Rejected({
      reason: 'PublicationOperationSuperseded',
    })
  const failed = DeliveryRepresentation.cases.Failed.make({
    representationId: preparing.representationId,
    operationId,
    format: preparing.format,
    diagnosticRef,
  })
  return PublicationFailureDecision.Failed({
    asset: LibraryAsset.make({
      ...asset,
      revision: AssetRevision.make(asset.revision + 1),
      representations: asset.representations.map((representation) =>
        representation.representationId === preparing.representationId
          ? failed
          : representation,
      ),
    }),
  })
}

export type RepresentationExpiryDecision = Data.TaggedEnum<{
  Expired: { readonly asset: LibraryAsset }
  Unchanged: { readonly asset: LibraryAsset }
  Rejected: { readonly reason: 'RepresentationUnavailable' }
}>

export const RepresentationExpiryDecision =
  Data.taggedEnum<RepresentationExpiryDecision>()

export const expireAssetRepresentation = (
  asset: LibraryAsset,
  representationId: typeof RepresentationId.Type,
  observedAtEpochMs: number,
): RepresentationExpiryDecision => {
  const representation = asset.representations.find(
    (candidate) => candidate.representationId === representationId,
  )
  if (representation === undefined)
    return RepresentationExpiryDecision.Rejected({
      reason: 'RepresentationUnavailable',
    })
  if (
    !DeliveryRepresentation.guards.Published(representation) ||
    representation.expiresAtEpochMs > observedAtEpochMs
  ) {
    return RepresentationExpiryDecision.Unchanged({ asset })
  }
  const expired = DeliveryRepresentation.cases.Expired.make({
    representationId,
    format: representation.format,
    expiredAtEpochMs: NonNegativeInt.make(observedAtEpochMs),
  })
  return RepresentationExpiryDecision.Expired({
    asset: LibraryAsset.make({
      ...asset,
      revision: AssetRevision.make(asset.revision + 1),
      representations: [
        ...asset.representations.filter(
          (candidate) => candidate.representationId !== representationId,
        ),
        expired,
      ],
    }),
  })
}

export const LibraryComparison = Schema.Struct({
  comparisonGroupId: Schema.NonEmptyString,
  entries: Schema.NonEmptyArray(
    Schema.Struct({
      assetId: AssetId,
      role: LibraryAsset.fields.role,
      format: AssetFormat,
      checksum: Schema.NonEmptyString,
      sourceAssetIds: Schema.NonEmptyArray(AssetId),
      processingProjectId: Schema.optionalKey(ProcessingProjectId),
      processingAttemptIds: Schema.Array(ProcessingStageAttemptId),
      processingResultId: Schema.optionalKey(ProcessingStageResultId),
      processingOutputId: Schema.optionalKey(ProcessingOutputId),
      operationIds: Schema.Array(OperationId),
    }),
  ),
})

export type LibraryComparisonDecision = Data.TaggedEnum<{
  Ready: { readonly comparison: typeof LibraryComparison.Type }
  Rejected: {
    readonly reason:
      | 'ComparisonNeedsMultipleAssets'
      | 'DuplicateAssetSelection'
      | 'AssetsUnrelated'
  }
}>

export const LibraryComparisonDecision =
  Data.taggedEnum<LibraryComparisonDecision>()

export const buildLibraryComparison = (
  assets: ReadonlyArray<LibraryAsset>,
): LibraryComparisonDecision => {
  if (assets.length < 2)
    return LibraryComparisonDecision.Rejected({
      reason: 'ComparisonNeedsMultipleAssets',
    })
  if (new Set(assets.map((asset) => asset.assetId)).size !== assets.length) {
    return LibraryComparisonDecision.Rejected({
      reason: 'DuplicateAssetSelection',
    })
  }
  const [first, ...rest] = assets
  if (first === undefined)
    return LibraryComparisonDecision.Rejected({
      reason: 'ComparisonNeedsMultipleAssets',
    })
  if (
    rest.some(
      (asset) =>
        asset.lineage.comparisonGroupId !== first.lineage.comparisonGroupId ||
        !sameIds(asset.lineage.sourceAssetIds, first.lineage.sourceAssetIds),
    )
  ) {
    return LibraryComparisonDecision.Rejected({ reason: 'AssetsUnrelated' })
  }
  return LibraryComparisonDecision.Ready({
    comparison: LibraryComparison.make({
      comparisonGroupId: first.lineage.comparisonGroupId,
      entries: [comparisonEntry(first), ...rest.map(comparisonEntry)],
    }),
  })
}

function comparisonEntry(asset: LibraryAsset) {
  return {
    assetId: asset.assetId,
    role: asset.role,
    format: asset.format,
    checksum: asset.checksum,
    sourceAssetIds: asset.lineage.sourceAssetIds,
    ...(asset.lineage.processingProjectId === undefined
      ? {}
      : { processingProjectId: asset.lineage.processingProjectId }),
    processingAttemptIds: asset.lineage.processingAttemptIds ?? [],
    ...(asset.lineage.processingResultId === undefined
      ? {}
      : { processingResultId: asset.lineage.processingResultId }),
    ...(asset.lineage.processingOutputId === undefined
      ? {}
      : { processingOutputId: asset.lineage.processingOutputId }),
    operationIds: asset.lineage.operationIds,
  }
}

function sameIds(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
