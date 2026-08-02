import { Effect, Schema } from 'effect'
import {
  AtomicCommit,
  makeAtomicServerSimulation,
} from './atomic-server-simulation.js'
import {
  AssetDeliveryWork,
  DeliveryRepresentation,
  DownloadRoutingDecision,
  LibraryComparison,
  LibraryComparisonDecision,
  LibraryAsset,
  OpenAssetInProcessDecision,
  PublicationCompletionDecision,
  PublicationFailureDecision,
  RepublicationStartDecision,
  RepresentationExpiryDecision,
  buildLibraryComparison,
  completeAssetPublication,
  decideAssetDownload,
  decideOpenAssetInProcess,
  decideRepublishAsset,
  expireAssetRepresentation,
  failAssetPublication,
} from './asset-domain.js'
import { Command, CommandEnvelope } from './commands.js'
import { DomainEventEnvelope } from './events.js'
import { CommandFailure } from './failures.js'
import {
  ActorContext,
  CommandGateDecision,
  IdempotencyState,
  evaluateCommandGate,
} from './gate.js'
import {
  IdempotencyClassification,
  IdempotencyReceipt,
  IdempotencyRequest,
  classifyIdempotency,
} from './idempotency.js'
import { ProcessingSourceRef } from './processing-domain.js'
import {
  AssetId,
  AssetRevision,
  CommandId,
  CommandResultRef,
  EventCursor,
  NormalizedInputHash,
  OperationId,
  ProcessingSessionId,
  RepresentationId,
  SnapshotVersion,
} from './primitives.js'
import { AssetSnapshot, projectAssetSnapshot } from './snapshots.js'
import type { ProcessingServerSimulation } from './processing-server-simulation.js'

export const AssetDownloadResponse = Schema.TaggedUnion({
  StreamLocal: {
    resultRef: CommandResultRef,
    assetId: AssetId,
    replayed: Schema.Boolean,
  },
  PublishedRepresentationEligible: {
    resultRef: CommandResultRef,
    representationId: RepresentationId,
    replayed: Schema.Boolean,
  },
  Preparing: {
    resultRef: CommandResultRef,
    operationId: OperationId,
    replayed: Schema.Boolean,
  },
})

export type AssetDownloadResponse = typeof AssetDownloadResponse.Type

export const AssetRepublicationResponse = Schema.Struct({
  resultRef: CommandResultRef,
  assetId: AssetId,
  operationId: OperationId,
  replayed: Schema.Boolean,
})

export interface AssetRepublicationResponse extends Schema.Schema.Type<
  typeof AssetRepublicationResponse
> {}

export const AssetProcessOpenResponse = Schema.TaggedUnion({
  Started: {
    sessionId: ProcessingSessionId,
    assetId: AssetId,
    phase: Schema.Literals(['build', 'develop']),
  },
  Resumed: {
    sessionId: ProcessingSessionId,
    assetId: AssetId,
    phase: Schema.Literals(['build', 'develop']),
  },
})

export type AssetProcessOpenResponse = typeof AssetProcessOpenResponse.Type

export const ProcessingOpenRequest = Schema.Struct({
  commandId: CommandId,
  assetId: AssetId,
  assetRevision: AssetRevision,
  role: Schema.Literals(['original', 'linearMaster']),
  checksum: Schema.NonEmptyString,
  unfinishedSessionId: Schema.optionalKey(ProcessingSessionId),
})

export interface ProcessingOpenAuthority {
  readonly open: (
    request: typeof ProcessingOpenRequest.Type,
    actor: MemberActor,
  ) => Effect.Effect<AssetProcessOpenResponse, AssetProcessingOpenRejected>
}

export class AssetCommandRejected extends Schema.TaggedErrorClass<AssetCommandRejected>()(
  'AssetServerSimulation.CommandRejected',
  { failure: CommandFailure },
) {}

export class AssetDownloadRejected extends Schema.TaggedErrorClass<AssetDownloadRejected>()(
  'AssetServerSimulation.DownloadRejected',
  {
    reason: Schema.Literals([
      'AssetNotFound',
      'LocalOriginalUnavailable',
      'AssetRepresentationUnavailable',
    ]),
  },
) {}

export class AssetIdempotencyConflict extends Schema.TaggedErrorClass<AssetIdempotencyConflict>()(
  'AssetServerSimulation.IdempotencyConflict',
  {},
) {}

export class AssetWorkerRejected extends Schema.TaggedErrorClass<AssetWorkerRejected>()(
  'AssetServerSimulation.WorkerRejected',
  {
    reason: Schema.Literals([
      'AssetNotFound',
      'ChecksumMismatch',
      'PublicationOperationSuperseded',
      'InvalidPublicationExpiry',
      'RepresentationUnavailable',
    ]),
  },
) {}

export class AssetQueryRejected extends Schema.TaggedErrorClass<AssetQueryRejected>()(
  'AssetServerSimulation.QueryRejected',
  {
    reason: Schema.Literals([
      'AssetNotFound',
      'ComparisonNeedsMultipleAssets',
      'DuplicateAssetSelection',
      'AssetsUnrelated',
    ]),
  },
) {}

