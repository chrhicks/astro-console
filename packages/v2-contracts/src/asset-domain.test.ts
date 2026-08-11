import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  NonNegativeInt,
  OperationId,
  ProcessingOutputId,
  ProcessingProjectId,
  ProcessingStageAttemptId,
  ProcessingStageResultId,
  RepresentationId,
} from './primitives.js'
import {
  DeliveryRepresentation,
  CapturedFrameIntake,
  LibraryAsset,
  buildLibraryComparison,
  completeAssetPublication,
  decideAssetDownload,
  decideRepublishAsset,
  expireAssetRepresentation,
} from './asset-domain.js'
import { AssetSnapshot, projectAssetSnapshot } from './snapshots.js'

const original = LibraryAsset.make({
  assetId: AssetId.make('raw-m27'),
  revision: AssetRevision.make(1),
  role: 'original',
  format: 'cameraRaw',
  checksum: 'sha256:raw-m27',
  localAvailable: true,
  lineage: {
    comparisonGroupId: 'm27-source',
    sourceAssetIds: [AssetId.make('raw-m27')],
    operationIds: [],
  },
  representations: [],
})

describe('hardened Asset domain', () => {
  it('keeps capture intake metadata separate from opaque original bytes', () => {
    const valid = {
      assetId: 'asset-capture-m27-001',
      frameId: 'frame-m27-001',
      capturedAt: '2026-08-04T01:02:03.000Z',
      format: 'fits',
      equipment: {
        rigId: 'rig-main',
        cameraDeviceId: 'camera-imaging',
      },
      capture: {
        exposureSeconds: 180,
        filter: 'L',
        binning: 1,
        frameType: 'light',
      },
      lineage: {
        runId: 'run-capture-m27',
        sequenceId: 'sequence-l',
        acquisitionId: 'acquire-m27-001',
      },
      idempotencyKey: 'capture-m27-001',
    }
    assert.equal(Schema.is(CapturedFrameIntake)(valid), true)
    assert.equal(
      Schema.is(CapturedFrameIntake)({
        ...valid,
        capture: { ...valid.capture, exposureSeconds: 0 },
      }),
      false,
    )
  })

  it('streams locally but stages a remote-only delivery without changing asset identity', () => {
    const local = decideAssetDownload({
      asset: original,
      accessPath: 'lan',
      nowEpochMs: 100,
      assignedRepresentationId: RepresentationId.make('unused'),
      assignedOperationId: OperationId.make('unused'),
    })
    assert.deepEqual(local, {
      _tag: 'StreamLocal',
      assetId: AssetId.make('raw-m27'),
    })

    const remote = decideAssetDownload({
      asset: original,
      accessPath: 'remote',
      nowEpochMs: 100,
      assignedRepresentationId: RepresentationId.make('r2-stage-1'),
      assignedOperationId: OperationId.make('stage-1'),
    })
    assert.equal(remote._tag, 'PreparationStarted')
    if (remote._tag === 'PreparationStarted') {
      assert.equal(remote.asset.assetId, original.assetId)
      assert.equal(remote.work._tag, 'StageForRemoteDownload')
    }
  })

  it('publishes only the correlated staging operation and honors expiry', () => {
    const started = decideAssetDownload({
      asset: original,
      accessPath: 'remote',
      nowEpochMs: 100,
      assignedRepresentationId: RepresentationId.make('r2-stage-1'),
      assignedOperationId: OperationId.make('stage-1'),
    })
    assert.equal(started._tag, 'PreparationStarted')
    if (started._tag !== 'PreparationStarted') return
    assert.equal(
      completeAssetPublication(
        started.asset,
        OperationId.make('superseded'),
        500,
      )._tag,
      'Rejected',
    )
    const completed = completeAssetPublication(
      started.asset,
      OperationId.make('stage-1'),
      500,
    )
    assert.equal(completed._tag, 'Published')
    if (completed._tag !== 'Published') return

    const valid = decideAssetDownload({
      asset: completed.asset,
      accessPath: 'remote',
      nowEpochMs: 499,
      assignedRepresentationId: RepresentationId.make('unused'),
      assignedOperationId: OperationId.make('unused'),
    })
    assert.equal(valid._tag, 'PublishedRepresentationEligible')
    const expired = decideAssetDownload({
      asset: completed.asset,
      accessPath: 'remote',
      nowEpochMs: 500,
      assignedRepresentationId: RepresentationId.make('r2-stage-2'),
      assignedOperationId: OperationId.make('stage-2'),
    })
    assert.equal(expired._tag, 'PreparationStarted')
  })

  it('compares related Project results without mutating them', () => {
    const master = LibraryAsset.make({
      ...original,
      assetId: AssetId.make('m27-master'),
      role: 'linearMaster',
      format: 'fits',
      lineage: {
        ...original.lineage,
        processingProjectId: ProcessingProjectId.make('project-m27'),
        processingAttemptIds: [
          ProcessingStageAttemptId.make('stack-attempt-1'),
        ],
        processingResultId: ProcessingStageResultId.make('stack-result-1'),
        processingOutputId: ProcessingOutputId.make('stack-output-1'),
      },
    })
    const final = LibraryAsset.make({
      ...master,
      assetId: AssetId.make('m27-final'),
      role: 'final',
      lineage: {
        ...master.lineage,
        processingAttemptIds: [
          ...(master.lineage.processingAttemptIds ?? []),
          ProcessingStageAttemptId.make('develop-attempt-1'),
        ],
        processingResultId: ProcessingStageResultId.make('develop-result-1'),
        processingOutputId: ProcessingOutputId.make('develop-output-1'),
      },
    })
    const comparison = buildLibraryComparison([master, final])
    assert.equal(comparison._tag, 'Ready')
  })

  it('rejects duplicate or falsely grouped comparison selections', () => {
    assert.deepEqual(buildLibraryComparison([original, original]), {
      _tag: 'Rejected',
      reason: 'DuplicateAssetSelection',
    })
    const unrelated = LibraryAsset.make({
      ...original,
      assetId: AssetId.make('raw-other'),
      lineage: {
        comparisonGroupId: original.lineage.comparisonGroupId,
        sourceAssetIds: [AssetId.make('raw-other')],
        operationIds: [],
      },
    })
    assert.deepEqual(buildLibraryComparison([original, unrelated]), {
      _tag: 'Rejected',
      reason: 'AssetsUnrelated',
    })
  })

  it('rejects duplicate representation identities and representation format drift', () => {
    const representation = DeliveryRepresentation.cases.Published.make({
      representationId: RepresentationId.make('duplicate-r2'),
      format: 'cameraRaw',
      expiresAtEpochMs: NonNegativeInt.make(500),
    })
    assert.throws(() =>
      LibraryAsset.make({
        ...original,
        representations: [representation, representation],
      }),
    )
    assert.throws(() =>
      LibraryAsset.make({
        ...original,
        representations: [
          DeliveryRepresentation.cases.Published.make({
            representationId: RepresentationId.make('wrong-format'),
            format: 'fits',
            expiresAtEpochMs: NonNegativeInt.make(500),
          }),
        ],
      }),
    )
  })

  it('expires and republishes delivery state without replacing canonical asset identity', () => {
    const published = LibraryAsset.make({
      ...original,
      representations: [
        DeliveryRepresentation.cases.Published.make({
          representationId: RepresentationId.make('r2-final'),
          format: 'cameraRaw',
          expiresAtEpochMs: NonNegativeInt.make(100),
        }),
      ],
    })
    const expired = expireAssetRepresentation(
      published,
      RepresentationId.make('r2-final'),
      101,
    )
    assert.equal(expired._tag, 'Expired')
    if (expired._tag !== 'Expired') return
    assert.equal(expired.asset.assetId, published.assetId)
    const republish = decideRepublishAsset(
      expired.asset,
      RepresentationId.make('r2-final'),
      OperationId.make('republish-final'),
      published.checksum,
      101,
    )
    assert.equal(republish._tag, 'Started')
    if (republish._tag === 'Started') {
      assert.equal(republish.asset.assetId, published.assetId)
      assert.equal(republish.work._tag, 'RepublishRepresentation')
    }
  })

  it('projects enough stable lineage for Library review without paths or provider keys', () => {
    const snapshot = Schema.decodeUnknownSync(AssetSnapshot)({
      assetId: 'm27-final',
      revision: 4,
      role: 'final',
      format: 'fits',
      checksum: 'sha256:m27-final',
      localAvailable: true,
      comparisonGroupId: 'm27-source',
      sourceAssetIds: ['raw-m27'],
      operationIds: ['stretch-m27'],
      availability: 'published',
      representationCount: 1,
      representations: [
        {
          representationId: 'r2-final',
          storage: 'r2',
          state: 'published',
          format: 'fits',
          expiresAt: '2026-10-01T00:00:00Z',
        },
      ],
      actions: [],
    })
    assert.equal(snapshot.comparisonGroupId, 'm27-source')
    assert.equal('path' in snapshot, false)
    assert.equal('providerKey' in snapshot, false)
  })

  it('derives honest delivery availability from representation evidence', () => {
    const republishing = decideRepublishAsset(
      original,
      RepresentationId.make('r2-final'),
      OperationId.make('republish-final'),
      original.checksum,
      100,
    )
    assert.equal(republishing._tag, 'Started')
    if (republishing._tag !== 'Started') return
    assert.equal(
      projectAssetSnapshot(republishing.asset, 100, 50).availability,
      'republishing',
    )

    const published = completeAssetPublication(
      republishing.asset,
      OperationId.make('republish-final'),
      200,
    )
    assert.equal(published._tag, 'Published')
    if (published._tag !== 'Published') return
    assert.equal(
      projectAssetSnapshot(published.asset, 160, 50).availability,
      'expiring',
    )
    assert.equal(
      projectAssetSnapshot(published.asset, 201, 50).availability,
      'expired',
    )
  })
})
