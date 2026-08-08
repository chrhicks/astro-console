import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Result, Schema } from 'effect'
import {
  AssetId,
  AssetRevision,
  AttemptId,
  CheckpointId,
  FindingId,
  OperationId,
  PreviewId,
  ProcessingOutputId,
  ProcessingSessionId,
} from './primitives.js'
import {
  ProcessingImageRef,
  ProcessingPreviewSpec,
  ProcessingSession,
  ProcessingSourceRef,
  ProcessingTransition,
  StartProcessingDecision,
  completeProcessingApply,
  completeLinearMasterBuild,
  completeProcessingPreview,
  currentProcessingImage,
  decideStartProcessingSession,
  discardHardenedProcessingSession,
  failProcessingApply,
  moveHardenedProcessingHistory,
  queueProcessingPreview,
  retryHardenedProcessingStage,
  startProcessingApply,
} from './processing-domain.js'

const source = (assetId: string, role: 'original' | 'linearMaster') =>
  ProcessingSourceRef.make({
    assetId: AssetId.make(assetId),
    assetRevision: AssetRevision.make(2),
    role,
    checksum: `sha256:${assetId}`,
    locallyAvailable: true,
  })

const startedDevelop = () => {
  const decision = decideStartProcessingSession(
    ProcessingSessionId.make('process-1'),
    [source('linear-1', 'linearMaster')],
  )
  return StartProcessingDecision.$match(decision, {
    Started: ({ session }) => session,
    Rejected: ({ reason }) => assert.fail(`unexpected rejection: ${reason}`),
  })
}

const readyPreview = (session: ProcessingSession) =>
  ProcessingPreviewSpec.make({
    previewId: PreviewId.make('preview-1'),
    clientPreviewSequence: 1,
    operation: 'stretch',
    toolId: 'siril',
    parameters: [{ key: 'amount', value: { _tag: 'NumberValue', value: 0.6 } }],
    input:
      currentProcessingImage(session) ?? assert.fail('missing current image'),
    baseHistoryPosition: session.historyPosition,
    state: 'ready',
    previewOutputId: ProcessingOutputId.make('preview-output-1'),
  })

