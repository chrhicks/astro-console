import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, Ref } from 'effect'
import { DeliveryRepresentation, LibraryAsset } from './asset-domain.js'
import {
  makeAssetServerSimulation,
  makeProcessingOpenAuthority,
} from './asset-server-simulation.js'
import { ActorContext } from './gate.js'
import { ProcessingSession, ProcessingSourceRef } from './processing-domain.js'
import {
  ProcessingSimulationState,
  makeProcessingServerSimulation,
} from './processing-server-simulation.js'
import {
  AssetId,
  AssetRevision,
  ClientId,
  EventCursor,
  NonNegativeInt,
  OperationId,
  PersonId,
  ProcessingOutputId,
  ProcessingRevision,
  ProcessingSessionId,
  RepresentationId,
  SnapshotVersion,
} from './primitives.js'

const owner = ActorContext.cases.Member.make({
  personId: PersonId.make('owner'),
  clientId: ClientId.make('owner-desktop'),
  role: 'owner',
  capability: 'controlCapable',
})

const viewer = ActorContext.cases.Member.make({
  personId: PersonId.make('friend'),
  clientId: ClientId.make('friend-phone'),
  role: 'viewer',
  capability: 'readOnly',
})

const original = LibraryAsset.make({
  assetId: AssetId.make('raw-m27'),
  revision: AssetRevision.make(2),
  role: 'original',
  format: 'cameraRaw',
  checksum: 'sha256:raw-m27',
  localAvailable: true,
  lineage: {
    comparisonGroupId: 'm27',
    sourceAssetIds: [AssetId.make('raw-m27')],
    operationIds: [],
  },
  representations: [],
})

const initialState = {
  assets: [original],
  snapshotVersion: SnapshotVersion.make(10),
  eventCursor: EventCursor.make(20),
  receipts: [],
  results: [],
  republicationResults: [],
  events: [],
  outbox: [],
}

const source = (assetId: string, role: 'original' | 'linearMaster') =>
  ProcessingSourceRef.make({
    assetId: AssetId.make(assetId),
    assetRevision: AssetRevision.make(2),
    role,
    checksum: `sha256:${assetId}`,
    locallyAvailable: true,
  })

const processingState = (
  sessions: ReadonlyArray<ProcessingSession> = [],
): ProcessingSimulationState => ({
  sessions,
  sourceCatalog: [source('raw-m27', 'original')],
  pendingSaves: [],
  assets: [],
  viewedFindings: [],
  pressure: { state: 'normal' },
  snapshotVersion: SnapshotVersion.make(30),
  eventCursor: EventCursor.make(50),
  receipts: [],
  results: [],
  events: [],
  outbox: [],
})

const makeProcessingServer = (state = processingState()) =>
  makeProcessingServerSimulation({
    initialState: state,
    occurredAt: '2026-07-23T02:00:00Z',
    discardConfirmation: (sessionId) => `confirm-${sessionId}`,
  })

const request = (commandId: string, idempotencyKey: string) => ({
  commandId,
  command: {
    _tag: 'RequestAssetDownload',
    assetId: 'raw-m27',
    idempotencyKey,
  },
})

