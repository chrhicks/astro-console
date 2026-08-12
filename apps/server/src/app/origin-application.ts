import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import {
  Context,
  Effect,
  Layer,
  Match,
  Queue,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import type { OriginServerConfig } from '../config/environment-config.ts'
import { reject } from '../http/origin-handlers.ts'
import { makeOriginHttpApplication } from '../http/effect-origin-http.ts'
import {
  openOriginDatabase,
  OriginDatabase,
  originDatabaseLayer,
} from '../persistence/database.ts'
import {
  RunSqliteRepository,
  runSqliteRepositoryLayer,
} from '../persistence/run-sqlite-repository.ts'
import {
  StateSqliteRepository,
  stateSqliteRepositoryLayer,
} from '../persistence/state-sqlite-repository.ts'
import { sqliteLibraryServiceLayer } from '../persistence/library-sqlite-repository.ts'
import { installPublishedLibraryFixture } from '../persistence/library-sqlite-repository.ts'
import {
  AcquireCommandService,
  CameraExposureMaterialization,
  CameraProviderSelection,
  PolarMeasurementProviderSelection,
  TargetAcquisitionProviderSelection,
  absentCameraProviderSelectionLayer,
  absentPolarMeasurementProviderSelectionLayer,
  absentTargetAcquisitionProviderSelectionLayer,
  acquireCommandServiceLayer,
  boundedSimulationAcquireOuterTransitionPolicyLayer,
  configuredCameraProviderSelectionLayer,
  configuredPolarMeasurementProviderSelectionLayer,
  configuredTargetAcquisitionProviderSelectionLayer,
  standardAcquireOuterTransitionPolicyLayer,
  unavailableCameraExposureMaterializationLayer,
} from '../services/acquire-command-service.ts'
import type { CameraProviderShape } from '../services/camera-command-service.ts'
import { materializeCapturedFrame } from '../services/captured-frame-intake.ts'
import { configuredTargetAcquisitionProvider } from '../services/configured-target-acquisition-provider.ts'
import { developmentTargetAcquisitionProvider } from '../services/development-target-acquisition-provider.ts'
import { acquireSqliteRepository } from '../persistence/acquire-sqlite-repository.ts'
import { createRunExecutorWorker } from '../workers/run-executor-worker.ts'
import {
  LibraryDownloadGrantSelection,
  LibraryRepresentationStorageSelection,
  LibraryRepresentationService,
  libraryRepresentationServiceLayer,
} from '../services/library-representation-service.ts'
import {
  LibraryReviewService,
  libraryReviewServiceLayer,
} from '../services/library-review-service.ts'
import { LibraryService } from '../services/library-service.ts'
import {
  absentReadOnlyPreflightProviderSelectionLayer,
  configuredReadOnlyPreflightProviderSelectionLayer,
  PreflightCommandService,
  ReadOnlyPreflightProviderSelection,
  preflightCommandServiceLayer,
} from '../services/preflight-command-service.ts'
import {
  ProcessingProjectLifecycle,
  ProcessingProjectWork,
  processingProjectLifecycleLayer,
} from '../services/processing-project-service.ts'
import {
  ProjectionPublication,
  projectionPublicationLayer,
} from '../services/projection-publication.ts'
import {
  initializeRuntimeState,
  installDevelopmentSimulationPlan,
  installM27Fixture,
} from '../services/runtime-bootstrap.ts'
import {
  fixturePolarMeasurementProvider,
  fixtureTargetAcquisitionProvider,
  installOriginFixtureState,
} from './origin-fixtures.ts'
import {
  bootstrapPlanWorkspaceProjection,
  observeWorkspaceProjection,
} from '../services/workspace-projection-service.ts'
import {
  createProcessWorkWorker,
  processWorkResultChangesProjection,
} from '../workers/process-work-worker.ts'
import {
  OriginApplicationTelemetry,
  OriginCapturedFrameStorage,
  OriginConfiguredTargetProvider,
  OriginFrameInspectionStorage,
  OriginPlateSolveWorker,
  OriginProcessWorkBehavior,
  OriginProjectionObservation,
  OriginRunExecution,
  type OptionalSelection,
} from './origin-application-services.ts'
import { tracedExecutorWork } from '../observability/executor-telemetry.ts'
import {
  tracedFrameInspection,
  tracedFrameIntake,
} from '../observability/pipeline-telemetry.ts'
import {
  recordSqliteBacklog,
  tracedSqliteOperation,
} from '../observability/sqlite-telemetry.ts'
import {
  recordProcessBacklog,
  recordProcessPressureMetric,
  tracedProcessWorker,
} from '../observability/process-telemetry.ts'

const LibraryDetailRow = Schema.Struct({ detail: Schema.String })
const LibraryDetailJson = Schema.Record(Schema.String, Schema.Unknown)

const configuredValue = <A>(selection: OptionalSelection<A>) =>
  Match.value(selection).pipe(
    Match.tag('Configured', ({ value }) => value),
    Match.orElse(() => undefined),
  )

export const consumeProjectionInvalidations = (
  invalidations: Queue.Queue<number>,
  publish: (cursor: number) => Effect.Effect<void>,
) => Queue.take(invalidations).pipe(Effect.flatMap(publish), Effect.forever)

const configuredCameraExposureMaterializationLayer = (
  provider: CameraProviderShape,
  originalsRoot: string,
) =>
  Layer.effect(
    CameraExposureMaterialization,
    Effect.gen(function* () {
      const { database } = yield* OriginDatabase
      const publication = yield* ProjectionPublication
      return CameraExposureMaterialization.of({
        complete: (raw) =>
          provider.readImageArray === undefined
            ? Effect.succeed({
                outcome: 'rejected' as const,
                reason: 'MaterializationFailed' as const,
              })
            : provider.readImageArray().pipe(
                Effect.map((image) =>
                  materializeCapturedFrame(
                    database,
                    { originalsRoot },
                    {
                      ...Schema.decodeUnknownSync(
                        Schema.Record(Schema.String, Schema.Unknown),
                      )(raw),
                      format: image.format,
                    },
                    image.bytes,
                  ),
                ),
                Effect.tap((result) =>
                  result.outcome === 'accepted'
                    ? publication.publish(result.cursor)
                    : Effect.void,
                ),
                Effect.tap((result) =>
                  result.outcome === 'accepted'
                    ? Effect.sync(() => {
                        const row = Schema.decodeUnknownSync(LibraryDetailRow)(
                          database
                            .prepare(
                              'SELECT detail FROM library_assets WHERE asset_id=?',
                            )
                            .get(result.assetId),
                        )
                        const detail = Schema.decodeUnknownSync(
                          LibraryDetailJson,
                        )(JSON.parse(row.detail))
                        const representations = Array.isArray(
                          detail.representations,
                        )
                          ? detail.representations
                          : []
                        database
                          .prepare(
                            'UPDATE library_assets SET detail=? WHERE asset_id=?',
                          )
                          .run(
                            JSON.stringify({
                              ...detail,
                              representations: [
                                ...representations,
                                {
                                  label:
                                    'Preview unavailable for this retained camera original',
                                  state: 'unavailable',
                                },
                              ],
                            }),
                            result.assetId,
                          )
                      })
                    : Effect.void,
                ),
                Effect.catch(() =>
                  Effect.succeed({
                    outcome: 'rejected' as const,
                    reason: 'MaterializationFailed' as const,
                  }),
                ),
              ),
      })
    }),
  )

export const makeProductionOriginGraph = (config: OriginServerConfig) =>
  Effect.gen(function* () {
    const cameraSelection = yield* CameraProviderSelection
    const polarSelection = yield* PolarMeasurementProviderSelection
    const targetSelection = yield* TargetAcquisitionProviderSelection
    const preflightSelection = yield* ReadOnlyPreflightProviderSelection
    const capturedFrameStorageSelection = yield* OriginCapturedFrameStorage
    const frameInspectionStorageSelection = yield* OriginFrameInspectionStorage
    const plateSolveWorkerSelection = yield* OriginPlateSolveWorker
    const configuredTargetSelection = yield* OriginConfiguredTargetProvider
    const runExecution = yield* OriginRunExecution
    const representationStorage = yield* LibraryRepresentationStorageSelection
    const downloadGrant = yield* LibraryDownloadGrantSelection
    const observeProjection = yield* OriginProjectionObservation
    const processWorkBehavior = yield* OriginProcessWorkBehavior
    const telemetry = yield* OriginApplicationTelemetry
    const cameraProvider = Match.value(cameraSelection).pipe(
      Match.tag('Configured', ({ provider }) => provider),
      Match.orElse(() => undefined),
    )
    const polarProvider = Match.value(polarSelection).pipe(
      Match.tag('Configured', ({ provider }) => provider),
      Match.orElse(() => undefined),
    )
    const targetProvider = Match.value(targetSelection).pipe(
      Match.tag('Configured', ({ provider }) => provider),
      Match.orElse(() => undefined),
    )
    const preflightProvider = Match.value(preflightSelection).pipe(
      Match.tag('Configured', ({ provider }) => provider),
      Match.orElse(() => undefined),
    )
    const capturedFrameStorage = configuredValue(capturedFrameStorageSelection)
    const frameInspectionStorage = configuredValue(
      frameInspectionStorageSelection,
    )
    const configuredTargetProvider = configuredValue(configuredTargetSelection)
    const plateSolveWorker = configuredValue(plateSolveWorkerSelection)
    const configuredRunExecution = Match.value(runExecution).pipe(
      Match.tag('Configured', (configured) => configured),
      Match.orElse(() => undefined),
    )
    const database = openOriginDatabase(config.runtime.databasePath)
    yield* Effect.addFinalizer(() => Effect.sync(() => database.close()))

    if (config.fixture === undefined) initializeRuntimeState(database)
    else
      installM27Fixture(
        database,
        config.fixture === 'plan-draft'
          ? false
          : config.fixture === 'preflight'
            ? 'fake'
            : 'fixture',
      )
    if (config.fixture === 'library-published')
      installPublishedLibraryFixture(database)
    if (config.simulation !== undefined)
      installDevelopmentSimulationPlan(
        database,
        config.simulation.launchScenario,
      )

    const repository = Context.get(
      yield* Layer.build(
        stateSqliteRepositoryLayer(database, {
          plan: bootstrapPlanWorkspaceProjection,
          observe: (db, identity, current) =>
            observeWorkspaceProjection(db, identity, current, {
              suppressTargetTerminalActions:
                config.simulation?.launchScenario ===
                  'target-evidence-progression' ||
                config.simulation?.launchScenario ===
                  'solve-success-no-solution',
            }),
        }),
      ),
      StateSqliteRepository,
    )
    installOriginFixtureState(database, repository, config.fixture)
    const runRepository = Context.get(
      yield* Layer.build(
        runSqliteRepositoryLayer(
          database,
          repository,
          reject,
          configuredRunExecution === undefined ||
            (config.simulation !== undefined &&
              configuredRunExecution.providerOrigin !==
                config.simulation.origin)
            ? cameraProvider === undefined
              ? { executor: 'fake' }
              : { executor: 'unavailable' }
            : {
                executor: 'real',
                executionContext: configuredRunExecution.context,
              },
        ),
      ),
      RunSqliteRepository,
    )
    const publication = Context.get(
      yield* Layer.build(
        projectionPublicationLayer({
          expire: repository.expireReconnectGrace,
          currentCursor: () => repository.state().eventCursor,
          eventFor: repository.projectionEvent,
          controllerConnected: repository.controllerConnected,
          controllerDisconnected: repository.controllerDisconnected,
          observe: observeProjection,
        }),
      ),
      ProjectionPublication,
    )
    const projectionInvalidations = yield* Queue.unbounded<number>()
    const invalidateProjection = (cursor: number) => {
      Queue.offerUnsafe(projectionInvalidations, cursor)
    }
    yield* consumeProjectionInvalidations(
      projectionInvalidations,
      publication.publish,
    ).pipe(Effect.forkScoped)
    const runExecutor =
      cameraProvider === undefined ||
      configuredRunExecution === undefined ||
      (config.simulation !== undefined &&
        configuredRunExecution.providerOrigin !== config.simulation.origin)
        ? undefined
        : createRunExecutorWorker({
            database,
            stateRepository: repository,
            cameraProvider,
            acquireRepository: acquireSqliteRepository(database),
            developmentDeepSkyHold:
              configuredTargetProvider !== undefined ||
              config.simulation?.launchScenario ===
                'target-evidence-progression' ||
              config.simulation?.launchScenario === 'solve-success-no-solution',
            ...(capturedFrameStorage === undefined
              ? {}
              : {
                  capturedFrameStorage,
                }),
            ...(frameInspectionStorage === undefined
              ? {}
              : {
                  frameInspectionStorage,
                }),
            publish: (_type, cursor) => invalidateProjection(cursor),
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
          })
    if (runExecutor !== undefined)
      yield* Effect.forkScoped(
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
    const baseLayer = Layer.mergeAll(
      originDatabaseLayer(database),
      Layer.succeed(StateSqliteRepository, repository),
      Layer.succeed(RunSqliteRepository, runRepository),
      Layer.succeed(ProjectionPublication, publication),
    )
    const selectedTargetProvider =
      targetProvider ??
      (configuredTargetProvider !== undefined &&
      capturedFrameStorage !== undefined &&
      cameraProvider !== undefined &&
      plateSolveWorker !== undefined
        ? configuredTargetAcquisitionProvider({
            database,
            alpaca: configuredTargetProvider,
            cameraProvider,
            capturedFrameStorage,
            plateSolveWorker,
            ...(frameInspectionStorage === undefined
              ? {}
              : {
                  frameInspectionStorage,
                }),
            publish: (_type, cursor) => invalidateProjection(cursor),
          })
        : undefined) ??
      (config.simulation !== undefined &&
      capturedFrameStorage !== undefined &&
      cameraProvider !== undefined &&
      (config.simulation.launchScenario === 'target-evidence-progression' ||
        config.simulation.launchScenario === 'solve-success-no-solution')
        ? developmentTargetAcquisitionProvider({
            database,
            simulation: config.simulation,
            capturedFrameStorage,
            cameraProvider,
            ...(frameInspectionStorage === undefined
              ? {}
              : {
                  frameInspectionStorage,
                }),
            publish: (_type, cursor) => invalidateProjection(cursor),
          })
        : undefined) ??
      fixtureTargetAcquisitionProvider(config.fixture)
    const polarMeasurementProvider =
      polarProvider ?? fixturePolarMeasurementProvider(config.fixture)
    const acquireSelections = Layer.mergeAll(
      cameraProvider === undefined
        ? absentCameraProviderSelectionLayer
        : configuredCameraProviderSelectionLayer(cameraProvider),
      polarMeasurementProvider === undefined
        ? absentPolarMeasurementProviderSelectionLayer
        : configuredPolarMeasurementProviderSelectionLayer(
            polarMeasurementProvider,
          ),
      selectedTargetProvider === undefined
        ? absentTargetAcquisitionProviderSelectionLayer
        : configuredTargetAcquisitionProviderSelectionLayer(
            selectedTargetProvider,
          ),
      cameraProvider === undefined
        ? unavailableCameraExposureMaterializationLayer
        : configuredCameraExposureMaterializationLayer(
            cameraProvider,
            config.runtime.originalsRoot,
          ).pipe(Layer.provide(baseLayer)),
      config.simulation === undefined
        ? standardAcquireOuterTransitionPolicyLayer
        : boundedSimulationAcquireOuterTransitionPolicyLayer,
      preflightProvider === undefined
        ? absentReadOnlyPreflightProviderSelectionLayer
        : configuredReadOnlyPreflightProviderSelectionLayer(preflightProvider),
    )
    const serviceDependencies = Layer.merge(baseLayer, acquireSelections)
    const acquire = Context.get(
      yield* Layer.build(
        acquireCommandServiceLayer.pipe(Layer.provide(serviceDependencies)),
      ),
      AcquireCommandService,
    )
    const preflight = Context.get(
      yield* Layer.build(
        preflightCommandServiceLayer.pipe(Layer.provide(serviceDependencies)),
      ),
      PreflightCommandService,
    )
    const library = Context.get(
      yield* Layer.build(
        sqliteLibraryServiceLayer(
          database,
          () => repository.state().snapshotVersion,
        ),
      ),
      LibraryService,
    )
    const libraryLayer = Layer.merge(
      baseLayer,
      Layer.succeed(LibraryService, library),
    )
    const review = Context.get(
      yield* Layer.build(
        libraryReviewServiceLayer.pipe(Layer.provide(libraryLayer)),
      ),
      LibraryReviewService,
    )
    const representation = Context.get(
      yield* Layer.build(
        libraryRepresentationServiceLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(LibraryService, library),
              Layer.succeed(
                LibraryRepresentationStorageSelection,
                representationStorage,
              ),
              Layer.succeed(LibraryDownloadGrantSelection, downloadGrant),
            ),
          ),
        ),
      ),
      LibraryRepresentationService,
    )
    const projects = yield* Layer.build(
      processingProjectLifecycleLayer(database),
    )
    const lifecycle = Context.get(projects, ProcessingProjectLifecycle)
    const work = Context.get(projects, ProcessingProjectWork)
    const processWorker = createProcessWorkWorker({
      outputRoot:
        processWorkBehavior.outputRoot ??
        (config.runtime.databasePath === ':memory:'
          ? join(tmpdir(), `astro-console-process-${randomUUID()}`)
          : `${config.runtime.databasePath}.process-work`),
      traceWork: (kind, stage, run) =>
        telemetry.runSync(tracedProcessWorker(kind, stage, Effect.sync(run))),
      observeBacklog: (count, oldestAgeSeconds) => {
        telemetry.runSync(recordProcessBacklog(count, oldestAgeSeconds))
        telemetry.runSync(recordSqliteBacklog('process', count))
      },
      observePressure: (state) =>
        telemetry.runSync(recordProcessPressureMetric(state)),
    })
    const publishProcessingProjection = () =>
      publication.publish(repository.advanceProjectionCursor())

    yield* Effect.forkScoped(
      lifecycle
        .changes({
          personId: 'system',
          clientId: 'processing-project-notices',
          role: 'owner',
          capability: 'controlCapable',
        })
        .pipe(Stream.runForEach(() => publishProcessingProjection())),
    )
    if (processWorkBehavior.autoRun)
      yield* Effect.forkScoped(
        processWorker.pass().pipe(
          Effect.provideService(ProcessingProjectWork, work),
          Effect.flatMap((result) =>
            processWorkResultChangesProjection(result)
              ? publishProcessingProjection()
              : Effect.void,
          ),
          Effect.catch((cause) =>
            Effect.logError('ProcessWorkWorker.pass failed', cause),
          ),
          Effect.repeat(Schedule.spaced('250 millis')),
        ),
      )

    const applicationLayer = Layer.mergeAll(
      baseLayer,
      Layer.succeed(AcquireCommandService, acquire),
      Layer.succeed(PreflightCommandService, preflight),
      Layer.succeed(LibraryService, library),
      Layer.succeed(LibraryReviewService, review),
      Layer.succeed(LibraryRepresentationService, representation),
      Layer.succeed(ProcessingProjectLifecycle, lifecycle),
      Layer.succeed(ProcessingProjectWork, work),
    )
    const context = yield* Layer.build(applicationLayer)
    const application = yield* makeOriginHttpApplication(
      config.runtime.webDistPath,
      config.simulation,
    ).pipe(
      Effect.provide(context),
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(NodePath.layer),
    )
    return { application, context }
  })

export const makeProductionOriginApplication = (config: OriginServerConfig) =>
  makeProductionOriginGraph(config).pipe(
    Effect.map(({ application }) => application),
  )
