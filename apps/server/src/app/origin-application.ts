import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Context, Effect, Layer, Schedule, Schema, Stream } from 'effect'
import type { OriginServerConfig } from '../config/environment-config.ts'
import type { PreflightProviderConfig } from '../config/environment-config.ts'
import { reject } from '../http/origin-handlers.ts'
import {
  makeOriginHttpApplication,
  type OriginHttpApplication,
} from '../http/effect-origin-http.ts'
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
import type { PolarMeasurementProviderShape } from '../services/polar-service.ts'
import type { TargetAcquisitionProviderShape } from '../services/target-acquisition-service.ts'
import { configuredTargetAcquisitionProvider } from '../services/configured-target-acquisition-provider.ts'
import { developmentTargetAcquisitionProvider } from '../services/development-target-acquisition-provider.ts'
import type { CapturedFrameStorage } from '../services/captured-frame-intake.ts'
import type { FrameInspectionStorage } from '../services/frame-inspection.ts'
import type { PlateSolveWorkerConfig } from '../workers/plate-solve-worker.ts'
import type { RunExecutionContext } from '../services/run-domain.ts'
import { acquireSqliteRepository } from '../persistence/acquire-sqlite-repository.ts'
import { createRunExecutorWorker } from '../workers/run-executor-worker.ts'
import {
  absentLibraryDownloadGrantLayer,
  configuredLibraryDownloadGrantLayer,
  configuredLibraryRepresentationStorageLayer,
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
  preflightCommandServiceLayer,
} from '../services/preflight-command-service.ts'
import type { ReadOnlyPreflightProviderShape } from '../services/preflight-service.ts'
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
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import {
  createProcessWorkWorker,
  processWorkResultChangesProjection,
} from '../workers/process-work-worker.ts'

const LibraryDetailRow = Schema.Struct({ detail: Schema.String })
const LibraryDetailJson = Schema.Record(Schema.String, Schema.Unknown)

export type OriginApplicationDependencies = {
  readonly preflightProvider?: ReadOnlyPreflightProviderShape
  readonly cameraProvider?: CameraProviderShape
  readonly polarMeasurementProvider?: PolarMeasurementProviderShape
  readonly targetAcquisitionProvider?: TargetAcquisitionProviderShape
  readonly configuredTargetProvider?: PreflightProviderConfig
  readonly capturedFrameStorage?: CapturedFrameStorage
  readonly frameInspectionStorage?: FrameInspectionStorage
  readonly plateSolveWorker?: PlateSolveWorkerConfig
  readonly runExecutionContext?: typeof RunExecutionContext.Type
  readonly runExecutorProviderOrigin?: string
  readonly downloadGrantIssuer?: DownloadGrantIssuer
  readonly downloadGrantNow?: () => Date
  readonly observeProjectionPublication?: (
    event: 'connect' | 'disconnect' | 'publish' | 'writeFailure',
  ) => void
  readonly processWorkRoot?: string
  readonly processWorkAutoRun?: boolean
  readonly processFailBuildStage?: 'align'
}

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