export class AssetProcessingOpenRejected extends Schema.TaggedErrorClass<AssetProcessingOpenRejected>()(
  'AssetServerSimulation.ProcessingOpenRejected',
  {
    reason: Schema.Literals([
      'AssetNotFound',
      'SourceAssetUnavailable',
      'SourceRoleUnsupported',
      'ProcessingSessionUnavailable',
      'ProcessingSessionSourceMismatch',
      'ProcessingAuthorityRejected',
    ]),
  },
) {}

export const AssetPublicationEvidence = Schema.Struct({
  assetId: AssetId,
  operationId: OperationId,
  checksum: Schema.NonEmptyString,
  expiresAtEpochMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

export const AssetPublicationFailureEvidence = Schema.Struct({
  assetId: AssetId,
  operationId: OperationId,
  checksum: Schema.NonEmptyString,
  diagnosticRef: Schema.NonEmptyString,
})

interface StoredDownloadResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly response: AssetDownloadResponse
}

interface StoredRepublicationResult {
  readonly resultRef: typeof CommandResultRef.Type
  readonly response: AssetRepublicationResponse
}

export interface AssetServerSimulationState {
  readonly assets: ReadonlyArray<LibraryAsset>
  readonly snapshotVersion: typeof SnapshotVersion.Type
  readonly eventCursor: typeof EventCursor.Type
  readonly receipts: ReadonlyArray<typeof IdempotencyReceipt.Type>
  readonly results: ReadonlyArray<StoredDownloadResult>
  readonly republicationResults: ReadonlyArray<StoredRepublicationResult>
  readonly events: ReadonlyArray<DomainEventEnvelope>
  readonly outbox: ReadonlyArray<typeof AssetDeliveryWork.Type>
}

type MemberActor = Extract<
  typeof ActorContext.Type,
  { readonly _tag: 'Member' }
>

export interface AssetServerSimulation {
  readonly requestDownload: (
    rawRequest: unknown,
    actor: MemberActor,
    accessPath: 'lan' | 'remote',
    nowEpochMs: number,
  ) => Effect.Effect<
    AssetDownloadResponse,
    | Schema.SchemaError
    | AssetCommandRejected
    | AssetDownloadRejected
    | AssetIdempotencyConflict
  >
  readonly readState: () => Effect.Effect<AssetServerSimulationState>
  readonly completePublication: (
    rawEvidence: unknown,
    nowEpochMs: number,
  ) => Effect.Effect<LibraryAsset, Schema.SchemaError | AssetWorkerRejected>
  readonly failPublication: (
    rawEvidence: unknown,
  ) => Effect.Effect<LibraryAsset, Schema.SchemaError | AssetWorkerRejected>
  readonly expireRepresentation: (
    assetId: typeof AssetId.Type,
    representationId: typeof RepresentationId.Type,
    observedAtEpochMs: number,
  ) => Effect.Effect<LibraryAsset, AssetWorkerRejected>
  readonly librarySnapshot: (
    actor: MemberActor,
    nowEpochMs: number,
    expiringWindowMs: number,
  ) => Effect.Effect<ReadonlyArray<typeof AssetSnapshot.Type>>
  readonly compareAssets: (
    assetIds: ReadonlyArray<typeof AssetId.Type>,
    actor: MemberActor,
  ) => Effect.Effect<typeof LibraryComparison.Type, AssetQueryRejected>
  readonly openInProcess: (
    rawRequest: unknown,
    actor: MemberActor,
  ) => Effect.Effect<
    AssetProcessOpenResponse,
    Schema.SchemaError | AssetCommandRejected | AssetProcessingOpenRejected
  >
  readonly republish: (
    rawRequest: unknown,
    actor: MemberActor,
    nowEpochMs: number,
  ) => Effect.Effect<
    AssetRepublicationResponse,
    | Schema.SchemaError
    | AssetCommandRejected
    | AssetDownloadRejected
    | AssetIdempotencyConflict
  >
  readonly dispatchOutbox: <E>(
    execute: (work: typeof AssetDeliveryWork.Type) => Effect.Effect<void, E>,
  ) => Effect.Effect<void, E>
}

export const makeAssetServerSimulation = Effect.fn(
  'AssetServerSimulation.make',
)(function* (
  initialState: AssetServerSimulationState,
  acceptedAt: string,
  processingAuthority?: ProcessingOpenAuthority,
) {
  const simulation = yield* makeAtomicServerSimulation(
    initialState,
    (state) => state.outbox,
  )

  const requestDownload: AssetServerSimulation['requestDownload'] = Effect.fn(
    'AssetServerSimulation.requestDownload',
  )(function* (rawRequest, actor, accessPath, nowEpochMs) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(
      Command.cases.RequestAssetDownload,
    )(envelope.command)

    return yield* simulation.transact((current) =>
      Effect.gen(function* () {
        const asset = current.assets.find(
          (candidate) => candidate.assetId === command.assetId,
        )
        if (asset === undefined)
          return yield* new AssetDownloadRejected({ reason: 'AssetNotFound' })
        const request = IdempotencyRequest.make({
          idempotencyKey: command.idempotencyKey,
          personId: actor.personId,
          commandTag: 'RequestAssetDownload',
          normalizedInputHash: NormalizedInputHash.make(
            JSON.stringify([
              'RequestAssetDownload.v1',
              command.assetId,
              command.representationId ?? null,
              accessPath,
            ]),
          ),
        })
        const receipt = current.receipts.find(
          (candidate) => candidate.idempotencyKey === request.idempotencyKey,
        )
        const idempotency = classifyIdempotency(request, receipt)
        const gate = evaluateCommandGate({
          envelope,
          actor,
          connected: true,
          snapshotVersion: current.snapshotVersion,
          currentRevisions: { asset: asset.revision },
          idempotency: gateIdempotency(idempotency),
        })

        return yield* CommandGateDecision.$match(gate, {
          Rejected: ({ failure }) =>
            Effect.fail(new AssetCommandRejected({ failure })),
          ReplayPending: () =>
            replay(current, receipt, asset, accessPath, nowEpochMs),
          ReplayRecorded: () =>
            replay(current, receipt, asset, accessPath, nowEpochMs),
          Accepted: () =>
            acceptDownload(
              current,
              asset,
              command,
              envelope,
              request,
              accessPath,
              nowEpochMs,
              acceptedAt,
            ),
        })
      }),
    )
  })

  const republish: AssetServerSimulation['republish'] = Effect.fn(
    'AssetServerSimulation.republish',
  )(function* (rawRequest, actor, nowEpochMs) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(
      Command.cases.RepublishAssetRepresentation,
    )(envelope.command)
    return yield* simulation.transact((current) =>
      Effect.gen(function* () {
        const asset = current.assets.find(
          (candidate) => candidate.assetId === command.assetId,
        )
        if (asset === undefined)
          return yield* new AssetDownloadRejected({ reason: 'AssetNotFound' })
        const request = IdempotencyRequest.make({
          idempotencyKey: command.idempotencyKey,
          personId: actor.personId,
          commandTag: 'RepublishAssetRepresentation',
          normalizedInputHash: NormalizedInputHash.make(
            JSON.stringify([
              'RepublishAssetRepresentation.v1',
              command.assetId,
              command.expectedAssetRevision,
              command.representationId,
              command.sourceChecksum,
            ]),
          ),
        })
        const receipt = current.receipts.find(
          (candidate) => candidate.idempotencyKey === request.idempotencyKey,
        )
        const classification = classifyIdempotency(request, receipt)
        const gate = evaluateCommandGate({
          envelope,
          actor,
          connected: true,
          snapshotVersion: current.snapshotVersion,
          currentRevisions: { asset: asset.revision },
          idempotency: gateIdempotency(classification),
        })
        return yield* CommandGateDecision.$match(gate, {
          Rejected: ({ failure }) =>
            Effect.fail(new AssetCommandRejected({ failure })),
          ReplayPending: () => replayRepublication(current, receipt),
          ReplayRecorded: () => replayRepublication(current, receipt),
          Accepted: () =>
            acceptRepublication(
              current,
              asset,
              command,
              envelope,
              request,
              nowEpochMs,
              acceptedAt,
            ),
        })
      }),
    )
  })

  const completePublication: AssetServerSimulation['completePublication'] =
    Effect.fn('AssetServerSimulation.completePublication')(
      function* (rawEvidence, nowEpochMs) {
        const evidence = yield* Schema.decodeUnknownEffect(
          AssetPublicationEvidence,
        )(rawEvidence)
        return yield* simulation.transact((current) =>
          Effect.gen(function* () {
            const asset = current.assets.find(
              (candidate) => candidate.assetId === evidence.assetId,
            )
            if (asset === undefined)
              return yield* new AssetWorkerRejected({
                reason: 'AssetNotFound',
              })
            if (asset.checksum !== evidence.checksum)
              return yield* new AssetWorkerRejected({
                reason: 'ChecksumMismatch',
              })
            const decision = completeAssetPublication(
              asset,
              evidence.operationId,
              evidence.expiresAtEpochMs,
              nowEpochMs,
            )
            return yield* PublicationCompletionDecision.$match(decision, {
              Rejected: ({ reason }) =>
                Effect.fail(new AssetWorkerRejected({ reason })),
              AlreadyPublished: ({ asset }) =>
                Effect.succeed({ state: current, result: asset }),
              Published: ({ asset: published }) => {
                const representation = published.representations.find(
                  (candidate) =>
                    DeliveryRepresentation.guards.Published(candidate) &&
                    candidate.operationId === evidence.operationId,
                )
                if (representation === undefined) {
                  return Effect.fail(
                    new AssetWorkerRejected({
                      reason: 'PublicationOperationSuperseded',
                    }),
                  )
                }
                const eventCursor = EventCursor.make(current.eventCursor + 1)
                const next: AssetServerSimulationState = {
                  ...current,
                  assets: current.assets.map((candidate) =>
                    candidate.assetId === published.assetId
                      ? published
                      : candidate,
                  ),
                  snapshotVersion: SnapshotVersion.make(
                    current.snapshotVersion + 1,
                  ),
                  eventCursor,
                  events: [
                    ...current.events,
                    DomainEventEnvelope.make({
                      eventId: `event-${eventCursor}`,
                      aggregateKind: 'Asset',
                      aggregateId: published.assetId,
                      aggregateRevision: published.revision,
                      occurredAt: acceptedAt,
                      operationId: evidence.operationId,
                      event: {
                        _tag: 'AssetPublished',
                        assetId: published.assetId,
                        representationId: representation.representationId,
                        expiresAt: new Date(
                          evidence.expiresAtEpochMs,
                        ).toISOString(),
                      },
                      schemaVersion: 1,
                    }),
                  ],
                }
                return Effect.succeed({ state: next, result: published })
              },
            })
          }),
        )
      },
    )

  const failPublication: AssetServerSimulation['failPublication'] = Effect.fn(
    'AssetServerSimulation.failPublication',
  )(function* (rawEvidence) {
    const evidence = yield* Schema.decodeUnknownEffect(
      AssetPublicationFailureEvidence,
    )(rawEvidence)
    return yield* simulation.transact((current) =>
      Effect.gen(function* () {
        const asset = current.assets.find(
          (candidate) => candidate.assetId === evidence.assetId,
        )
        if (asset === undefined)
          return yield* new AssetWorkerRejected({ reason: 'AssetNotFound' })
        if (asset.checksum !== evidence.checksum)
          return yield* new AssetWorkerRejected({ reason: 'ChecksumMismatch' })
        const decision = failAssetPublication(
          asset,
          evidence.operationId,
          evidence.diagnosticRef,
        )
        return yield* PublicationFailureDecision.$match(decision, {
          Rejected: ({ reason }) =>
            Effect.fail(new AssetWorkerRejected({ reason })),
          AlreadyFailed: ({ asset }) =>
            Effect.succeed({ state: current, result: asset }),
          Failed: ({ asset: failed }) => {
            const representation = failed.representations.find(
              (candidate) =>
                DeliveryRepresentation.guards.Failed(candidate) &&
                candidate.operationId === evidence.operationId,
            )
            if (representation === undefined) {
              return Effect.fail(
                new AssetWorkerRejected({
                  reason: 'PublicationOperationSuperseded',
                }),
              )
            }
            const eventCursor = EventCursor.make(current.eventCursor + 1)
            const next: AssetServerSimulationState = {
              ...current,
              assets: current.assets.map((candidate) =>
                candidate.assetId === failed.assetId ? failed : candidate,
              ),
              snapshotVersion: SnapshotVersion.make(
                current.snapshotVersion + 1,
              ),
              eventCursor,
              events: [
                ...current.events,
                DomainEventEnvelope.make({
                  eventId: `event-${eventCursor}`,
                  aggregateKind: 'Asset',
                  aggregateId: failed.assetId,
                  aggregateRevision: failed.revision,
                  occurredAt: acceptedAt,
                  operationId: evidence.operationId,
                  event: {
                    _tag: 'AssetPublicationFailed',
                    assetId: failed.assetId,
                    representationId: representation.representationId,
                    reason: 'publicationFailed',
                    diagnosticRef: evidence.diagnosticRef,
                  },
                  schemaVersion: 1,
                }),
              ],
            }
            return Effect.succeed({ state: next, result: failed })
          },
        })
      }),
    )
  })

  const expireRepresentation: AssetServerSimulation['expireRepresentation'] =
    Effect.fn('AssetServerSimulation.expireRepresentation')(
      function* (assetId, representationId, observedAtEpochMs) {
        return yield* simulation.transact((current) => {
          const asset = current.assets.find(
            (candidate) => candidate.assetId === assetId,
          )
          if (asset === undefined)
            return Effect.fail(
              new AssetWorkerRejected({ reason: 'AssetNotFound' }),
            )
          return RepresentationExpiryDecision.$match(
            expireAssetRepresentation(
              asset,
              representationId,
              observedAtEpochMs,
            ),
            {
              Rejected: () =>
                Effect.fail(
                  new AssetWorkerRejected({
                    reason: 'RepresentationUnavailable',
                  }),
                ),
              Unchanged: ({ asset }) =>
                Effect.succeed({ state: current, result: asset }),
              Expired: ({ asset: expired }) => {
                const eventCursor = EventCursor.make(current.eventCursor + 1)
                const next: AssetServerSimulationState = {
                  ...current,
                  assets: current.assets.map((candidate) =>
                    candidate.assetId === expired.assetId ? expired : candidate,
                  ),
                  snapshotVersion: SnapshotVersion.make(
                    current.snapshotVersion + 1,
                  ),
                  eventCursor,
                  events: [
                    ...current.events,
                    DomainEventEnvelope.make({
                      eventId: `event-${eventCursor}`,
                      aggregateKind: 'Asset',
                      aggregateId: expired.assetId,
                      aggregateRevision: expired.revision,
                      occurredAt: acceptedAt,
                      event: {
                        _tag: 'AssetRepresentationExpired',
                        assetId: expired.assetId,
                        representationId,
                      },
                      schemaVersion: 1,
                    }),
                  ],
                }
                return Effect.succeed({ state: next, result: expired })
              },
            },
          )
        })
      },
    )

  const librarySnapshot: AssetServerSimulation['librarySnapshot'] = Effect.fn(
    'AssetServerSimulation.librarySnapshot',
  )(function* (_actor, nowEpochMs, expiringWindowMs) {
    const current = yield* simulation.readState()
    return current.assets.map((asset) =>
      projectAssetSnapshot(asset, nowEpochMs, expiringWindowMs),
    )
  })

  const compareAssets: AssetServerSimulation['compareAssets'] = Effect.fn(
    'AssetServerSimulation.compareAssets',
  )(function* (assetIds, _actor) {
    const current = yield* simulation.readState()
    const assets = assetIds.map((assetId) =>
      current.assets.find((candidate) => candidate.assetId === assetId),
    )
    if (assets.some((asset) => asset === undefined))
      return yield* new AssetQueryRejected({ reason: 'AssetNotFound' })
    return yield* LibraryComparisonDecision.$match(
      buildLibraryComparison(assets.filter((asset) => asset !== undefined)),
      {
        Rejected: ({ reason }) =>
          Effect.fail(new AssetQueryRejected({ reason })),
        Ready: ({ comparison }) => Effect.succeed(comparison),
      },
    )
  })

  const openInProcess: AssetServerSimulation['openInProcess'] = Effect.fn(
    'AssetServerSimulation.openInProcess',
  )(function* (rawRequest, actor) {
    const envelope =
      yield* Schema.decodeUnknownEffect(CommandEnvelope)(rawRequest)
    const command = yield* Schema.decodeUnknownEffect(
      Command.cases.OpenAssetInProcess,
    )(envelope.command)
    const asset = yield* simulation.transact((current) =>
      Effect.gen(function* () {
        const asset = current.assets.find(
          (candidate) => candidate.assetId === command.assetId,
        )
        if (asset === undefined)
          return yield* new AssetProcessingOpenRejected({
            reason: 'AssetNotFound',
          })
        const gate = evaluateCommandGate({
          envelope,
          actor,
          connected: true,
          snapshotVersion: current.snapshotVersion,
          currentRevisions: { asset: asset.revision },
          idempotency: IdempotencyState.cases.Fresh.make({}),
        })
        return yield* CommandGateDecision.$match(gate, {
          Rejected: ({ failure }) =>
            Effect.fail(new AssetCommandRejected({ failure })),
          ReplayPending: () =>
            Effect.fail(
              new AssetProcessingOpenRejected({
                reason: 'ProcessingAuthorityRejected',
              }),
            ),
          ReplayRecorded: () =>
            Effect.fail(
              new AssetProcessingOpenRejected({
                reason: 'ProcessingAuthorityRejected',
              }),
            ),
          Accepted: () =>
            OpenAssetInProcessDecision.$match(decideOpenAssetInProcess(asset), {
              Rejected: ({ reason }) =>
                Effect.fail(new AssetProcessingOpenRejected({ reason })),
              Resume: () =>
                Effect.fail(
                  new AssetProcessingOpenRejected({
                    reason: 'ProcessingAuthorityRejected',
                  }),
                ),
              Start: () => Effect.succeed({ state: current, result: asset }),
            }),
        })
      }),
    )
    if (processingAuthority === undefined) {
      return yield* new AssetProcessingOpenRejected({
        reason: 'ProcessingAuthorityRejected',
      })
    }
    if (asset.role !== 'original' && asset.role !== 'linearMaster') {
      return yield* new AssetProcessingOpenRejected({
        reason: 'SourceRoleUnsupported',
      })
    }
    return yield* processingAuthority.open(
      ProcessingOpenRequest.make({
        commandId: envelope.commandId,
        assetId: asset.assetId,
        assetRevision: asset.revision,
        role: asset.role,
        checksum: asset.checksum,
        ...(command.unfinishedSessionId === undefined
          ? {}
          : { unfinishedSessionId: command.unfinishedSessionId }),
      }),
      actor,
    )
  })

  return {
    requestDownload,
    republish,
    completePublication,
    failPublication,
    expireRepresentation,
    librarySnapshot,
    compareAssets,
    openInProcess,
    readState: simulation.readState,
    dispatchOutbox: simulation.dispatchOutbox,
  } satisfies AssetServerSimulation
})

