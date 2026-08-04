import { Effect, Exit, Match, Schema, Scope } from 'effect'
import type { ServerResponse } from 'node:http'
import {
  BootstrapHttpSuccessEnvelope,
  CommandHttpFailureEnvelope,
  RefreshPreflightResponse,
} from '@astro-console/v2-contracts'
import {
  cleanupProcessOrphans,
  saveProcessOutputs,
  type ProcessSaveStorage,
} from '../services/process-save.ts'
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
  libraryDetail,
  libraryPage,
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
    readonly webDistPath?: string
    readonly preflightProvider?: ReadOnlyPreflightProviderShape
    readonly polarMeasurementProvider?: PolarMeasurementProviderShape
    readonly targetAcquisitionProvider?: TargetAcquisitionProviderShape
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
    options.fixture === 'target-lunar'
  ) {
    const acquisitionMethod =
      options.fixture === 'target-deep-sky'
        ? 'deepSkyPlateSolve'
        : 'lunarDiskLimb'
    const run = {
      id: `run-${acquisitionMethod}-fixture`,
      revision: 1,
      phase: 'acquire' as const,
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
    acquireRepository.install(
      targetAcquisitionSession(run.id, acquisitionMethod),
    )
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
          responseHeaders,
        }),
      ),
    ),
  )
  let closed = false
  const publish = (type: string, cursor: number) =>
    Effect.runSync(projectionPublication.publish(type, cursor))
  const targetAcquisitionProvider =
    options.targetAcquisitionProvider ??
    (options.fixture === 'target-deep-sky' || options.fixture === 'target-lunar'
      ? deterministicTargetAcquisitionProvider
      : undefined)

  const handler = createOriginRouter({
    identityResolver,
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
      processWorkspace(
        response,
        database,
        url,
        () => stateRepository.state().snapshotVersion,
      ),
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
      ),
    libraryDetail: (response, encodedAssetId) =>
      libraryDetail(
        response,
        database,
        encodedAssetId,
        () => stateRepository.state().snapshotVersion,
      ),
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
        return json(response, 200, result.response)
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
      let decoded: typeof AcquireCommandRequest.Type | undefined
      try {
        decoded = Schema.decodeUnknownSync(AcquireCommandRequest)(raw)
      } catch {}
      if (decoded !== undefined) {
        const prior = acquireRepository.receipt(
          decoded.intent.idempotencyKey,
          identity.clientId,
        )
        if (prior !== undefined) return json(response, prior.status, prior.body)
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
          AcquireIntent.guards.CaptureTargetAcquisitionEvidence(decoded.intent)
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
            commit: (session, type) => acquireRepository.commit(session, type),
          }),
        ),
      )
      const result: PolarCommandResult | TargetAcquisitionCommandResult =
        await Effect.runPromise(
          program.pipe(
            (effect) =>
              options.polarMeasurementProvider === undefined
                ? effect
                : effect.pipe(
                    Effect.provideService(
                      PolarMeasurementProvider,
                      options.polarMeasurementProvider,
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
          snapshot: Effect.runSync(stateRepository.bootstrapSnapshot(identity)),
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
    apiNotFound: (response) => json(response, 404, reject('InvalidInput').body),
    notFound: (response) =>
      response
        .writeHead(404, responseHeaders('text/plain; charset=utf-8'))
        .end(),
  })
  const listen = async (port = 0, host = '127.0.0.1') => {
    const scope = Effect.runSync(Scope.make())
    const listener = await Effect.runPromise(
      Scope.provide(
        originListener.listen(port, host, (request, response) => {
          void handler(request, response)
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
    cleanupSavedOrphans,
    advanceFakeRun,
  }
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
export const startOrigin = () =>
  runExecutable('origin server', async () => {
    const config = await Effect.runPromise(originServerConfig)
    const admission = createOriginAdmission(config)
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
            }),
        webDistPath: config.runtime.webDistPath,
      },
    )
    await service
      .listen(config.runtime.port, config.runtime.host)
      .then(({ port }) =>
        console.log(
          `Astro Console ${config.runtime.release}: http://127.0.0.1:${port}`,
        ),
      )
  })
