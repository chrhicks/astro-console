import {
  Context,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Match,
  Schedule,
  Schema,
  Scope,
  Stream,
} from 'effect'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BootstrapHttpSuccessEnvelope,
  CommandHttpFailureEnvelope,
  DevelopmentSimulationControlFailure,
  DevelopmentSimulationProjection,
  DevelopmentSimulationUnavailable,
  RefreshPreflightResponse,
} from '@astro-console/protocol'
import {
  ProcessingProjectLifecycle,
  processingProjectLifecycleLayer,
} from '../services/processing-project-service.ts'
import {
  materializeCapturedFrame,
  type CapturedFrameStorage,
} from '../services/captured-frame-intake.ts'
import {
  inspectCapturedFrame,
  type FrameInspectionStorage,
} from '../services/frame-inspection.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import {
  type OriginServerConfig,
  type PreflightProviderConfig,
} from '../config/environment-config.ts'
import { OriginListener, originListenerLayer } from '../http/origin-listener.ts'
import { serveProjectionSse } from '../http/projection-sse.ts'
import { WebHost, webHostLayer } from '../http/web-host.ts'
import { openOriginDatabase } from '../persistence/database.ts'
import type {
  AdmissionRequest,
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
import { handleProcessingProjectsHttp } from '../http/processing-project-handlers.ts'
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
import {
  CameraProvider,
  executeCameraCommand,
  type CameraProviderShape,
} from '../services/camera-command-service.ts'
import {
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
import { tracedAdmission } from '../observability/admission-telemetry.ts'
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
  AcquireIntent,
  CameraCommandRequest,
  CameraCommandResponse,
  PreflightSnapshot,
  AssetId,
  AttemptId,
} from '@astro-console/protocol'
import { RunDefinition, RunExecutionContext } from '../services/run-domain.ts'
import {
  AcquireActiveWork,
  RecoverySeriesId,
  recordCorrectionAcknowledgement,
  recordManagedCapture,
  recordLiveFrameEvidence,
  recordSolveCompletion,
} from '../services/acquire-domain.ts'
export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}
const AcceptedDefinitionRow = Schema.Struct({ definition: Schema.String })
const AcceptedDefinitionRecord = Schema.Struct({ definition: RunDefinition })

type LocalWebServiceOptions = {
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
}

export function createLocalWebService(
  databasePath = ':memory:',
  identityResolver: RequestAdmission = createLocalFixtureAdmission({
    personId: 'owner-chicks',
    clientId: 'desktop-owner',
    capability: 'controlCapable',
  }),
  _unused?: unknown,
  downloadGrants?: DownloadGrantConfig,
  options: LocalWebServiceOptions = {},
) {
  const database = openOriginDatabase(databasePath)
  const runtimeScope = Effect.runSync(Scope.make())
  Effect.runSync(
    Scope.addFinalizer(
      runtimeScope,
      Effect.sync(() => database.close()),
    ),
  )
  try {
    return constructLocalWebService(
      database,
      runtimeScope,
      databasePath,
      identityResolver,
      downloadGrants,
      options,
    )
  } catch (cause) {
    Effect.runSync(Scope.close(runtimeScope, Exit.void))
    throw cause
  }
}