export const makeProcessingOpenAuthority = (
  processing: Pick<ProcessingServerSimulation, 'execute' | 'readState'>,
): ProcessingOpenAuthority => ({
  open: Effect.fn('AssetServerSimulation.ProcessingOpenAuthority.open')(
    function* (request, actor) {
      const current = yield* processing.readState()
      const catalogSource = current.sourceCatalog.find(
        (candidate) => candidate.assetId === request.assetId,
      )
      const saved = current.assets.find(
        (candidate) => candidate.assetId === request.assetId,
      )
      const source =
        catalogSource ??
        (saved === undefined || saved.role !== 'linearMaster'
          ? undefined
          : ProcessingSourceRef.make({
              assetId: saved.assetId,
              assetRevision: saved.revision,
              role: 'linearMaster',
              checksum: saved.checksum,
              locallyAvailable: saved.localAvailable,
            }))
      if (
        source === undefined ||
        !source.locallyAvailable ||
        source.role !== request.role ||
        source.assetRevision !== request.assetRevision ||
        source.checksum !== request.checksum
      ) {
        return yield* new AssetProcessingOpenRejected({
          reason: 'SourceAssetUnavailable',
        })
      }
      if (request.unfinishedSessionId !== undefined) {
        const session = current.sessions.find(
          (candidate) => candidate.sessionId === request.unfinishedSessionId,
        )
        if (session === undefined || session.lifecycle !== 'unfinished') {
          return yield* new AssetProcessingOpenRejected({
            reason: 'ProcessingSessionUnavailable',
          })
        }
        if (
          !session.sources.some(
            (candidate) => candidate.assetId === request.assetId,
          )
        ) {
          return yield* new AssetProcessingOpenRejected({
            reason: 'ProcessingSessionSourceMismatch',
          })
        }
        yield* processing
          .execute(
            {
              commandId: `resume-${request.commandId}`,
              command: {
                _tag: 'ResumeProcessingSession',
                sessionId: session.sessionId,
                expectedProcessingRevision: session.revision,
              },
            },
            actor,
          )
          .pipe(
            Effect.mapError(
              () =>
                new AssetProcessingOpenRejected({
                  reason: 'ProcessingAuthorityRejected',
                }),
            ),
          )
        return AssetProcessOpenResponse.cases.Resumed.make({
          sessionId: session.sessionId,
          assetId: request.assetId,
          phase: session.phase,
        })
      }
      const response = yield* processing
        .execute(
          {
            commandId: `start-${request.commandId}`,
            command: {
              _tag: 'StartProcessingSession',
              sourceAssetIds: [request.assetId],
              idempotencyKey: `open-${request.commandId}`,
            },
          },
          actor,
        )
        .pipe(
          Effect.mapError(
            () =>
              new AssetProcessingOpenRejected({
                reason: 'ProcessingAuthorityRejected',
              }),
          ),
        )
      if (response.projection.selectedSessionId === undefined) {
        return yield* new AssetProcessingOpenRejected({
          reason: 'ProcessingAuthorityRejected',
        })
      }
      return AssetProcessOpenResponse.cases.Started.make({
        sessionId: response.projection.selectedSessionId,
        assetId: request.assetId,
        phase: request.role === 'linearMaster' ? 'develop' : 'build',
      })
    },
  ),
})

