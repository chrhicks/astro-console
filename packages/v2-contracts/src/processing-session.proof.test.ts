import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect } from 'effect'
import { LibraryAsset, StagedArtifact } from './asset-domain.js'
import { ActorContext } from './gate.js'
import { HostPressure } from './processing-pressure.js'
import {
  AppliedProcessingOperation,
  AssistantFinding,
  ProcessingImageRef,
  ProcessingSession,
  ProcessingSourceRef,
} from './processing-domain.js'
import {
  ProcessingSimulationState,
  makeProcessingServerSimulation,
  projectProcessingProjection,
  projectProcessingProjectActions,
} from './processing-server-simulation.js'
import { projectProcessingSessionSnapshot } from './snapshots.js'
import {
  AssetId,
  AssetRevision,
  AttemptId,
  CheckpointId,
  ClientId,
  EventCursor,
  FindingId,
  NonNegativeInt,
  OperationId,
  PersonId,
  PreviewId,
  ProcessingOutputId,
  ProcessingProjectId,
  ProcessingRevision,
  ProcessingSessionId,
  SnapshotVersion,
} from './primitives.js'

const owner = ActorContext.cases.Member.make({
  personId: PersonId.make('person-owner'),
  clientId: ClientId.make('client-owner'),
  role: 'owner',
  capability: 'controlCapable',
})

const source = (assetId: string, role: 'original' | 'linearMaster') =>
  ProcessingSourceRef.make({
    assetId: AssetId.make(assetId),
    assetRevision: AssetRevision.make(2),
    role,
    checksum: `sha256:${assetId}`,
    locallyAvailable: true,
  })

const baseImage = ProcessingImageRef.cases.SourceAsset.make({
  assetId: AssetId.make('linear-1'),
  checksum: 'sha256:linear-1',
})
const outputImage = (id: string) =>
  ProcessingImageRef.cases.DerivedOutput.make({
    outputId: ProcessingOutputId.make(id),
    checksum: `sha256:${id}`,
  })

const operation = (position: number) =>
  AppliedProcessingOperation.make({
    operationId: OperationId.make(`operation-${position}`),
    attemptId: AttemptId.make(`attempt-${position}`),
    operation: position === 1 ? 'stretch' : 'color',
    toolId: 'siril',
    parameters: [],
    input: position === 1 ? baseImage : outputImage('output-1'),
    output: outputImage(`output-${position}`),
    checkpointId: CheckpointId.make(`checkpoint-${position}`),
  })

const developSession = (historyLength = 0, sessionId = 'process-1') =>
  ProcessingSession.make({
    sessionId: ProcessingSessionId.make(sessionId),
    revision: ProcessingRevision.make(0),
    lifecycle: 'active',
    phase: 'develop',
    sources: [source('linear-1', 'linearMaster')],
    baseImage,
    history:
      historyLength === 0
        ? []
        : historyLength === 1
          ? [operation(1)]
          : [operation(1), operation(2)],
    historyPosition: NonNegativeInt.make(historyLength),
    assistantFindings: [],
    savedAssetIds: [],
  })

const staged = (
  assetId: string,
  outputId: string,
  format: 'fits' | 'png',
  role: 'linearMaster' | 'final' | 'preview',
) =>
  StagedArtifact.make({
    assetId: AssetId.make(assetId),
    outputId: ProcessingOutputId.make(outputId),
    role,
    format,
    checksum: `sha256:${assetId}`,
    permanentBytesReady: true,
  })

const state = (
  sessions: ReadonlyArray<ProcessingSession> = [],
): ProcessingSimulationState => ({
  sessions,
  ...(sessions[0] === undefined
    ? {}
    : { selectedSessionId: sessions[0].sessionId }),
  sourceCatalog: [
    source('raw-1', 'original'),
    source('raw-2', 'original'),
    source('linear-1', 'linearMaster'),
  ],
  pendingSaves: [],
  assets: [],
  viewedFindings: [],
  pressure: { state: 'normal' },
  snapshotVersion: SnapshotVersion.make(20),
  eventCursor: EventCursor.make(40),
  receipts: [],
  results: [],
  events: [],
  outbox: [],
})