export const makeProductionOriginGraph = (
  config: OriginServerConfig,
  dependencies: OriginApplicationDependencies,
) =>
  Effect.gen(function* () {
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
          dependencies.runExecutionContext === undefined ||
            (config.simulation !== undefined &&
              dependencies.runExecutorProviderOrigin !==
                config.simulation.origin)
            ? dependencies.cameraProvider === undefined
              ? { executor: 'fake' }
              : { executor: 'unavailable' }
            : {
                executor: 'real',
                executionContext: dependencies.runExecutionContext,
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
          ...(dependencies.observeProjectionPublication === undefined
            ? {}
            : {
                observe: (event) =>
                  dependencies.observeProjectionPublication?.(event),
              }),
        }),
      ),
      ProjectionPublication,
    )
    const runExecutor =
      dependencies.cameraProvider === undefined ||
      dependencies.runExecutionContext === undefined ||
      (config.simulation !== undefined &&
        dependencies.runExecutorProviderOrigin !== config.simulation.origin)
        ? undefined
        : createRunExecutorWorker({
            database,
            stateRepository: repository,
            cameraProvider: dependencies.cameraProvider,
            acquireRepository: acquireSqliteRepository(database),
            developmentDeepSkyHold:
              dependencies.configuredTargetProvider !== undefined ||
              config.simulation?.launchScenario ===
                'target-evidence-progression' ||
              config.simulation?.launchScenario === 'solve-success-no-solution',
            ...(dependencies.capturedFrameStorage === undefined
              ? {}
              : {
                  capturedFrameStorage: dependencies.capturedFrameStorage,
                }),
            ...(dependencies.frameInspectionStorage === undefined
              ? {}
              : {
                  frameInspectionStorage: dependencies.frameInspectionStorage,
                }),
            publish: (_type, cursor) =>
              Effect.runSync(publication.publish(cursor)),
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
      dependencies.targetAcquisitionProvider ??
      (dependencies.configuredTargetProvider !== undefined &&
      dependencies.capturedFrameStorage !== undefined &&
      dependencies.cameraProvider !== undefined &&
      dependencies.plateSolveWorker !== undefined
        ? configuredTargetAcquisitionProvider({
            database,
            alpaca: dependencies.configuredTargetProvider,
            cameraProvider: dependencies.cameraProvider,
            capturedFrameStorage: dependencies.capturedFrameStorage,
            plateSolveWorker: dependencies.plateSolveWorker,
            ...(dependencies.frameInspectionStorage === undefined
              ? {}
              : {
                  frameInspectionStorage: dependencies.frameInspectionStorage,
                }),
            publish: (_type, cursor) =>
              Effect.runSync(publication.publish(cursor)),
          })
        : undefined) ??
      (config.simulation !== undefined &&
      dependencies.capturedFrameStorage !== undefined &&
      dependencies.cameraProvider !== undefined &&
      (config.simulation.launchScenario === 'target-evidence-progression' ||
        config.simulation.launchScenario === 'solve-success-no-solution')
        ? developmentTargetAcquisitionProvider({
            database,
            simulation: config.simulation,
            capturedFrameStorage: dependencies.capturedFrameStorage,
            cameraProvider: dependencies.cameraProvider,
            ...(dependencies.frameInspectionStorage === undefined
              ? {}
              : {
                  frameInspectionStorage: dependencies.frameInspectionStorage,
                }),
            publish: (_type, cursor) =>
              Effect.runSync(publication.publish(cursor)),
          })
        : undefined) ??
      fixtureTargetAcquisitionProvider(config.fixture)
    const polarMeasurementProvider =
      dependencies.polarMeasurementProvider ??
      fixturePolarMeasurementProvider(config.fixture)
    const acquireSelections = Layer.mergeAll(
      dependencies.cameraProvider === undefined
        ? absentCameraProviderSelectionLayer
        : configuredCameraProviderSelectionLayer(dependencies.cameraProvider),
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
      dependencies.cameraProvider === undefined
        ? unavailableCameraExposureMaterializationLayer
        : configuredCameraExposureMaterializationLayer(
            dependencies.cameraProvider,
            config.runtime.originalsRoot,
          ).pipe(Layer.provide(baseLayer)),
      config.simulation === undefined
        ? standardAcquireOuterTransitionPolicyLayer
        : boundedSimulationAcquireOuterTransitionPolicyLayer,
      dependencies.preflightProvider === undefined
        ? absentReadOnlyPreflightProviderSelectionLayer
        : configuredReadOnlyPreflightProviderSelectionLayer(
            dependencies.preflightProvider,
          ),
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
              configuredLibraryRepresentationStorageLayer({
                originalsRoot: config.runtime.originalsRoot,
                previewsRoot: config.runtime.previewRoot,
              }),
              dependencies.downloadGrantIssuer === undefined
                ? absentLibraryDownloadGrantLayer
                : configuredLibraryDownloadGrantLayer(
                    dependencies.downloadGrantIssuer,
                    dependencies.downloadGrantNow,
                  ),
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
        dependencies.processWorkRoot ??
        (config.runtime.databasePath === ':memory:'
          ? join(tmpdir(), `astro-console-process-${randomUUID()}`)
          : `${config.runtime.databasePath}.process-work`),
      ...(dependencies.processFailBuildStage === undefined
        ? {}
        : { failBuildStage: dependencies.processFailBuildStage }),
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
    if (dependencies.processWorkAutoRun !== false)
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

export const makeProductionOriginApplication = (
  config: OriginServerConfig,
  dependencies: OriginApplicationDependencies,
): Effect.Effect<
  OriginHttpApplication,
  unknown,
  import('effect').Scope.Scope
> =>
  makeProductionOriginGraph(config, dependencies).pipe(
    Effect.map(({ application }) => application),
  )
