import { Effect, Exit, Match, Schema, Scope } from 'effect'
import type { ServerResponse } from 'node:http'
import {
  BootstrapHttpSuccessEnvelope,
  CommandHttpFailureEnvelope,
  RefreshPreflightResponse,
} from '@astro-console/v2-contracts'
import {
  executeProcessCommand,
  processSnapshot,
} from '../services/process-workspace.ts'
import {
  cleanupProcessOrphans,
  saveProcessOutputs,
  type ProcessSaveStorage,
} from '../services/process-save.ts'
import {
  materializeCapturedFrame,
  type CapturedFrameStorage,
} from '../services/captured-frame-intake.ts'
import {
  inspectCapturedFrame,
  type FrameInspectionStorage,
} from '../services/frame-inspection.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import { configuredDownloadGrantIssuer } from '../config/download-grant-config.ts'
import {
  originServerConfig,
  type OriginServerConfig,
} from '../config/environment-config.ts'
import { runExecutable } from './executable.ts'
import { OriginListener, originListenerLayer } from '../http/origin-listener.ts'
import { WebHost, webHostLayer } from '../http/web-host.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import type { LocalIdentity, RequestAdmission } from '../auth/identity.ts'
import {
  createJwksKeyResolver,
  createLocalFixtureAdmission,
  createMembershipBootstrapResolver,
  createProductionAccessAdmission,
} from '../auth/access-admission.ts'

