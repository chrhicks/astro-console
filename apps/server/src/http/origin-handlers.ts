import { type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { Effect, Layer, Schema } from 'effect'
import {
  BootstrapHttpFailureEnvelope,
  CommandFailure,
  CommandHttpFailureEnvelope,
  ObserveCommandResponse,
  PlanCommandResponse,
  PlanWorkspaceProjection,
  LibraryQuery,
} from '@astro-console/v2-contracts'
import type { DownloadGrantIssuer } from '../storage/r2-download-grant.ts'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  type ControlEvent,
  type FailureReason,
  type Snapshot,
} from '../services/domain-state.ts'
import {
  executePlanRequest,
  planPersistenceLayer,
  planServiceLayer,
} from '../services/plan-command-service.ts'
import {
  executeObserveRequest,
  observePersistenceLayer,
  observeServiceLayer,
} from '../services/observe-command-service.ts'
import {
  LibraryInputInvalid,
  LibraryService,
} from '../services/library-service.ts'
import { sqliteLibraryServiceLayer } from '../persistence/library-sqlite-repository.ts'
import { planWorkspaceProjection } from '../services/runtime-bootstrap.ts'
import { type StateSqliteRepositoryShape } from '../persistence/state-sqlite-repository.ts'
import { type RunSqliteRepositoryShape } from '../persistence/run-sqlite-repository.ts'
export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}

