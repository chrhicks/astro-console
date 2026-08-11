import type { DatabaseSync } from 'node:sqlite'
import { Context, Effect, Layer, Match, Option, Schema } from 'effect'
import {
  AcquireCommandRequest,
  AcquireCommandResponse,
  AcquireIntent,
  CameraCommandRequest,
  CameraCommandResponse,
  PreflightSnapshot,
} from '@astro-console/protocol'
import type { LocalIdentity } from '../auth/identity.ts'
import { acquireSqliteRepository } from '../persistence/acquire-sqlite-repository.ts'
import { OriginDatabase } from '../persistence/database.ts'
import {
  StateSqliteRepository,
  type StateSqliteRepositoryShape,
} from '../persistence/state-sqlite-repository.ts'
import {
  CameraProvider,
  executeCameraCommand,
  type CameraProviderShape,
} from './camera-command-service.ts'
import {
  AcquirePersistence,
  executePolarCommand,
  PolarMeasurementProvider,
  type PolarCommandResult,
  type PolarMeasurementProviderShape,
} from './polar-service.ts'
import { ProjectionPublication } from './projection-publication.ts'
import {
  executeTargetAcquisitionCommand,
  TargetAcquisitionProvider,
  type TargetAcquisitionCommandResult,
  type TargetAcquisitionProviderShape,
} from './target-acquisition-service.ts'
import { AcquireActiveWork } from './acquire-domain.ts'
import { RunDefinition } from './run-domain.ts'

const AcceptedDefinitionRow = Schema.Struct({ definition: Schema.String })
const AcceptedDefinitionRecord = Schema.Struct({ definition: RunDefinition })

type CompletedCameraExposureResult =
  | { readonly outcome: 'accepted'; readonly assetId: string }
  | { readonly outcome: 'rejected'; readonly reason: string }

export type AcquireCommandServiceOptions = {
  readonly cameraProvider?: CameraProviderShape
  readonly polarMeasurementProvider?: PolarMeasurementProviderShape
  readonly targetAcquisitionProvider?: TargetAcquisitionProviderShape
  readonly denyOuterTargetTransitions?: boolean
  readonly completeCameraExposure?: (
    raw: unknown,
  ) => Effect.Effect<CompletedCameraExposureResult, unknown>
}

export type AcquireHttpResult = {
  readonly status: number
  readonly body:
    typeof AcquireCommandResponse.Type | typeof CameraCommandResponse.Type
}

export interface AcquireCommandServiceShape {
  readonly execute: (
    raw: unknown,
    identity: LocalIdentity,
  ) => Effect.Effect<AcquireHttpResult, unknown>
}

export class AcquireCommandService extends Context.Service<
  AcquireCommandService,
  AcquireCommandServiceShape
>()('@astro-console/server/AcquireCommandService') {}

export const acquireCommandServiceLayer = (
  options: AcquireCommandServiceOptions = {},
) =>
  Layer.effect(
    AcquireCommandService,
    Effect.gen(function* () {
      const { database } = yield* OriginDatabase
      const repository = yield* StateSqliteRepository
      const publication = yield* ProjectionPublication
      const acquireRepository = acquireSqliteRepository(database)

      return AcquireCommandService.of({
        execute: Effect.fn('AcquireCommandService.execute')(
          function* (raw, identity) {
            if (identity.capability !== 'controlCapable')
              return {
                status: 403,
                body: AcquireCommandResponse.cases.Unavailable.make({
                  summary:
                    'This client is read-only and cannot record Acquire evidence.',
                }),
              }

            const camera = Schema.decodeUnknownOption(CameraCommandRequest)(raw)
            if (Option.isSome(camera))
              return yield* executeCamera(
                camera.value,
                raw,
                identity,
                database,
                repository,
                acquireRepository,
                publication.publish,
                options,
              )

            const decoded = Schema.decodeUnknownOption(AcquireCommandRequest)(
              raw,
            )
            return yield* executeAcquire(
              raw,
              decoded,
              identity,
              repository,
              acquireRepository,
              publication.publish,
              options,
            )
          },
        ),
      })
    }),
  )

type AcquireRepository = ReturnType<typeof acquireSqliteRepository>
type Publish = (cursor: number) => Effect.Effect<void, unknown>