import { type Evidence } from '../services/domain-state.ts'
import {
  ProjectionPublication,
  projectionPublicationLayer,
} from '../services/projection-publication.ts'
import { controlCommandFromEnvelope } from '../persistence/control-sqlite-repository.ts'
import { installPublishedLibraryFixture } from '../persistence/library-sqlite-repository.ts'
import { createOriginRouter } from '../http/origin-router.ts'
import {
  initializeRuntimeState,
  installM27Fixture,
} from '../services/runtime-bootstrap.ts'
import {
  StateSqliteRepository,
  stateSqliteRepositoryLayer,
  type StateSqliteRepositoryShape,
} from '../persistence/state-sqlite-repository.ts'
import {
  RunSqliteRepository,
  runSqliteRepositoryLayer,
  type RunSqliteRepositoryShape,
} from '../persistence/run-sqlite-repository.ts'
import {
  bootstrapPlanWorkspaceProjection,
  observeWorkspaceProjection,
} from '../services/workspace-projection-service.ts'
import { AdapterObservation, isOwner, reject } from '../http/origin-handlers.ts'
import { BodyTooLarge, body } from '../http/request-body.ts'
import { json, responseHeaders, unauthenticated } from '../http/response.ts'
import {
  commandFailureStatuses,
  observeCommandFromRequest,
  observeInvalidResponse,
  observeServiceResponse,
  planCommandFromRequest,
  planInvalidResponse,
  planServiceResponse,
} from '../http/command-handlers.ts'
import {
  downloadAsset,
  createLibraryPreviewHandler,
  libraryDetail,
  libraryReview,
  libraryPage,
  observeLiveFrameReview,
  processWorkspace,
  workspace,
} from '../http/library-handlers.ts'
import {
  ReadOnlyPreflightProvider,
  preflightPersistenceLayer,
  refreshPreflight,
  type ReadOnlyPreflightProviderShape,
} from '../services/preflight-service.ts'
import { alpacaPreflightProvider } from '../providers/alpaca-preflight-provider.ts'
import { alpacaCameraProvider } from '../providers/alpaca-camera-provider.ts'
import {
  CameraProvider,
  executeCameraCommand,
  type CameraProviderShape,
} from '../services/camera-command-service.ts'
import {
  acquireSqliteRepository,
  polarSession,
  targetAcquisitionSession,
} from '../persistence/acquire-sqlite-repository.ts'
import {
  AcquirePersistence,
  executePolarCommand,
  PolarMeasurementProvider,
  type PolarCommandResult,
  type PolarMeasurementProviderShape,
} from '../services/polar-service.ts'
import {
  executeTargetAcquisitionCommand,
  TargetAcquisitionProvider,
  type TargetAcquisitionCommandResult,
  type TargetAcquisitionProviderShape,
} from '../services/target-acquisition-service.ts'
import {
  AcquireCommandRequest,
  AcquireCommandResponse,
  AcquireIntent,
  CameraCommandRequest,
  CameraCommandResponse,
  PreflightSnapshot,
  AssetId,
  AttemptId,
  RecoverySeriesId,
  recordCorrectionAcknowledgement,
  recordManagedCapture,
  recordLiveFrameEvidence,
  recordSolveCompletion,
} from '@astro-console/v2-contracts'
export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}
export function createLocalWebService(
  databasePath = ':memory:',
  identityResolver: RequestAdmission = createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
  }),
  processSaveStorage?: ProcessSaveStorage,
  downloadGrants?: DownloadGrantConfig,
  options: {
    readonly fixture?:
      | 'm27'
      | 'preflight'
      | 'plan-draft'
      | 'library-published'
      | 'polar'
      | 'target-deep-sky'
      | 'target-lunar'
      | 'target-correction'
      | 'target-verification'
      | 'live-frame'
      | 'live-frame-library'
      | 'managed-capture'
      | 'acquire-recovery'
    readonly webDistPath?: string
    readonly previewRoot?: string
    readonly preflightProvider?: ReadOnlyPreflightProviderShape
    readonly cameraProvider?: CameraProviderShape
    readonly polarMeasurementProvider?: PolarMeasurementProviderShape
    readonly targetAcquisitionProvider?: TargetAcquisitionProviderShape
    readonly capturedFrameStorage?: CapturedFrameStorage
    readonly frameInspectionStorage?: FrameInspectionStorage
  } = {},
) {
  const database = openOriginDatabase(databasePath)
  if (options.fixture !== undefined) {
    installM27Fixture(
      database,
      options.fixture === 'plan-draft'
        ? false
        : options.fixture === 'preflight'
          ? 'fake'
          : 'fixture',
    )
    if (options.fixture === 'library-published')
      installPublishedLibraryFixture(database)
  } else initializeRuntimeState(database)
  const acquireRepository = acquireSqliteRepository(database)
  const stateRepository: StateSqliteRepositoryShape = Effect.runSync(
    StateSqliteRepository.pipe(
      Effect.provide(
        stateSqliteRepositoryLayer(database, {
          plan: bootstrapPlanWorkspaceProjection,
          observe: observeWorkspaceProjection,
        }),
      ),
    ),
  )
  const runRepository: RunSqliteRepositoryShape = Effect.runSync(
    RunSqliteRepository.pipe(
      Effect.provide(
        runSqliteRepositoryLayer(database, stateRepository, reject),
      ),
    ),
  )
  if (options.fixture === 'polar') {
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
    options.fixture === 'target-deep-sky' ||
    options.fixture === 'target-lunar' ||
    options.fixture === 'target-correction' ||
    options.fixture === 'target-verification' ||
    options.fixture === 'live-frame' ||
    options.fixture === 'live-frame-library' ||
    options.fixture === 'managed-capture' ||
    options.fixture === 'acquire-recovery'
  ) {
    const acquisitionMethod =
      options.fixture === 'target-lunar' ? 'lunarDiskLimb' : 'deepSkyPlateSolve'
    const run = {
      id: `run-${acquisitionMethod}-fixture`,
      revision: 1,
      phase:
        options.fixture === 'live-frame' ||
        options.fixture === 'live-frame-library' ||
        options.fixture === 'managed-capture' ||
        options.fixture === 'acquire-recovery'
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
      options.fixture === 'target-correction' ||
      options.fixture === 'target-verification' ||
      options.fixture === 'live-frame' ||
      options.fixture === 'live-frame-library' ||
      options.fixture === 'managed-capture'
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
              options.fixture === 'live-frame' ||
              options.fixture === 'live-frame-library' ||
              options.fixture === 'managed-capture'
                ? 0
                : options.fixture === 'target-verification'
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
        options.fixture === 'target-verification'
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
        options.fixture === 'live-frame-library'
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
        options.fixture === 'managed-capture'
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
      if (options.fixture === 'live-frame-library')
        installCurrentLibraryFrameFixture(database)
    } else if (options.fixture === 'acquire-recovery') {
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
  const webHost = Effect.runSync(
    WebHost.pipe(
      Effect.provide(webHostLayer(options.webDistPath ?? '../web/dist')),
    ),
  )
  const originListener = Effect.runSync(
    OriginListener.pipe(Effect.provide(originListenerLayer)),
  )
  const projectionPublication = Effect.runSync(
    ProjectionPublication.pipe(
      Effect.provide(
        projectionPublicationLayer({
          expire: () => stateRepository.expireReconnectGrace(),
          currentCursor: () => stateRepository.state().eventCursor,
          eventFor: (identity) => stateRepository.sseProjection(identity),
          controllerConnected: (identity) =>
            stateRepository.controllerConnected(identity),
          controllerDisconnected: (identity) =>
            stateRepository.controllerDisconnected(identity),
          responseHeaders,
        }),
      ),
    ),
  )
  const libraryPreview = createLibraryPreviewHandler(
    options.frameInspectionStorage?.previewsRoot ??
      options.previewRoot ??
      './.astro-server/previews',
  )
  let closed = false
  const publish = (type: string, cursor: number) =>
    Effect.runSync(projectionPublication.publish(type, cursor))
  const targetAcquisitionProvider =
    options.targetAcquisitionProvider ??
    (options.fixture === 'target-deep-sky' ||
    options.fixture === 'target-lunar' ||
    options.fixture === 'live-frame' ||
    options.fixture === 'live-frame-library' ||
    options.fixture === 'managed-capture'
      ? deterministicTargetAcquisitionProvider
      : undefined)
  const polarMeasurementProvider =
    options.polarMeasurementProvider ??
    (options.fixture === 'polar'
      ? deterministicPolarMeasurementProvider
      : undefined)
  const cameraProvider = options.cameraProvider

  const handler = (requestAdmission: RequestAdmission = identityResolver) =>
    createOriginRouter({
      identityResolver: requestAdmission,
      expireReconnectGrace: () => stateRepository.expireReconnectGrace(),
      live: (response) => json(response, 200, { status: 'alive' }),
      unauthenticated,
      snapshot: (response, identity) =>
        void Effect.runSync(
          stateRepository.bootstrapSnapshot(identity).pipe(
            Effect.flatMap((data) =>
              Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope)({
                ok: true,
                data,
              }),
            ),
            Effect.map((body) => json(response, 200, body)),
          ),
        ),
      ready: (response) => json(response, 200, stateRepository.readiness()),
      operations: (response, identity) =>
        isOwner(identity)
          ? json(response, 200, stateRepository.operations())
          : json(response, 403, reject('OwnerRequired').body),
      events: (request, response, identity) =>
        void Effect.runSync(
          projectionPublication.stream(request, response, identity),
        ),
      control: (response, identity, request) =>
        Effect.runPromise(
          controlCommandFromEnvelope(
            body(request),
            BodyTooLarge,
            database,
            stateRepository,
            identity,
            publish,
          ).pipe(
            Effect.catchTags({
              'Server.CommandInputInvalid': () =>
                Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
                  ok: false,
                  failure: {
                    _tag: 'InvalidInput',
                    summary: 'The service could not read that action.',
                  },
                }).pipe(Effect.map((body) => ({ status: 400, body }))),
              'Server.CommandRejected': ({ failure }) =>
                Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
                  ok: false,
                  failure: { _tag: 'CommandRejected', failure },
                }).pipe(
                  Effect.map((body) => ({
                    status: commandFailureStatuses[failure._tag],
                    body,
                  })),
                ),
            }),
          ),
        ).then(({ status, body }) => json(response, status, body)),
      planWorkspace: (response) => workspace(response, database, 'plan'),
      processWorkspace: (response, url) =>
        url.searchParams.has('sourceAssetId')
          ? processWorkspace(
              response,
              database,
              url,
              () => stateRepository.state().snapshotVersion,
            )
          : json(response, 200, processSnapshot(database)),
      libraryPage: (response, url) =>
        libraryPage(
          response,
          database,
          url,
          () => stateRepository.state().snapshotVersion,
        ),
      libraryDownload: (response, url) =>
        downloadAsset(
          response,
          database,
          url,
          downloadGrants,
          () => stateRepository.state().snapshotVersion,
          options.capturedFrameStorage?.originalsRoot,
        ),
      libraryDetail: (response, encodedAssetId) =>
        libraryDetail(
          response,
          database,
          encodedAssetId,
          () => stateRepository.state().snapshotVersion,
        ),
      libraryPreview: (response, encodedAssetId, identity) =>
        libraryPreview(
          response,
          database,
          encodedAssetId,
          identity,
          () => stateRepository.state().snapshotVersion,
        ),
      observeLiveFrameReview: (response, identity) =>
        observeLiveFrameReview(
          response,
          database,
          () => stateRepository.state().snapshotVersion,
          () =>
            Effect.runPromise(
              stateRepository
                .bootstrapSnapshot(identity)
                .pipe(
                  Effect.map(
                    (snapshot) => snapshot.observe?.acquire?.liveFrame,
                  ),
                ),
            ),
        ),
      libraryReview: (response, identity, request, encodedAssetId) =>
        libraryReview(response, database, identity, request, encodedAssetId),
      planCommand: (response, identity, request) =>
        Effect.runPromise(
          planCommandFromRequest(
            body(request),
            runRepository,
            stateRepository,
            identity,
            publish,
          ).pipe(
            Effect.catchTags({
              'Server.PlanCommandInputInvalid': () =>
                planInvalidResponse(stateRepository, identity),
              'Server.PlanServiceUnavailable': () =>
                planServiceResponse(
                  'PlanServiceUnavailable',
                  'The Plan service is temporarily unavailable.',
                ),
            }),
            Effect.map(({ status, body }) => json(response, status, body)),
          ),
        ),
      observeCommand: (response, identity, request) =>
        Effect.runPromise(
          observeCommandFromRequest(
            body(request),
            runRepository,
            stateRepository,
            identity,
            publish,
          ).pipe(
            Effect.catchTags({
              'Server.ObserveCommandInputInvalid': () =>
                observeInvalidResponse(stateRepository, identity),
              'Server.ObserveServiceUnavailable': () =>
                observeServiceResponse(
                  'ObserveServiceUnavailable',
                  'The Observe command service is temporarily unavailable.',
                ),
            }),
            Effect.map(({ status, body }) => json(response, status, body)),
          ),
        ),
      processCommand: async (response, identity, request) => {
        const result = executeProcessCommand(
          database,
          await body(request),
          identity,
        )
        if (result.outcome === 'accepted')
          publish('ProcessingProjected', stateRepository.state().eventCursor)
        return json(response, result.outcome === 'accepted' ? 200 : 409, result)
      },
      refreshPreflight: async (response, identity, request) => {
        if (identity.capability !== 'controlCapable')
          return json(
            response,
            403,
            RefreshPreflightResponse.cases.Rejected.make({
              summary: 'This client is read-only and cannot refresh preflight.',
            }),
          )
        const persistence = preflightPersistenceLayer({
          activeRun: () => stateRepository.state().run,
          persist: (snapshot) =>
            Effect.try({
              try: () => stateRepository.persistPreflight(snapshot),
              catch: (cause) => cause,
            }),
        })
        const program = Effect.promise(() => body(request)).pipe(
          Effect.flatMap(refreshPreflight),
          Effect.provide(persistence),
        )
        const result = await Effect.runPromise(
          options.preflightProvider === undefined
            ? program
            : program.pipe(
                Effect.provideService(
                  ReadOnlyPreflightProvider,
                  options.preflightProvider,
                ),
              ),
        )
        if ('response' in result) {
          publish('PreflightRefreshed', result.cursor)
          return RefreshPreflightResponse.match(result.response, {
            Refreshed: (body) => json(response, 200, body),
            Rejected: (body) => json(response, 409, body),
            Unavailable: (body) => json(response, 503, body),
          })
        }
        return RefreshPreflightResponse.match(result, {
          Refreshed: (body) => json(response, 200, body),
          Rejected: (body) => json(response, 409, body),
          Unavailable: (body) => json(response, 503, body),
        })
      },
      polarCommand: async (response, identity, request) => {
        if (identity.capability !== 'controlCapable')
          return json(
            response,
            403,
            AcquireCommandResponse.cases.Unavailable.make({
              summary:
                'This client is read-only and cannot record polar evidence.',
            }),
          )
        const raw = await body(request)
        let camera: typeof CameraCommandRequest.Type | undefined
        try {
          camera = Schema.decodeUnknownSync(CameraCommandRequest)(raw)
        } catch {}
        if (camera !== undefined) {
          const prior = acquireRepository.receipt(
            camera.intent.idempotencyKey,
            identity.clientId,
          )
          if (prior !== undefined)
            return json(response, prior.status, prior.body)
          const current = stateRepository.state()
          if (
            current.run === null ||
            camera.intent.expectedLeaseRevision !== current.control.revision ||
            camera.intent.expectedRunRevision !== current.run.revision
          )
            return json(
              response,
              409,
              CameraCommandResponse.cases.Rejected.make({
                summary:
                  'The control lease or active run changed. Read the current Observe projection.',
              }),
            )
          if (
            current.run.preflight?.checks.some(
              (check) =>
                check.key === 'camera-connected' && check.state === 'ready',
            ) !== true
          )
            return json(
              response,
              409,
              CameraCommandResponse.cases.Rejected.make({
                summary:
                  'Current camera connection truth is not ready. Refresh preflight before any camera command.',
              }),
            )
          if (
            CameraCommandRequest.fields.intent.guards.CompleteCameraExposure(
              camera.intent,
            )
          ) {
            acquireRepository.saveReceipt(
              camera.intent.idempotencyKey,
              identity.clientId,
              {
                status: 503,
                body: CameraCommandResponse.cases.Unavailable.make({
                  summary:
                    'The camera image read outcome is not yet known. It will not replay.',
                }),
              },
            )
            const completed = await ingestCompletedCameraExposure({
              assetId: `asset-capture-${camera.intent.idempotencyKey}`,
              frameId: camera.intent.frameId,
              capturedAt: camera.intent.capturedAt,
              capture: {
                exposureSeconds: camera.intent.exposureSeconds,
                filter: camera.intent.filter,
                binning: camera.intent.binning,
                frameType: camera.intent.frameType,
              },
              lineage: {
                runId: current.run.id,
                sequenceId: 'camera-exposure',
                acquisitionId: 'camera-exposure',
              },
              idempotencyKey: camera.intent.idempotencyKey,
            })
            const body =
              completed.outcome === 'accepted'
                ? CameraCommandResponse.cases.Completed.make({
                    assetId: completed.assetId,
                  })
                : CameraCommandResponse.cases.Unavailable.make({
                    summary:
                      'The completed camera image could not be retained.',
                  })
            const status = completed.outcome === 'accepted' ? 202 : 503
            acquireRepository.saveReceipt(
              camera.intent.idempotencyKey,
              identity.clientId,
              { status, body },
            )
            return json(response, status, body)
          }
          acquireRepository.saveReceipt(
            camera.intent.idempotencyKey,
            identity.clientId,
            {
              status: 503,
              body: CameraCommandResponse.cases.Unavailable.make({
                summary:
                  'The camera command outcome is not yet known. Refresh its state; it will not replay.',
              }),
            },
          )
          const result = await Effect.runPromise(
            executeCameraCommand(raw).pipe(
              cameraProvider === undefined
                ? (effect) => effect
                : (effect) =>
                    effect.pipe(
                      Effect.provideService(CameraProvider, cameraProvider),
                    ),
            ),
          )
          const body =
            result._tag === 'Observed'
              ? CameraCommandResponse.cases.Accepted.make({
                  observation: result.observation,
                })
              : result._tag === 'Rejected'
                ? CameraCommandResponse.cases.Rejected.make({
                    summary: result.summary,
                  })
                : CameraCommandResponse.cases.Unavailable.make({
                    summary: result.summary,
                  })
          const status = result._tag === 'Observed' ? 202 : 503
          const observedAt = new Date().toISOString()
          const previous = current.run.preflight
          const preflight = Schema.decodeUnknownSync(PreflightSnapshot)({
            observedAt,
            verdict:
              result._tag === 'Observed'
                ? (previous?.verdict ?? 'unknown')
                : 'unavailable',
            nextAction:
              result._tag === 'Observed'
                ? (previous?.nextAction ??
                  'Camera state was read after the command acknowledgement.')
                : 'Restore the camera provider, then refresh its state. The command will not replay.',
            checks: previous?.checks ?? [
              {
                key: 'camera-provider',
                state: result._tag === 'Observed' ? 'unknown' : 'unavailable',
                observedAt,
                reason:
                  result._tag === 'Observed'
                    ? 'No prior full rig inventory is available.'
                    : result.summary,
              },
            ],
            ...(previous?.rig === undefined ? {} : { rig: previous.rig }),
            camera:
              result._tag === 'Observed'
                ? result.observation
                : { observedAt, cameraState: 'unknown' },
          })
          const persisted = stateRepository.persistPreflight(preflight)
          publish('CameraObservationRecorded', persisted.cursor)
          if (result._tag === 'Observed') {
            database
              .prepare(
                'INSERT OR REPLACE INTO camera_observations (run_id,observation) VALUES (?,?)',
              )
              .run(current.run.id, JSON.stringify(result.observation))
          }
          acquireRepository.saveReceipt(
            camera.intent.idempotencyKey,
            identity.clientId,
            {
              status,
              body,
            },
          )
          return json(response, status, body)
        }
        let decoded: typeof AcquireCommandRequest.Type | undefined
        try {
          decoded = Schema.decodeUnknownSync(AcquireCommandRequest)(raw)
        } catch {}
        if (decoded !== undefined) {
          const prior = acquireRepository.receipt(
            decoded.intent.idempotencyKey,
            identity.clientId,
          )
          if (prior !== undefined)
            return json(response, prior.status, prior.body)
          const current = stateRepository.state()
          if (
            current.run === null ||
            decoded.intent.expectedLeaseRevision !== current.control.revision ||
            decoded.intent.expectedRunRevision !== current.run.revision
          )
            return json(
              response,
              409,
              AcquireCommandResponse.cases.Rejected.make({
                summary:
                  'The control lease or active run changed. Read the current Observe projection.',
                snapshot: Effect.runSync(
                  stateRepository.bootstrapSnapshot(identity),
                ),
              }),
            )
        }
        const program = Effect.succeed(raw).pipe(
          Effect.flatMap((input) =>
            decoded !== undefined &&
            (AcquireIntent.guards.CaptureTargetAcquisitionEvidence(
              decoded.intent,
            ) ||
              AcquireIntent.guards.RetryPlateSolveWithParameters(
                decoded.intent,
              ) ||
              AcquireIntent.guards.SkipAcquireTarget(decoded.intent) ||
              AcquireIntent.guards.AbortAcquire(decoded.intent) ||
              AcquireIntent.guards.RecordLiveFrameEvidence(decoded.intent) ||
              AcquireIntent.guards.StartManagedCapture(decoded.intent) ||
              AcquireIntent.guards.PauseManagedCapture(decoded.intent) ||
              AcquireIntent.guards.StopManagedCapture(decoded.intent) ||
              AcquireIntent.guards.RecenterManagedCapture(decoded.intent) ||
              AcquireIntent.guards.ApprovePointingCorrection(decoded.intent) ||
              AcquireIntent.guards.RevisePointingCorrection(decoded.intent))
              ? executeTargetAcquisitionCommand(input)
              : executePolarCommand(input),
          ),
          Effect.provideService(
            AcquirePersistence,
            AcquirePersistence.of({
              current: () => {
                const run = stateRepository.state().run
                return run === null
                  ? undefined
                  : acquireRepository.current(run.id)
              },
              commit: (session, type) =>
                acquireRepository.commit(session, type),
            }),
          ),
        )
        const result: PolarCommandResult | TargetAcquisitionCommandResult =
          await Effect.runPromise(
            program.pipe(
              (effect) =>
                polarMeasurementProvider === undefined
                  ? effect
                  : effect.pipe(
                      Effect.provideService(
                        PolarMeasurementProvider,
                        polarMeasurementProvider,
                      ),
                    ),
              (effect) =>
                targetAcquisitionProvider === undefined
                  ? effect
                  : effect.pipe(
                      Effect.provideService(
                        TargetAcquisitionProvider,
                        targetAcquisitionProvider,
                      ),
                    ),
            ),
          )
        if ('cursor' in result) {
          publish('AcquireEvidenceUpdated', result.cursor)
          const resultBody = AcquireCommandResponse.cases.Accepted.make({
            snapshot: Effect.runSync(
              stateRepository.bootstrapSnapshot(identity),
            ),
          })
          if (decoded !== undefined)
            acquireRepository.saveReceipt(
              decoded.intent.idempotencyKey,
              identity.clientId,
              { status: 200, body: resultBody },
            )
          return json(response, 200, resultBody)
        }
        return matchPolarCommandResult(
          result,
          response,
          stateRepository,
          identity,
        )
      },
      webAsset: (response, pathname) =>
        Effect.runSync(webHost.asset(response, pathname, responseHeaders)),
      webRoute: (response, pathname) =>
        Effect.runSync(webHost.route(response, pathname, responseHeaders)),
      apiNotFound: (response) =>
        json(response, 404, reject('InvalidInput').body),
      notFound: (response) =>
        response
          .writeHead(404, responseHeaders('text/plain; charset=utf-8'))
          .end(),
    })
  const listen = async (
    port = 0,
    host = '127.0.0.1',
    requestAdmission: RequestAdmission = identityResolver,
  ) => {
    const scope = Effect.runSync(Scope.make())
    const requestHandler = handler(requestAdmission)
    const listener = await Effect.runPromise(
      Scope.provide(
        originListener.listen(port, host, (request, response) => {
          void requestHandler(request, response)
        }),
        scope,
      ),
    )
    return {
      ...listener,
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    }
  }
  const close = () => {
    if (closed) return
    closed = true
    Effect.runSync(projectionPublication.close())
    database.close()
  }
  const projectionIdentity = () => {
    const identity = identityResolver()
    return identity instanceof Promise
      ? {
          personId: 'system',
          clientId: 'system',
          capability: 'readOnly' as const,
        }
      : (identity ?? {
          personId: 'system',
          clientId: 'system',
          capability: 'readOnly' as const,
        })
  }
  const ingestObservation = (raw: unknown) => {
    try {
      const input = Schema.decodeUnknownSync(AdapterObservation)(raw)
      const current = stateRepository.state()
      const evidence: Evidence = {
        ...current.evidence,
        frameId: input.frameId,
        capturedAt: input.capturedAt,
        quality: input.quality,
        desired: input.desired,
        solved: input.solved,
        uncertaintyArcsec: input.uncertaintyArcsec,
        correction: {
          state: input.correctionState,
          evidence: input.correctionEvidence,
          bound: input.correctionBound,
          protection: input.protection,
          action:
            input.correctionState === 'automatic'
              ? 'none'
              : 'Review recovery in Observe before any new command.',
        },
      }
      return stateRepository.persistEvidence(evidence, projectionIdentity)
    } catch {
      return undefined
    }
  }
  const saveProcess = (raw: unknown, identity = projectionIdentity()) =>
    processSaveStorage === undefined
      ? { outcome: 'rejected' as const, reason: 'InvalidInput' as const }
      : saveProcessOutputs(database, processSaveStorage, raw, identity)
  const cleanupSavedOrphans = () =>
    processSaveStorage === undefined
      ? 0
      : cleanupProcessOrphans(database, processSaveStorage)
  const ingestCapturedFrame = (raw: unknown, bytes: Uint8Array) => {
    if (options.capturedFrameStorage === undefined)
      return {
        outcome: 'rejected' as const,
        reason: 'MaterializationFailed' as const,
      }
    const result = materializeCapturedFrame(
      database,
      options.capturedFrameStorage,
      raw,
      bytes,
    )
    if (result.outcome === 'accepted')
      publish('CapturedFrameMaterialized', result.cursor)
    return result
  }
  const ingestCompletedCameraExposure = async (raw: unknown) => {
    if (
      options.cameraProvider?.readImageArray === undefined ||
      options.capturedFrameStorage === undefined
    )
      return {
        outcome: 'rejected' as const,
        reason: 'MaterializationFailed' as const,
      }
    const image = await Effect.runPromiseExit(
      options.cameraProvider.readImageArray(),
    )
    if (Exit.isFailure(image))
      return {
        outcome: 'rejected' as const,
        reason: 'MaterializationFailed' as const,
      }
    const result = ingestCapturedFrame(
      { ...(raw as object), format: image.value.format },
      image.value.bytes,
    )
    if (result.outcome === 'accepted') {
      const row = database
        .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
        .get(result.assetId) as { detail: string }
      const detail = JSON.parse(row.detail) as {
        representations: Array<unknown>
      }
      detail.representations.push({
        label: 'Preview unavailable for this retained camera original',
        state: 'unavailable',
      })
      database
        .prepare('UPDATE library_assets SET detail=? WHERE asset_id=?')
        .run(JSON.stringify(detail), result.assetId)
    }
    return result
  }
  const inspectFrame = (assetId: string) =>
    options.frameInspectionStorage === undefined
      ? undefined
      : Effect.runSync(
          inspectCapturedFrame(
            database,
            options.frameInspectionStorage,
            assetId,
          ),
        )
  const advanceFakeRun = () => {
    const result = runRepository.advance(projectionIdentity())
    if (result?.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return result?.body
  }
  return {
    database,
    handler,
    listen,
    close,
    ingestObservation,
    saveProcess,
    ingestCapturedFrame,
    ingestCompletedCameraExposure,
    inspectFrame,
    cleanupSavedOrphans,
    advanceFakeRun,
  }
}