type RequestDownloadCommand = typeof Command.cases.RequestAssetDownload.Type
type RepublishCommand = typeof Command.cases.RepublishAssetRepresentation.Type
type AssetCommit = AtomicCommit<
  AssetServerSimulationState,
  AssetDownloadResponse
>

function acceptDownload(
  current: AssetServerSimulationState,
  asset: LibraryAsset,
  command: RequestDownloadCommand,
  envelope: CommandEnvelope,
  request: IdempotencyRequest,
  accessPath: 'lan' | 'remote',
  nowEpochMs: number,
  acceptedAt: string,
): Effect.Effect<AssetCommit, AssetDownloadRejected> {
  const sequence = current.results.length + 1
  const decision = decideAssetDownload({
    asset,
    accessPath,
    ...(command.representationId === undefined
      ? {}
      : { requestedRepresentationId: command.representationId }),
    nowEpochMs,
    assignedRepresentationId: RepresentationId.make(
      `representation-${sequence}`,
    ),
    assignedOperationId: OperationId.make(`publish-${sequence}`),
  })
  return DownloadRoutingDecision.$match(decision, {
    Rejected: ({ reason }) =>
      Effect.fail(new AssetDownloadRejected({ reason })),
    StreamLocal: ({ assetId }) =>
      commitDownload(
        current,
        envelope,
        request,
        acceptedAt,
        asset,
        'lanStream',
        [],
        (resultRef) =>
          AssetDownloadResponse.cases.StreamLocal.make({
            resultRef,
            assetId,
            replayed: false,
          }),
      ),
    PublishedRepresentationEligible: ({ representationId }) =>
      commitDownload(
        current,
        envelope,
        request,
        acceptedAt,
        asset,
        'remoteGrantEligible',
        [],
        (resultRef) =>
          AssetDownloadResponse.cases.PublishedRepresentationEligible.make({
            resultRef,
            representationId,
            replayed: false,
          }),
      ),
    PreparationPending: ({ operationId }) =>
      commitDownload(
        current,
        envelope,
        request,
        acceptedAt,
        asset,
        'remoteStage',
        [],
        (resultRef) =>
          AssetDownloadResponse.cases.Preparing.make({
            resultRef,
            operationId,
            replayed: false,
          }),
      ),
    PreparationStarted: ({ asset: changedAsset, work }) =>
      commitDownload(
        current,
        envelope,
        request,
        acceptedAt,
        changedAsset,
        'remoteStage',
        [work],
        (resultRef) =>
          AssetDownloadResponse.cases.Preparing.make({
            resultRef,
            operationId: work.operationId,
            replayed: false,
          }),
      ),
  })
}

