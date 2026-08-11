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

export interface CameraExposureMaterializationShape {
  readonly complete: (
    raw: unknown,
  ) => Effect.Effect<CompletedCameraExposureResult, unknown>
}

export class CameraExposureMaterialization extends Context.Service<
  CameraExposureMaterialization,
  CameraExposureMaterializationShape
>()('@astro-console/server/CameraExposureMaterialization') {}

export class AcquireOuterTransitionPolicy extends Context.Service<
  AcquireOuterTransitionPolicy,
  { readonly denyOuterTargetTransitions: boolean }
>()('@astro-console/server/AcquireOuterTransitionPolicy') {}

const unavailableProvider = 'No configured Acquire provider is available.'

export const unavailableCameraProviderLayer = Layer.succeed(
  CameraProvider,
  CameraProvider.of({
    startExposure: () => Effect.fail(unavailableProvider),
    abortExposure: () => Effect.fail(unavailableProvider),
    readState: () => Effect.fail(unavailableProvider),
  }),
)

export const unavailablePolarMeasurementProviderLayer = Layer.succeed(
  PolarMeasurementProvider,
  PolarMeasurementProvider.of({
    measure: () => Effect.fail(unavailableProvider),
  }),
)

export const unavailableTargetAcquisitionProviderLayer = Layer.succeed(
  TargetAcquisitionProvider,
  TargetAcquisitionProvider.of({
    capture: () => Effect.fail(unavailableProvider),
    correct: () => Effect.fail(unavailableProvider),
    frame: () => Effect.fail(unavailableProvider),
  }),
)

export const unavailableCameraExposureMaterializationLayer = Layer.succeed(
  CameraExposureMaterialization,
  CameraExposureMaterialization.of({
    complete: () =>
      Effect.succeed({
        outcome: 'rejected',
        reason: 'MaterializationFailed',
      }),
  }),
)

export const standardAcquireOuterTransitionPolicyLayer = Layer.succeed(
  AcquireOuterTransitionPolicy,
  AcquireOuterTransitionPolicy.of({ denyOuterTargetTransitions: false }),
)

export const boundedSimulationAcquireOuterTransitionPolicyLayer = Layer.succeed(
  AcquireOuterTransitionPolicy,
  AcquireOuterTransitionPolicy.of({ denyOuterTargetTransitions: true }),
)

export const AcquireCommandOutcome = Schema.TaggedUnion({
  ReadOnly: { response: AcquireCommandResponse.cases.Unavailable },
  AcquireAccepted: { response: AcquireCommandResponse.cases.Accepted },
  AcquireRejected: { response: AcquireCommandResponse.cases.Rejected },
  AcquireUnavailable: { response: AcquireCommandResponse.cases.Unavailable },
  CameraAccepted: {
    response: Schema.Union([
      CameraCommandResponse.cases.Accepted,
      CameraCommandResponse.cases.Completed,
    ]),
  },
  CameraRejected: { response: CameraCommandResponse.cases.Rejected },
  CameraUnavailable: {
    response: Schema.Union([
      CameraCommandResponse.cases.Rejected,
      CameraCommandResponse.cases.Unavailable,
    ]),
  },
})

export interface AcquireCommandServiceShape {
  readonly execute: (
    raw: unknown,
    identity: LocalIdentity,
  ) => Effect.Effect<typeof AcquireCommandOutcome.Type, unknown>
}

export class AcquireCommandService extends Context.Service<
  AcquireCommandService,
  AcquireCommandServiceShape
>()('@astro-console/server/AcquireCommandService') {}