const deterministicPolarMeasurementProvider: PolarMeasurementProviderShape = {
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

const deterministicTargetAcquisitionProvider: TargetAcquisitionProviderShape = {
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

function matchPolarCommandResult(
  result: Exclude<
    PolarCommandResult | TargetAcquisitionCommandResult,
    { readonly _tag: 'Committed' }
  >,
  response: ServerResponse,
  stateRepository: StateSqliteRepositoryShape,
  identity: LocalIdentity,
) {
  return Match.value(result).pipe(
    Match.tag('Rejected', ({ summary }) => {
      const resultBody = AcquireCommandResponse.cases.Rejected.make({
        summary,
        snapshot: Effect.runSync(stateRepository.bootstrapSnapshot(identity)),
      })
      return json(response, 409, resultBody)
    }),
    Match.tag('Aborted', ({ summary }) => {
      const resultBody = AcquireCommandResponse.cases.Rejected.make({
        summary,
        snapshot: Effect.runSync(stateRepository.bootstrapSnapshot(identity)),
      })
      return json(response, 409, resultBody)
    }),
    Match.tag('Unavailable', ({ summary }) =>
      json(
        response,
        503,
        AcquireCommandResponse.cases.Unavailable.make({ summary }),
      ),
    ),
    Match.exhaustive,
  )
}

export function createOriginAdmission(
  config: OriginServerConfig,
): RequestAdmission {
  if (config.admission.mode === 'development') {
    const client = config.admission.client
    return createLocalFixtureAdmission({
      personId: client === 'friend' ? 'friend-ada' : 'owner-chicks',
      clientId:
        client === 'phone'
          ? 'phone-monitor'
          : client === 'friend'
            ? 'desktop-ada'
            : 'desktop-owner',
      capability: client === 'phone' ? 'readOnly' : 'controlCapable',
    })
  }
  return createProductionAccessAdmission({
    issuer: config.admission.issuer,
    audience: config.admission.audience,
    keyResolver: createJwksKeyResolver({
      url: config.admission.jwksUrl,
      cacheTtlMs: config.admission.cacheTtlMs,
    }),
    databasePath: config.runtime.databasePath,
    clientContext: config.admission.clientContext,
    bootstrapResolver: createMembershipBootstrapResolver({
      path: config.admission.bootstrapPath,
    }),
  })
}
export function createRemoteReadOnlyAdmission(
  config: OriginServerConfig,
): RequestAdmission {
  return createRemoteAccessAdmission(config, 'phone')
}
export function createRemoteDesktopAdmission(
  config: OriginServerConfig,
): RequestAdmission {
  return createRemoteAccessAdmission(config, 'desktop')
}
function createRemoteAccessAdmission(
  config: OriginServerConfig,
  clientContext: 'desktop' | 'phone',
): RequestAdmission {
  if (config.admission.mode === 'development')
    return createOriginAdmission(config)
  return createProductionAccessAdmission({
    issuer: config.admission.issuer,
    audience: config.admission.audience,
    keyResolver: createJwksKeyResolver({
      url: config.admission.jwksUrl,
      cacheTtlMs: config.admission.cacheTtlMs,
    }),
    databasePath: config.runtime.databasePath,
    clientContext,
    bootstrapResolver: createMembershipBootstrapResolver({
      path: config.admission.bootstrapPath,
    }),
  })
}
export const createLocalOwnerAdmission = () =>
  createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'local-owner',
    role: 'owner',
    capability: 'controlCapable',
  })