const executeCamera = Effect.fn('AcquireCommandService.executeCamera')(
  function* (
    camera: typeof CameraCommandRequest.Type,
    raw: unknown,
    identity: LocalIdentity,
    database: DatabaseSync,
    repository: StateSqliteRepositoryShape,
    acquireRepository: AcquireRepository,
    publish: Publish,
    options: AcquireCommandServiceOptions,
  ) {
    const prior = acquireRepository.receipt(
      camera.intent.idempotencyKey,
      identity.clientId,
    )
    if (prior !== undefined)
      return {
        status: prior.status,
        body: yield* Schema.decodeUnknownEffect(CameraCommandResponse)(
          prior.body,
        ),
      }

    const current = repository.state()
    if (
      current.run === null ||
      camera.intent.expectedLeaseRevision !== current.control.revision ||
      camera.intent.expectedRunRevision !== current.run.revision
    )
      return {
        status: 409,
        body: CameraCommandResponse.cases.Rejected.make({
          summary:
            'The control lease or active run changed. Read the current Observe projection.',
        }),
      }
    if (
      current.run.preflight?.checks.some(
        (check) => check.key === 'camera-connected' && check.state === 'ready',
      ) !== true
    )
      return {
        status: 409,
        body: CameraCommandResponse.cases.Rejected.make({
          summary:
            'Current camera connection truth is not ready. Refresh preflight before any camera command.',
        }),
      }

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
        return {
          status: 409,
          body: CameraCommandResponse.cases.Rejected.make({
            summary:
              'The accepted run definition cannot supply capture equipment identity.',
          }),
        }
      const pending = CameraCommandResponse.cases.Unavailable.make({
        summary:
          'The camera image read outcome is not yet known. It will not replay.',
      })
      acquireRepository.saveReceipt(
        camera.intent.idempotencyKey,
        identity.clientId,
        { status: 503, body: pending },
      )
      const completed =
        options.completeCameraExposure === undefined
          ? ({ outcome: 'rejected', reason: 'MaterializationFailed' } as const)
          : yield* options.completeCameraExposure({
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
            })
      const body =
        completed.outcome === 'accepted'
          ? CameraCommandResponse.cases.Completed.make({
              assetId: completed.assetId,
            })
          : CameraCommandResponse.cases.Unavailable.make({
              summary: 'The completed camera image could not be retained.',
            })
      const status = completed.outcome === 'accepted' ? 202 : 503
      acquireRepository.saveReceipt(
        camera.intent.idempotencyKey,
        identity.clientId,
        { status, body },
      )
      return { status, body }
    }

    const pending = CameraCommandResponse.cases.Unavailable.make({
      summary:
        'The camera command outcome is not yet known. Refresh its state; it will not replay.',
    })
    acquireRepository.saveReceipt(
      camera.intent.idempotencyKey,
      identity.clientId,
      { status: 503, body: pending },
    )
    const result = yield* executeCameraCommand(raw).pipe(
      options.cameraProvider === undefined
        ? (effect) => effect
        : Effect.provideService(CameraProvider, options.cameraProvider),
    )
    const outcome = Match.value(result).pipe(
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
    const status = outcome.observed ? 202 : 503
    const observedAt = new Date().toISOString()
    const previous = current.run.preflight
    const preflight = Schema.decodeUnknownSync(PreflightSnapshot)({
      observedAt,
      verdict: outcome.observed
        ? (previous?.verdict ?? 'unknown')
        : 'unavailable',
      nextAction: outcome.observed
        ? (previous?.nextAction ??
          'Camera state was read after the command acknowledgement.')
        : 'Restore the camera provider, then refresh its state. The command will not replay.',
      checks: previous?.checks ?? [
        {
          key: 'camera-provider',
          state: outcome.observed ? 'unknown' : 'unavailable',
          observedAt,
          reason: outcome.observed
            ? 'No prior full rig inventory is available.'
            : outcome.summary,
        },
      ],
      ...(previous?.rig === undefined ? {} : { rig: previous.rig }),
      camera: outcome.observed
        ? outcome.observation
        : { observedAt, cameraState: 'unknown' },
    })
    const persisted = repository.persistPreflight(preflight)
    yield* publish(persisted.cursor)
    if (outcome.observed)
      database
        .prepare(
          'INSERT OR REPLACE INTO camera_observations (run_id,observation) VALUES (?,?)',
        )
        .run(current.run.id, JSON.stringify(outcome.observation))
    acquireRepository.saveReceipt(
      camera.intent.idempotencyKey,
      identity.clientId,
      { status, body: outcome.body },
    )
    return { status, body: outcome.body }
  },
)