const makeServer = (initial = state()) =>
  makeProcessingServerSimulation({
    initialState: initial,
    occurredAt: '2026-07-23T03:00:00Z',
    discardConfirmation: (sessionId) => `confirm-${sessionId}`,
  })

const envelope = (commandId: string, command: object) => ({
  commandId,
  command,
})
const sync = (
  commandId: string,
  revision: number,
  sequence: number,
  amount = 0.6,
) =>
  envelope(commandId, {
    _tag: 'SyncProcessingPreview',
    sessionId: 'process-1',
    expectedProcessingRevision: revision,
    operation: 'stretch',
    toolId: 'siril',
    parameters: [
      { key: 'amount', value: { _tag: 'NumberValue', value: amount } },
    ],
    baseHistoryPosition: 0,
    clientPreviewSequence: sequence,
  })

describe('processing session server proofs', () => {
  it('starts raws in Build and a linear master directly in Develop with immutable lineage', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const rawServer = yield* makeServer()
        const raw = yield* rawServer.execute(
          envelope('start-raw', {
            _tag: 'StartProcessingSession',
            sourceAssetIds: ['raw-1', 'raw-2'],
            idempotencyKey: 'start-raw',
          }),
          owner,
        )
        const rawSession = raw.projection.sessions[0]
        assert.equal(rawSession?.phase, 'build')
        assert.deepEqual(
          rawSession?.sources.map((item) => item.assetId),
          ['raw-1', 'raw-2'],
        )
        assert.equal(
          (yield* rawServer.readState()).outbox[0]?._tag,
          'BuildLinearMaster',
        )

        const built = yield* rawServer.completeBuild(
          rawSession?.sessionId ?? ProcessingSessionId.make('missing'),
          ProcessingOutputId.make('linear-built'),
          'sha256:linear-built',
        )
        assert.equal(built._tag, 'BuildCompleted')
        assert.equal(
          (yield* rawServer.snapshot()).sessions[0]?.phase,
          'develop',
        )

        const preparingLinear = yield* rawServer.execute(
          envelope('save-linear', {
            _tag: 'SaveProcessingArtifacts',
            sessionId: rawSession?.sessionId ?? 'missing',
            expectedProcessingRevision: 1,
            artifacts: [
              {
                outputId: 'linear-built',
                format: 'fits',
                role: 'linearMaster',
              },
            ],
            idempotencyKey: 'save-linear',
          }),
          owner,
        )
        const savedLinear = yield* rawServer.completeSave(
          preparingLinear.operationId ?? OperationId.make('missing'),
          [
            staged(
              'asset-linear-built',
              'linear-built',
              'fits',
              'linearMaster',
            ),
          ],
        )
        assert.equal(savedLinear.projection.assets[0]?.role, 'linearMaster')
        const reopened = yield* rawServer.execute(
          envelope('open-linear', {
            _tag: 'SwitchProcessingContext',
            sessionId: rawSession?.sessionId ?? 'missing',
            expectedProcessingRevision: 2,
            destination: { _tag: 'SavedAsset', assetId: 'asset-linear-built' },
            disposition: { _tag: 'LeaveUnfinished' },
            idempotencyKey: 'open-linear',
          }),
          owner,
        )
        assert.equal(
          reopened.projection.sessions.find(
            (session) =>
              session.sessionId === reopened.projection.selectedSessionId,
          )?.phase,
          'develop',
        )
        assert.equal(
          reopened.projection.sessions.find(
            (session) =>
              session.sessionId === reopened.projection.selectedSessionId,
          )?.sources[0]?.assetId,
          'asset-linear-built',
        )

        const linearServer = yield* makeServer()
        const linear = yield* linearServer.execute(
          envelope('start-linear', {
            _tag: 'StartProcessingSession',
            sourceAssetIds: ['linear-1'],
            idempotencyKey: 'start-linear',
          }),
          owner,
        )
        assert.equal(linear.projection.sessions[0]?.phase, 'develop')
        assert.equal((yield* linearServer.readState()).outbox.length, 0)
      }),
    )
  })

  it('persists debounced preview settings and ignores superseded worker completion exactly', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession()]))
        const first = yield* server.execute(
          sync('preview-old', 0, 7, 0.58),
          owner,
        )
        const second = yield* server.execute(
          sync('preview-current', 1, 8, 0.63),
          owner,
        )
        const beforeRegressive = yield* server.readState()
        const regressive = yield* server
          .execute(sync('preview-regressive', 2, 7, 0.58), owner)
          .pipe(
            Effect.as('accepted' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(regressive, 'PreviewSequenceSuperseded')
        assert.deepEqual(yield* server.readState(), beforeRegressive)
        const beforeLate = yield* server.readState()

        const late = yield* server.completePreview(
          ProcessingSessionId.make('process-1'),
          PreviewId.make('preview-preview-old'),
          ProcessingOutputId.make('late-output'),
        )
        assert.equal(late._tag, 'Rejected')
        assert.deepEqual(yield* server.readState(), beforeLate)

        const completed = yield* server.completePreview(
          ProcessingSessionId.make('process-1'),
          PreviewId.make('preview-preview-current'),
          ProcessingOutputId.make('preview-output'),
        )
        assert.equal(completed._tag, 'PreviewCompleted')
        const beforeDuplicate = yield* server.readState()
        assert.equal(
          (yield* server.completePreview(
            ProcessingSessionId.make('process-1'),
            PreviewId.make('preview-preview-current'),
            ProcessingOutputId.make('preview-output'),
          ))._tag,
          'Rejected',
        )
        assert.deepEqual(yield* server.readState(), beforeDuplicate)
        const session = (yield* server.snapshot()).sessions[0]
        assert.equal(session?.preview?.clientPreviewSequence, 8)
        assert.equal(session?.preview?.parameters[0]?.value._tag, 'NumberValue')
        assert.deepEqual(session?.baseImage, baseImage)
        assert.equal(session?.history.length, 0)
        assert.equal(
          first.projection.sessions[0]?.preview?.clientPreviewSequence,
          7,
        )
        assert.equal(
          second.projection.sessions[0]?.preview?.clientPreviewSequence,
          8,
        )
      }),
    )
  })

  it('applies only through a full-resolution attempt and replaces redo after undo', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession()]))
        yield* server.execute(sync('preview-apply', 0, 1), owner)
        yield* server.completePreview(
          ProcessingSessionId.make('process-1'),
          PreviewId.make('preview-preview-apply'),
          ProcessingOutputId.make('temporary-preview'),
        )
        const beforeApply = yield* server.readState()
        const staleApply = yield* server
          .execute(
            envelope('apply-stale', {
              _tag: 'ApplyProcessingPreview',
              sessionId: 'process-1',
              expectedProcessingRevision: 2,
              previewId: 'preview-superseded',
              idempotencyKey: 'apply-stale',
            }),
            owner,
          )
          .pipe(
            Effect.as('accepted' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(staleApply, 'PreviewInputSuperseded')
        assert.deepEqual(yield* server.readState(), beforeApply)
        const started = yield* server.execute(
          envelope('apply-1', {
            _tag: 'ApplyProcessingPreview',
            sessionId: 'process-1',
            expectedProcessingRevision: 2,
            previewId: 'preview-preview-apply',
            idempotencyKey: 'apply-1',
          }),
          owner,
        )
        assert.equal(started.projection.sessions[0]?.history.length, 0)
        assert.deepEqual(
          started.projection.sessions[0]?.baseImage,
          beforeApply.sessions[0]?.baseImage,
        )
        const attemptId =
          started.projection.sessions[0]?.activeAttempt?.attemptId ??
          AttemptId.make('missing')
        yield* server.completeApply(
          ProcessingSessionId.make('process-1'),
          attemptId,
          ProcessingOutputId.make('full-output'),
          'sha256:full-output',
          CheckpointId.make('checkpoint-full'),
        )
        assert.equal(
          (yield* server.snapshot()).sessions[0]?.history[0]?.output.outputId,
          'full-output',
        )

        const branchServer = yield* makeServer(state([developSession(2)]))
        yield* branchServer.execute(
          envelope('undo-branch', {
            _tag: 'UndoProcessingStep',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            idempotencyKey: 'undo-branch',
          }),
          owner,
        )
        yield* branchServer.execute(
          {
            ...sync('preview-alternate', 1, 1),
            command: {
              ...sync('preview-alternate', 1, 1).command,
              baseHistoryPosition: 1,
            },
          },
          owner,
        )
        yield* branchServer.completePreview(
          ProcessingSessionId.make('process-1'),
          PreviewId.make('preview-preview-alternate'),
          ProcessingOutputId.make('temporary-alternate'),
        )
        const alternate = yield* branchServer.execute(
          envelope('apply-alternate', {
            _tag: 'ApplyProcessingPreview',
            sessionId: 'process-1',
            expectedProcessingRevision: 3,
            previewId: 'preview-preview-alternate',
            idempotencyKey: 'apply-alternate',
          }),
          owner,
        )
        const alternateAttempt =
          alternate.projection.sessions[0]?.activeAttempt?.attemptId ??
          AttemptId.make('missing')
        yield* branchServer.completeApply(
          ProcessingSessionId.make('process-1'),
          alternateAttempt,
          ProcessingOutputId.make('output-alternate'),
          'sha256:output-alternate',
          CheckpointId.make('checkpoint-alternate'),
        )
        const branched = (yield* branchServer.snapshot()).sessions[0]
        assert.equal(branched?.history.length, 2)
        assert.equal(branched?.history[1]?.output.outputId, 'output-alternate')
        assert.equal(
          branched?.history.some(
            (entry) => entry.output.outputId === 'output-2',
          ),
          false,
        )
      }),
    )
  })

  it('moves linear undo/redo and serializes concurrent stale intents', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession(2)]))
        const outcomes = yield* Effect.all(
          [
            server
              .execute(
                envelope('undo-a', {
                  _tag: 'UndoProcessingStep',
                  sessionId: 'process-1',
                  expectedProcessingRevision: 0,
                  idempotencyKey: 'undo-a',
                }),
                owner,
              )
              .pipe(
                Effect.as('accepted' as const),
                Effect.catchTag(
                  'ProcessingServerSimulation.CommandRejected',
                  () => Effect.succeed('stale' as const),
                ),
              ),
            server
              .execute(
                envelope('undo-b', {
                  _tag: 'UndoProcessingStep',
                  sessionId: 'process-1',
                  expectedProcessingRevision: 0,
                  idempotencyKey: 'undo-b',
                }),
                owner,
              )
              .pipe(
                Effect.as('accepted' as const),
                Effect.catchTag(
                  'ProcessingServerSimulation.CommandRejected',
                  () => Effect.succeed('stale' as const),
                ),
              ),
          ],
          { concurrency: 'unbounded' },
        )
        assert.deepEqual([...outcomes].sort(), ['accepted', 'stale'])
        const afterUndo = yield* server.readState()
        assert.equal(afterUndo.sessions[0]?.historyPosition, 1)
        assert.equal(afterUndo.events.length, 1)
        assert.equal(afterUndo.receipts.length, 1)
        yield* server.execute(
          envelope('redo', {
            _tag: 'RedoProcessingStep',
            sessionId: 'process-1',
            expectedProcessingRevision: 1,
            idempotencyKey: 'redo',
          }),
          owner,
        )
        assert.equal((yield* server.snapshot()).sessions[0]?.historyPosition, 2)
      }),
    )
  })

  it('correlates Assistant suggestions to the current image and never applies them', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const session = ProcessingSession.make({
          ...developSession(),
          assistantFindings: [
            AssistantFinding.make({
              findingId: FindingId.make('finding-1'),
              version: 2,
              operation: 'stretch',
              toolId: 'siril',
              parameters: [
                { key: 'amount', value: { _tag: 'NumberValue', value: 0.63 } },
              ],
              input: baseImage,
            }),
          ],
        })
        const server = yield* makeServer(state([session]))
        const before = yield* server.readState()
        const stale = yield* server
          .execute(
            envelope('assistant-stale', {
              _tag: 'PreviewAssistantSuggestion',
              sessionId: 'process-1',
              expectedProcessingRevision: 0,
              findingId: 'finding-1',
              findingVersion: 1,
            }),
            owner,
          )
          .pipe(
            Effect.as('accepted' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(stale, 'AssistantFindingSuperseded')
        assert.deepEqual(yield* server.readState(), before)

        const previewed = yield* server.execute(
          envelope('assistant-current', {
            _tag: 'PreviewAssistantSuggestion',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            findingId: 'finding-1',
            findingVersion: 2,
          }),
          owner,
        )
        assert.equal(
          previewed.projection.sessions[0]?.preview?.suggestionFindingId,
          'finding-1',
        )
        assert.equal(previewed.projection.sessions[0]?.history.length, 0)

        const beforeViewed = previewed.projection.sessions[0]
        const viewed = yield* server.execute(
          envelope('finding-viewed', {
            _tag: 'MarkAssistantFindingViewed',
            sessionId: 'process-1',
            findingId: 'finding-1',
            findingVersion: 2,
          }),
          owner,
        )
        const afterViewed = viewed.projection.sessions[0]
        assert.equal(afterViewed?.revision, beforeViewed?.revision)
        assert.deepEqual(afterViewed?.baseImage, beforeViewed?.baseImage)
        assert.equal((yield* server.readState()).viewedFindings.length, 1)
      }),
    )
  })

  it('retains diagnostics and retries only the failed stage from its checkpoint', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession()]))
        yield* server.execute(sync('preview-fail', 0, 1), owner)
        yield* server.completePreview(
          ProcessingSessionId.make('process-1'),
          PreviewId.make('preview-preview-fail'),
          ProcessingOutputId.make('temporary'),
        )
        const started = yield* server.execute(
          envelope('apply-fail', {
            _tag: 'ApplyProcessingPreview',
            sessionId: 'process-1',
            expectedProcessingRevision: 2,
            previewId: 'preview-preview-fail',
            idempotencyKey: 'apply-fail',
          }),
          owner,
        )
        const attemptId =
          started.projection.sessions[0]?.activeAttempt?.attemptId ??
          AttemptId.make('missing')
        yield* server.failApply(
          ProcessingSessionId.make('process-1'),
          attemptId,
          CheckpointId.make('checkpoint-linear'),
          'diagnostic-stderr-1',
        )
        const failed = (yield* server.snapshot()).sessions[0]
        assert.equal(
          failed?.failedAttempt?.diagnosticRef,
          'diagnostic-stderr-1',
        )
        assert.deepEqual(failed?.baseImage, baseImage)

        const retry = yield* server.execute(
          envelope('retry-stretch', {
            _tag: 'RetryProcessingStep',
            sessionId: 'process-1',
            expectedProcessingRevision: 4,
            failedAttemptId: attemptId,
            checkpointId: 'checkpoint-linear',
            idempotencyKey: 'retry-stretch',
          }),
          owner,
        )
        assert.equal(
          retry.projection.sessions[0]?.activeAttempt?.retryOfAttemptId,
          attemptId,
        )
        assert.equal(retry.projection.sessions[0]?.history.length, 0)
        assert.equal(
          (yield* server.readState()).outbox.at(-1)?._tag,
          'RetryProcessingStage',
        )
      }),
    )
  })

  it('uses measured pressure and never capture activity alone', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession()]))
        const healthy = HostPressure.make({
          memoryUsedFraction: 0.4,
          storageFreeGiB: 800,
          thermalCelsius: 55,
          acquisitionWriteBacklogMiB: 40,
          captureActive: true,
        })
        assert.equal((yield* server.evaluatePressure(healthy))._tag, 'Continue')
        assert.equal((yield* server.snapshot()).pressure.state, 'normal')
        const pressured = HostPressure.make({
          memoryUsedFraction: 0.5,
          storageFreeGiB: 5,
          thermalCelsius: 60,
          acquisitionWriteBacklogMiB: 0,
          captureActive: false,
        })
        assert.equal((yield* server.evaluatePressure(pressured))._tag, 'Pause')
        assert.equal(
          (yield* server.snapshot()).pressure.reason,
          'StorageReserveProtected',
        )
        assert.equal((yield* server.evaluatePressure(healthy))._tag, 'Continue')
        assert.equal((yield* server.snapshot()).pressure.state, 'normal')
      }),
    )
  })

  it('projects each Process action with typed domain and authority eligibility', () => {
    const active = projectProcessingProjection(state([developSession(0)]))
    const actions = active.sessionActions[0]?.actions ?? []
    assert.deepEqual(
      actions.find((action) => action.action === 'SyncProcessingPreview'),
      { _tag: 'Eligible', action: 'SyncProcessingPreview' },
    )
    assert.deepEqual(
      actions.find((action) => action.action === 'ApplyProcessingPreview'),
      {
        _tag: 'Ineligible',
        action: 'ApplyProcessingPreview',
        reason: 'previewReadyRequired',
      },
    )
    const viewer = projectProcessingProjection(state([developSession(0)]), {
      role: 'viewer',
      capability: 'readOnly',
    })
    assert.equal(
      viewer.actions.every(
        (action) =>
          action._tag === 'Ineligible' && action.reason === 'ownerRequired',
      ),
      true,
    )
    assert.equal(
      viewer.sessionActions[0]?.actions.every(
        (action) =>
          action._tag === 'Ineligible' && action.reason === 'ownerRequired',
      ),
      true,
    )
    assert.deepEqual(
      viewer.actions.find(
        (action) => action.action === 'CreateProcessingProject',
      ),
      {
        _tag: 'Ineligible',
        action: 'CreateProcessingProject',
        reason: 'ownerRequired',
      },
    )
    assert.equal(
      projectProcessingProjectActions([ProcessingProjectId.make('project-1')], {
        role: 'owner',
        capability: 'readOnly',
      })[0]?.actions.every(
        (action) =>
          action._tag === 'Ineligible' && action.reason === 'readOnlyClient',
      ),
      true,
    )
  })

  it('restores one authoritative session snapshot and resumes without reconstructing history', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession(2)]))
        yield* server.execute(
          envelope('undo-refresh', {
            _tag: 'UndoProcessingStep',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            idempotencyKey: 'undo-refresh',
          }),
          owner,
        )
        const persisted = yield* server.readState()
        const unfinished = {
          ...persisted,
          sessions: persisted.sessions.map((session) =>
            ProcessingSession.make({
              ...session,
              revision: ProcessingRevision.make(session.revision + 1),
              lifecycle: 'unfinished',
            }),
          ),
        }
        const reloaded = yield* makeServer(unfinished)
        const response = yield* reloaded.execute(
          envelope('resume', {
            _tag: 'ResumeProcessingSession',
            sessionId: 'process-1',
            expectedProcessingRevision: 2,
          }),
          owner,
        )
        assert.equal(response.projection.sessions[0]?.lifecycle, 'active')
        assert.equal(response.projection.sessions[0]?.historyPosition, 1)
        assert.equal(response.projection.sessions[0]?.revision, 3)
        const restored = response.projection.sessions[0]
        if (restored === undefined)
          assert.fail('authoritative processing session missing')
        const uiSnapshot = projectProcessingSessionSnapshot(
          restored,
          response.projection.pressure,
        )
        assert.deepEqual(uiSnapshot.sourceAssetIds, ['linear-1'])
        assert.equal(uiSnapshot.currentOutputId, 'output-1')
        assert.equal(uiSnapshot.historyLength, 2)
        assert.equal(uiSnapshot.historyPosition, 1)
      }),
    )
  })

  it('saves several assets atomically, replays duplicates, and fails closed before bytes are ready', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeServer(state([developSession(2)]))
        const command = envelope('save-many', {
          _tag: 'SaveProcessingArtifacts',
          sessionId: 'process-1',
          expectedProcessingRevision: 0,
          artifacts: [
            { outputId: 'output-2', format: 'fits', role: 'final' },
            { outputId: 'output-2', format: 'png', role: 'preview' },
          ],
          idempotencyKey: 'save-many',
        })
        const preparing = yield* server.execute(command, owner)
        assert.equal(preparing.effect, 'savePreparing')
        assert.equal(preparing.projection.assets.length, 0)
        assert.deepEqual(preparing.projection.sessions[0]?.savedAssetIds, [])
        const operationId = preparing.operationId ?? OperationId.make('missing')
        const pendingReplay = yield* server.execute(command, owner)
        assert.equal(pendingReplay.replayed, true)
        assert.equal(pendingReplay.operationId, operationId)
        assert.equal((yield* server.readState()).outbox.length, 1)
        const saved = yield* server.completeSave(operationId, [
          staged('asset-final', 'output-2', 'fits', 'final'),
          staged('asset-preview', 'output-2', 'png', 'preview'),
        ])
        assert.equal(saved.projection.assets.length, 2)
        assert.deepEqual(saved.projection.sessions[0]?.savedAssetIds, [
          'asset-final',
          'asset-preview',
        ])
        assert.equal(saved.projection.sessions[0]?.lifecycle, 'active')
        const afterSave = yield* server.readState()
        assert.deepEqual(
          afterSave.events.map((event) => event.event._tag),
          ['AssetCreated', 'AssetCreated', 'ProcessingArtifactsSaved'],
        )
        assert.equal(afterSave.eventCursor, EventCursor.make(43))
        assert.equal((yield* server.execute(command, owner)).replayed, true)
        assert.deepEqual(yield* server.readState(), afterSave)

        const failedServer = yield* makeServer(state([developSession(2)]))
        const pending = yield* failedServer.execute(command, owner)
        const beforeCompletion = yield* failedServer.readState()
        const outcome = yield* failedServer
          .completeSave(pending.operationId ?? OperationId.make('missing'), [
            staged('asset-final', 'output-2', 'fits', 'final'),
          ])
          .pipe(
            Effect.as('saved' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(outcome, 'ArtifactMaterializationMismatch')
        assert.deepEqual(yield* failedServer.readState(), beforeCompletion)
        assert.equal(beforeCompletion.assets.length, 0)
        assert.equal(beforeCompletion.selectedSessionId, 'process-1')

        const collisionState = state([developSession(2)])
        const collisionServer = yield* makeServer({
          ...collisionState,
          assets: [
            LibraryAsset.make({
              assetId: AssetId.make('asset-final'),
              revision: AssetRevision.make(0),
              role: 'final',
              format: 'fits',
              checksum: 'sha256:existing',
              localAvailable: true,
              lineage: {
                comparisonGroupId: 'older-save',
                sourceAssetIds: [AssetId.make('linear-1')],
                operationIds: [],
              },
              representations: [],
            }),
          ],
        })
        const collisionPending = yield* collisionServer.execute(command, owner)
        const beforeCollision = yield* collisionServer.readState()
        const collision = yield* collisionServer
          .completeSave(
            collisionPending.operationId ?? OperationId.make('missing'),
            [
              staged('asset-final', 'output-2', 'fits', 'final'),
              staged('asset-preview', 'output-2', 'png', 'preview'),
            ],
          )
          .pipe(
            Effect.as('saved' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(collision, 'AssetIdentityConflict')
        assert.deepEqual(yield* collisionServer.readState(), beforeCollision)
      }),
    )
  })

  it('switches only after leave/save/discard disposition and tombstones before cleanup', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const destination = developSession(0, 'process-2')
        const leaveServer = yield* makeServer(
          state([developSession(2), destination]),
        )
        const left = yield* leaveServer.execute(
          envelope('switch-leave', {
            _tag: 'SwitchProcessingContext',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            destination: { _tag: 'SourceAssets', assetIds: ['raw-1', 'raw-2'] },
            disposition: { _tag: 'LeaveUnfinished' },
            idempotencyKey: 'switch-leave',
          }),
          owner,
        )
        assert.equal(
          left.projection.selectedSessionId,
          'session-switch-switch-leave',
        )
        assert.equal(
          left.projection.sessions.find(
            (session) => session.sessionId === 'process-1',
          )?.lifecycle,
          'unfinished',
        )
        assert.equal(
          left.projection.sessions.find(
            (session) => session.sessionId === 'session-switch-switch-leave',
          )?.phase,
          'build',
        )
        assert.equal(
          (yield* leaveServer.readState()).outbox.at(-1)?._tag,
          'BuildLinearMaster',
        )

        const saveServer = yield* makeServer(
          state([developSession(2), destination]),
        )
        const preparing = yield* saveServer.execute(
          envelope('switch-save', {
            _tag: 'SwitchProcessingContext',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            destination: { _tag: 'SavedAsset', assetId: 'linear-1' },
            disposition: {
              _tag: 'SaveAndSwitch',
              artifacts: [
                { outputId: 'output-2', format: 'fits', role: 'final' },
              ],
            },
            idempotencyKey: 'switch-save',
          }),
          owner,
        )
        assert.equal(preparing.projection.selectedSessionId, 'process-1')
        assert.equal(preparing.projection.assets.length, 0)
        assert.equal(
          preparing.projection.sessions.some(
            (session) => session.sessionId === 'session-switch-switch-save',
          ),
          false,
        )
        const saved = yield* saveServer.completeSave(
          preparing.operationId ?? OperationId.make('missing'),
          [staged('asset-final', 'output-2', 'fits', 'final')],
        )
        assert.equal(
          saved.projection.selectedSessionId,
          'session-switch-switch-save',
        )
        assert.equal(saved.projection.assets.length, 1)
        assert.equal(
          saved.projection.sessions.find(
            (session) => session.sessionId === 'session-switch-switch-save',
          )?.phase,
          'develop',
        )

        const discardSession = ProcessingSession.make({
          ...developSession(2),
          savedAssetIds: [AssetId.make('already-saved')],
        })
        const discardServer = yield* makeServer(
          state([discardSession, destination]),
        )
        const discarded = yield* discardServer.execute(
          envelope('switch-discard', {
            _tag: 'SwitchProcessingContext',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            destination: { _tag: 'ExistingSession', sessionId: 'process-2' },
            disposition: {
              _tag: 'DiscardAndSwitch',
              confirmationId: 'confirm-process-1',
            },
            idempotencyKey: 'switch-discard',
          }),
          owner,
        )
        const tombstone = discarded.projection.sessions.find(
          (session) => session.sessionId === 'process-1',
        )
        assert.equal(tombstone?.lifecycle, 'discarded')
        assert.deepEqual(tombstone?.savedAssetIds, ['already-saved'])
        assert.equal(tombstone?.history.length, 0)
        assert.equal(discarded.projection.selectedSessionId, 'process-2')
        const cleanup = (yield* discardServer.readState()).outbox.at(-1)
        assert.equal(cleanup?._tag, 'CleanupDiscardedSession')
        if (cleanup?._tag === 'CleanupDiscardedSession')
          assert.deepEqual(cleanup.protectedAssetIds, ['already-saved'])

        const failedServer = yield* makeServer(
          state([developSession(2), destination]),
        )
        const before = yield* failedServer.readState()
        const failed = yield* failedServer
          .execute(
            envelope('switch-bad-discard', {
              _tag: 'SwitchProcessingContext',
              sessionId: 'process-1',
              expectedProcessingRevision: 0,
              destination: { _tag: 'ExistingSession', sessionId: 'process-2' },
              disposition: {
                _tag: 'DiscardAndSwitch',
                confirmationId: 'wrong',
              },
              idempotencyKey: 'switch-bad-discard',
            }),
            owner,
          )
          .pipe(
            Effect.as('switched' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(failed, 'DiscardConfirmationMismatch')
        assert.deepEqual(yield* failedServer.readState(), before)

        const missingServer = yield* makeServer(state([developSession(2)]))
        const beforeMissing = yield* missingServer.readState()
        const missing = yield* missingServer
          .execute(
            envelope('switch-missing', {
              _tag: 'SwitchProcessingContext',
              sessionId: 'process-1',
              expectedProcessingRevision: 0,
              destination: {
                _tag: 'SourceAssets',
                assetIds: ['missing-source'],
              },
              disposition: { _tag: 'LeaveUnfinished' },
              idempotencyKey: 'switch-missing',
            }),
            owner,
          )
          .pipe(
            Effect.as('switched' as const),
            Effect.catchTag(
              'ProcessingServerSimulation.TransitionRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(missing, 'DestinationUnavailable')
        assert.deepEqual(yield* missingServer.readState(), beforeMissing)

        const directServer = yield* makeServer(state([discardSession]))
        const direct = yield* directServer.execute(
          envelope('discard-direct', {
            _tag: 'DiscardProcessingSession',
            sessionId: 'process-1',
            expectedProcessingRevision: 0,
            confirmationId: 'confirm-process-1',
            idempotencyKey: 'discard-direct',
          }),
          owner,
        )
        assert.equal(direct.projection.sessions[0]?.lifecycle, 'discarded')
        assert.deepEqual(direct.projection.sessions[0]?.savedAssetIds, [
          'already-saved',
        ])
        assert.equal(
          (yield* directServer.readState()).outbox.at(-1)?._tag,
          'CleanupDiscardedSession',
        )
      }),
    )
  })
})