export const acquireCommandServiceLayer = Layer.effect(
  AcquireCommandService,
  Effect.gen(function* () {
    const { database } = yield* OriginDatabase
    const repository = yield* StateSqliteRepository
    const publication = yield* ProjectionPublication
    const cameraProvider = yield* CameraProvider
    const polarMeasurementProvider = yield* PolarMeasurementProvider
    const targetAcquisitionProvider = yield* TargetAcquisitionProvider
    const materialization = yield* CameraExposureMaterialization
    const policy = yield* AcquireOuterTransitionPolicy
    const acquireRepository = acquireSqliteRepository(database)

    return AcquireCommandService.of({
      execute: Effect.fn('AcquireCommandService.execute')(
        function* (raw, identity) {
          if (identity.capability !== 'controlCapable')
            return AcquireCommandOutcome.cases.ReadOnly.make({
              response: AcquireCommandResponse.cases.Unavailable.make({
                summary:
                  'This client is read-only and cannot record polar evidence.',
              }),
            })

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
              cameraProvider,
              materialization,
            )

          const decoded = Schema.decodeUnknownOption(AcquireCommandRequest)(raw)
          return yield* executeAcquire(
            raw,
            decoded,
            identity,
            repository,
            acquireRepository,
            publication.publish,
            polarMeasurementProvider,
            targetAcquisitionProvider,
            policy,
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
    cameraProvider: CameraProviderShape,
    materialization: CameraExposureMaterializationShape,
  ) {
    const prior = acquireRepository.applicationReceipt(
      camera.intent.idempotencyKey,
      identity.clientId,
    )
    if (prior !== undefined)
      return yield* Schema.decodeUnknownEffect(AcquireCommandOutcome)(prior)

    const current = repository.state()
    if (
      current.run === null ||
      camera.intent.expectedLeaseRevision !== current.control.revision ||
      camera.intent.expectedRunRevision !== current.run.revision
    )
      return AcquireCommandOutcome.cases.CameraRejected.make({
        response: CameraCommandResponse.cases.Rejected.make({
          summary:
            'The control lease or active run changed. Read the current Observe projection.',
        }),
      })
    if (
      current.run.preflight?.checks.some(
        (check) => check.key === 'camera-connected' && check.state === 'ready',
      ) !== true
    )
      return AcquireCommandOutcome.cases.CameraRejected.make({
        response: CameraCommandResponse.cases.Rejected.make({
          summary:
            'Current camera connection truth is not ready. Refresh preflight before any camera command.',
        }),
      })

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
        return AcquireCommandOutcome.cases.CameraRejected.make({
          response: CameraCommandResponse.cases.Rejected.make({
            summary:
              'The accepted run definition cannot supply capture equipment identity.',
          }),
        })
      const pending = AcquireCommandOutcome.cases.CameraUnavailable.make({
        response: CameraCommandResponse.cases.Unavailable.make({
          summary:
            'The camera image read outcome is not yet known. It will not replay.',
        }),
      })
      acquireRepository.saveApplicationReceipt(
        camera.intent.idempotencyKey,
        identity.clientId,
        pending,
      )
      const completed = yield* materialization.complete({
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
      const outcome =
        completed.outcome === 'accepted'
          ? AcquireCommandOutcome.cases.CameraAccepted.make({
              response: CameraCommandResponse.cases.Completed.make({
                assetId: completed.assetId,
              }),
            })
          : AcquireCommandOutcome.cases.CameraUnavailable.make({
              response: CameraCommandResponse.cases.Unavailable.make({
                summary: 'The completed camera image could not be retained.',
              }),
            })
      acquireRepository.saveApplicationReceipt(
        camera.intent.idempotencyKey,
        identity.clientId,
        outcome,
      )
      return outcome
    }

    const pending = AcquireCommandOutcome.cases.CameraUnavailable.make({
      response: CameraCommandResponse.cases.Unavailable.make({
        summary:
          'The camera command outcome is not yet known. Refresh its state; it will not replay.',
      }),
    })
    acquireRepository.saveApplicationReceipt(
      camera.intent.idempotencyKey,
      identity.clientId,
      pending,
    )
    const result = yield* executeCameraCommand(raw).pipe(
      Effect.provideService(CameraProvider, cameraProvider),
    )
    const command = Match.value(result).pipe(
      Match.when({ _tag: 'Observed' }, (observed) => ({
        observed: true as const,
        response: CameraCommandResponse.cases.Accepted.make({
          observation: observed.observation,
        }),
        observation: observed.observation,
        summary: 'Camera state was read after acknowledgement.',
      })),
      Match.when({ _tag: 'Rejected' }, (rejected) => ({
        observed: false as const,
        response: CameraCommandResponse.cases.Rejected.make({
          summary: rejected.summary,
        }),
        summary: rejected.summary,
      })),
      Match.orElse((unavailable) => ({
        observed: false as const,
        response: CameraCommandResponse.cases.Unavailable.make({
          summary: unavailable.summary,
        }),
        summary: unavailable.summary,
      })),
    )
    const observedAt = new Date().toISOString()
    const previous = current.run.preflight
    const preflight = Schema.decodeUnknownSync(PreflightSnapshot)({
      observedAt,
      verdict: command.observed
        ? (previous?.verdict ?? 'unknown')
        : 'unavailable',
      nextAction: command.observed
        ? (previous?.nextAction ??
          'Camera state was read after the command acknowledgement.')
        : 'Restore the camera provider, then refresh its state. The command will not replay.',
      checks: previous?.checks ?? [
        {
          key: 'camera-provider',
          state: command.observed ? 'unknown' : 'unavailable',
          observedAt,
          reason: command.observed
            ? 'No prior full rig inventory is available.'
            : command.summary,
        },
      ],
      ...(previous?.rig === undefined ? {} : { rig: previous.rig }),
      camera: command.observed
        ? command.observation
        : { observedAt, cameraState: 'unknown' },
    })
    const persisted = repository.persistPreflight(preflight)
    yield* publish(persisted.cursor)
    if (command.observed)
      database
        .prepare(
          'INSERT OR REPLACE INTO camera_observations (run_id,observation) VALUES (?,?)',
        )
        .run(current.run.id, JSON.stringify(command.observation))
    const outcome = command.observed
      ? AcquireCommandOutcome.cases.CameraAccepted.make({
          response: command.response,
        })
      : AcquireCommandOutcome.cases.CameraUnavailable.make({
          response: command.response,
        })
    acquireRepository.saveApplicationReceipt(
      camera.intent.idempotencyKey,
      identity.clientId,
      outcome,
    )
    return outcome
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
    polarMeasurementProvider: PolarMeasurementProviderShape,
    targetAcquisitionProvider: TargetAcquisitionProviderShape,
    policy: { readonly denyOuterTargetTransitions: boolean },
  ) {
    if (Option.isSome(decoded)) {
      const prior = acquireRepository.applicationReceipt(
        decoded.value.intent.idempotencyKey,
        identity.clientId,
      )
      if (prior !== undefined)
        return yield* Schema.decodeUnknownEffect(AcquireCommandOutcome)(prior)
      const current = repository.state()
      if (
        current.run === null ||
        decoded.value.intent.expectedLeaseRevision !==
          current.control.revision ||
        decoded.value.intent.expectedRunRevision !== current.run.revision
      )
        return AcquireCommandOutcome.cases.AcquireRejected.make({
          response: AcquireCommandResponse.cases.Rejected.make({
            summary:
              'The control lease or active run changed. Read the current Observe projection.',
            snapshot: yield* repository.bootstrapSnapshot(identity),
          }),
        })
      const acquire = acquireRepository.current(current.run.id)
      if (
        acquire === undefined ||
        decoded.value.intent.expectedAcquireRevision !== acquire.revision
      )
        return AcquireCommandOutcome.cases.AcquireRejected.make({
          response: AcquireCommandResponse.cases.Rejected.make({
            summary:
              'Target evidence changed. Read the current Observe projection.',
            snapshot: yield* repository.bootstrapSnapshot(identity),
          }),
        })
      if (
        policy.denyOuterTargetTransitions &&
        (AcquireIntent.guards.SkipAcquireTarget(decoded.value.intent) ||
          AcquireIntent.guards.AbortAcquire(decoded.value.intent))
      ) {
        const denied = AcquireCommandOutcome.cases.AcquireRejected.make({
          response: AcquireCommandResponse.cases.Rejected.make({
            summary:
              'This bounded target simulation does not implement an outer-run Skip or Abort transition.',
            snapshot: yield* repository.bootstrapSnapshot(identity),
          }),
        })
        acquireRepository.saveApplicationReceipt(
          decoded.value.intent.idempotencyKey,
          identity.clientId,
          denied,
        )
        return denied
      }
      const providerEffect =
        (AcquireIntent.guards.CaptureTargetAcquisitionEvidence(
          decoded.value.intent,
        ) &&
          AcquireActiveWork.guards.SolveRequested(acquire.activeWork)) ||
        (AcquireIntent.guards.ApprovePointingCorrection(decoded.value.intent) &&
          acquire.pendingCorrectionProposal !== null)
      if (providerEffect) {
        const pending = AcquireCommandOutcome.cases.AcquireUnavailable.make({
          response: AcquireCommandResponse.cases.Unavailable.make({
            summary:
              'This provider work is in progress. Reconcile current Acquire evidence; it will not replay.',
          }),
        })
        acquireRepository.saveApplicationReceipt(
          decoded.value.intent.idempotencyKey,
          identity.clientId,
          pending,
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
        Effect.provideService(
          PolarMeasurementProvider,
          polarMeasurementProvider,
        ),
        Effect.provideService(
          TargetAcquisitionProvider,
          targetAcquisitionProvider,
        ),
      )
    return yield* Match.value(result).pipe(
      Match.tag('Committed', (committed) =>
        Effect.gen(function* () {
          yield* publish(committed.cursor)
          const outcome = AcquireCommandOutcome.cases.AcquireAccepted.make({
            response: AcquireCommandResponse.cases.Accepted.make({
              snapshot: yield* repository.bootstrapSnapshot(identity),
            }),
          })
          if (Option.isSome(decoded))
            acquireRepository.saveApplicationReceipt(
              decoded.value.intent.idempotencyKey,
              identity.clientId,
              outcome,
            )
          return outcome
        }),
      ),
      Match.tag('Unavailable', ({ summary }) =>
        Effect.succeed(
          AcquireCommandOutcome.cases.AcquireUnavailable.make({
            response: AcquireCommandResponse.cases.Unavailable.make({
              summary,
            }),
          }),
        ),
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
    Effect.map((snapshot) =>
      AcquireCommandOutcome.cases.AcquireRejected.make({
        response: AcquireCommandResponse.cases.Rejected.make({
          summary,
          snapshot,
        }),
      }),
    ),
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
