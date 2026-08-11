import { Effect, Exit, Fiber, Match, Schedule, Schema, Scope } from 'effect'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BootstrapHttpSuccessEnvelope,
  CommandHttpFailureEnvelope,
  RefreshPreflightResponse,
} from '@astro-console/v2-contracts'
import { createProcessingProjectLifecycle } from '../services/processing-project-service.ts'
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
  type PreflightProviderConfig,
} from '../config/environment-config.ts'
import { runExecutable } from './executable.ts'
import { OriginListener, originListenerLayer } from '../http/origin-listener.ts'
import { WebHost, webHostLayer } from '../http/web-host.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import type {
  AdmissionObservation,
  LocalIdentity,
  RequestAdmission,
} from '../auth/identity.ts'
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
import { createProcessingProjectsHttpHandler } from '../http/processing-project-handlers.ts'
import {
  initializeRuntimeState,
  installDevelopmentSimulationPlan,
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
  controlDevelopmentSimulation,
  DevelopmentSimulationControlRejected,
  readDevelopmentSimulation,
  type DevelopmentSimulationConfig,
} from '../http/development-simulation.ts'
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
  processSourceHandoff,
  observeLiveFrameReview,
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
  createOriginTelemetry,
  defaultOriginTelemetry,
  tracedHttpRequest,
  type OriginTelemetry,
} from '../observability/origin-telemetry.ts'
import { tracedPlanWorkspaceRead } from '../observability/plan-telemetry.ts'
import { tracedLibraryOperation } from '../observability/library-telemetry.ts'
import {
  recordProcessBacklog,
  recordProcessPressureMetric,
  tracedProcessOperation,
  tracedProcessWorker,
} from '../observability/process-telemetry.ts'
import { tracedExecutorWork } from '../observability/executor-telemetry.ts'
import { tracedProjectionDelivery } from '../observability/projection-telemetry.ts'
import { recordOperationalEvent } from '../observability/operational-telemetry.ts'
import {
  recordAdmissionDecision,
  recordJwksRefresh,
  tracedAdmission,
} from '../observability/admission-telemetry.ts'
import { tracedStartup } from '../observability/startup-telemetry.ts'
import {
  tracedFrameInspection,
  tracedFrameIntake,
  tracedPipelineStage,
  tracedPlateSolve,
} from '../observability/pipeline-telemetry.ts'
import {
  recordSqliteBacklog,
  tracedSqliteOperation,
} from '../observability/sqlite-telemetry.ts'
import { createRunExecutorWorker } from '../workers/run-executor-worker.ts'
import {
  createProcessWorkWorker,
  processWorkResultChangesProjection,
} from '../workers/process-work-worker.ts'
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
import { developmentTargetAcquisitionProvider } from '../services/development-target-acquisition-provider.ts'
import { configuredTargetAcquisitionProvider } from '../services/configured-target-acquisition-provider.ts'
import {
  createPlateSolveWorker,
  type PlateSolveWorkerConfig,
} from '../workers/plate-solve-worker.ts'
import {
  AcquireCommandRequest,
  AcquireCommandResponse,
  AcquireActiveWork,
  AcquireIntent,
  CameraCommandRequest,
  CameraCommandResponse,
  PreflightSnapshot,
  AssetId,
  AttemptId,
  RecoverySeriesId,
  RunDefinition,
  RunExecutionContext,
  recordCorrectionAcknowledgement,
  recordManagedCapture,
  recordLiveFrameEvidence,
  recordSolveCompletion,
} from '@astro-console/v2-contracts'
export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}
const AcceptedDefinitionRow = Schema.Struct({ definition: Schema.String })
const AcceptedDefinitionRecord = Schema.Struct({ definition: RunDefinition })