const executeAcquire = Effect.fn('AcquireCommandService.executeAcquire')(
  function* (
    raw: unknown,
    decoded: Option.Option<typeof AcquireCommandRequest.Type>,
    identity: LocalIdentity,
    repository: StateSqliteRepositoryShape,
    acquireRepository: AcquireRepository,
    publish: Publish,
    options: AcquireCommandServiceOptions,
  ) {
    if (Option.isSome(decoded)) {
      const prior = acquireRepository.receipt(
        decoded.value.intent.idempotencyKey,
        identity.clientId,
      )
      if (prior !== undefined)
        return {
          status: prior.status,
          body: yield* Schema.decodeUnknownEffect(AcquireCommandResponse)(
            prior.body,
          ),
        }
      const current = repository.state()
      if (
        current.run === null ||
        decoded.value.intent.expectedLeaseRevision !==
          current.control.revision ||
        decoded.value.intent.expectedRunRevision !== current.run.revision
      )
        return {
          status: 409,
          body: AcquireCommandResponse.cases.Rejected.make({
            summary:
              'The control lease or active run changed. Read the current Observe projection.',
            snapshot: yield* repository.bootstrapSnapshot(identity),
          }),
        }
      const acquire = acquireRepository.current(current.run.id)
      if (
        acquire === undefined ||
        decoded.value.intent.expectedAcquireRevision !== acquire.revision
      )
        return {
          status: 409,
          body: AcquireCommandResponse.cases.Rejected.make({
            summary:
              'Target evidence changed. Read the current Observe projection.',
            snapshot: yield* repository.bootstrapSnapshot(identity),
          }),
        }
      if (
        options.denyOuterTargetTransitions === true &&
        (AcquireIntent.guards.SkipAcquireTarget(decoded.value.intent) ||
          AcquireIntent.guards.AbortAcquire(decoded.value.intent))
      ) {
        const denied = AcquireCommandResponse.cases.Rejected.make({
          summary:
            'This bounded target simulation does not implement an outer-run Skip or Abort transition.',
          snapshot: yield* repository.bootstrapSnapshot(identity),
        })
        acquireRepository.saveReceipt(
          decoded.value.intent.idempotencyKey,
          identity.clientId,
          { status: 409, body: denied },
        )
        return { status: 409, body: denied }
      }
      const providerEffect =
        (AcquireIntent.guards.CaptureTargetAcquisitionEvidence(
          decoded.value.intent,
        ) &&
          AcquireActiveWork.guards.SolveRequested(acquire.activeWork)) ||
        (AcquireIntent.guards.ApprovePointingCorrection(decoded.value.intent) &&
          acquire.pendingCorrectionProposal !== null)
      if (providerEffect) {
        const pending = AcquireCommandResponse.cases.Unavailable.make({
          summary:
            'This provider work is in progress. Reconcile current Acquire evidence; it will not replay.',
        })
        acquireRepository.saveReceipt(
          decoded.value.intent.idempotencyKey,
          identity.clientId,
          { status: 503, body: pending },
        )
      }
    }

    const persistence = AcquirePersistence.of({
      current: () => {
        const run = repository.state().run
        return run === null ? undefined : acquireRepository.current(run.id)
      },
      commit: (session, type) => acquireRepository.commit(session, type),
    })
    const targetIntent =
      Option.isSome(decoded) && isTargetIntent(decoded.value.intent)
    const program = targetIntent
      ? executeTargetAcquisitionCommand(raw)
      : executePolarCommand(raw)
    const result: PolarCommandResult | TargetAcquisitionCommandResult =
      yield* program.pipe(
        Effect.provideService(AcquirePersistence, persistence),
        options.polarMeasurementProvider === undefined
          ? (effect) => effect
          : Effect.provideService(
              PolarMeasurementProvider,
              options.polarMeasurementProvider,
            ),
        options.targetAcquisitionProvider === undefined
          ? (effect) => effect
          : Effect.provideService(
              TargetAcquisitionProvider,
              options.targetAcquisitionProvider,
            ),
      )
    return yield* Match.value(result).pipe(
      Match.tag('Committed', (committed) =>
        Effect.gen(function* () {
          yield* publish(committed.cursor)
          const body = AcquireCommandResponse.cases.Accepted.make({
            snapshot: yield* repository.bootstrapSnapshot(identity),
          })
          if (Option.isSome(decoded))
            acquireRepository.saveReceipt(
              decoded.value.intent.idempotencyKey,
              identity.clientId,
              { status: 200, body },
            )
          return { status: 200, body }
        }),
      ),
      Match.tag('Unavailable', ({ summary }) =>
        Effect.succeed({
          status: 503,
          body: AcquireCommandResponse.cases.Unavailable.make({ summary }),
        }),
      ),
      Match.tags({
        Rejected: ({ summary }) =>
          rejectedAcquireResult(summary, repository, identity),
        Aborted: ({ summary }) =>
          rejectedAcquireResult(summary, repository, identity),
      }),
      Match.exhaustive,
    )
  },
)

const rejectedAcquireResult = (
  summary: string,
  repository: StateSqliteRepositoryShape,
  identity: LocalIdentity,
) =>
  repository.bootstrapSnapshot(identity).pipe(
    Effect.map((snapshot) => ({
      status: 409,
      body: AcquireCommandResponse.cases.Rejected.make({ summary, snapshot }),
    })),
  )

function isTargetIntent(intent: typeof AcquireIntent.Type) {
  return (
    AcquireIntent.guards.CaptureTargetAcquisitionEvidence(intent) ||
    AcquireIntent.guards.RetryPlateSolveWithParameters(intent) ||
    AcquireIntent.guards.SkipAcquireTarget(intent) ||
    AcquireIntent.guards.AbortAcquire(intent) ||
    AcquireIntent.guards.RecordLiveFrameEvidence(intent) ||
    AcquireIntent.guards.StartManagedCapture(intent) ||
    AcquireIntent.guards.PauseManagedCapture(intent) ||
    AcquireIntent.guards.StopManagedCapture(intent) ||
    AcquireIntent.guards.RecenterManagedCapture(intent) ||
    AcquireIntent.guards.ApprovePointingCorrection(intent) ||
    AcquireIntent.guards.RevisePointingCorrection(intent)
  )
}

function acceptedCaptureEquipment(
  database: DatabaseSync,
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