const StoredEvidence = Schema.Struct({
  frameId: Schema.String,
  capturedAt: Schema.String,
  quality: Schema.Literals(['verified', 'warning']),
  desired: Schema.String,
  solved: Schema.String,
  uncertaintyArcsec: Schema.Number,
  stack: Schema.optionalKey(
    Schema.Struct({
      availability: Schema.Literals(['available', 'unavailable']),
      observedAt: Schema.String,
      frameCount: Schema.Int,
      message: Schema.String,
    }),
  ),
  correction: Schema.Struct({
    state: Schema.Literals(['automatic', 'exhausted']),
    evidence: Schema.String,
    bound: Schema.String,
    protection: Schema.String,
    action: Schema.String,
  }),
})
export const AdapterObservation = Schema.Struct({
  frameId: Schema.NonEmptyString,
  capturedAt: Schema.NonEmptyString,
  quality: Schema.Literals(['verified', 'warning']),
  desired: Schema.NonEmptyString,
  solved: Schema.NonEmptyString,
  uncertaintyArcsec: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  correctionState: Schema.Literals(['automatic', 'exhausted']),
  correctionEvidence: Schema.NonEmptyString,
  correctionBound: Schema.NonEmptyString,
  protection: Schema.NonEmptyString,
})
const RunMutationSchema = Schema.Struct({
  previewId: Schema.String,
  kind: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
})
const StoredState = Schema.Struct({
  snapshotVersion: Schema.Int,
  eventCursor: Schema.Int,
  planRevision: Schema.Int,
  leaseRevision: Schema.Int,
  leaseHolder: Schema.NullOr(Schema.String),
  leaseState: Schema.Literals(['held', 'reconnecting', 'unheld']),
  reconnectGraceUntil: Schema.NullOr(Schema.String),
  run: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      revision: Schema.Int,
      phase: Schema.Literals([
        'preflight',
        'acquire',
        'capture',
        'verify',
        'completed',
        'paused',
        'stopped',
        'parkRequested',
      ]),
      target: Schema.String,
      progress: Schema.Number,
      sourceDefinitionId: Schema.optionalKey(Schema.String),
      activeSequenceIndex: Schema.optionalKey(Schema.Int),
      completedSequenceCount: Schema.optionalKey(Schema.Int),
      resumablePhase: Schema.optionalKey(
        Schema.Literals(['preflight', 'acquire', 'capture', 'verify']),
      ),
      retryPhase: Schema.optionalKey(
        Schema.Literals(['preflight', 'acquire', 'capture', 'verify']),
      ),
      appliedMutations: Schema.optionalKey(Schema.Array(RunMutationSchema)),
    }),
  ),
  evidence: StoredEvidence,
})
const StoredRequest = Schema.Struct({
  request_id: Schema.String,
  client_id: Schema.String,
  person_id: Schema.String,
  created_at: Schema.String,
  expires_at: Schema.String,
  target_control_capable: Schema.Int,
})
const StoredRow = Schema.Struct({ value: Schema.String })
const PlanWorkspace = PlanWorkspaceProjection
const ObservingPlanRow = Schema.Struct({
  plan_id: Schema.String,
  revision: Schema.Int,
  projection: Schema.String,
  run_eligible: Schema.Int,
})
const operatorMessages = {
  Unauthenticated: 'A verified member identity is required.',
  FreshnessConflict:
    'The plan or control changed. Review the current plan before accepting it.',
  PlanUnavailable: 'No observation plan is installed.',
  PlanNotReady: 'The plan is not ready for RunDefinition acceptance.',
  RunDefinitionAlreadyAccepted:
    'This plan revision already has an immutable RunDefinition.',
  ClientReadOnly: 'Monitoring is read-only on this client.',
  ControlLeaseLost:
    'Control changed hands. Your command was not sent to the observatory; the accepted run continues.',
  AlreadyController: 'This desktop already controls the observatory.',
  ControlRequestAlreadyPending:
    'This desktop already has a pending control request.',
  OwnerRequired: 'Only the owner can accept a RunDefinition.',
  ControlRequestUnavailable: 'There is no current control request to grant.',
  ActiveRunConflict: 'A run is already active. Return to Observe.',
  RunRevisionConflict:
    'The active run changed. Refresh Observe before trying again.',
  AlreadyPaused: 'This run is already paused.',
  AlreadyTerminal: 'This run is terminal and cannot be paused.',
  NotPaused: 'This run is not paused.',
  ResumePhaseUnavailable: 'The paused run has no resumable phase.',
  IdempotencyConflict:
    'This idempotency key was already used for a different command.',
  InvalidInput: 'The service could not read that action.',
  DraftUnchanged: 'The displayed draft does not contain any changes to save.',
  ControlRequested:
    'Control request recorded. The owner can grant or decline it.',
  ControlGranted: 'Control granted. The other desktop now owns control.',
  ControlDeclined:
    'Control request declined. The current desktop keeps control.',
  ControlReleased: 'Control released. No desktop now owns control.',
  OwnerTookControl: 'Control returned to the owner desktop.',
  ControlLeaseExpired:
    'Control lease expired. Control is unheld; accepted work continues.',
  RunPaused: 'Pause was accepted by the service.',
  RunResumed: 'Resume was accepted by the service.',
  RunStopped: 'Stop was accepted by the service. This run cannot be resumed.',
  FakeSequenceSkipped: 'The remaining fake sequence was skipped.',
  FakePhaseRetried: 'The fake phase will retry once.',
  FakeParkRequested: 'Fake park was requested; no mount moved.',
  RunMutationApplied: 'The fake-run mutation was applied.',
  PreviewUnavailable: 'The requested fake-run preview is unavailable.',
  PreviewExpired: 'The requested fake-run preview expired.',
  ApprovalRequired: 'This fake-run mutation requires approval.',
  ApprovalMismatch: 'The fake-run approval does not match the preview.',
  RetryExhausted: 'The fake phase has already retried once.',
  PolicyUnavailable: 'This fake-run policy is unavailable.',
} satisfies Record<FailureReason | ControlEvent, string>

export const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
export function workspace(
  response: ServerResponse,
  db: DatabaseSync,
  name: 'plan',
) {
  return json(response, 200, planWorkspaceProjection(db, name))
}