function commitDownload(
  current: AssetServerSimulationState,
  envelope: CommandEnvelope,
  request: IdempotencyRequest,
  acceptedAt: string,
  asset: LibraryAsset,
  route: 'lanStream' | 'remoteGrantEligible' | 'remoteStage',
  work: ReadonlyArray<typeof AssetDeliveryWork.Type>,
  response: (resultRef: typeof CommandResultRef.Type) => AssetDownloadResponse,
): Effect.Effect<AssetCommit> {
  const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
  const eventCursor = EventCursor.make(current.eventCursor + 1)
  const result = response(resultRef)
  const next: AssetServerSimulationState = {
    ...current,
    assets: current.assets.map((candidate) =>
      candidate.assetId === asset.assetId ? asset : candidate,
    ),
    snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
    eventCursor,
    receipts: [
      ...current.receipts,
      IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef }),
    ],
    results: [...current.results, { resultRef, response: result }],
    events: [
      ...current.events,
      DomainEventEnvelope.make({
        eventId: `event-${eventCursor}`,
        aggregateKind: 'Asset',
        aggregateId: asset.assetId,
        aggregateRevision: asset.revision,
        occurredAt: acceptedAt,
        commandId: envelope.commandId,
        event: {
          _tag: 'AssetDownloadRequested',
          assetId: asset.assetId,
          route,
        },
        schemaVersion: 1,
      }),
    ],
    outbox: [...current.outbox, ...work],
  }
  return Effect.succeed({ state: next, result } satisfies AtomicCommit<
    AssetServerSimulationState,
    AssetDownloadResponse
  >)
}

