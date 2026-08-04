import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  AttemptId,
  CheckpointId,
  NonNegativeInt,
  OperationId,
  ProcessingOutputId,
  ProcessingRevision,
  ProcessingSessionId,
  RepresentationId,
} from './primitives.js'
import {
  AppliedProcessingOperation,
  ProcessingImageRef,
  ProcessingSession,
  ProcessingSourceRef,
} from './processing-domain.js'
import {
  DeliveryRepresentation,
  CapturedFrameIntake,
  LibraryAsset,
  buildLibraryComparison,
  completeAssetPublication,
  completeProcessingSave,
  decideAssetDownload,
  decideOpenAssetInProcess,
  decideRepublishAsset,
  expireAssetRepresentation,
} from './asset-domain.js'
import { AssetSnapshot, projectAssetSnapshot } from './snapshots.js'

const session = ProcessingSession.make({
  sessionId: ProcessingSessionId.make('process-m27'),
  revision: ProcessingRevision.make(4),
  lifecycle: 'active',
  phase: 'develop',
  sources: [
    ProcessingSourceRef.make({
      assetId: AssetId.make('raw-m27'),
      assetRevision: AssetRevision.make(3),
      role: 'original',
      checksum: 'sha256:raw-m27',
      locallyAvailable: true,
    }),
  ],
  baseImage: ProcessingImageRef.cases.DerivedOutput.make({
    outputId: ProcessingOutputId.make('linear-m27'),
    checksum: 'sha256:linear-m27',
  }),
  history: [
    AppliedProcessingOperation.make({
      operationId: OperationId.make('stretch-m27'),
      attemptId: AttemptId.make('attempt-stretch-m27'),
      operation: 'stretch',
      toolId: 'siril',
      parameters: [],
      input: ProcessingImageRef.cases.DerivedOutput.make({
        outputId: ProcessingOutputId.make('linear-m27'),
        checksum: 'sha256:linear-m27',
      }),
      output: ProcessingImageRef.cases.DerivedOutput.make({
        outputId: ProcessingOutputId.make('stretched-m27'),
        checksum: 'sha256:stretched-m27',
      }),
      checkpointId: CheckpointId.make('checkpoint-stretched-m27'),
    }),
  ],
  historyPosition: NonNegativeInt.make(1),
  assistantFindings: [],
  savedAssetIds: [],
})

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

  it('creates several durable assets and leaves Process as a working session', () => {
    const decision = completeProcessingSave(session, 'm27-source', [
      {
        assetId: AssetId.make('m27-final-fits'),
        outputId: ProcessingOutputId.make('stretched-m27'),
        role: 'final',
        format: 'fits',
        checksum: 'sha256:m27-final-fits',
        permanentBytesReady: true,
      },
      {
        assetId: AssetId.make('m27-preview-png'),
        outputId: ProcessingOutputId.make('stretched-m27'),
        role: 'preview',
        format: 'png',
        checksum: 'sha256:m27-preview-png',
        permanentBytesReady: true,
      },
    ])
    assert.equal(decision._tag, 'Saved')
    if (decision._tag === 'Saved') {
      assert.equal(decision.assets.length, 2)
      assert.equal(decision.session.lifecycle, 'active')
      assert.deepEqual(decision.assets[0]?.lineage.operationIds, [
        OperationId.make('stretch-m27'),
      ])
    }
  })

  it('fails the whole save if any permanent output is not ready', () => {
    const decision = completeProcessingSave(session, 'm27-source', [
      {
        assetId: AssetId.make('m27-final-fits'),
        outputId: ProcessingOutputId.make('stretched-m27'),
        role: 'final',
        format: 'fits',
        checksum: 'sha256:m27-final-fits',
        permanentBytesReady: false,
      },
    ])
    assert.deepEqual(decision, {
      _tag: 'Rejected',
      reason: 'ArtifactBytesNotReady',
    })
  })

  it('rejects colliding stable asset identities and records only the operations that produced each output', () => {
    const first = session.history[0]
    assert.notEqual(first, undefined)
    if (first === undefined) return
    const second = AppliedProcessingOperation.make({
      operationId: OperationId.make('color-m27'),
      attemptId: AttemptId.make('attempt-color-m27'),
      operation: 'color',
      toolId: 'siril',
      parameters: [],
      input: first.output,
      output: ProcessingImageRef.cases.DerivedOutput.make({
        outputId: ProcessingOutputId.make('colored-m27'),
        checksum: 'sha256:colored-m27',
      }),
      checkpointId: CheckpointId.make('checkpoint-colored-m27'),
    })
    const twoStepSession = ProcessingSession.make({
      ...session,
      history: [first, second],
      historyPosition: NonNegativeInt.make(2),
    })
    const saved = completeProcessingSave(twoStepSession, 'm27-source', [
      {
        assetId: AssetId.make('m27-stretched'),
        outputId: first.output.outputId,
        role: 'intermediate',
        format: 'fits',
        checksum: 'sha256:m27-stretched',
        permanentBytesReady: true,
      },
      {
        assetId: AssetId.make('m27-colored'),
        outputId: second.output.outputId,
        role: 'final',
        format: 'fits',
        checksum: 'sha256:m27-colored',
        permanentBytesReady: true,
      },
    ])
    assert.equal(saved._tag, 'Saved')
    if (saved._tag !== 'Saved') return
    assert.deepEqual(saved.assets[0]?.lineage.operationIds, [first.operationId])
    assert.deepEqual(saved.assets[1]?.lineage.operationIds, [
      first.operationId,
      second.operationId,
    ])

    assert.deepEqual(
      completeProcessingSave(twoStepSession, 'm27-source', [
        {
          assetId: AssetId.make('duplicate'),
          outputId: first.output.outputId,
          role: 'intermediate',
          format: 'fits',
          checksum: 'sha256:first',
          permanentBytesReady: true,
        },
        {
          assetId: AssetId.make('duplicate'),
          outputId: second.output.outputId,
          role: 'final',
          format: 'fits',
          checksum: 'sha256:second',
          permanentBytesReady: true,
        },
      ]),
      { _tag: 'Rejected', reason: 'AssetIdentityConflict' },
    )
    assert.deepEqual(
      completeProcessingSave(
        twoStepSession,
        'm27-source',
        [
          {
            assetId: AssetId.make('existing-asset'),
            outputId: second.output.outputId,
            role: 'final',
            format: 'fits',
            checksum: 'sha256:existing',
            permanentBytesReady: true,
          },
        ],
        [AssetId.make('existing-asset')],
      ),
      { _tag: 'Rejected', reason: 'AssetIdentityConflict' },
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

  it('compares related saved assets without mutating them', () => {
    const saved = completeProcessingSave(session, 'm27-source', [
      {
        assetId: AssetId.make('m27-final-fits'),
        outputId: ProcessingOutputId.make('stretched-m27'),
        role: 'final',
        format: 'fits',
        checksum: 'sha256:m27-final-fits',
        permanentBytesReady: true,
      },
      {
        assetId: AssetId.make('m27-preview-png'),
        outputId: ProcessingOutputId.make('stretched-m27'),
        role: 'preview',
        format: 'png',
        checksum: 'sha256:m27-preview-png',
        permanentBytesReady: true,
      },
    ])
    assert.equal(saved._tag, 'Saved')
    if (saved._tag === 'Saved') {
      const comparison = buildLibraryComparison(saved.assets)
      assert.equal(comparison._tag, 'Ready')
      assert.equal(
        saved.assets.every((asset) => asset.revision === AssetRevision.make(0)),
        true,
      )
    }
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

  it('opens only source roles that justify a Process phase', () => {
    assert.equal(decideOpenAssetInProcess(original)._tag, 'Start')
    const derived = LibraryAsset.make({
      ...original,
      assetId: AssetId.make('preview-m27'),
      role: 'preview',
      format: 'png',
      representations: [
        DeliveryRepresentation.cases.Published.make({
          representationId: RepresentationId.make('preview-r2'),
          format: 'png',
          expiresAtEpochMs: NonNegativeInt.make(500),
        }),
      ],
    })
    assert.deepEqual(decideOpenAssetInProcess(derived), {
      _tag: 'Rejected',
      reason: 'SourceRoleUnsupported',
    })
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