export function createLocalWebService(
  databasePath = ':memory:',
  identityResolver: RequestAdmission = createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
  }),
  _unused?: unknown,
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
    readonly configuredTargetProvider?: PreflightProviderConfig
    readonly capturedFrameStorage?: CapturedFrameStorage
    readonly frameInspectionStorage?: FrameInspectionStorage
    readonly plateSolveWorker?: PlateSolveWorkerConfig
    readonly simulation?: DevelopmentSimulationConfig
    readonly runExecutionContext?: typeof RunExecutionContext.Type
    readonly runExecutorProviderOrigin?: string
    readonly telemetry?: OriginTelemetry
    readonly admissionObservability?: AdmissionObservation
    readonly processWorkRoot?: string
    readonly processFailBuildStage?: 'align'
    readonly processWorkAutoRun?: boolean
    readonly observeProjectionPublication?: (
      event: 'connect' | 'disconnect' | 'publish' | 'writeFailure',
    ) => void
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
  if (options.simulation !== undefined)
    installDevelopmentSimulationPlan(
      database,
      options.simulation.launchScenario,
    )
  const processingProjects = createProcessingProjectLifecycle(database)
  const processingProjectsHttp =
    createProcessingProjectsHttpHandler(processingProjects)
  const acquireRepository = acquireSqliteRepository(database)
  const stateRepository: StateSqliteRepositoryShape = Effect.runSync(
    StateSqliteRepository.pipe(
      Effect.provide(
        stateSqliteRepositoryLayer(database, {
          plan: bootstrapPlanWorkspaceProjection,
          observe: (db, identity, current) =>
            observeWorkspaceProjection(db, identity, current, {
              suppressTargetTerminalActions:
                options.simulation?.launchScenario ===
                  'target-evidence-progression' ||
                options.simulation?.launchScenario ===
                  'solve-success-no-solution',
            }),
        }),
      ),
    ),
  )
  const runRepository: RunSqliteRepositoryShape = Effect.runSync(
    RunSqliteRepository.pipe(
      Effect.provide(
        runSqliteRepositoryLayer(
          database,
          stateRepository,
          reject,
          options.runExecutionContext === undefined ||
            (options.simulation !== undefined &&
              options.runExecutorProviderOrigin !== options.simulation.origin)
            ? options.cameraProvider === undefined
              ? { executor: 'fake' }
              : { executor: 'unavailable' }
            : {
                executor: 'real',
                executionContext: options.runExecutionContext,
              },
        ),
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
  const telemetry = options.telemetry ?? defaultOriginTelemetry
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
          observe: (event) => {
            options.observeProjectionPublication?.(event)
            telemetry.runSync(
              recordOperationalEvent({
                scope: 'projection',
                operation: `sse.${event}`,
                outcome: event === 'writeFailure' ? 'failed' : 'success',
              }),
            )
          },
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
  const publishProcessingProjection = () => {
    const cursor = stateRepository.advanceProjectionCursor()
    publish('ProcessingProjected', cursor)
  }
  const processingProjectNotices = processingProjects
    .changes({
      personId: 'system',
      clientId: 'processing-project-notices',
      role: 'owner',
      capability: 'controlCapable',
    })
    [Symbol.asyncIterator]()
  void (async () => {
    while (true) {
      const next = await processingProjectNotices.next()
      if (next.done) return
      publishProcessingProjection()
    }
  })()
  const runExecutor =
    options.cameraProvider === undefined ||
    options.runExecutionContext === undefined ||
    (options.simulation !== undefined &&
      options.runExecutorProviderOrigin !== options.simulation.origin)
      ? undefined
      : createRunExecutorWorker({
          database,
          stateRepository,
          cameraProvider: options.cameraProvider,
          acquireRepository,
          developmentDeepSkyHold:
            options.configuredTargetProvider !== undefined ||
            (options.simulation !== undefined &&
              (options.simulation.launchScenario ===
                'target-evidence-progression' ||
                options.simulation.launchScenario ===
                  'solve-success-no-solution')),
          ...(options.capturedFrameStorage === undefined
            ? {}
            : { capturedFrameStorage: options.capturedFrameStorage }),
          ...(options.frameInspectionStorage === undefined
            ? {}
            : { frameInspectionStorage: options.frameInspectionStorage }),
          publish,
          ...(options.telemetry === undefined
            ? {}
            : {
                traceWork: (kind, run) =>
                  telemetry.runPromise(tracedExecutorWork(kind, run)),
                traceFrameIntake: (run) =>
                  telemetry.runSync(tracedFrameIntake(Effect.sync(run))),
                traceFrameInspection: (effect) =>
                  telemetry.runPromise(
                    tracedFrameInspection(effect).pipe(Effect.exit),
                  ),
                traceSqlite: (operation, run) =>
                  telemetry.runSync(
                    tracedSqliteOperation(
                      operation,
                      Effect.try({ try: run, catch: (cause) => cause }),
                    ),
                  ),
                observeSqliteBacklog: (backlog, count) =>
                  telemetry.runSync(recordSqliteBacklog(backlog, count)),
              }),
        })
  const runExecutorFiber =
    runExecutor === undefined
      ? undefined
      : Effect.runFork(
          Effect.tryPromise({
            try: () => runExecutor.pass(),
            catch: (cause) => cause,
          }).pipe(
            Effect.catch((cause) =>
              Effect.logError('RunExecutor.pass failed', cause),
            ),
            Effect.repeat(Schedule.spaced('250 millis')),
          ),
        )
  const processWorkWorker = createProcessWorkWorker({
    database,
    outputRoot:
      options.processWorkRoot ??
      (databasePath === ':memory:'
        ? join(tmpdir(), `astro-console-process-${randomUUID()}`)
        : `${databasePath}.process-work`),
    ...(options.processFailBuildStage === undefined
      ? {}
      : { failBuildStage: options.processFailBuildStage }),
    ...(options.telemetry === undefined
      ? {}
      : {
          traceWork: (kind, stage, run) =>
            telemetry.runSync(
              tracedProcessWorker(kind, stage, Effect.sync(run)),
            ),
          observeBacklog: (count, oldestAgeSeconds) =>
            telemetry.runSync(
              Effect.all([
                recordProcessBacklog(count, oldestAgeSeconds),
                recordSqliteBacklog('process', count),
              ]),
            ),
          observePressure: (state) =>
            telemetry.runSync(recordProcessPressureMetric(state)),
        }),
  })
  const processWorkPass = () => {
    const result = processWorkWorker.pass()
    if (processWorkResultChangesProjection(result))
      publishProcessingProjection()
    return result
  }
  const processWorkFiber =
    options.processWorkAutoRun === false
      ? undefined
      : Effect.runFork(
          Effect.sync(processWorkPass).pipe(
            Effect.catch((cause) =>
              Effect.logError('ProcessWorkWorker.pass failed', cause),
            ),
            Effect.repeat(Schedule.spaced('250 millis')),
          ),
        )
  const targetAcquisitionProvider =
    options.targetAcquisitionProvider ??
    (options.configuredTargetProvider !== undefined &&
    options.capturedFrameStorage !== undefined &&
    options.cameraProvider !== undefined &&
    options.plateSolveWorker !== undefined
      ? configuredTargetAcquisitionProvider({
          database,
          alpaca: options.configuredTargetProvider,
          cameraProvider: options.cameraProvider,
          capturedFrameStorage: options.capturedFrameStorage,
          plateSolveWorker: options.plateSolveWorker,
          ...(options.frameInspectionStorage === undefined
            ? {}
            : { frameInspectionStorage: options.frameInspectionStorage }),
          publish,
        })
      : undefined) ??
    (options.simulation !== undefined &&
    options.capturedFrameStorage !== undefined &&
    options.cameraProvider !== undefined &&
    (options.simulation.launchScenario === 'target-evidence-progression' ||
      options.simulation.launchScenario === 'solve-success-no-solution')
      ? developmentTargetAcquisitionProvider({
          database,
          simulation: options.simulation,
          capturedFrameStorage: options.capturedFrameStorage,
          cameraProvider: options.cameraProvider,
          ...(options.frameInspectionStorage === undefined
            ? {}
            : { frameInspectionStorage: options.frameInspectionStorage }),
          publish,
        })
      : undefined) ??
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
  const developmentSimulation = options.simulation
  const runHttp = <A, E>(
    response: ServerResponse,
    input: Parameters<typeof tracedHttpRequest>[1],
    effect: Effect.Effect<A, E>,
  ) => telemetry.runPromise(tracedHttpRequest(response, input, effect))

  const handler = (requestAdmission: RequestAdmission = identityResolver) => {
    const observedAdmission: RequestAdmission = (request) => {
      const pathname = new URL(request?.url ?? '/', 'http://local').pathname
      if (!pathname.startsWith('/api/') || pathname.startsWith('/api/health/'))
        return requestAdmission(request)
      return telemetry.runPromise(
        tracedAdmission(
          Effect.tryPromise({
            try: async () =>
              await requestAdmission(request, options.admissionObservability),
            catch: (cause) => cause,
          }),
        ),
      )
    }
    return createOriginRouter({
      identityResolver: observedAdmission,
      expireReconnectGrace: () => stateRepository.expireReconnectGrace(),
      live: (response) => json(response, 200, { status: 'alive' }),
      unauthenticated,
      snapshot: (response, identity) =>
        void telemetry.runSync(
          tracedHttpRequest(
            response,
            {
              method: 'GET',
              route: '/api/snapshot',
              workspace: 'projection',
            },
            tracedProjectionDelivery(
              response,
              'snapshot',
              tracedSqliteOperation(
                'projection.snapshot.read',
                stateRepository.bootstrapSnapshot(identity),
              ).pipe(
                Effect.flatMap((data) =>
                  Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope)({
                    ok: true,
                    data,
                  }),
                ),
                Effect.map((body) => json(response, 200, body)),
              ),
            ),
          ),
        ),
      ready: (response) => json(response, 200, stateRepository.readiness()),
      operations: (response, identity) =>
        isOwner(identity)
          ? json(response, 200, stateRepository.operations())
          : json(response, 403, reject('OwnerRequired').body),
      events: (request, response, identity) =>
        void telemetry.runSync(
          tracedHttpRequest(
            response,
            {
              method: 'GET',
              route: '/api/events',
              workspace: 'projection',
            },
            tracedProjectionDelivery(
              response,
              'sse.open',
              projectionPublication.stream(request, response, identity),
              () =>
                identity.capability === 'controlCapable'
                  ? stateRepository.state().control.state
                  : 'notApplicable',
            ),
          ),
        ),
      control: (response, identity, request) =>
        runHttp(
          response,
          {
            method: 'POST',
            route: '/api/commands/control',
            workspace: 'control',
          },
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
            Effect.map(({ status, body }) => json(response, status, body)),
          ),
        ),
      ...(developmentSimulation === undefined
        ? {}
        : {
            simulationProjection: async (response: ServerResponse) => {
              try {
                return json(
                  response,
                  200,
                  await readDevelopmentSimulation(developmentSimulation),
                )
              } catch {
                return json(response, 503, {
                  mode: 'alpaca',
                  notice: 'SIMULATION · NOT LIVE HARDWARE',
                  state: 'unavailable',
                  launchScenario: developmentSimulation.launchScenario,
                  message: 'The development simulator is unavailable.',
                })
              }
            },
            simulationControl: async (
              response: ServerResponse,
              identity: LocalIdentity,
              request: IncomingMessage,
            ) => {
              try {
                return json(
                  response,
                  200,
                  await controlDevelopmentSimulation(
                    developmentSimulation,
                    identity,
                    await body(request),
                  ),
                )
              } catch (cause) {
                const rejected =
                  cause instanceof DevelopmentSimulationControlRejected
                    ? cause
                    : undefined
                return json(response, rejected?.status ?? 503, {
                  outcome: 'rejected',
                  reason:
                    rejected?.status === 403
                      ? 'ControlRequired'
                      : rejected?.status === 400
                        ? 'InvalidInput'
                        : 'SimulatorUnavailable',
                  message:
                    rejected?.message ??
                    'The development simulator is unavailable.',
                })
              }
            },
          }),
      planWorkspace: (response) =>
        runHttp(
          response,
          {
            method: 'GET',
            route: '/api/workspaces/plan',
            workspace: 'plan',
          },
          tracedPlanWorkspaceRead(
            Effect.sync(() => workspace(response, database, 'plan')),
          ),
        ),
      processingProjects: (response, identity, request, url) =>
        runHttp(
          response,
          {
            method:
              request.method === 'POST'
                ? 'POST'
                : request.method === 'PATCH'
                  ? 'PATCH'
                  : 'GET',
            route: url.pathname.endsWith('/evidence')
              ? '/api/process/projects/:projectId/evidence'
              : url.pathname === '/api/process/projects'
                ? '/api/process/projects'
                : '/api/process/projects/:projectId',
            workspace: 'process',
          },
          tracedProcessOperation(
            response,
            request.method === 'GET' ? 'project.read' : 'project.change',
            Effect.promise(() =>
              processingProjectsHttp(response, identity, request, url),
            ),
          ),
        ),
      libraryPage: (response, url) =>
        runHttp(
          response,
          { method: 'GET', route: '/api/library', workspace: 'library' },
          libraryPage(
            response,
            database,
            url,
            () => stateRepository.state().snapshotVersion,
          ),
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
        runHttp(
          response,
          {
            method: 'GET',
            route: '/api/library/assets/:assetId',
            workspace: 'library',
          },
          libraryDetail(
            response,
            database,
            encodedAssetId,
            () => stateRepository.state().snapshotVersion,
          ),
        ),
      libraryPreview: (response, encodedAssetId, identity) =>
        libraryPreview(
          response,
          database,
          encodedAssetId,
          identity,
          () => stateRepository.state().snapshotVersion,
        ),
      libraryProcessSource: (response, encodedAssetId) =>
        runHttp(
          response,
          {
            method: 'GET',
            route: '/api/library/assets/:assetId/process-source',
            workspace: 'library',
          },
          processSourceHandoff(
            response,
            database,
            encodedAssetId,
            () => stateRepository.state().snapshotVersion,
          ),
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
        runHttp(
          response,
          {
            method: 'POST',
            route: '/api/library/assets/:assetId/review',
            workspace: 'library',
          },
          tracedLibraryOperation(
            response,
            'asset.review',
            Effect.promise(() =>
              libraryReview(
                response,
                database,
                identity,
                request,
                encodedAssetId,
              ),
            ),
          ),
        ),
      planCommand: (response, identity, request) =>
        runHttp(
          response,
          {
            method: 'POST',
            route: '/api/plan/commands',
            workspace: 'plan',
          },
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
        runHttp(
          response,
          {
            method: 'POST',
            route: '/api/observe/commands',
            workspace: 'observe',
          },
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
        return runHttp(
          response,
          {
            method: 'POST',
            route: '/api/observe/preflight',
            workspace: 'observe',
          },
          (options.preflightProvider === undefined
            ? program
            : program.pipe(
                Effect.provideService(
                  ReadOnlyPreflightProvider,
                  options.preflightProvider,
                ),
              )
          ).pipe(
            Effect.map((result) => {
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
            }),
          ),
        )
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
            const equipment = acceptedCaptureEquipment(
              database,
              current.run.sourceDefinitionId,
            )
            if (equipment === undefined)
              return json(
                response,
                409,
                CameraCommandResponse.cases.Rejected.make({
                  summary:
                    'The accepted run definition cannot supply capture equipment identity.',
                }),
              )
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
            const completed = await runHttp(
              response,
              {
                method: 'POST',
                route: '/api/acquire/commands',
                workspace: 'acquire',
              },
              completedCameraExposure({
                assetId: `asset-capture-${camera.intent.idempotencyKey}`,
                frameId: camera.intent.frameId,
                capturedAt: camera.intent.capturedAt,
                equipment,
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
              }),
            )
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
          const result = await runHttp(
            response,
            {
              method: 'POST',
              route: '/api/acquire/commands',
              workspace: 'acquire',
            },
            executeCameraCommand(raw).pipe(
              cameraProvider === undefined
                ? (effect) => effect
                : (effect) =>
                    effect.pipe(
                      Effect.provideService(CameraProvider, cameraProvider),
                    ),
            ),
          )
          const cameraOutcome = Match.value(result).pipe(
            Match.when({ _tag: 'Observed' }, (observed) => ({
              observed: true as const,
              body: CameraCommandResponse.cases.Accepted.make({
                observation: observed.observation,
              }),
              observation: observed.observation,
              summary: 'Camera state was read after acknowledgement.',
            })),
            Match.when({ _tag: 'Rejected' }, (rejected) => ({
              observed: false as const,
              body: CameraCommandResponse.cases.Rejected.make({
                summary: rejected.summary,
              }),
              summary: rejected.summary,
            })),
            Match.orElse((unavailable) => ({
              observed: false as const,
              body: CameraCommandResponse.cases.Unavailable.make({
                summary: unavailable.summary,
              }),
              summary: unavailable.summary,
            })),
          )
          const body = cameraOutcome.body
          const status = cameraOutcome.observed ? 202 : 503
          const observedAt = new Date().toISOString()
          const previous = current.run.preflight
          const preflight = Schema.decodeUnknownSync(PreflightSnapshot)({
            observedAt,
            verdict: cameraOutcome.observed
              ? (previous?.verdict ?? 'unknown')
              : 'unavailable',
            nextAction: cameraOutcome.observed
              ? (previous?.nextAction ??
                'Camera state was read after the command acknowledgement.')
              : 'Restore the camera provider, then refresh its state. The command will not replay.',
            checks: previous?.checks ?? [
              {
                key: 'camera-provider',
                state: cameraOutcome.observed ? 'unknown' : 'unavailable',
                observedAt,
                reason: cameraOutcome.observed
                  ? 'No prior full rig inventory is available.'
                  : cameraOutcome.summary,
              },
            ],
            ...(previous?.rig === undefined ? {} : { rig: previous.rig }),
            camera: cameraOutcome.observed
              ? cameraOutcome.observation
              : { observedAt, cameraState: 'unknown' },
          })
          const persisted = stateRepository.persistPreflight(preflight)
          publish('CameraObservationRecorded', persisted.cursor)
          if (cameraOutcome.observed) {
            database
              .prepare(
                'INSERT OR REPLACE INTO camera_observations (run_id,observation) VALUES (?,?)',
              )
              .run(current.run.id, JSON.stringify(cameraOutcome.observation))
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
        let providerEffect = false
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
          const acquire = acquireRepository.current(current.run.id)
          if (
            acquire === undefined ||
            decoded.intent.expectedAcquireRevision !== acquire.revision
          )
            return json(
              response,
              409,
              AcquireCommandResponse.cases.Rejected.make({
                summary:
                  'Target evidence changed. Read the current Observe projection.',
                snapshot: Effect.runSync(
                  stateRepository.bootstrapSnapshot(identity),
                ),
              }),
            )
          if (
            (options.simulation?.launchScenario ===
              'target-evidence-progression' ||
              options.simulation?.launchScenario ===
                'solve-success-no-solution') &&
            (AcquireIntent.guards.SkipAcquireTarget(decoded.intent) ||
              AcquireIntent.guards.AbortAcquire(decoded.intent))
          ) {
            const denied = AcquireCommandResponse.cases.Rejected.make({
              summary:
                'This bounded target simulation does not implement an outer-run Skip or Abort transition.',
              snapshot: Effect.runSync(
                stateRepository.bootstrapSnapshot(identity),
              ),
            })
            acquireRepository.saveReceipt(
              decoded.intent.idempotencyKey,
              identity.clientId,
              { status: 409, body: denied },
            )
            return json(response, 409, denied)
          }
          if (
            AcquireIntent.guards.CaptureTargetAcquisitionEvidence(
              decoded.intent,
            ) &&
            AcquireActiveWork.guards.SolveRequested(acquire.activeWork)
          )
            providerEffect = true
          else if (
            AcquireIntent.guards.ApprovePointingCorrection(decoded.intent) &&
            acquire.pendingCorrectionProposal !== null
          )
            providerEffect = true
          if (providerEffect) {
            const pending = AcquireCommandResponse.cases.Unavailable.make({
              summary:
                'This provider work is in progress. Reconcile current Acquire evidence; it will not replay.',
            })
            acquireRepository.saveReceipt(
              decoded.intent.idempotencyKey,
              identity.clientId,
              { status: 503, body: pending },
            )
          }
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
          await runHttp(
            response,
            {
              method: 'POST',
              route: '/api/acquire/commands',
              workspace: 'acquire',
            },
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
  }
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
    if (runExecutorFiber !== undefined)
      Effect.runSync(Fiber.interrupt(runExecutorFiber))
    if (processWorkFiber !== undefined)
      Effect.runSync(Fiber.interrupt(processWorkFiber))
    void processingProjectNotices.return?.()
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
  const ingestCapturedFrame = (raw: unknown, bytes: Uint8Array) => {
    const capturedFrameStorage = options.capturedFrameStorage
    if (capturedFrameStorage === undefined)
      return {
        outcome: 'rejected' as const,
        reason: 'MaterializationFailed' as const,
      }
    const result = telemetry.runSync(
      tracedFrameIntake(
        Effect.sync(() =>
          materializeCapturedFrame(database, capturedFrameStorage, raw, bytes),
        ),
      ),
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
    const input = Schema.decodeUnknownSync(
      Schema.Record(Schema.String, Schema.Unknown),
    )(raw)
    const result = ingestCapturedFrame(
      { ...input, format: image.value.format },
      image.value.bytes,
    )
    if (result.outcome === 'accepted') {
      const row = Schema.decodeUnknownSync(
        Schema.Struct({ detail: Schema.String }),
      )(
        database
          .prepare('SELECT detail FROM library_assets WHERE asset_id=?')
          .get(result.assetId),
      )
      const detail = Schema.decodeUnknownSync(
        Schema.Record(Schema.String, Schema.Unknown),
      )(JSON.parse(row.detail))
      const representations = Schema.decodeUnknownSync(
        Schema.Array(Schema.Unknown),
      )(detail.representations)
      database
        .prepare('UPDATE library_assets SET detail=? WHERE asset_id=?')
        .run(
          JSON.stringify({
            ...detail,
            representations: [
              ...representations,
              {
                label: 'Preview unavailable for this retained camera original',
                state: 'unavailable',
              },
            ],
          }),
          result.assetId,
        )
    }
    return result
  }
  const completedCameraExposure = (raw: unknown) =>
    Effect.promise(() => ingestCompletedCameraExposure(raw))
  const inspectFrame = (assetId: string) =>
    options.frameInspectionStorage === undefined
      ? undefined
      : telemetry.runSync(
          tracedFrameInspection(
            inspectCapturedFrame(
              database,
              options.frameInspectionStorage,
              assetId,
            ),
          ),
        )
  const solveRetainedFrame = async (assetId: string) => {
    const plateSolveWorker = options.plateSolveWorker
    if (plateSolveWorker === undefined)
      return {
        outcome: 'rejected' as const,
        reason: 'SourceUnavailable' as const,
      }
    const result = await telemetry.runPromise(
      tracedPlateSolve(
        Effect.promise(() =>
          createPlateSolveWorker(database, plateSolveWorker, {
            traceExecute: (run) =>
              telemetry.runPromise(
                tracedPipelineStage('plateSolve.execute', run),
              ),
          }).solve(assetId),
        ),
      ),
    )
    if (result.outcome === 'recorded')
      publish('AcquireEvidenceUpdated', result.cursor)
    return result
  }
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
    ingestCapturedFrame,
    ingestCompletedCameraExposure,
    inspectFrame,
    solveRetainedFrame,
    advanceFakeRun,
    runExecutorPass: () => runExecutor?.pass(),
    processWorkPass,
    enqueueRunExposureAbort: (runId: string) =>
      runExecutor?.enqueueAbort(runId),
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

function acceptedCaptureEquipment(
  database: import('node:sqlite').DatabaseSync,
  runDefinitionId: string | undefined,
) {
  if (runDefinitionId === undefined) return undefined
  try {
    const row = Schema.decodeUnknownSync(AcceptedDefinitionRow)(
      database
        .prepare(
          'SELECT definition FROM run_definitions WHERE run_definition_id=?',
        )
        .get(runDefinitionId),
    )
    const definition = Schema.decodeUnknownSync(AcceptedDefinitionRecord)(
      JSON.parse(row.definition),
    ).definition
    return {
      rigId: definition.executionContext.rigId,
      cameraDeviceId: definition.executionContext.cameraDeviceId,
    }
  } catch {
    return undefined
  }
}

export function createOriginAdmission(
  config: OriginServerConfig,
): RequestAdmission {
  if (config.admission.mode === 'development') {
    const client = config.admission.client
    const admission = createLocalFixtureAdmission({
      personId: client === 'friend' ? 'friend-ada' : 'owner-chicks',
      clientId:
        client === 'phone'
          ? 'phone-monitor'
          : client === 'friend'
            ? 'desktop-ada'
            : 'desktop-owner',
      capability: client === 'phone' ? 'readOnly' : 'controlCapable',
    })
    return admission
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
export const createLocalOwnerAdmission = (): RequestAdmission =>
  createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'local-owner',
    role: 'owner',
    capability: 'controlCapable',
  })
export const startOrigin = () =>
  runExecutable('origin server', async () => {
    const telemetry = createOriginTelemetry()
    const listeners: Array<{ readonly close: () => Promise<void> }> = []
    let service: ReturnType<typeof createLocalWebService> | undefined
    try {
      await telemetry.initialize()
      const config = await telemetry.runPromise(
        tracedStartup('config.decode', originServerConfig),
      )
      const admissionObservability: AdmissionObservation = {
        admission: (reason) =>
          telemetry.runSync(recordAdmissionDecision(reason)),
        jwks: (outcome) => telemetry.runSync(recordJwksRefresh(outcome)),
      }
      const admission = createRemoteReadOnlyAdmission(config)
      const issuer = configuredDownloadGrantIssuer(config.downloadGrant)
      const createdService = telemetry.runSync(
        tracedStartup(
          'service.create',
          Effect.sync(() =>
            createLocalWebService(
              config.runtime.databasePath,
              admission,
              undefined,
              issuer === undefined ? undefined : { issuer },
              {
                ...(config.fixture === undefined
                  ? {}
                  : { fixture: config.fixture }),
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
                            runExecutorProviderOrigin: new URL(
                              `http://${config.preflightProvider.host}:${config.preflightProvider.port}`,
                            ).origin,
                            ...(config.preflightProvider.devices.camera
                              .uniqueId === undefined
                              ? {}
                              : {
                                  runExecutionContext: RunExecutionContext.make(
                                    {
                                      rigId: config.preflightProvider.rigId,
                                      cameraDeviceId:
                                        config.preflightProvider.devices.camera
                                          .uniqueId,
                                      ...(config.preflightProvider.devices
                                        .telescope?.uniqueId === undefined
                                        ? {}
                                        : {
                                            mountDeviceId:
                                              config.preflightProvider.devices
                                                .telescope.uniqueId,
                                            ...(config.preflightProvider
                                              .site === undefined
                                              ? config.simulation === undefined
                                                ? {}
                                                : {
                                                    latitudeDegrees: 39.755,
                                                    longitudeDegrees:
                                                      -74.2677777778,
                                                    elevationMeters: 0,
                                                  }
                                              : config.preflightProvider.site),
                                          }),
                                      completionBehavior: 'hold',
                                      unsafeBehavior: 'pauseAndPark',
                                    },
                                  ),
                                }),
                          }),
                    }),
                webDistPath: config.runtime.webDistPath,
                previewRoot: config.runtime.previewRoot,
                capturedFrameStorage: {
                  originalsRoot: config.runtime.originalsRoot,
                },
                frameInspectionStorage: {
                  originalsRoot: config.runtime.originalsRoot,
                  previewsRoot: config.runtime.previewRoot,
                },
                plateSolveWorker: {
                  originalsRoot: config.runtime.originalsRoot,
                  executable: config.plateSolve.executable,
                  indexesRoot: config.plateSolve.indexesRoot,
                  timeoutMs: config.plateSolve.timeoutMs,
                  solverVersion: config.plateSolve.solverVersion,
                  scaleLowDeg: config.plateSolve.scaleLowDeg,
                  scaleHighDeg: config.plateSolve.scaleHighDeg,
                  searchRadiusDeg: config.plateSolve.searchRadiusDeg,
                },
                ...(config.simulation === undefined &&
                config.preflightProvider?.site !== undefined &&
                config.preflightProvider.devices.camera?.uniqueId !==
                  undefined &&
                config.preflightProvider.devices.telescope?.uniqueId !==
                  undefined
                  ? { configuredTargetProvider: config.preflightProvider }
                  : {}),
                ...(config.simulation === undefined
                  ? {}
                  : { simulation: config.simulation }),
                telemetry,
                admissionObservability,
              },
            ),
          ),
        ),
      )
      service = createdService
      const remote = await telemetry.runPromise(
        tracedStartup(
          'listener.bind',
          Effect.promise(() =>
            createdService.listen(config.runtime.port, config.runtime.host),
          ),
        ),
      )
      listeners.push(remote)
      if (config.admission.mode === 'development') {
        console.log(
          `Astro Console ${config.runtime.release}: http://127.0.0.1:${remote.port}`,
        )
        installOriginShutdown(service, telemetry, [remote])
        return
      }
      const localOwnerPort = config.runtime.localOwnerPort
      if (localOwnerPort === undefined)
        throw new Error('Production origin requires ASTRO_LOCAL_OWNER_PORT')
      const local = await telemetry.runPromise(
        tracedStartup(
          'listener.bind',
          Effect.promise(() =>
            createdService.listen(
              localOwnerPort,
              config.runtime.host,
              createLocalOwnerAdmission(),
            ),
          ),
        ),
      )
      listeners.push(local)
      const remoteDesktop =
        config.runtime.remoteDesktopPort === undefined
          ? undefined
          : await telemetry.runPromise(
              tracedStartup(
                'listener.bind',
                Effect.promise(() =>
                  createdService.listen(
                    config.runtime.remoteDesktopPort,
                    config.runtime.host,
                    createRemoteDesktopAdmission(config),
                  ),
                ),
              ),
            )
      if (remoteDesktop !== undefined) listeners.push(remoteDesktop)
      console.log(
        `Astro Console ${config.runtime.release}: remote phone http://${config.runtime.host}:${remote.port};${remoteDesktop === undefined ? '' : ` remote desktop http://${config.runtime.host}:${remoteDesktop.port};`} local owner http://${config.runtime.host}:${local.port}`,
      )
      installOriginShutdown(
        createdService,
        telemetry,
        remoteDesktop === undefined
          ? [remote, local]
          : [remote, local, remoteDesktop],
      )
    } catch (cause) {
      await Promise.allSettled(listeners.map((listener) => listener.close()))
      try {
        service?.close()
      } finally {
        await telemetry.dispose()
      }
      throw cause
    }
  })

function installOriginShutdown(
  service: ReturnType<typeof createLocalWebService>,
  telemetry: OriginTelemetry,
  listeners: ReadonlyArray<{ readonly close: () => Promise<void> }>,
) {
  let closing = false
  const close = async () => {
    if (closing) return
    closing = true
    await Promise.allSettled(listeners.map((listener) => listener.close()))
    try {
      service.close()
    } finally {
      await telemetry.runPromise(
        recordOperationalEvent({
          scope: 'startup',
          operation: 'shutdown',
          outcome: 'stopped',
        }),
      )
      await telemetry.dispose()
    }
  }
  process.once('SIGINT', () => void close())
  process.once('SIGTERM', () => void close())
}