function acceptRepublication(
  current: AssetServerSimulationState,
  asset: LibraryAsset,
  command: RepublishCommand,
  envelope: CommandEnvelope,
  request: IdempotencyRequest,
  nowEpochMs: number,
  acceptedAt: string,
): Effect.Effect<
  AtomicCommit<AssetServerSimulationState, AssetRepublicationResponse>,
  AssetDownloadRejected
> {
  const operationId = OperationId.make(
    `republish-${current.republicationResults.length + 1}`,
  )
  const decision = decideRepublishAsset(
    asset,
    command.representationId,
    operationId,
    command.sourceChecksum,
    nowEpochMs,
  )
  return RepublicationStartDecision.$match(decision, {
    Rejected: () =>
      Effect.fail(
        new AssetDownloadRejected({ reason: 'AssetRepresentationUnavailable' }),
      ),
    Reused: ({ operationId }) =>
      commitReusedRepublication(current, asset, envelope, request, operationId),
    Started: ({ asset: changedAsset, work }) => {
      const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
      const eventCursor = EventCursor.make(current.eventCursor + 1)
      const result = AssetRepublicationResponse.make({
        resultRef,
        assetId: changedAsset.assetId,
        operationId,
        replayed: false,
      })
      const next: AssetServerSimulationState = {
        ...current,
        assets: current.assets.map((candidate) =>
          candidate.assetId === changedAsset.assetId ? changedAsset : candidate,
        ),
        snapshotVersion: SnapshotVersion.make(current.snapshotVersion + 1),
        eventCursor,
        receipts: [
          ...current.receipts,
          IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef }),
        ],
        republicationResults: [
          ...current.republicationResults,
          { resultRef, response: result },
        ],
        events: [
          ...current.events,
          DomainEventEnvelope.make({
            eventId: `event-${eventCursor}`,
            aggregateKind: 'Asset',
            aggregateId: changedAsset.assetId,
            aggregateRevision: changedAsset.revision,
            occurredAt: acceptedAt,
            commandId: envelope.commandId,
            operationId,
            event: {
              _tag: 'AssetRepublicationStarted',
              assetId: changedAsset.assetId,
              representationId: command.representationId,
            },
            schemaVersion: 1,
          }),
        ],
        outbox: [...current.outbox, work],
      }
      return Effect.succeed({ state: next, result })
    },
  })
}