function constructLocalWebService(
  database: ReturnType<typeof openOriginDatabase>,
  runtimeScope: Scope.Closeable,
  databasePath: string,
  identityResolver: RequestAdmission,
  downloadGrants: DownloadGrantConfig | undefined,
  options: LocalWebServiceOptions,
) {
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
  const processingProjects = ManagedRuntime.make(
    processingProjectLifecycleLayer(database),
  )
  Effect.runSync(
    Scope.addFinalizer(runtimeScope, processingProjects.disposeEffect),
  )
  const processingProjectsHttp = (
    response: ServerResponse,
    identity: LocalIdentity,
    request: IncomingMessage,
    url: URL,
  ) =>
    processingProjects.runPromise(
      handleProcessingProjectsHttp(response, identity, request, url),
    )
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
  let closed = false
  const telemetry = options.telemetry ?? defaultOriginTelemetry
  const observeProjectionPublication = (
    event: 'connect' | 'disconnect' | 'publish' | 'writeFailure',
  ) => {
    options.observeProjectionPublication?.(event)
    telemetry.runSync(
      recordOperationalEvent({
        scope: 'projection',
        operation: `sse.${event}`,
        outcome: event === 'writeFailure' ? 'failed' : 'success',
      }),
    )
  }
  const projectionPublication = Effect.runSync(
    Scope.provide(
      Layer.build(
        projectionPublicationLayer({
          expire: () => stateRepository.expireReconnectGrace(),
          currentCursor: () => stateRepository.state().eventCursor,
          eventFor: (identity) => stateRepository.projectionEvent(identity),
          controllerConnected: (identity) =>
            stateRepository.controllerConnected(identity),
          controllerDisconnected: (identity) => {
            if (!closed) stateRepository.controllerDisconnected(identity)
          },
          observe: observeProjectionPublication,
        }),
      ).pipe(
        Effect.map((context) => Context.get(context, ProjectionPublication)),
      ),
      runtimeScope,
    ),
  )
  const libraryPreview = createLibraryPreviewHandler(
    options.frameInspectionStorage?.previewsRoot ??
      options.previewRoot ??
      './.astro-server/previews',
  )
  const publishProjection = (cursor: number) =>
    Effect.runSync(projectionPublication.publish(cursor))

  // Existing domain persistence and worker ports also report the durable
  // event type. This ticket keeps that audit contract at the adapter seam;
  // the projection stream deliberately publishes one closed wire event.
  const publishDomainProjection = (_durableEventType: string, cursor: number) =>
    publishProjection(cursor)
  const publishProcessingProjection = () => {
    const cursor = stateRepository.advanceProjectionCursor()
    publishProjection(cursor)
  }
  processingProjects.runSync(
    Effect.forkIn(
      Effect.flatMap(ProcessingProjectLifecycle, (lifecycle) =>
        lifecycle
          .changes({
            personId: 'system',
            clientId: 'processing-project-notices',
            role: 'owner',
            capability: 'controlCapable',
          })
          .pipe(
            Stream.runForEach(() => Effect.sync(publishProcessingProjection)),
          ),
      ),
      runtimeScope,
    ),
  )
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
          publish: publishDomainProjection,
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
  if (runExecutor !== undefined)
    Effect.runSync(
      Effect.forkIn(
        Effect.tryPromise({
          try: () => runExecutor.pass(),
          catch: (cause) => cause,
        }).pipe(
          Effect.catch((cause) =>
            Effect.logError('RunExecutor.pass failed', cause),
          ),
          Effect.repeat(Schedule.spaced('250 millis')),
        ),
        runtimeScope,
      ),
    )
  const processWorkWorker = createProcessWorkWorker({
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
    const result = processingProjects.runSync(processWorkWorker.pass())
    if (processWorkResultChangesProjection(result))
      publishProcessingProjection()
    return result
  }
  if (options.processWorkAutoRun !== false)
    Effect.runSync(
      Effect.forkIn(
        Effect.sync(processWorkPass).pipe(
          Effect.catch((cause) =>
            Effect.logError('ProcessWorkWorker.pass failed', cause),
          ),
          Effect.repeat(Schedule.spaced('250 millis')),
        ),
        runtimeScope,
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
          publish: publishDomainProjection,
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
          publish: publishDomainProjection,
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
      if (
        !request.path.startsWith('/api/') ||
        request.path.startsWith('/api/health/')
      )
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
    const routes = {
      identityResolver: observedAdmission,
      expireReconnectGrace: () => stateRepository.expireReconnectGrace(),
      live: (response: ServerResponse) =>
        json(response, 200, { status: 'alive' }),
      unauthenticated,
      snapshot: (response: ServerResponse, identity: LocalIdentity) =>
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
      ready: (response: ServerResponse) =>
        json(response, 200, stateRepository.readiness()),
      operations: (response: ServerResponse, identity: LocalIdentity) =>
        isOwner(identity)
          ? json(response, 200, stateRepository.operations())
          : json(response, 403, reject('OwnerRequired').body),
      events: (
        request: IncomingMessage,
        response: ServerResponse,
        identity: LocalIdentity,
      ) =>
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
              serveProjectionSse({
                request,
                response,
                responseHeaders: responseHeaders('text/event-stream'),
                events: projectionPublication.stream(identity),
                scope: runtimeScope,
                observeWriteFailure: () =>
                  observeProjectionPublication('writeFailure'),
              }),
              () =>
                identity.capability === 'controlCapable'
                  ? stateRepository.state().control.state
                  : 'notApplicable',
            ),
          ),
        ),
      control: (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
      ) =>
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
            publishDomainProjection,
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
                  Schema.encodeSync(DevelopmentSimulationProjection)(
                    await readDevelopmentSimulation(developmentSimulation),
                  ),
                )
              } catch {
                return json(
                  response,
                  503,
                  DevelopmentSimulationUnavailable.make({
                    mode: 'alpaca',
                    notice: 'SIMULATION · NOT LIVE HARDWARE',
                    state: 'unavailable',
                    launchScenario: developmentSimulation.launchScenario,
                    message: 'The development simulator is unavailable.',
                  }),
                )
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
                  Schema.encodeSync(DevelopmentSimulationProjection)(
                    await controlDevelopmentSimulation(
                      developmentSimulation,
                      identity,
                      await body(request),
                    ),
                  ),
                )
              } catch (cause) {
                const rejected =
                  cause instanceof DevelopmentSimulationControlRejected
                    ? cause
                    : undefined
                return json(
                  response,
                  rejected?.status ?? 503,
                  DevelopmentSimulationControlFailure.make({
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
                  }),
                )
              }
            },
          }),
      planWorkspace: (response: ServerResponse) =>
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
      processingProjects: (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
        url: URL,
      ) =>
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
      libraryPage: (response: ServerResponse, url: URL) =>
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
      libraryDownload: (response: ServerResponse, url: URL) =>
        downloadAsset(
          response,
          database,
          url,
          downloadGrants,
          () => stateRepository.state().snapshotVersion,
          options.capturedFrameStorage?.originalsRoot,
        ),
      libraryDetail: (response: ServerResponse, encodedAssetId: string) =>
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
      libraryPreview: (
        response: ServerResponse,
        encodedAssetId: string,
        identity: LocalIdentity,
      ) =>
        libraryPreview(
          response,
          database,
          encodedAssetId,
          identity,
          () => stateRepository.state().snapshotVersion,
        ),
      libraryProcessSource: (
        response: ServerResponse,
        encodedAssetId: string,
      ) =>
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
      observeLiveFrameReview: (
        response: ServerResponse,
        identity: LocalIdentity,
      ) =>
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
      libraryReview: (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
        encodedAssetId: string,
      ) =>
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
      planCommand: (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
      ) =>
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
            publishDomainProjection,
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
      observeCommand: (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
      ) =>
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
            publishDomainProjection,
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
      refreshPreflight: async (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
      ) => {
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
                publishProjection(result.cursor)
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
      polarCommand: async (
        response: ServerResponse,
        identity: LocalIdentity,
        request: IncomingMessage,
      ) => {
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
          publishProjection(persisted.cursor)
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
          publishProjection(result.cursor)
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
      webAsset: (response: ServerResponse, pathname: string) =>
        Effect.runSync(webHost.asset(response, pathname, responseHeaders)),
      webRoute: (response: ServerResponse, pathname: string) =>
        Effect.runSync(webHost.route(response, pathname, responseHeaders)),
      apiNotFound: (response: ServerResponse) =>
        json(response, 404, reject('InvalidInput').body),
      notFound: (response: ServerResponse) =>
        response
          .writeHead(404, responseHeaders('text/plain; charset=utf-8'))
          .end(),
    }
    return async (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://local')
      if (request.method === 'GET' && url.pathname === '/health/live')
        return routes.live(response)
      routes.expireReconnectGrace()
      const admissionRequest: AdmissionRequest = {
        method: request.method ?? 'GET',
        path: url.pathname,
        headers: request.headers,
      }
      const identity = await routes.identityResolver(admissionRequest)
      if (identity === undefined)
        return routes.unauthenticated(
          response,
          request.method ?? 'GET',
          url.pathname,
        )
      if (request.method === 'GET' && url.pathname === '/api/snapshot')
        return routes.snapshot(response, identity)
      if (request.method === 'GET' && url.pathname === '/api/health/ready')
        return routes.ready(response)
      if (request.method === 'GET' && url.pathname === '/api/health/operations')
        return routes.operations(response, identity)
      if (request.method === 'GET' && url.pathname === '/api/events')
        return routes.events(request, response, identity)
      if (request.method === 'POST' && url.pathname === '/api/commands/control')
        return routes.control(response, identity, request)
      if (
        request.method === 'GET' &&
        url.pathname === '/api/simulation' &&
        routes.simulationProjection !== undefined
      )
        return routes.simulationProjection(response)
      if (
        request.method === 'POST' &&
        url.pathname === '/api/simulation' &&
        routes.simulationControl !== undefined
      )
        return routes.simulationControl(response, identity, request)
      if (request.method === 'GET' && url.pathname === '/api/workspaces/plan')
        return routes.planWorkspace(response)
      if (
        url.pathname === '/api/process/projects' ||
        url.pathname.startsWith('/api/process/projects/')
      )
        return routes.processingProjects(response, identity, request, url)
      if (request.method === 'GET' && url.pathname === '/api/library')
        return routes.libraryPage(response, url)
      if (
        request.method === 'GET' &&
        url.pathname === '/api/observe/live-frame'
      )
        return routes.observeLiveFrameReview(response, identity)
      if (
        request.method === 'GET' &&
        url.pathname.startsWith('/api/library/assets/') &&
        url.pathname.endsWith('/download')
      )
        return routes.libraryDownload(response, url)
      if (
        request.method === 'GET' &&
        url.pathname.startsWith('/api/library/assets/') &&
        url.pathname.endsWith('/process-source')
      )
        return routes.libraryProcessSource(
          response,
          url.pathname.slice(
            '/api/library/assets/'.length,
            -'/process-source'.length,
          ),
        )
      if (
        request.method === 'GET' &&
        url.pathname.startsWith('/api/library/assets/') &&
        url.pathname.endsWith('/preview')
      )
        return routes.libraryPreview(
          response,
          url.pathname.slice('/api/library/assets/'.length, -'/preview'.length),
          identity,
        )
      if (
        request.method === 'GET' &&
        url.pathname.startsWith('/api/library/assets/')
      )
        return routes.libraryDetail(
          response,
          url.pathname.slice('/api/library/assets/'.length),
        )
      if (
        request.method === 'POST' &&
        url.pathname.startsWith('/api/library/assets/') &&
        url.pathname.endsWith('/review')
      )
        return routes.libraryReview(
          response,
          identity,
          request,
          url.pathname.slice('/api/library/assets/'.length, -'/review'.length),
        )
      if (request.method === 'POST' && url.pathname === '/api/plan/commands')
        return routes.planCommand(response, identity, request)
      if (request.method === 'POST' && url.pathname === '/api/observe/commands')
        return routes.observeCommand(response, identity, request)
      if (
        request.method === 'POST' &&
        url.pathname === '/api/observe/preflight'
      )
        return routes.refreshPreflight(response, identity, request)
      if (request.method === 'POST' && url.pathname === '/api/acquire/commands')
        return routes.polarCommand(response, identity, request)
      if (request.method === 'GET' && routes.webAsset(response, url.pathname))
        return
      if (request.method === 'GET' && routes.webRoute(response, url.pathname))
        return
      if (url.pathname.startsWith('/api/')) return routes.apiNotFound(response)
      return routes.notFound(response)
    }
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
    Effect.runSync(Scope.close(runtimeScope, Exit.void))
  }
  const projectionIdentity = () => {
    const identity = identityResolver({
      method: 'GET',
      path: '/api/snapshot',
      headers: {},
    })
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
    if (result.outcome === 'accepted') publishProjection(result.cursor)
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
    if (result.outcome === 'recorded') publishProjection(result.cursor)
    return result
  }
  const advanceFakeRun = () => {
    const result = runRepository.advance(projectionIdentity())
    if (result?.event !== undefined) publishProjection(result.event.cursor)
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
