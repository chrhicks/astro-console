import { type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import {
  createPublicKey,
  createVerify,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { Effect, Exit, Layer, Schema, Scope } from 'effect'
import {
  BootstrapHttpFailureEnvelope,
  BootstrapHttpSuccessEnvelope,
  CommandFailure,
  CommandHttpFailureEnvelope,
  ObserveCommandResponse,
  PlanCommandResponse,
  PlanWorkspaceProjection,
  LibraryQuery,
} from '@astro-console/v2-contracts'
import {
  cleanupProcessOrphans,
  saveProcessOutputs,
  type ProcessSaveStorage,
} from './process-save.ts'
import type { DownloadGrantIssuer } from './r2-download-grant.ts'
import { configuredDownloadGrantIssuer } from './download-grant-config.ts'
import {
  originServerConfig,
  type OriginServerConfig,
} from './environment-config.ts'
import { runExecutable } from './executable.ts'
import { OriginListener, originListenerLayer } from './origin-listener.ts'
import { WebHost, webHostLayer } from './web-host.ts'
import { openOriginDatabase } from './database.ts'
import type { LocalIdentity, RequestAdmission } from './identity.ts'
import {
  type ControlEvent,
  type Evidence,
  type FailureReason,
  type Snapshot,
} from './domain-state.ts'
import {
  ProjectionPublication,
  projectionPublicationLayer,
} from './projection-publication.ts'
import {
  executePlanRequest,
  planPersistenceLayer,
  planServiceLayer,
} from './plan-command-service.ts'
import { controlCommandFromEnvelope } from './control-sqlite-repository.ts'
import {
  executeObserveRequest,
  observePersistenceLayer,
  observeServiceLayer,
} from './observe-command-service.ts'
import { LibraryInputInvalid, LibraryService } from './library-service.ts'
import {
  installPublishedLibraryFixture,
  sqliteLibraryServiceLayer,
} from './library-sqlite-repository.ts'
import { createOriginRouter } from './origin-router.ts'
import {
  initializeRuntimeState,
  installM27Fixture,
  planWorkspaceProjection,
} from './runtime-bootstrap.ts'
import {
  StateSqliteRepository,
  stateSqliteRepositoryLayer,
  type StateSqliteRepositoryShape,
} from './state-sqlite-repository.ts'
import {
  RunSqliteRepository,
  runSqliteRepositoryLayer,
  type RunSqliteRepositoryShape,
} from './run-sqlite-repository.ts'
import {
  bootstrapPlanWorkspaceProjection,
  observeWorkspaceProjection,
} from './workspace-projection-service.ts'
export type DownloadGrantConfig = {
  readonly issuer: DownloadGrantIssuer
  readonly now?: () => Date
}
const AccessClaims = Schema.Struct({
  sub: Schema.NonEmptyString,
  iss: Schema.NonEmptyString,
  aud: Schema.Union([
    Schema.NonEmptyString,
    Schema.Array(Schema.NonEmptyString),
  ]),
  exp: Schema.Int,
  email: Schema.optionalKey(Schema.String),
})
const AccessHeader = Schema.Struct({
  alg: Schema.Literal('RS256'),
  kid: Schema.NonEmptyString,
  typ: Schema.optionalKey(Schema.String),
})
const JwksDocument = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kid: Schema.NonEmptyString,
      kty: Schema.Literal('RSA'),
      alg: Schema.optionalKey(Schema.Literal('RS256')),
      use: Schema.optionalKey(Schema.Literal('sig')),
      n: Schema.optionalKey(Schema.NonEmptyString),
      e: Schema.optionalKey(Schema.NonEmptyString),
      x5c: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
    }),
  ),
})
const MembershipRow = Schema.Struct({
  person_id: Schema.String,
  role: Schema.Literals(['owner', 'viewer']),
})
const MembershipBootstrap = Schema.Array(
  Schema.Struct({
    email: Schema.NonEmptyString,
    personId: Schema.NonEmptyString,
    role: Schema.Literals(['owner', 'viewer']),
  }),
)
const jwtPart = (part: string) => Buffer.from(part, 'base64url')
function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Bootstrap email is invalid')
  return email
}
type MembershipPolicy = ReadonlyArray<{
  readonly email: string
  readonly personId: string
  readonly role: 'owner' | 'viewer'
}>
export type MembershipBootstrapResolver = {
  load(): MembershipPolicy | undefined
}
function membershipPolicy(
  bootstrap: typeof MembershipBootstrap.Type,
): MembershipPolicy {
  const policy = bootstrap.map((entry) => ({
    ...entry,
    email: normalizedEmail(entry.email),
  }))
  if (new Set(policy.map((entry) => entry.email)).size !== policy.length)
    throw new Error('Bootstrap emails must be unique after normalization')
  return policy
}
export function createMembershipBootstrapResolver(config: {
  readonly path: string
  readonly reloadIntervalMs?: number
  readonly now?: () => number
}): MembershipBootstrapResolver {
  const interval = config.reloadIntervalMs ?? 1_000
  if (!Number.isInteger(interval) || interval < 1_000 || interval > 60_000)
    throw new Error(
      'Membership bootstrap reload interval must be between 1000 and 60000 ms',
    )
  const now = config.now ?? Date.now
  let checkedAt = -Infinity
  let mtimeMs: number | undefined
  let policy: MembershipPolicy | undefined
  return {
    load: () => {
      if (now() - checkedAt < interval) return policy
      checkedAt = now()
      try {
        const modified = statSync(config.path).mtimeMs
        if (modified === mtimeMs && policy !== undefined) return policy
        policy = membershipPolicy(
          Schema.decodeUnknownSync(MembershipBootstrap)(
            JSON.parse(readFileSync(config.path, 'utf8')),
          ),
        )
        mtimeMs = modified
        return policy
      } catch {
        mtimeMs = undefined
        policy = undefined
        return undefined
      }
    },
  }
}
type AccessToken = {
  readonly header: typeof AccessHeader.Type
  readonly claims: typeof AccessClaims.Type
  readonly signed: string
  readonly signature: Buffer
}
export type JwksFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<{
  readonly ok: boolean
  readonly status: number
  text(): Promise<string>
}>
export type JwksKeyResolver = {
  resolve(kid: string): Promise<KeyObject | undefined>
  refresh(): Promise<void>
}
function accessToken(
  request: Pick<IncomingMessage, 'headers'> | undefined,
): AccessToken | undefined {
  const token = request?.headers['cf-access-jwt-assertion']
  if (typeof token !== 'string' || token.length > 8_192) return undefined
  const [encodedHeader, encodedClaims, encodedSignature, extra] =
    token.split('.')
  if (
    !encodedHeader ||
    !encodedClaims ||
    !encodedSignature ||
    extra !== undefined
  )
    return undefined
  try {
    return {
      header: Schema.decodeUnknownSync(AccessHeader)(
        JSON.parse(jwtPart(encodedHeader).toString('utf8')),
      ),
      claims: Schema.decodeUnknownSync(AccessClaims)(
        JSON.parse(jwtPart(encodedClaims).toString('utf8')),
      ),
      signed: `${encodedHeader}.${encodedClaims}`,
      signature: jwtPart(encodedSignature),
    }
  } catch {
    return undefined
  }
}
function validClaims(
  config: { readonly issuer: string; readonly audience: string },
  claims: typeof AccessClaims.Type,
) {
  return (
    claims.iss === config.issuer &&
    (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(
      config.audience,
    ) &&
    claims.exp > Math.floor(Date.now() / 1_000)
  )
}
function verifyAccessToken(token: AccessToken, key: KeyObject) {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(token.signed)
    verifier.end()
    return verifier.verify(key, token.signature)
  } catch {
    return false
  }
}
function keyFromJwk(
  jwk: (typeof JwksDocument.Type)['keys'][number],
): KeyObject | undefined {
  try {
    if (jwk.n !== undefined && jwk.e !== undefined)
      return createPublicKey({
        key: { kty: 'RSA', n: jwk.n, e: jwk.e },
        format: 'jwk',
      })
    if (jwk.x5c?.[0] !== undefined)
      return new X509Certificate(Buffer.from(jwk.x5c[0], 'base64')).publicKey
    return undefined
  } catch {
    return undefined
  }
}
export function createJwksKeyResolver(config: {
  readonly url: string
  readonly cacheTtlMs?: number
  readonly fetcher?: JwksFetcher
  readonly now?: () => number
}): JwksKeyResolver {
  const endpoint = new URL(config.url)
  if (endpoint.protocol !== 'https:')
    throw new Error('CF Access JWKS URL must use HTTPS')
  const ttl = config.cacheTtlMs ?? 300_000
  if (!Number.isInteger(ttl) || ttl < 1_000 || ttl > 3_600_000)
    throw new Error(
      'CF Access JWKS cache TTL must be between 1000 and 3600000 ms',
    )
  const fetcher = config.fetcher ?? ((url, signal) => fetch(url, { signal }))
  const now = config.now ?? Date.now
  let cached: ReadonlyMap<string, KeyObject> | undefined
  let expiresAt = 0
  const unknownKids = new Set<string>()
  const refresh = async () => {
    const response = await fetcher(
      endpoint.toString(),
      AbortSignal.timeout(5_000),
    )
    if (!response.ok)
      throw new Error(`CF Access JWKS request failed with ${response.status}`)
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > 131_072)
      throw new Error('CF Access JWKS response exceeds 128 KiB')
    const document = Schema.decodeUnknownSync(JwksDocument)(JSON.parse(text))
    const keys = new Map<string, KeyObject>()
    for (const jwk of document.keys) {
      const key = keyFromJwk(jwk)
      if (key === undefined || keys.has(jwk.kid))
        throw new Error(
          'CF Access JWKS contains an invalid or duplicate signing key',
        )
      keys.set(jwk.kid, key)
    }
    if (keys.size === 0)
      throw new Error('CF Access JWKS contains no signing keys')
    cached = keys
    expiresAt = now() + ttl
    unknownKids.clear()
  }
  return {
    refresh,
    resolve: async (kid) => {
      if (cached === undefined || now() >= expiresAt) {
        try {
          await refresh()
        } catch {
          return undefined
        }
      }
      let key = cached?.get(kid)
      if (key !== undefined) return key
      if (unknownKids.has(kid)) return undefined
      try {
        await refresh()
      } catch {
        return undefined
      }
      key = cached?.get(kid)
      if (key === undefined) {
        if (unknownKids.size >= 64) unknownKids.clear()
        unknownKids.add(kid)
      }
      return key
    },
  }
}
async function verifiedAccessClaims(
  config: {
    readonly issuer: string
    readonly audience: string
    readonly keyResolver: JwksKeyResolver
  },
  request: Pick<IncomingMessage, 'headers'> | undefined,
) {
  const token = accessToken(request)
  if (token === undefined || !validClaims(config, token.claims))
    return undefined
  const key = await config.keyResolver.resolve(token.header.kid)
  return key !== undefined && verifyAccessToken(token, key)
    ? token.claims
    : undefined
}
export function createProductionAccessAdmission(config: {
  readonly issuer: string
  readonly audience: string
  readonly keyResolver: JwksKeyResolver
  readonly databasePath: string
  readonly clientContext: 'desktop' | 'phone'
  readonly bootstrap?: typeof MembershipBootstrap.Type
  readonly bootstrapResolver?: MembershipBootstrapResolver
}): RequestAdmission {
  const staticPolicy =
    config.bootstrap === undefined
      ? undefined
      : membershipPolicy(config.bootstrap)
  if (staticPolicy === undefined && config.bootstrapResolver === undefined)
    throw new Error(
      'Production admission requires a membership bootstrap policy',
    )
  return async (request) => {
    const claims = await verifiedAccessClaims(config, request)
    if (!claims || claims.email === undefined) return undefined
    const policy = config.bootstrapResolver?.load() ?? staticPolicy
    if (policy === undefined) return undefined
    const email = claims.email
    if (email === undefined) return undefined
    const entry = policy.find((item) => item.email === normalizedEmail(email))
    if (!entry) return undefined
    const membership = new DatabaseSync(config.databasePath)
    try {
      membership.exec('BEGIN IMMEDIATE')
      membership
        .prepare(
          'INSERT INTO memberships VALUES (?,?,?) ON CONFLICT(external_subject) DO UPDATE SET person_id=excluded.person_id,role=excluded.role',
        )
        .run(claims.sub, entry.personId, entry.role)
      const raw: unknown = membership
        .prepare(
          'SELECT person_id,role FROM memberships WHERE external_subject=?',
        )
        .get(claims.sub)
      const stored = Schema.decodeUnknownSync(MembershipRow)(raw)
      membership.exec('COMMIT')
      if (stored.person_id !== entry.personId || stored.role !== entry.role)
        return undefined
      return {
        personId: stored.person_id,
        clientId: `access:${claims.sub}`,
        role: stored.role,
        capability:
          stored.role === 'owner' && config.clientContext === 'desktop'
            ? 'controlCapable'
            : 'readOnly',
      }
    } catch {
      try {
        membership.exec('ROLLBACK')
      } catch {}
      return undefined
    } finally {
      membership.close()
    }
  }
}
export const createLocalFixtureAdmission =
  (identity: LocalIdentity): RequestAdmission =>
  () => ({
    ...identity,
    role:
      identity.role ??
      (identity.personId === 'owner-chicks' ? 'owner' : 'viewer'),
  })
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
const AdapterObservation = Schema.Struct({
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
    readonly fixture?: 'm27' | 'plan-draft' | 'library-published'
    readonly webDistPath?: string
  } = {},
) {
  const database = openOriginDatabase(databasePath)
  if (options.fixture !== undefined) {
    installM27Fixture(database, options.fixture !== 'plan-draft')
    if (options.fixture === 'library-published')
      installPublishedLibraryFixture(database)
  } else initializeRuntimeState(database)
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
      processWorkspace(response, database, url),
    libraryPage: (response, url) => libraryPage(response, database, url),
    libraryDownload: (response, url) =>
      downloadAsset(response, database, url, downloadGrants),
    libraryDetail: (response, encodedAssetId) =>
      libraryDetail(response, database, encodedAssetId),
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

const isOwner = (identity: LocalIdentity) => identity.role === 'owner'
function workspace(response: ServerResponse, db: DatabaseSync, name: 'plan') {
  return json(response, 200, planWorkspaceProjection(db, name))
}

async function processWorkspace(
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
async function libraryPage(
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
async function libraryDetail(
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
async function downloadAsset(
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
function reject(reason: FailureReason) {
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

const commandFailureStatuses = {
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
const planCommandFromRequest = Effect.fn('Server.planCommandFromRequest')(
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
const observeCommandFromRequest = Effect.fn('Server.observeCommandFromRequest')(
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
const observeServiceResponse = Effect.fn('Server.observeServiceResponse')(
  function* (_failure: 'ObserveServiceUnavailable', summary: string) {
    const body = yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
      _tag: 'Unavailable',
      failure: { _tag: 'ObserveServiceUnavailable', summary },
    })
    return { status: 503, body }
  },
)
const observeInvalidResponse = Effect.fn('Server.observeInvalidResponse')(
  function* (
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
  },
)
const planServiceResponse = Effect.fn('Server.planServiceResponse')(function* (
  failure: 'PlanServiceUnavailable',
  summary: string,
) {
  const body = yield* Schema.decodeUnknownEffect(PlanCommandResponse)({
    _tag: 'Unavailable',
    failure: { _tag: 'PlanServiceUnavailable', summary },
  })
  return { status: 503, body }
})
const planInvalidResponse = Effect.fn('Server.planInvalidResponse')(function* (
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
})
const BodyTooLarge = Symbol('BodyTooLarge')
function body(
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
function responseHeaders(contentType: string, cacheControl = 'no-store') {
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
function json(response: ServerResponse, status: number, value: unknown) {
  response
    .writeHead(status, responseHeaders('application/json; charset=utf-8'))
    .end(JSON.stringify(value))
}
function unauthenticated(
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
if (process.argv[1]?.endsWith('server.ts')) {
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
}