function commitReusedRepublication(
  current: AssetServerSimulationState,
  asset: LibraryAsset,
  envelope: CommandEnvelope,
  request: IdempotencyRequest,
  operationId: typeof OperationId.Type,
): Effect.Effect<
  AtomicCommit<AssetServerSimulationState, AssetRepublicationResponse>
> {
  const resultRef = CommandResultRef.make(`result-${envelope.commandId}`)
  const result = AssetRepublicationResponse.make({
    resultRef,
    assetId: asset.assetId,
    operationId,
    replayed: false,
  })
  return Effect.succeed({
    state: {
      ...current,
      receipts: [
        ...current.receipts,
        IdempotencyReceipt.cases.Recorded.make({ ...request, resultRef }),
      ],
      republicationResults: [
        ...current.republicationResults,
        { resultRef, response: result },
      ],
    },
    result,
  })
}

function replayRepublication(
  current: AssetServerSimulationState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
): Effect.Effect<
  AtomicCommit<AssetServerSimulationState, AssetRepublicationResponse>,
  AssetIdempotencyConflict
> {
  if (receipt === undefined) return Effect.fail(new AssetIdempotencyConflict())
  return IdempotencyReceipt.match(receipt, {
    Pending: () => Effect.fail(new AssetIdempotencyConflict()),
    Recorded: ({ resultRef }) => {
      const stored = current.republicationResults.find(
        (candidate) => candidate.resultRef === resultRef,
      )
      if (stored === undefined)
        return Effect.fail(new AssetIdempotencyConflict())
      return Effect.succeed({
        state: current,
        result: AssetRepublicationResponse.make({
          ...stored.response,
          replayed: true,
        }),
      })
    },
  })
}