export async function processWorkspace(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
) {
  const sourceAssetId = url.searchParams.get('sourceAssetId')
  if (sourceAssetId !== null) {
    const result = await Effect.runPromise(
      LibraryService.pipe(
        Effect.flatMap((library) => library.processSource(sourceAssetId)),
        Effect.map((body) => ({ status: 200, body })),
        Effect.catchTags({
          'Server.LibraryInputInvalid': () =>
            Effect.succeed({ status: 400, reason: 'InvalidInput' }),
          'Server.LibraryAssetNotFound': () =>
            Effect.succeed({ status: 404, reason: 'AssetNotFound' }),
          'Server.LibraryAssetUnavailable': () =>
            Effect.succeed({ status: 409, reason: 'AssetUnavailable' }),
          'Server.LibraryPersistenceUnavailable': () =>
            Effect.succeed({ status: 503, reason: 'LibraryUnavailable' }),
        }),
        Effect.provide(
          sqliteLibraryServiceLayer(db, () => state(db).snapshotVersion),
        ),
      ),
    )
    if ('reason' in result)
      return json(response, result.status, {
        outcome: 'rejected',
        reason: result.reason,
        ...(result.status === 409
          ? {
              message:
                'This asset is temporarily unavailable and cannot open in Process.',
            }
          : {}),
      })
    return json(response, result.status, result.body)
  }
  return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
}
export async function libraryPage(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
) {
  const result = await Effect.runPromise(
    decodeLibraryQuery(url).pipe(
      Effect.flatMap((query) =>
        LibraryService.pipe(Effect.flatMap((library) => library.page(query))),
      ),
      Effect.map((body) => ({ status: 200, body })),
      Effect.catchTags({
        'Server.LibraryInputInvalid': () =>
          Effect.succeed({ status: 400, body: libraryInvalidBody }),
        'Server.LibraryPersistenceUnavailable': () =>
          Effect.succeed({ status: 503, body: libraryUnavailableBody }),
      }),
      Effect.provide(
        sqliteLibraryServiceLayer(db, () => state(db).snapshotVersion),
      ),
    ),
  )
  return json(response, result.status, result.body)
}
function decodeLibraryQuery(url: URL) {
  const allowed = new Set(['queryId', 'cursor', 'pageSize', 'role', 'sort'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
    return Effect.fail(new LibraryInputInvalid())
  const cursor = url.searchParams.get('cursor')
  const pageSize = url.searchParams.get('pageSize') ?? '40'
  if (cursor !== null && !/^\d+$/.test(cursor))
    return Effect.fail(new LibraryInputInvalid())
  if (!/^\d+$/.test(pageSize)) return Effect.fail(new LibraryInputInvalid())
  return Schema.decodeUnknownEffect(LibraryQuery)({
    queryId: url.searchParams.get('queryId') ?? 'library-m27',
    ...(cursor === null ? {} : { cursor }),
    pageSize: Number(pageSize),
    ...(url.searchParams.get('role') === null
      ? {}
      : { role: url.searchParams.get('role') }),
    sort: url.searchParams.get('sort') ?? 'capturedAtDescending',
  }).pipe(Effect.mapError(() => new LibraryInputInvalid()))
}
export async function libraryDetail(
  response: ServerResponse,
  db: DatabaseSync,
  encodedAssetId: string,
) {
  const result = await Effect.runPromise(
    LibraryService.pipe(
      Effect.flatMap((library) =>
        library.detail(decodedAssetId(encodedAssetId)),
      ),
      Effect.map((body) => ({ status: 200, body })),
      Effect.catchTags({
        'Server.LibraryInputInvalid': () =>
          Effect.succeed({ status: 400, body: libraryInvalidBody }),
        'Server.LibraryAssetNotFound': () =>
          Effect.succeed({ status: 404, body: libraryNotFoundBody }),
        'Server.LibraryPersistenceUnavailable': () =>
          Effect.succeed({ status: 503, body: libraryUnavailableBody }),
      }),
      Effect.provide(
        sqliteLibraryServiceLayer(db, () => state(db).snapshotVersion),
      ),
    ),
  )
  return json(response, result.status, result.body)
}
function decodedAssetId(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}
const libraryInvalidBody = {
  outcome: 'rejected',
  reason: 'InvalidInput',
  message: operatorMessages.InvalidInput,
}
const libraryNotFoundBody = { outcome: 'rejected', reason: 'AssetNotFound' }
const libraryUnavailableBody = {
  outcome: 'rejected',
  reason: 'LibraryUnavailable',
}
export async function downloadAsset(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
  grants: DownloadGrantConfig | undefined,
) {
  if (grants === undefined)
    return json(response, 503, {
      outcome: 'rejected',
      reason: 'DownloadUnavailable',
    })
  const encodedAssetId = /^\/api\/library\/assets\/(.+)\/download$/.exec(
    url.pathname,
  )?.[1]
  if (encodedAssetId === undefined)
    return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
  const asset = await Effect.runPromise(
    LibraryService.pipe(
      Effect.flatMap((library) =>
        library.download(decodedAssetId(encodedAssetId)),
      ),
      Effect.map((asset) => ({ status: 200 as const, asset })),
      Effect.catchTags({
        'Server.LibraryInputInvalid': () =>
          Effect.succeed({ status: 400 as const, reason: 'InvalidInput' }),
        'Server.LibraryAssetNotFound': () =>
          Effect.succeed({ status: 404 as const, reason: 'AssetNotFound' }),
        'Server.LibraryAssetUnavailable': () =>
          Effect.succeed({ status: 409 as const, reason: 'AssetUnavailable' }),
        'Server.LibraryPersistenceUnavailable': () =>
          Effect.succeed({
            status: 503 as const,
            reason: 'DownloadUnavailable',
          }),
      }),
      Effect.provide(
        sqliteLibraryServiceLayer(db, () => state(db).snapshotVersion),
      ),
    ),
  )
  if ('reason' in asset)
    return json(response, asset.status, {
      outcome: 'rejected',
      reason: asset.reason,
    })
  const now = grants.now?.() ?? new Date()
  const expiresAt = new Date(now.valueOf() + 300_000).toISOString()
  let signedUrl: string
  try {
    signedUrl = await grants.issuer.issue({
      objectKey: asset.asset.objectKey,
      expiresAt,
    })
  } catch {
    return json(response, 503, {
      outcome: 'rejected',
      reason: 'DownloadUnavailable',
    })
  }
  return response
    .writeHead(303, {
      ...responseHeaders('text/plain; charset=utf-8', 'private, no-store'),
      location: signedUrl,
    })
    .end()
}
function storedValue(db: DatabaseSync, key: string): unknown {
  const raw: unknown = db
    .prepare('SELECT value FROM state WHERE key=?')
    .get(key)
  const row = Schema.decodeUnknownSync(Schema.optional(StoredRow))(raw)
  if (row === undefined) throw new Error(`Missing stored state: ${key}`)
  const parsed: unknown = JSON.parse(row.value)
  return parsed
}
function expireControlRequests(db: DatabaseSync) {
  db.prepare('DELETE FROM control_requests WHERE expires_at<=?').run(
    new Date().toISOString(),
  )
}
function state(
  db: DatabaseSync,
): Omit<Snapshot, 'generatedAt' | 'identity' | 'connection'> {
  expireControlRequests(db)
  const stored = Schema.decodeUnknownSync(StoredState)({
    snapshotVersion: storedValue(db, 'snapshotVersion'),
    eventCursor: storedValue(db, 'eventCursor'),
    planRevision: storedValue(db, 'planRevision'),
    leaseRevision: storedValue(db, 'leaseRevision'),
    leaseHolder: storedValue(db, 'leaseHolder'),
    leaseState: storedValue(db, 'leaseState'),
    reconnectGraceUntil: storedValue(db, 'reconnectGraceUntil'),
    run: storedValue(db, 'run'),
    evidence: storedValue(db, 'evidence'),
  })
  const requestRows: unknown = db
    .prepare(
      'SELECT request_id,client_id,person_id,created_at,expires_at,target_control_capable FROM control_requests ORDER BY client_id',
    )
    .all()
  const requests = Schema.decodeUnknownSync(Schema.Array(StoredRequest))(
    requestRows,
  )
  const rawPlan: unknown = db
    .prepare(
      "SELECT plan_id,revision,projection,run_eligible FROM observing_plans WHERE plan_id='plan-m27'",
    )
    .get()
  const storedPlan = Schema.decodeUnknownSync(
    Schema.optional(ObservingPlanRow),
  )(rawPlan)
  const projection =
    storedPlan === undefined
      ? undefined
      : Schema.decodeUnknownSync(PlanWorkspace)(
          JSON.parse(storedPlan.projection),
        )
  const plan =
    storedPlan === undefined || projection === undefined
      ? {
          id: 'uninitialized',
          revision: 0,
          target: 'No observation plan is installed.',
          readiness: 'unavailable' as const,
          runEligible: false,
        }
      : {
          id: projection.planId,
          revision: projection.revision,
          target: projection.sequences[0]?.target ?? 'Observation plan',
          readiness: projection.readiness,
          runEligible: storedPlan.run_eligible === 1,
        }
  return {
    snapshotVersion: stored.snapshotVersion,
    eventCursor: stored.eventCursor,
    plan,
    control: {
      holderClientId: stored.leaseHolder,
      revision: stored.leaseRevision,
      state: stored.leaseState,
      ...(stored.reconnectGraceUntil === null
        ? {}
        : { reconnectGraceUntil: stored.reconnectGraceUntil }),
      pendingRequests: requests.map((item) => ({
        requestId: item.request_id,
        clientId: item.client_id,
        personId: item.person_id,
        expiresAt: item.expires_at,
      })),
    },
    run: stored.run,
    dispatch: 'none',
    dispatchAction: 'none',
    evidence: {
      ...stored.evidence,
      stack: stored.evidence.stack ?? {
        availability: 'unavailable',
        observedAt: stored.evidence.capturedAt,
        frameCount: 0,
        message: 'No Stack observation has been received.',
      },
    },
  }
}
export function reject(reason: FailureReason) {
  return {
    status:
      reason === 'Unauthenticated'
        ? 401
        : reason === 'FreshnessConflict' ||
            reason === 'PlanUnavailable' ||
            reason === 'PlanNotReady' ||
            reason === 'RunDefinitionAlreadyAccepted' ||
            reason === 'ActiveRunConflict' ||
            reason === 'RunRevisionConflict' ||
            reason === 'AlreadyPaused' ||
            reason === 'AlreadyTerminal' ||
            reason === 'NotPaused' ||
            reason === 'ResumePhaseUnavailable' ||
            reason === 'IdempotencyConflict' ||
            reason === 'PreviewUnavailable' ||
            reason === 'PreviewExpired' ||
            reason === 'RetryExhausted' ||
            reason === 'PolicyUnavailable' ||
            reason === 'DraftUnchanged'
          ? 409
          : reason === 'InvalidInput'
            ? 400
            : 403,
    body: {
      outcome: 'rejected' as const,
      reason,
      message:
        operatorMessages[reason] ??
        'The requested fake-run action is unavailable.',
    },
  }
}

export const commandFailureStatuses = {
  AuthenticationFailure: 401,
  AuthorizationFailure: 403,
  FreshnessConflict: 409,
  InvalidInput: 400,
  ActionIneligible: 409,
  ReferenceUnavailable: 409,
  CapabilityUnavailable: 409,
  ResourceProtected: 409,
  IdempotencyConflict: 409,
} satisfies Record<CommandFailure['_tag'], number>
const sqlitePlanPersistenceLayer = (
  runRepository: RunSqliteRepositoryShape,
  stateRepository: StateSqliteRepositoryShape,
  publish: (type: string, cursor: number) => void,
) =>
  planPersistenceLayer({
    saveDraft: (intent, identity) =>
      Effect.try({
        try: () => runRepository.saveDraft(intent, identity),
        catch: (cause) => cause,
      }),
    acceptRunDefinition: (intent, identity) =>
      Effect.try({
        try: () => runRepository.acceptRunDefinition(intent, identity),
        catch: (cause) => cause,
      }),
    startAcceptedRun: (intent, identity) =>
      Effect.try({
        try: () => runRepository.startAcceptedRun(intent, identity),
        catch: (cause) => cause,
      }),
    previewRunMutation: (intent, identity) =>
      Effect.try({
        try: () => runRepository.previewRunMutation(intent, identity),
        catch: (cause) => cause,
      }),
    applyRunMutation: (intent, identity) =>
      Effect.try({
        try: () => runRepository.applyRunMutation(intent, identity),
        catch: (cause) => cause,
      }),
    snapshot: (identity) => stateRepository.bootstrapSnapshot(identity),
    publish: (type, cursor) =>
      Effect.try({
        try: () => publish(type, cursor),
        catch: (cause) => cause,
      }),
  })
export const planCommandFromRequest = Effect.fn(
  'Server.planCommandFromRequest',
)(
  function* (
    request: Promise<unknown | undefined | typeof BodyTooLarge>,
    runRepository: RunSqliteRepositoryShape,
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => void,
  ) {
    void runRepository
    void stateRepository
    void identity
    void publish
    return yield* executePlanRequest(request, BodyTooLarge, identity)
  },
  (effect, _request, runRepository, stateRepository, identity, publish) =>
    effect.pipe(
      Effect.provide(
        Layer.merge(
          sqlitePlanPersistenceLayer(runRepository, stateRepository, publish),
          planServiceLayer.pipe(
            Layer.provide(
              sqlitePlanPersistenceLayer(
                runRepository,
                stateRepository,
                publish,
              ),
            ),
          ),
        ),
      ),
    ),
)
const sqliteObservePersistenceLayer = (
  runRepository: RunSqliteRepositoryShape,
  stateRepository: StateSqliteRepositoryShape,
  publish: (type: string, cursor: number) => void,
) =>
  observePersistenceLayer({
    pause: (intent, identity) =>
      Effect.try({
        try: () => runRepository.pause(intent, identity),
        catch: (cause) => cause,
      }),
    resume: (intent, identity) =>
      Effect.try({
        try: () => runRepository.resume(intent, identity),
        catch: (cause) => cause,
      }),
    stop: (intent, identity) =>
      Effect.try({
        try: () => runRepository.stop(intent, identity),
        catch: (cause) => cause,
      }),
    skip: (intent, identity) =>
      Effect.try({
        try: () => runRepository.skip(intent, identity),
        catch: (cause) => cause,
      }),
    retry: (intent, identity) =>
      Effect.try({
        try: () => runRepository.retry(intent, identity),
        catch: (cause) => cause,
      }),
    park: (intent, identity) =>
      Effect.try({
        try: () => runRepository.park(intent, identity),
        catch: (cause) => cause,
      }),
    snapshot: (identity) => stateRepository.bootstrapSnapshot(identity),
    publish: (type, cursor) =>
      Effect.try({
        try: () => publish(type, cursor),
        catch: (cause) => cause,
      }),
  })
export const observeCommandFromRequest = Effect.fn(
  'Server.observeCommandFromRequest',
)(
  function* (
    request: Promise<unknown | undefined | typeof BodyTooLarge>,
    runRepository: RunSqliteRepositoryShape,
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => void,
  ) {
    void runRepository
    void stateRepository
    void identity
    void publish
    return yield* executeObserveRequest(request, BodyTooLarge, identity)
  },
  (effect, _request, runRepository, stateRepository, identity, publish) =>
    effect.pipe(
      Effect.provide(
        Layer.merge(
          sqliteObservePersistenceLayer(
            runRepository,
            stateRepository,
            publish,
          ),
          observeServiceLayer.pipe(
            Layer.provide(
              sqliteObservePersistenceLayer(
                runRepository,
                stateRepository,
                publish,
              ),
            ),
          ),
        ),
      ),
    ),
)
export const observeServiceResponse = Effect.fn(
  'Server.observeServiceResponse',
)(function* (_failure: 'ObserveServiceUnavailable', summary: string) {
  const body = yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
    _tag: 'Unavailable',
    failure: { _tag: 'ObserveServiceUnavailable', summary },
  })
  return { status: 503, body }
})
export const observeInvalidResponse = Effect.fn(
  'Server.observeInvalidResponse',
)(function* (
  stateRepository: StateSqliteRepositoryShape,
  identity: LocalIdentity,
) {
  const snapshot = yield* stateRepository.bootstrapSnapshot(identity)
  const body = yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
    _tag: 'Rejected',
    failure: {
      _tag: 'InvalidInput',
      summary: 'The Observe command is invalid.',
    },
    snapshot,
  })
  return { status: 400, body }
})
export const planServiceResponse = Effect.fn('Server.planServiceResponse')(
  function* (failure: 'PlanServiceUnavailable', summary: string) {
    const body = yield* Schema.decodeUnknownEffect(PlanCommandResponse)({
      _tag: 'Unavailable',
      failure: { _tag: 'PlanServiceUnavailable', summary },
    })
    return { status: 503, body }
  },
)
export const planInvalidResponse = Effect.fn('Server.planInvalidResponse')(
  function* (
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
  ) {
    const snapshot = yield* stateRepository.bootstrapSnapshot(identity)
    const body = yield* Schema.decodeUnknownEffect(PlanCommandResponse)({
      _tag: 'Rejected',
      failure: {
        _tag: 'InvalidInput',
        summary: 'The Plan command is invalid.',
      },
      snapshot,
    })
    return { status: 400, body }
  },
)
export const BodyTooLarge = Symbol('BodyTooLarge')
export function body(
  request: IncomingMessage,
): Promise<unknown | undefined | typeof BodyTooLarge> {
  return new Promise((resolve) => {
    let size = 0
    let text = ''
    let settled = false
    const finish = (value: unknown | undefined | typeof BodyTooLarge) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const contentLength = request.headers['content-length']
    if (
      typeof contentLength === 'string' &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) > 16_384
    ) {
      request.resume()
      return finish(BodyTooLarge)
    }
    request.on('data', (chunk: Buffer | string) => {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      if (size > 16_384) {
        request.resume()
        return finish(BodyTooLarge)
      }
      text += chunk
    })
    request.on('end', () => {
      try {
        finish(JSON.parse(text))
      } catch {
        finish(undefined)
      }
    })
    request.on('error', () => finish(undefined))
  })
}
export function responseHeaders(
  contentType: string,
  cacheControl = 'no-store',
) {
  return {
    'content-type': contentType,
    'cache-control': cacheControl,
    'content-security-policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  }
}
export function json(response: ServerResponse, status: number, value: unknown) {
  response
    .writeHead(status, responseHeaders('application/json; charset=utf-8'))
    .end(JSON.stringify(value))
}
export function unauthenticated(
  response: ServerResponse,
  method: string | undefined,
  path: string,
) {
  if (method === 'GET' && path === '/api/snapshot')
    return void Effect.runSync(
      Schema.decodeUnknownEffect(BootstrapHttpFailureEnvelope)({
        ok: false,
        failure: {
          _tag: 'AuthenticationFailure',
          reason: 'Unauthenticated',
          summary: 'A verified member identity is required.',
        },
      }).pipe(Effect.map((body) => json(response, 401, body))),
    )
  if (method === 'POST' && path === '/api/commands/control')
    return void Effect.runSync(
      Schema.decodeUnknownEffect(CommandHttpFailureEnvelope)({
        ok: false,
        failure: {
          _tag: 'AuthenticationFailure',
          summary: 'A verified member identity is required.',
        },
      }).pipe(Effect.map((body) => json(response, 401, body))),
    )
  return json(response, 401, reject('Unauthenticated').body)
}
