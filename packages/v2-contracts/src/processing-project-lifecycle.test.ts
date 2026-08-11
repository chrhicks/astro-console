import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Result, Schema } from 'effect'
import {
  OpenedProcessingProject,
  ProcessingProjectAuthority,
  ProcessingProjectCaller,
  ProcessingProjectEvidence,
  ProcessingProjectIntent,
  ProcessingStageResult,
  ProcessingStageState,
  appendProcessingStageResult,
  currentProcessingStageResult,
  decideProcessingProjectAuthority,
  moveProcessingCurrentResult,
  restoreProcessingResultForUpstream,
} from './processing-project-domain.js'

const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S['Type'] => Schema.decodeUnknownSync(schema)(input)

const draft = {
  revision: 0,
  value: { _tag: 'Calibration' as const, settings: [], overrides: [] },
  undo: [],
  redo: [],
}

const result = (
  id: string,
  attemptId: string,
  checksum: string,
  upstream?: typeof ProcessingStageResult.Type,
): typeof ProcessingStageResult.Type =>
  decode(ProcessingStageResult, {
    resultId: id,
    attemptId,
    stage: 'Calibration',
    outcome: 'Succeeded',
    checksum,
    outputId: `output-${id}`,
    checkpointId: `checkpoint-${id}`,
    sources: [],
    ...(upstream === undefined
      ? {}
      : {
          upstream: {
            stage: upstream.stage,
            resultId: upstream.resultId,
            attemptId: upstream.attemptId,
            checksum: upstream.checksum,
          },
        }),
    summary: `result ${id}`,
    completedAt: '2026-08-10T12:00:00Z',
  })

describe('Processing Projects lifecycle contract', () => {
  it('derives Process Authority from owner desktop identity without a Control Lease', () => {
    const allowed = decideProcessingProjectAuthority(
      decode(ProcessingProjectCaller, {
        personId: 'owner-1',
        clientId: 'desktop-1',
        role: 'owner',
        capability: 'controlCapable',
      }),
    )
    assert.equal(ProcessingProjectAuthority.guards.Allowed(allowed), true)

    const phone = decideProcessingProjectAuthority(
      decode(ProcessingProjectCaller, {
        personId: 'owner-1',
        clientId: 'phone-1',
        role: 'owner',
        capability: 'readOnly',
      }),
    )
    assert.deepEqual(phone, {
      _tag: 'Denied',
      reason: 'ControlCapableClientRequired',
    })
  })

  it('keeps one closed Project intent vocabulary with no navigation, cancel, or removal intent', () => {
    assert.deepEqual(Object.keys(ProcessingProjectIntent.cases), [
      'AddSources',
      'RemoveSource',
      'AssignSourceRole',
      'ReplaceDraft',
      'UndoDraft',
      'RedoDraft',
      'SyncDevelopPreview',
      'RunStage',
      'UndoCurrentResult',
      'RedoCurrentResult',
      'SaveCurrentResult',
      'OpenDevelop',
    ])
  })

  it('opens Develop only from an exact saved Library Master', () => {
    const intent = decode(ProcessingProjectIntent, {
      _tag: 'OpenDevelop',
      assetId: 'master-m27',
    })
    assert.equal(intent._tag, 'OpenDevelop')

    const opened = decode(OpenedProcessingProject, {
      projectId: 'project-1',
      revision: 4,
      name: 'M27',
      authority: { _tag: 'Allowed' },
      sources: [],
      warnings: [],
      stages: [],
      developBase: {
        assetId: 'master-m27',
        assetRevision: 1,
        checksum: 'sha256:master',
        stackingAttemptId: 'stack-attempt-1',
        stackingResultId: 'stack-result-1',
      },
      savedAssetIds: ['master-m27'],
      createdAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:01:00Z',
    })
    assert.equal(opened.developBase?.assetId, 'master-m27')
  })

  it('moves Current Result and replaces only the product redo branch after a successful Run', () => {
    const first = result('result-1', 'attempt-1', 'sha256:first')
    const second = result('result-2', 'attempt-2', 'sha256:second')
    const initial = decode(ProcessingStageState, {
      stage: 'Calibration',
      draft,
      resultHistory: [first, second],
      resultCursor: 2,
    })
    const undone = moveProcessingCurrentResult(initial, 'Undo')
    assert.ok(undone)
    assert.equal(currentProcessingStageResult(undone)?.resultId, 'result-1')

    const replacement = result('result-3', 'attempt-3', 'sha256:third')
    const branched = appendProcessingStageResult(undone, replacement)
    assert.deepEqual(
      branched.resultHistory.map((entry) => entry.resultId),
      ['result-1', 'result-3'],
    )
    assert.equal(currentProcessingStageResult(branched)?.resultId, 'result-3')
  })

  it('restores the downstream Current Result with exact upstream lineage', () => {
    const upstreamOne = result('upstream-1', 'attempt-upstream-1', 'sha256:one')
    const upstreamTwo = result('upstream-2', 'attempt-upstream-2', 'sha256:two')
    const downstreamOne = result(
      'downstream-1',
      'attempt-downstream-1',
      'sha256:down-one',
      upstreamOne,
    )
    const downstreamTwo = result(
      'downstream-2',
      'attempt-downstream-2',
      'sha256:down-two',
      upstreamTwo,
    )
    const downstream = decode(ProcessingStageState, {
      stage: 'Calibration',
      draft,
      resultHistory: [downstreamOne, downstreamTwo],
      resultCursor: 2,
    })

    assert.equal(
      currentProcessingStageResult(
        restoreProcessingResultForUpstream(downstream, upstreamOne),
      )?.resultId,
      'downstream-1',
    )
  })

  it('keeps sealed attempts in evidence and out of the primary opened Project', () => {
    const attempt = {
      attemptId: 'attempt-1',
      stage: 'Develop',
      state: 'succeeded',
      draftRevision: 1,
      draft: {
        _tag: 'Develop',
        operation: { _tag: 'Stretch', method: 'asinh', amount: 0.5 },
      },
      sources: [],
      inputCheckpointId: 'checkpoint-0',
      previewId: 'preview-1',
      frozenAt: '2026-08-10T12:00:00Z',
      settledAt: '2026-08-10T12:01:00Z',
      outcome: 'Succeeded',
      outputs: [
        {
          outputId: 'output-1',
          checksum: 'sha256:output',
          relation: 'CurrentResult',
        },
        {
          outputId: 'output-stars',
          checksum: 'sha256:stars',
          relation: 'RelatedResult',
        },
      ],
      evidence: {
        _tag: 'Develop',
        previewId: 'preview-1',
        inputCheckpointId: 'checkpoint-0',
        relatedOutputIds: ['output-stars'],
      },
      diagnostics: [],
    }
    const evidence = decode(ProcessingProjectEvidence, {
      projectId: 'project-1',
      attempts: [attempt],
    })
    assert.equal(evidence.attempts.length, 1)

    const openedResult = Schema.decodeUnknownResult(OpenedProcessingProject)({
      projectId: 'project-1',
      revision: 1,
      name: 'M27',
      authority: { _tag: 'Allowed' },
      sources: [],
      warnings: [],
      stages: [],
      attempts: [attempt],
      savedAssetIds: [],
      createdAt: '2026-08-10T12:00:00Z',
      updatedAt: '2026-08-10T12:01:00Z',
    })
    assert.equal(Result.isSuccess(openedResult), true)
    if (Result.isSuccess(openedResult)) {
      assert.equal('attempts' in openedResult.success, false)
    }
  })
})