function replay(
  current: AssetServerSimulationState,
  receipt: typeof IdempotencyReceipt.Type | undefined,
  asset: LibraryAsset,
  accessPath: 'lan' | 'remote',
  nowEpochMs: number,
): Effect.Effect<
  AssetCommit,
  AssetIdempotencyConflict | AssetDownloadRejected
> {
  if (receipt === undefined) return Effect.fail(new AssetIdempotencyConflict())
  return IdempotencyReceipt.match(receipt, {
    Pending: () => Effect.fail(new AssetIdempotencyConflict()),
    Recorded: ({ resultRef }) => {
      const stored = current.results.find(
        (candidate) => candidate.resultRef === resultRef,
      )
      if (stored === undefined)
        return Effect.fail(new AssetIdempotencyConflict())
      if (
        AssetDownloadResponse.guards.StreamLocal(stored.response) &&
        (accessPath !== 'lan' || !asset.localAvailable)
      ) {
        return Effect.fail(
          new AssetDownloadRejected({ reason: 'LocalOriginalUnavailable' }),
        )
      }
      if (
        AssetDownloadResponse.guards.PublishedRepresentationEligible(
          stored.response,
        )
      ) {
        const grantedRepresentationId = stored.response.representationId
        const representation = asset.representations.find(
          (candidate) => candidate.representationId === grantedRepresentationId,
        )
        if (
          accessPath !== 'remote' ||
          representation === undefined ||
          !DeliveryRepresentation.guards.Published(representation) ||
          representation.expiresAtEpochMs <= nowEpochMs
        ) {
          return Effect.fail(
            new AssetDownloadRejected({
              reason: 'AssetRepresentationUnavailable',
            }),
          )
        }
      }
      if (AssetDownloadResponse.guards.Preparing(stored.response)) {
        const storedPreparing = stored.response
        const preparing = asset.representations.find(
          (candidate) =>
            DeliveryRepresentation.guards.Preparing(candidate) &&
            candidate.operationId === storedPreparing.operationId,
        )
        if (preparing !== undefined) {
          return Effect.succeed({
            state: current,
            result: AssetDownloadResponse.cases.Preparing.make({
              ...storedPreparing,
              replayed: true,
            }),
          })
        }
        const published = asset.representations.find(
          (candidate) =>
            DeliveryRepresentation.guards.Published(candidate) &&
            candidate.operationId === storedPreparing.operationId,
        )
        if (
          published !== undefined &&
          DeliveryRepresentation.guards.Published(published) &&
          published.expiresAtEpochMs > nowEpochMs
        ) {
          return Effect.succeed({
            state: current,
            result:
              AssetDownloadResponse.cases.PublishedRepresentationEligible.make({
                resultRef: storedPreparing.resultRef,
                representationId: published.representationId,
                replayed: true,
              }),
          })
        }
        return Effect.fail(
          new AssetDownloadRejected({
            reason: 'AssetRepresentationUnavailable',
          }),
        )
      }
      const result: AssetDownloadResponse =
        AssetDownloadResponse.guards.StreamLocal(stored.response)
          ? AssetDownloadResponse.cases.StreamLocal.make({
              ...stored.response,
              replayed: true,
            })
          : AssetDownloadResponse.cases.PublishedRepresentationEligible.make({
              ...stored.response,
              replayed: true,
            })
      return Effect.succeed({ state: current, result } satisfies AtomicCommit<
        AssetServerSimulationState,
        AssetDownloadResponse
      >)
    },
  })
}

function gateIdempotency(
  classification: IdempotencyClassification,
): typeof IdempotencyState.Type {
  return IdempotencyClassification.$match(classification, {
    Fresh: () => IdempotencyState.cases.Fresh.make({}),
    PendingMatch: ({ operationId }) =>
      operationId === undefined
        ? IdempotencyState.cases.PendingMatch.make({})
        : IdempotencyState.cases.PendingMatch.make({ operationId }),
    RecordedMatch: () => IdempotencyState.cases.RecordedMatch.make({}),
    Conflict: () => IdempotencyState.cases.Conflict.make({}),
  })
}
