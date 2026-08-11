import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Context, Effect, Layer, Schedule, Stream } from 'effect'
import type { OriginServerConfig } from '../config/environment-config.ts'
import { reject } from '../http/origin-handlers.ts'
import {
  makeOriginHttpApplication,
  type OriginHttpApplication,
} from '../http/effect-origin-http.ts'
import {
  openOriginDatabase,
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
import {
  AcquireCommandService,
  absentCameraProviderSelectionLayer,
  absentPolarMeasurementProviderSelectionLayer,
  absentTargetAcquisitionProviderSelectionLayer,
  acquireCommandServiceLayer,
  boundedSimulationAcquireOuterTransitionPolicyLayer,
  configuredCameraProviderSelectionLayer,
  standardAcquireOuterTransitionPolicyLayer,
  unavailableCameraExposureMaterializationLayer,
} from '../services/acquire-command-service.ts'
import type { CameraProviderShape } from '../services/camera-command-service.ts'
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
  installM27Fixture,
} from '../services/runtime-bootstrap.ts'
import {
  bootstrapPlanWorkspaceProjection,
  observeWorkspaceProjection,
} from '../services/workspace-projection-service.ts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import {
  createProcessWorkWorker,
  processWorkResultChangesProjection,
} from '../workers/process-work-worker.ts'

export type OriginApplicationDependencies = {
  readonly preflightProvider?: ReadOnlyPreflightProviderShape
  readonly cameraProvider?: CameraProviderShape
  readonly downloadGrantIssuer?: DownloadGrantIssuer
}

export const makeProductionOriginApplication = (
  config: OriginServerConfig,
  dependencies: OriginApplicationDependencies,
): Effect.Effect<
  OriginHttpApplication,
  unknown,
  import('effect').Scope.Scope
> =>
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
    const runRepository = Context.get(
      yield* Layer.build(
        runSqliteRepositoryLayer(database, repository, reject),
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
        }),
      ),
      ProjectionPublication,
    )
    const baseLayer = Layer.mergeAll(
      originDatabaseLayer(database),
      Layer.succeed(StateSqliteRepository, repository),
      Layer.succeed(RunSqliteRepository, runRepository),
      Layer.succeed(ProjectionPublication, publication),
    )
    const acquireSelections = Layer.mergeAll(
      dependencies.cameraProvider === undefined
        ? absentCameraProviderSelectionLayer
        : configuredCameraProviderSelectionLayer(dependencies.cameraProvider),
      absentPolarMeasurementProviderSelectionLayer,
      absentTargetAcquisitionProviderSelectionLayer,
      unavailableCameraExposureMaterializationLayer,
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
    const processOutputRoot = `${config.runtime.databasePath}.process-work`
    const processWorker = createProcessWorkWorker({
      outputRoot:
        config.runtime.databasePath === ':memory:'
          ? join(tmpdir(), `astro-console-process-${randomUUID()}`)
          : processOutputRoot,
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
    )
    return yield* makeOriginHttpApplication(
      config.runtime.webDistPath,
      config.simulation,
    ).pipe(
      Effect.provide(applicationLayer),
      Effect.provide(NodeFileSystem.layer),
      Effect.provide(NodePath.layer),
    )
  })