describe('hardened Processing domain', () => {
  it('starts raw sources in Build and emits only linear-master work', () => {
    const decision = decideStartProcessingSession(
      ProcessingSessionId.make('process-raw'),
      [source('raw-1', 'original'), source('raw-2', 'original')],
    )
    StartProcessingDecision.$match(decision, {
      Started: ({ session, work }) => {
        assert.equal(session.phase, 'build')
        assert.equal(session.baseImage, undefined)
        assert.equal(work?._tag, 'BuildLinearMaster')
      },
      Rejected: ({ reason }) => assert.fail(`unexpected rejection: ${reason}`),
    })
  })

  it('starts one linear master directly in Develop without Build work', () => {
    const decision = decideStartProcessingSession(
      ProcessingSessionId.make('process-linear'),
      [source('linear-1', 'linearMaster')],
    )
    StartProcessingDecision.$match(decision, {
      Started: ({ session, work }) => {
        assert.equal(session.phase, 'develop')
        assert.equal(session.baseImage?._tag, 'SourceAsset')
        assert.equal(work, undefined)
      },
      Rejected: ({ reason }) => assert.fail(`unexpected rejection: ${reason}`),
    })
  })

  it('moves a raw session into Develop only when its linear master completes', () => {
    const started = decideStartProcessingSession(
      ProcessingSessionId.make('process-raw'),
      [source('raw-1', 'original')],
    )
    assert.equal(started._tag, 'Started')
    if (started._tag !== 'Started') return
    const completed = completeLinearMasterBuild(
      started.session,
      ProcessingOutputId.make('linear-output-1'),
      'sha256:linear-output-1',
    )
    assert.equal(completed._tag, 'BuildCompleted')
    if (completed._tag === 'BuildCompleted') {
      assert.equal(completed.session.phase, 'develop')
      assert.equal(completed.session.baseImage?._tag, 'DerivedOutput')
      assert.equal(completed.session.history.length, 0)
    }
  })

  it('rejects mixed raw and linear-master source roles', () => {
    const decision = decideStartProcessingSession(
      ProcessingSessionId.make('process-mixed'),
      [source('raw-1', 'original'), source('linear-1', 'linearMaster')],
    )
    assert.equal(StartProcessingDecision.$is('Rejected')(decision), true)
  })

  it('starts full-resolution Apply without promoting preview output into history', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      preview: readyPreview(startedDevelop()),
    })
    const decision = startProcessingApply(
      session,
      AttemptId.make('attempt-1'),
      OperationId.make('operation-1'),
      PreviewId.make('preview-1'),
    )
    ProcessingTransition.$match(decision, {
      BuildCompleted: () => assert.fail('unexpected transition'),
      ApplyStarted: ({ session: next, work }) => {
        assert.equal(next.history.length, 0)
        assert.equal(next.historyPosition, 0)
        assert.equal(next.activeAttempt?.attemptId, AttemptId.make('attempt-1'))
        assert.equal(work._tag, 'RunAppliedOperation')
        assert.deepEqual(currentProcessingImage(next), session.baseImage)
      },
      PreviewQueued: () => assert.fail('unexpected transition'),
      PreviewCompleted: () => assert.fail('unexpected transition'),
      PreviewFailed: () => assert.fail('unexpected transition'),
      ApplyCompleted: () => assert.fail('unexpected transition'),
      ApplyFailed: () => assert.fail('unexpected transition'),
      RetryStarted: () => assert.fail('unexpected transition'),
      Resumed: () => assert.fail('unexpected transition'),
      HistoryMoved: () => assert.fail('unexpected transition'),
      LeftUnfinished: () => assert.fail('unexpected transition'),
      Discarded: () => assert.fail('unexpected transition'),
      Rejected: ({ reason }) => assert.fail(`unexpected rejection: ${reason}`),
    })
  })

  it('adds history only after the correlated full-resolution attempt completes', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      preview: readyPreview(startedDevelop()),
    })
    const started = startProcessingApply(
      session,
      AttemptId.make('attempt-1'),
      OperationId.make('operation-1'),
      PreviewId.make('preview-1'),
    )
    assert.equal(started._tag, 'ApplyStarted')
    if (started._tag !== 'ApplyStarted') return
    const completed = completeProcessingApply(
      started.session,
      AttemptId.make('attempt-1'),
      ProcessingOutputId.make('full-output-1'),
      'sha256:full-output-1',
      CheckpointId.make('checkpoint-1'),
    )
    assert.equal(completed._tag, 'ApplyCompleted')
    if (completed._tag === 'ApplyCompleted') {
      assert.equal(completed.session.history.length, 1)
      assert.equal(completed.session.historyPosition, 1)
      assert.equal(
        completed.session.history[0]?.output.outputId,
        ProcessingOutputId.make('full-output-1'),
      )
    }
  })

  it('ignores a superseded preview completion and preserves applied history', () => {
    const session = startedDevelop()
    const first = queueProcessingPreview(session, {
      previewId: PreviewId.make('preview-old'),
      clientPreviewSequence: 1,
      operation: 'stretch',
      toolId: 'siril',
      parameters: [],
      baseHistoryPosition: 0,
    })
    assert.equal(first._tag, 'PreviewQueued')
    if (first._tag !== 'PreviewQueued') return
    const second = queueProcessingPreview(first.session, {
      previewId: PreviewId.make('preview-current'),
      clientPreviewSequence: 2,
      operation: 'stretch',
      toolId: 'siril',
      parameters: [
        { key: 'amount', value: { _tag: 'NumberValue', value: 0.63 } },
      ],
      baseHistoryPosition: 0,
    })
    assert.equal(second._tag, 'PreviewQueued')
    if (second._tag !== 'PreviewQueued') return
    const late = completeProcessingPreview(
      second.session,
      PreviewId.make('preview-old'),
      ProcessingOutputId.make('late-preview'),
    )
    assert.equal(late._tag, 'Rejected')
    assert.equal(
      second.session.preview?.previewId,
      PreviewId.make('preview-current'),
    )
    assert.equal(second.session.history.length, 0)
  })

  it('rejects regressive preview sequences and duplicate worker completion', () => {
    const first = queueProcessingPreview(startedDevelop(), {
      previewId: PreviewId.make('preview-current'),
      clientPreviewSequence: 8,
      operation: 'stretch',
      toolId: 'siril',
      parameters: [],
      baseHistoryPosition: 0,
    })
    assert.equal(ProcessingTransition.$is('PreviewQueued')(first), true)
    if (!ProcessingTransition.$is('PreviewQueued')(first)) return
    const regressive = queueProcessingPreview(first.session, {
      previewId: PreviewId.make('preview-old'),
      clientPreviewSequence: 7,
      operation: 'stretch',
      toolId: 'siril',
      parameters: [],
      baseHistoryPosition: 0,
    })
    assert.equal(ProcessingTransition.$is('Rejected')(regressive), true)
    const completed = completeProcessingPreview(
      first.session,
      PreviewId.make('preview-current'),
      ProcessingOutputId.make('preview-output'),
    )
    assert.equal(ProcessingTransition.$is('PreviewCompleted')(completed), true)
    if (!ProcessingTransition.$is('PreviewCompleted')(completed)) return
    assert.equal(
      ProcessingTransition.$is('Rejected')(
        completeProcessingPreview(
          completed.session,
          PreviewId.make('preview-current'),
          ProcessingOutputId.make('preview-output'),
        ),
      ),
      true,
    )
  })

  it('correlates Apply to the preview the user actually accepted', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      preview: readyPreview(startedDevelop()),
    })
    const stale = startProcessingApply(
      session,
      AttemptId.make('attempt-1'),
      OperationId.make('operation-1'),
      PreviewId.make('preview-superseded'),
    )
    assert.equal(ProcessingTransition.$is('Rejected')(stale), true)
    assert.equal(session.activeAttempt, undefined)
  })

  it('rejects impossible history positions at the schema boundary', () => {
    const decoded = Schema.decodeUnknownResult(ProcessingSession)({
      ...startedDevelop(),
      historyPosition: 2,
    })
    assert.equal(Result.isFailure(decoded), true)
  })

  it('queues only the failed stage from its protected checkpoint', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      failedAttempt: {
        attemptId: AttemptId.make('attempt-failed'),
        operationId: OperationId.make('operation-stretch'),
        operation: 'stretch',
        toolId: 'siril',
        parameters: [],
        input: ProcessingImageRef.cases.SourceAsset.make({
          assetId: AssetId.make('linear-1'),
          checksum: 'sha256:linear-1',
        }),
        baseHistoryPosition: 0,
        checkpointId: CheckpointId.make('checkpoint-linear'),
        diagnosticRef: 'diagnostic-1',
      },
    })
    const decision = retryHardenedProcessingStage(
      session,
      AttemptId.make('attempt-failed'),
      AttemptId.make('attempt-retry'),
      CheckpointId.make('checkpoint-linear'),
    )
    assert.equal(decision._tag, 'RetryStarted')
    if (decision._tag === 'RetryStarted') {
      assert.equal(decision.work._tag, 'RetryProcessingStage')
      assert.equal(decision.session.history.length, session.history.length)
    }
  })

  it('records a failed Apply without replacing the last valid image', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      preview: readyPreview(startedDevelop()),
    })
    const started = startProcessingApply(
      session,
      AttemptId.make('attempt-1'),
      OperationId.make('operation-1'),
      PreviewId.make('preview-1'),
    )
    assert.equal(started._tag, 'ApplyStarted')
    if (started._tag !== 'ApplyStarted') return
    const before = currentProcessingImage(started.session)
    const failed = failProcessingApply(
      started.session,
      AttemptId.make('attempt-1'),
      CheckpointId.make('checkpoint-linear'),
      'diagnostic-stretch-1',
    )
    assert.equal(failed._tag, 'ApplyFailed')
    if (failed._tag === 'ApplyFailed') {
      assert.deepEqual(currentProcessingImage(failed.session), before)
      assert.equal(failed.session.failedAttempt?.operation, 'stretch')
      assert.equal(failed.session.history.length, 0)
    }
  })

  it('tombstones before cleanup while protecting source and saved assets', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      savedAssetIds: [AssetId.make('saved-1')],
    })
    const decision = discardHardenedProcessingSession(
      session,
      'confirm-1',
      'confirm-1',
    )
    assert.equal(decision._tag, 'Discarded')
    if (decision._tag === 'Discarded') {
      assert.equal(decision.session.lifecycle, 'discarded')
      assert.equal(
        decision.session.sources[0]?.assetId,
        AssetId.make('linear-1'),
      )
      assert.equal(decision.work._tag, 'CleanupDiscardedSession')
      if (decision.work._tag === 'CleanupDiscardedSession') {
        assert.deepEqual(decision.work.protectedAssetIds, [
          AssetId.make('saved-1'),
        ])
      }
    }
  })

  it('moves history only while no incompatible attempt is active', () => {
    const session = ProcessingSession.make({
      ...startedDevelop(),
      preview: readyPreview(startedDevelop()),
    })
    const started = startProcessingApply(
      session,
      AttemptId.make('attempt-1'),
      OperationId.make('operation-1'),
      PreviewId.make('preview-1'),
    )
    assert.equal(started._tag, 'ApplyStarted')
    if (started._tag === 'ApplyStarted') {
      assert.equal(
        moveHardenedProcessingHistory(started.session, 'undo')._tag,
        'Rejected',
      )
    }
  })

  it('assistant correlation stays on Preview and never creates applied history', () => {
    const session = startedDevelop()
    const decision = queueProcessingPreview(session, {
      previewId: PreviewId.make('assistant-preview'),
      clientPreviewSequence: 1,
      operation: 'stretch',
      toolId: 'siril',
      parameters: [
        { key: 'amount', value: { _tag: 'NumberValue', value: 0.63 } },
      ],
      baseHistoryPosition: 0,
      suggestionFindingId: FindingId.make('finding-1'),
    })
    assert.equal(decision._tag, 'PreviewQueued')
    if (decision._tag === 'PreviewQueued') {
      assert.equal(
        decision.session.preview?.suggestionFindingId,
        FindingId.make('finding-1'),
      )
      assert.equal(decision.session.history.length, 0)
    }
  })
})