describe('asset delivery server proof', () => {
  it('routes the same local original by trusted access path', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const lanServer = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const lan = yield* lanServer.requestDownload(
          request('download-lan', 'download-lan'),
          viewer,
          'lan',
          100,
        )
        assert.equal(lan._tag, 'StreamLocal')
        const lanState = yield* lanServer.readState()
        assert.equal(lanState.outbox.length, 0)

        const remoteServer = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const remote = yield* remoteServer.requestDownload(
          request('download-remote', 'download-remote'),
          viewer,
          'remote',
          100,
        )
        assert.equal(remote._tag, 'Preparing')
        const remoteState = yield* remoteServer.readState()
        assert.equal(remoteState.outbox.length, 1)
        assert.equal(remoteState.assets[0]?.assetId, original.assetId)
        assert.equal(remoteState.assets[0]?.revision, AssetRevision.make(3))
      }),
    )
  })

  it('commits staging identity, audit event, result, receipt, and outbox before upload', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const uploads = yield* Ref.make(0)

        yield* server.requestDownload(
          request('download-remote', 'download-remote'),
          viewer,
          'remote',
          100,
        )
        const committed = yield* server.readState()
        assert.equal(committed.receipts.length, 1)
        assert.equal(committed.results.length, 1)
        assert.equal(committed.events.length, 1)
        assert.equal(committed.outbox.length, 1)
        assert.equal(yield* Ref.get(uploads), 0)

        yield* server.dispatchOutbox(() =>
          Ref.update(uploads, (count) => count + 1),
        )
        assert.equal(yield* Ref.get(uploads), 1)
      }),
    )
  })

  it('accepts only correlated verified publication evidence before granting remote delivery', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const preparing = yield* server.requestDownload(
          request('prepare-1', 'prepare-key'),
          viewer,
          'remote',
          100,
        )
        assert.equal(preparing._tag, 'Preparing')
        if (preparing._tag !== 'Preparing') return
        const beforeBadEvidence = yield* server.readState()
        const mismatch = yield* server
          .completePublication(
            {
              assetId: 'raw-m27',
              operationId: preparing.operationId,
              checksum: 'sha256:wrong',
              expiresAtEpochMs: 500,
            },
            100,
          )
          .pipe(
            Effect.as('published' as const),
            Effect.catchTag('AssetServerSimulation.WorkerRejected', () =>
              Effect.succeed('rejected' as const),
            ),
          )
        assert.equal(mismatch, 'rejected')
        assert.deepEqual(yield* server.readState(), beforeBadEvidence)

        yield* server.completePublication(
          {
            assetId: 'raw-m27',
            operationId: preparing.operationId,
            checksum: 'sha256:raw-m27',
            expiresAtEpochMs: 500,
          },
          100,
        )
        const granted = yield* server.requestDownload(
          request('grant-after-stage', 'grant-after-stage'),
          viewer,
          'remote',
          200,
        )
        assert.equal(granted._tag, 'PublishedRepresentationEligible')
        const state = yield* server.readState()
        assert.equal(state.assets[0]?.revision, AssetRevision.make(4))
        assert.equal(state.events.length, 3)
      }),
    )
  })

  it('replays a duplicate without staging or auditing twice', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const accepted = yield* server.requestDownload(
          request('download-1', 'same-download'),
          owner,
          'remote',
          100,
        )
        const replayed = yield* server.requestDownload(
          request('download-2', 'same-download'),
          owner,
          'remote',
          100,
        )
        const state = yield* server.readState()

        assert.equal(accepted._tag, 'Preparing')
        assert.equal(replayed._tag, 'Preparing')
        assert.equal(replayed.replayed, true)
        assert.equal(state.receipts.length, 1)
        assert.equal(state.events.length, 1)
        assert.equal(state.outbox.length, 1)
      }),
    )
  })

  it('rejects idempotency reuse from another network path without changing state', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        yield* server.requestDownload(
          request('download-remote', 'same-path-bound-key'),
          owner,
          'remote',
          100,
        )
        const before = yield* server.readState()
        const outcome = yield* server
          .requestDownload(
            request('download-lan', 'same-path-bound-key'),
            owner,
            'lan',
            100,
          )
          .pipe(
            Effect.as('accepted' as const),
            Effect.catchTag('AssetServerSimulation.CommandRejected', () =>
              Effect.succeed('rejected' as const),
            ),
          )
        assert.equal(outcome, 'rejected')
        assert.deepEqual(yield* server.readState(), before)
      }),
    )
  })

  it('rechecks current representation validity instead of replaying stale delivery authority', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const published = LibraryAsset.make({
          ...original,
          representations: [
            DeliveryRepresentation.cases.Published.make({
              representationId: RepresentationId.make('published-raw'),
              format: 'cameraRaw',
              expiresAtEpochMs: NonNegativeInt.make(200),
            }),
          ],
        })
        const server = yield* makeAssetServerSimulation(
          { ...initialState, assets: [published] },
          '2026-07-23T02:00:00Z',
        )
        const accepted = yield* server.requestDownload(
          request('grant-1', 'grant-replay'),
          viewer,
          'remote',
          100,
        )
        assert.equal(accepted._tag, 'PublishedRepresentationEligible')
        const before = yield* server.readState()

        const replay = yield* server
          .requestDownload(
            request('grant-2', 'grant-replay'),
            viewer,
            'remote',
            201,
          )
          .pipe(
            Effect.as('granted' as const),
            Effect.catchTag('AssetServerSimulation.DownloadRejected', () =>
              Effect.succeed('expired' as const),
            ),
          )
        assert.equal(replay, 'expired')
        assert.deepEqual(yield* server.readState(), before)
      }),
    )
  })

  it('atomically starts republication under the same stable asset identity', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const expired = LibraryAsset.make({
          ...original,
          representations: [
            DeliveryRepresentation.cases.Expired.make({
              representationId: RepresentationId.make('expired-final'),
              format: 'cameraRaw',
              expiredAtEpochMs: NonNegativeInt.make(100),
            }),
          ],
        })
        const server = yield* makeAssetServerSimulation(
          { ...initialState, assets: [expired] },
          '2026-07-23T02:00:00Z',
        )
        const command = {
          commandId: 'republish-1',
          command: {
            _tag: 'RepublishAssetRepresentation',
            assetId: 'raw-m27',
            expectedAssetRevision: 2,
            representationId: 'expired-final',
            sourceChecksum: 'sha256:raw-m27',
            idempotencyKey: 'republish-key',
          },
        }
        const response = yield* server.republish(command, owner, 101)
        const state = yield* server.readState()

        assert.equal(response.assetId, original.assetId)
        assert.equal(state.assets[0]?.assetId, original.assetId)
        assert.equal(state.assets[0]?.revision, AssetRevision.make(3))
        assert.equal(state.events.length, 1)
        assert.equal(state.outbox[0]?._tag, 'RepublishRepresentation')

        const replay = yield* server.republish(
          { ...command, commandId: 'republish-2' },
          owner,
          101,
        )
        assert.equal(replay.replayed, true)
        assert.equal((yield* server.readState()).outbox.length, 1)
      }),
    )
  })

  it('reuses equivalent staging across distinct requests and replaces an explicit expired representation', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const first = yield* server.requestDownload(
          request('stage-a', 'stage-key-a'),
          viewer,
          'remote',
          100,
        )
        const second = yield* server.requestDownload(
          request('stage-b', 'stage-key-b'),
          viewer,
          'remote',
          100,
        )
        assert.equal(first._tag, 'Preparing')
        assert.equal(second._tag, 'Preparing')
        if (first._tag !== 'Preparing' || second._tag !== 'Preparing') return
        assert.equal(second.operationId, first.operationId)
        const reused = yield* server.readState()
        assert.equal(reused.assets[0]?.representations.length, 1)
        assert.equal(reused.outbox.length, 1)
        assert.equal(reused.receipts.length, 2)

        const expired = LibraryAsset.make({
          ...original,
          representations: [
            DeliveryRepresentation.cases.Expired.make({
              representationId: RepresentationId.make('expired-stage'),
              format: 'cameraRaw',
              expiredAtEpochMs: NonNegativeInt.make(99),
            }),
          ],
        })
        const replacementServer = yield* makeAssetServerSimulation(
          { ...initialState, assets: [expired] },
          '2026-07-23T02:00:00Z',
        )
        const replacement = yield* replacementServer.requestDownload(
          {
            commandId: 'replace-expired',
            command: {
              _tag: 'RequestAssetDownload',
              assetId: 'raw-m27',
              representationId: 'expired-stage',
              idempotencyKey: 'replace-expired',
            },
          },
          viewer,
          'remote',
          100,
        )
        assert.equal(replacement._tag, 'Preparing')
        const replaced = yield* replacementServer.readState()
        assert.equal(replaced.assets[0]?.representations.length, 1)
        assert.equal(
          replaced.assets[0]?.representations[0]?.representationId,
          'expired-stage',
        )
        assert.equal(replaced.assets[0]?.representations[0]?._tag, 'Preparing')
      }),
    )
  })

  it('makes worker completion and failure idempotent while rejecting untrusted expiry claims', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const preparing = yield* server.requestDownload(
          request('stage-complete', 'stage-complete'),
          viewer,
          'remote',
          100,
        )
        assert.equal(preparing._tag, 'Preparing')
        if (preparing._tag !== 'Preparing') return
        const staleExpiry = yield* server
          .completePublication(
            {
              assetId: 'raw-m27',
              operationId: preparing.operationId,
              checksum: original.checksum,
              expiresAtEpochMs: 100,
            },
            100,
          )
          .pipe(
            Effect.as('accepted' as const),
            Effect.catchTag(
              'AssetServerSimulation.WorkerRejected',
              ({ reason }) => Effect.succeed(reason),
            ),
          )
        assert.equal(staleExpiry, 'InvalidPublicationExpiry')
        const beforeCompletion = yield* server.readState()
        yield* server.completePublication(
          {
            assetId: 'raw-m27',
            operationId: preparing.operationId,
            checksum: original.checksum,
            expiresAtEpochMs: 500,
          },
          100,
        )
        const once = yield* server.readState()
        yield* server.completePublication(
          {
            assetId: 'raw-m27',
            operationId: preparing.operationId,
            checksum: original.checksum,
            expiresAtEpochMs: 500,
          },
          100,
        )
        assert.deepEqual(yield* server.readState(), once)
        assert.equal(once.events.length, beforeCompletion.events.length + 1)

        const failureServer = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
        )
        const failing = yield* failureServer.requestDownload(
          request('stage-fail', 'stage-fail'),
          viewer,
          'remote',
          100,
        )
        assert.equal(failing._tag, 'Preparing')
        if (failing._tag !== 'Preparing') return
        const evidence = {
          assetId: 'raw-m27',
          operationId: failing.operationId,
          checksum: original.checksum,
          diagnosticRef: 'diagnostic:upload-failed',
        }
        yield* failureServer.failPublication(evidence)
        const failedOnce = yield* failureServer.readState()
        yield* failureServer.failPublication(evidence)
        assert.deepEqual(yield* failureServer.readState(), failedOnce)
        assert.equal(failedOnce.assets[0]?.representations[0]?._tag, 'Failed')
        assert.equal(
          failedOnce.events.at(-1)?.event._tag,
          'AssetPublicationFailed',
        )
      }),
    )
  })

  it('durably expires and reuses republication before completing under the stable asset identity', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
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
        const server = yield* makeAssetServerSimulation(
          { ...initialState, assets: [published] },
          '2026-07-23T02:00:00Z',
        )
        const expired = yield* server.expireRepresentation(
          original.assetId,
          RepresentationId.make('r2-final'),
          101,
        )
        assert.equal(expired.assetId, original.assetId)
        assert.equal(expired.representations[0]?._tag, 'Expired')
        const expiredState = yield* server.readState()
        assert.equal(
          expiredState.events.at(-1)?.event._tag,
          'AssetRepresentationExpired',
        )

        const republish = (
          commandId: string,
          revision: number,
          key: string,
        ) => ({
          commandId,
          command: {
            _tag: 'RepublishAssetRepresentation',
            assetId: 'raw-m27',
            expectedAssetRevision: revision,
            representationId: 'r2-final',
            sourceChecksum: original.checksum,
            idempotencyKey: key,
          },
        })
        const first = yield* server.republish(
          republish('republish-a', 3, 'republish-a'),
          owner,
          101,
        )
        const second = yield* server.republish(
          republish('republish-b', 4, 'republish-b'),
          owner,
          101,
        )
        assert.equal(second.operationId, first.operationId)
        const preparing = yield* server.readState()
        assert.equal(preparing.outbox.length, 1)
        assert.equal(
          preparing.events.filter(
            (event) => event.event._tag === 'AssetRepublicationStarted',
          ).length,
          1,
        )
        yield* server.completePublication(
          {
            assetId: 'raw-m27',
            operationId: first.operationId,
            checksum: original.checksum,
            expiresAtEpochMs: 1_000,
          },
          101,
        )
        const completed = yield* server.readState()
        assert.equal(completed.assets[0]?.assetId, original.assetId)
        assert.equal(completed.assets[0]?.representations[0]?._tag, 'Published')
      }),
    )
  })

  it('projects and compares exact Library lineage through an authorized query without mutation', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const final = LibraryAsset.make({
          ...original,
          assetId: AssetId.make('m27-final'),
          role: 'final',
          format: 'fits',
          checksum: 'sha256:m27-final',
          lineage: {
            comparisonGroupId: 'm27',
            sourceAssetIds: [AssetId.make('raw-m27')],
            processingSessionId: ProcessingSessionId.make('process-m27'),
            processingOutputId: ProcessingOutputId.make('output-final'),
            operationIds: [OperationId.make('operation-stretch')],
          },
        })
        const preview = LibraryAsset.make({
          ...final,
          assetId: AssetId.make('m27-preview'),
          role: 'preview',
          format: 'png',
          checksum: 'sha256:m27-preview',
          lineage: {
            ...final.lineage,
            processingOutputId: ProcessingOutputId.make('output-preview'),
          },
        })
        const state = { ...initialState, assets: [final, preview] }
        const server = yield* makeAssetServerSimulation(
          state,
          '2026-07-23T02:00:00Z',
        )
        const before = yield* server.readState()
        const snapshots = yield* server.librarySnapshot(viewer, 100, 50)
        const comparison = yield* server.compareAssets(
          [final.assetId, preview.assetId],
          viewer,
        )
        assert.equal(snapshots[0]?.processingSessionId, 'process-m27')
        assert.equal(snapshots[0]?.processingOutputId, 'output-final')
        assert.deepEqual(comparison.entries[0]?.operationIds, [
          'operation-stretch',
        ])
        assert.equal(
          comparison.entries[1]?.processingOutputId,
          'output-preview',
        )
        assert.deepEqual(yield* server.readState(), before)
      }),
    )
  })

  it('opens stable Library identity through the authoritative Processing service for Start and Resume', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const processing = yield* makeProcessingServer()
        const server = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
          makeProcessingOpenAuthority(processing),
        )
        const open = {
          commandId: 'open-raw',
          command: { _tag: 'OpenAssetInProcess', assetId: 'raw-m27' },
        }
        const started = yield* server.openInProcess(open, owner)
        assert.equal(started._tag, 'Started')
        assert.equal(started.phase, 'build')
        const startedAgain = yield* server.openInProcess(open, owner)
        assert.equal(startedAgain.sessionId, started.sessionId)
        const processAfterStart = yield* processing.readState()
        assert.equal(processAfterStart.sessions.length, 1)
        assert.equal(
          processAfterStart.sessions[0]?.sources[0]?.assetId,
          original.assetId,
        )

        const unfinished = ProcessingSession.make({
          ...(processAfterStart.sessions[0] ??
            ProcessingSession.make({
              sessionId: ProcessingSessionId.make('missing'),
              revision: ProcessingRevision.make(0),
              lifecycle: 'active',
              phase: 'build',
              sources: [source('raw-m27', 'original')],
              history: [],
              historyPosition: NonNegativeInt.make(0),
              assistantFindings: [],
              savedAssetIds: [],
            })),
          lifecycle: 'unfinished',
        })
        const resumeProcessing = yield* makeProcessingServer(
          processingState([unfinished]),
        )
        const resumeServer = yield* makeAssetServerSimulation(
          initialState,
          '2026-07-23T02:00:00Z',
          makeProcessingOpenAuthority(resumeProcessing),
        )
        const resumed = yield* resumeServer.openInProcess(
          {
            commandId: 'resume-raw',
            command: {
              _tag: 'OpenAssetInProcess',
              assetId: 'raw-m27',
              unfinishedSessionId: unfinished.sessionId,
            },
          },
          owner,
        )
        assert.equal(resumed._tag, 'Resumed')
        assert.equal(resumed.sessionId, unfinished.sessionId)

        const savedLinear = LibraryAsset.make({
          ...original,
          assetId: AssetId.make('linear-saved'),
          revision: AssetRevision.make(0),
          role: 'linearMaster',
          format: 'fits',
          checksum: 'sha256:linear-saved',
        })
        const savedProcessingState = processingState()
        const savedProcessing = yield* makeProcessingServer({
          ...savedProcessingState,
          assets: [savedLinear],
        })
        const savedServer = yield* makeAssetServerSimulation(
          { ...initialState, assets: [savedLinear] },
          '2026-07-23T02:00:00Z',
          makeProcessingOpenAuthority(savedProcessing),
        )
        const openedSaved = yield* savedServer.openInProcess(
          {
            commandId: 'open-saved-linear',
            command: {
              _tag: 'OpenAssetInProcess',
              assetId: savedLinear.assetId,
            },
          },
          owner,
        )
        assert.equal(openedSaved._tag, 'Started')
        assert.equal(openedSaved.phase, 'develop')
        assert.equal(
          (yield* savedProcessing.readState()).sessions[0]?.sources[0]?.assetId,
          savedLinear.assetId,
        )

        const rejected = yield* resumeServer.openInProcess(open, viewer).pipe(
          Effect.as('accepted' as const),
          Effect.catchTag('AssetServerSimulation.CommandRejected', () =>
            Effect.succeed('rejected' as const),
          ),
        )
        assert.equal(rejected, 'rejected')
      }),
    )
  })
})