export const startOrigin = () =>
  runExecutable('origin server', async () => {
    const config = await Effect.runPromise(originServerConfig)
    const admission = createRemoteReadOnlyAdmission(config)
    const issuer = configuredDownloadGrantIssuer(config.downloadGrant)
    const service = createLocalWebService(
      config.runtime.databasePath,
      admission,
      undefined,
      issuer === undefined ? undefined : { issuer },
      {
        ...(config.fixture === undefined ? {} : { fixture: config.fixture }),
        ...(config.preflightProvider === undefined
          ? {}
          : {
              preflightProvider: alpacaPreflightProvider(
                config.preflightProvider,
              ),
              ...(config.preflightProvider.devices.camera === undefined
                ? {}
                : {
                    cameraProvider: alpacaCameraProvider(
                      config.preflightProvider,
                    ),
                  }),
            }),
        webDistPath: config.runtime.webDistPath,
        previewRoot: config.runtime.previewRoot,
        capturedFrameStorage: {
          originalsRoot: '/var/lib/astro-console/originals',
        },
        frameInspectionStorage: {
          originalsRoot: '/var/lib/astro-console/originals',
          previewsRoot: config.runtime.previewRoot,
        },
      },
    )
    const remote = await service.listen(
      config.runtime.port,
      config.runtime.host,
    )
    if (config.admission.mode === 'development') {
      console.log(
        `Astro Console ${config.runtime.release}: http://127.0.0.1:${remote.port}`,
      )
      return
    }
    const localOwnerPort = config.runtime.localOwnerPort
    if (localOwnerPort === undefined)
      throw new Error('Production origin requires ASTRO_LOCAL_OWNER_PORT')
    const local = await service.listen(
      localOwnerPort,
      config.runtime.host,
      createLocalOwnerAdmission(),
    )
    const remoteDesktop =
      config.runtime.remoteDesktopPort === undefined
        ? undefined
        : await service.listen(
            config.runtime.remoteDesktopPort,
            config.runtime.host,
            createRemoteDesktopAdmission(config),
          )
    console.log(
      `Astro Console ${config.runtime.release}: remote phone http://${config.runtime.host}:${remote.port};${remoteDesktop === undefined ? '' : ` remote desktop http://${config.runtime.host}:${remoteDesktop.port};`} local owner http://${config.runtime.host}:${local.port}`,
    )
  })
