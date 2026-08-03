import { type IncomingMessage, type ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import {
  randomUUID,
  createHash,
  createPublicKey,
  createVerify,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Effect, Exit, Layer, Option, Schema, Scope } from 'effect'
import {
  BootstrapHttpFailureEnvelope,
  BootstrapHttpSuccessEnvelope,
  BootstrapSseEventEnvelope,
  BootstrapSnapshot,
  Command,
  CommandEnvelope,
  CommandFailure,
  CommandHttpFailureEnvelope,
  CommandHttpSuccessEnvelope,
  PlanCommandRequest,
  PlanCommandResponse,
  PlanIntent,
  PlanWorkspaceProjection,
} from '@astro-console/v2-contracts'
import { decodeSeestarPushEvent } from 'seestar-sdk'
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
const StartRun = Schema.TaggedStruct('StartRunFromPlan', {
  planId: Schema.NonEmptyString,
  expectedPlanRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const AcceptRunDefinition = Schema.TaggedStruct('AcceptRunDefinition', {
  planId: Schema.NonEmptyString,
  expectedPlanRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const PauseRun = Schema.TaggedStruct('PauseRun', {
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const ResumeRun = Schema.TaggedStruct('ResumeRun', {
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const FakePolicy = Schema.Struct({
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const PreviewRunMutation = Schema.TaggedStruct('PreviewRunMutation', {
  mutation: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const ApplyRunMutation = Schema.TaggedStruct('ApplyRunMutation', {
  previewId: Schema.NonEmptyString,
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
})
const ApproveDisruptiveRunMutation = Schema.TaggedStruct(
  'ApproveDisruptiveRunMutation',
  {
    previewId: Schema.NonEmptyString,
    approvalToken: Schema.NonEmptyString,
    expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    expectedRunRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    idempotencyKey: Schema.NonEmptyString,
  },
)
const SavePlanDraft = Schema.Struct({
  planId: Schema.NonEmptyString,
  expectedPlanRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  idempotencyKey: Schema.NonEmptyString,
  sequences: Schema.Array(
    Schema.Struct({
      sequenceId: Schema.NonEmptyString,
      target: Schema.NonEmptyString,
      capture: Schema.NonEmptyString,
      acquisition: Schema.NonEmptyString,
      stopCondition: Schema.NonEmptyString,
      window: Schema.Struct({
        startsAt: Schema.NonEmptyString,
        endsAt: Schema.NonEmptyString,
        usableMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        peakAltitudeDeg: Schema.Finite,
        horizonClearanceDeg: Schema.Finite,
      }),
      estimatedMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
      storageForecastMb: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      horizon: Schema.Literals(['clear', 'limited', 'blocked', 'missing']),
      storage: Schema.Literals(['available', 'limited', 'blocked', 'missing']),
    }),
  ),
})
const ControlCommand = Schema.Struct({
  expectedLeaseRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  expectedRunRevision: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  idempotencyKey: Schema.NonEmptyString,
})
const SolarTestIntentInput = Schema.Struct({
  name: Schema.NonEmptyString.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(120),
  ),
  idempotencyKey: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
})
type Capability = 'controlCapable' | 'readOnly'
export type LocalIdentity = {
  readonly personId: string
  readonly clientId: string
  readonly capability: Capability
  readonly role?: 'owner' | 'viewer'
}
export type RequestAdmission = (
  request?: Pick<IncomingMessage, 'headers'>,
) => LocalIdentity | undefined | Promise<LocalIdentity | undefined>
export type SolarTestIntentResult =
  | {
      readonly outcome: 'accepted'
      readonly intentId: string
      readonly name: string
      readonly state: 'awaitingAdapter'
      readonly evidence: 'awaitingStackEvidence'
    }
  | {
      readonly outcome: 'rejected'
      readonly reason:
        'OwnerRequired' | 'ClientReadOnly' | 'InvalidInput' | 'SolarTestPending'
    }
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
type RunPhase =
  | 'preflight'
  | 'acquire'
  | 'capture'
  | 'verify'
  | 'completed'
  | 'paused'
  | 'stopped'
  | 'parkRequested'
type RunMutation = {
  readonly previewId: string
  readonly kind: 'reprioritizeSecond' | 'shortenSecond' | 'discardCurrent'
}
type Run = {
  readonly id: string
  readonly revision: number
  readonly phase: RunPhase
  readonly target: string
  readonly progress: number
  readonly sourceDefinitionId?: string
  readonly activeSequenceIndex?: number
  readonly completedSequenceCount?: number
  readonly resumablePhase?: Exclude<
    RunPhase,
    'paused' | 'completed' | 'stopped' | 'parkRequested'
  >
  readonly retryPhase?: 'preflight' | 'acquire' | 'capture' | 'verify'
  readonly appliedMutations?: ReadonlyArray<RunMutation>
}
function resumableRunPhase(
  phase: RunPhase,
):
  | Exclude<RunPhase, 'paused' | 'completed' | 'stopped' | 'parkRequested'>
  | undefined {
  return phase === 'preflight' ||
    phase === 'acquire' ||
    phase === 'capture' ||
    phase === 'verify'
    ? phase
    : undefined
}
type Evidence = {
  readonly frameId: string
  readonly capturedAt: string
  readonly quality: 'verified' | 'warning'
  readonly desired: string
  readonly solved: string
  readonly uncertaintyArcsec: number
  readonly stack?: {
    readonly availability: 'available' | 'unavailable'
    readonly observedAt: string
    readonly frameCount: number
    readonly message: string
  }
  readonly correction: {
    readonly state: 'automatic' | 'exhausted'
    readonly evidence: string
    readonly bound: string
    readonly protection: string
    readonly action: string
  }
}
type Snapshot = {
  readonly snapshotVersion: number
  readonly eventCursor: number
  readonly generatedAt: string
  readonly identity: LocalIdentity
  readonly plan: {
    readonly id: string
    readonly revision: number
    readonly target: string
    readonly readiness: PlanReadiness | 'unavailable'
    readonly runEligible: boolean
  }
  readonly control: {
    readonly holderClientId: string | null
    readonly revision: number
    readonly state: 'held' | 'reconnecting' | 'unheld'
    readonly reconnectGraceUntil?: string
    readonly pendingRequests: ReadonlyArray<{
      readonly clientId: string
      readonly personId: string
    }>
  }
  readonly run: Run | null
  readonly dispatch:
    'none' | 'pending' | 'dispatched' | 'unavailable' | 'failed'
  readonly dispatchAction: 'none' | 'pause' | 'resume' | 'stop'
  readonly evidence: Evidence
  readonly connection: 'current'
}
type ControlEvent =
  | 'ControlRequested'
  | 'ControlGranted'
  | 'OwnerTookControl'
  | 'ControlReconnectGraceStarted'
  | 'ControlReconnected'
  | 'ControlGraceExpired'
  | 'RunPaused'
  | 'RunResumed'
  | 'RunStopped'
  | 'FakeSequenceSkipped'
  | 'FakePhaseRetried'
  | 'FakeParkRequested'
  | 'RunMutationApplied'
type FailureReason =
  | 'Unauthenticated'
  | 'FreshnessConflict'
  | 'PlanUnavailable'
  | 'PlanNotReady'
  | 'RunDefinitionAlreadyAccepted'
  | 'ClientReadOnly'
  | 'ControlLeaseLost'
  | 'OwnerRequired'
  | 'ControlRequestUnavailable'
  | 'ActiveRunConflict'
  | 'RunRevisionConflict'
  | 'AlreadyPaused'
  | 'AlreadyTerminal'
  | 'NotPaused'
  | 'ResumePhaseUnavailable'
  | 'IdempotencyConflict'
  | 'PreviewUnavailable'
  | 'PreviewExpired'
  | 'ApprovalRequired'
  | 'ApprovalMismatch'
  | 'RetryExhausted'
  | 'PolicyUnavailable'
  | 'InvalidInput'
  | 'DraftUnchanged'
type CommandResult =
  | {
      readonly outcome: 'accepted'
      readonly eventType?: ControlEvent
      readonly message?: string
      readonly run?: Run
      readonly snapshot: Snapshot
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: FailureReason
      readonly message: string
    }
class CommandRejected extends Schema.TaggedErrorClass<CommandRejected>()(
  'Server.CommandRejected',
  { failure: CommandFailure },
) {}
class CommandInputInvalid extends Schema.TaggedErrorClass<CommandInputInvalid>()(
  'Server.CommandInputInvalid',
  {},
) {}
class PlanCommandInputInvalid extends Schema.TaggedErrorClass<PlanCommandInputInvalid>()(
  'Server.PlanCommandInputInvalid',
  {},
) {}
class PlanServiceUnavailable extends Schema.TaggedErrorClass<PlanServiceUnavailable>()(
  'Server.PlanServiceUnavailable',
  {},
) {}
interface PlanCommandServiceShape {
  readonly execute: (intent: typeof PlanIntent.Type) => Effect.Effect<
    {
      readonly status: number
      readonly body: typeof PlanCommandResponse.Type
    },
    Schema.SchemaError | PlanServiceUnavailable
  >
}
class PlanCommandService extends Context.Service<
  PlanCommandService,
  PlanCommandServiceShape
>()('Server.PlanCommandService') {}
interface ControlCommandServiceShape {
  readonly execute: (
    commandId: string,
    command: typeof controlEnvelopeCommand.Type,
  ) => Effect.Effect<
    {
      readonly status: number
      readonly body: typeof CommandHttpSuccessEnvelope.Type
    },
    CommandRejected | Schema.SchemaError
  >
}
class ControlCommandService extends Context.Service<
  ControlCommandService,
  ControlCommandServiceShape
>()('Server.ControlCommandService') {}
type PlanReadiness = 'ready' | 'readyWithLimitations' | 'blocked'
type DraftSequence = (typeof SavePlanDraft.Type)['sequences'][number]
type PlanProjection = {
  readonly planId: string
  readonly revision: number
  readonly readiness: PlanReadiness
  readonly readinessSummary: string
  readonly limitations: ReadonlyArray<string>
  readonly sequences: ReadonlyArray<
    DraftSequence & { readonly viability: 'viable' | 'limited' | 'blocked' }
  >
}
type SavePlanDraftResult =
  | {
      readonly outcome: 'accepted'
      readonly plan: PlanProjection
      readonly snapshot: Snapshot
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: FailureReason
      readonly message: string
    }
type RunDefinition = {
  readonly id: string
  readonly sourcePlanId: string
  readonly sourcePlanRevision: number
  readonly acceptedAt: string
  readonly executor: 'fake' | 'fixture'
  readonly plan: PlanProjection
}
type AcceptRunDefinitionResult =
  | {
      readonly outcome: 'accepted'
      readonly runDefinition: RunDefinition
      readonly snapshot: Snapshot
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: FailureReason
      readonly message: string
    }
type LibraryRole =
  | 'original'
  | 'linearMaster'
  | 'intermediate'
  | 'final'
  | 'preview'
  | 'diagnostic'
type LibrarySort = 'capturedAtDescending' | 'sharpestFirst' | 'recentlyUpdated'

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
  client_id: Schema.String,
  person_id: Schema.String,
})
const ControlRequestRow = Schema.Struct({ client_id: Schema.String })
const StoredRow = Schema.Struct({ value: Schema.String })
const LatestCursorRow = Schema.Struct({ cursor: Schema.Int })
const MigrationRow = Schema.Struct({ version: Schema.Int })
const WorkerStatusRow = Schema.Struct({
  worker_id: Schema.String,
  state: Schema.Literals(['alive', 'stopped']),
  adapter_state: Schema.Literals(['ready', 'unconfigured']),
  last_heartbeat: Schema.String,
})
const OutboxClaimRow = Schema.Struct({
  id: Schema.String,
  payload: Schema.String,
})
const CountRow = Schema.Struct({ count: Schema.Int })
const SolarTestIntentRow = Schema.Struct({
  intent_id: Schema.String,
  name: Schema.String,
  owner_person_id: Schema.String,
  semantic_key: Schema.String,
  state: Schema.Literal('awaitingAdapter'),
  evidence_state: Schema.Literal('awaitingStackEvidence'),
})
const SolarTestWork = Schema.Struct({
  intentId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  target: Schema.Literal('Sun'),
  requiredEvidence: Schema.Literal('Stack'),
})
const SqliteColumnRow = Schema.Struct({ name: Schema.String })
const LibraryRole = Schema.Literals([
  'original',
  'linearMaster',
  'intermediate',
  'final',
  'preview',
  'diagnostic',
])
const LibrarySort = Schema.Literals([
  'capturedAtDescending',
  'sharpestFirst',
  'recentlyUpdated',
])
const LibraryQueryInput = Schema.Struct({
  queryId: Schema.NonEmptyString,
  cursor: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
  pageSize: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100),
  ),
  role: Schema.optionalKey(LibraryRole),
  sort: LibrarySort,
})
const LibraryAssetRow = Schema.Struct({
  asset_id: Schema.String,
  revision: Schema.Int,
  role: LibraryRole,
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  comparison_group_id: Schema.String,
  detail: Schema.String,
})
const LibraryDetail = Schema.Struct({
  assetId: Schema.String,
  revision: Schema.Int,
  role: LibraryRole,
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  capturedAt: Schema.String,
  comparisonGroupId: Schema.String,
  lineage: Schema.Struct({
    sourceAssetIds: Schema.Array(Schema.String),
    runId: Schema.String,
    solveAttemptId: Schema.String,
  }),
  representations: Schema.Array(
    Schema.Struct({ label: Schema.String, state: Schema.String }),
  ),
})
const DownloadAssetRow = Schema.Struct({
  asset_id: Schema.String,
  role: LibraryRole,
  format: Schema.Literals(['cameraRaw', 'fits', 'tiff', 'png', 'jpeg']),
  availability: Schema.Literals([
    'availableLocally',
    'preparing',
    'published',
    'expiring',
    'expired',
    'republishing',
    'temporarilyUnavailable',
    'failedPublication',
  ]),
  state: Schema.String,
  object_key: Schema.String,
})
const PlanWorkspace = PlanWorkspaceProjection
const StoredRunDefinition = Schema.Struct({
  id: Schema.String,
  sourcePlanId: Schema.String,
  sourcePlanRevision: Schema.Int,
  acceptedAt: Schema.String,
  executor: Schema.Literals(['fake', 'fixture']),
  plan: PlanWorkspace,
})
const LegacyPlanWorkspace = Schema.Struct({
  planId: Schema.Literal('plan-m27'),
  revision: Schema.Int,
  target: Schema.NonEmptyString,
  readiness: Schema.Literal('ready'),
  readinessSummary: Schema.String,
  observingWindow: Schema.Struct({
    startsAt: Schema.NonEmptyString,
    endsAt: Schema.NonEmptyString,
    usableMinutes: Schema.Int,
    peakAltitudeDeg: Schema.Finite,
    horizonClearanceDeg: Schema.Finite,
  }),
  sequences: Schema.Array(
    Schema.Struct({
      sequenceId: Schema.NonEmptyString,
      order: Schema.optionalKey(Schema.Int),
      target: Schema.NonEmptyString,
      capture: Schema.NonEmptyString,
      acquisition: Schema.NonEmptyString,
      stopCondition: Schema.NonEmptyString,
      viability: Schema.Literal('viable'),
    }),
  ),
})
const ObservingPlanRow = Schema.Struct({
  plan_id: Schema.String,
  revision: Schema.Int,
  projection: Schema.String,
  run_eligible: Schema.Int,
})
const PlanReceiptRow = Schema.Struct({ response: Schema.String })
const RunDefinitionRow = Schema.Struct({
  run_definition_id: Schema.String,
  source_plan_id: Schema.String,
  source_plan_revision: Schema.Int,
  definition: Schema.String,
  accepted_at: Schema.String,
})
const RunDefinitionReceiptRow = Schema.Struct({ response: Schema.String })
const ProcessWorkspace = Schema.Struct({
  sessionId: Schema.String,
  revision: Schema.Int,
  phase: Schema.Literal('develop'),
  sourceAssetId: Schema.String,
  sourceLabel: Schema.String,
  preview: Schema.Struct({
    label: Schema.String,
    state: Schema.Literal('synchronized'),
    evidence: Schema.String,
  }),
  history: Schema.Array(
    Schema.Struct({
      stepId: Schema.String,
      label: Schema.String,
      state: Schema.Literals(['applied', 'current']),
      tool: Schema.String,
    }),
  ),
  checkpoint: Schema.Struct({
    stepId: Schema.String,
    label: Schema.String,
    protectedBy: Schema.String,
  }),
  failure: Schema.Struct({
    state: Schema.Literal('none'),
    retryScope: Schema.String,
  }),
  protection: Schema.String,
})
const ReceiptRow = Schema.Struct({ response: Schema.String })
const InterventionReceiptRow = Schema.Struct({
  semantic_key: Schema.String,
  response: Schema.String,
})
const StoredIdentity = Schema.Struct({
  personId: Schema.String,
  clientId: Schema.String,
  capability: Schema.Literals(['controlCapable', 'readOnly']),
  role: Schema.optionalKey(Schema.Literals(['owner', 'viewer'])),
})
const StoredRun = Schema.Struct({
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
})
const StoredSnapshot = Schema.Struct({
  snapshotVersion: Schema.Int,
  eventCursor: Schema.Int,
  generatedAt: Schema.String,
  identity: StoredIdentity,
  plan: Schema.Struct({
    id: Schema.String,
    revision: Schema.Int,
    target: Schema.String,
    readiness: Schema.Literals(['ready', 'unavailable']),
    runEligible: Schema.Boolean,
  }),
  control: Schema.Struct({
    holderClientId: Schema.NullOr(Schema.String),
    revision: Schema.Int,
    state: Schema.Literals(['held', 'reconnecting', 'unheld']),
    reconnectGraceUntil: Schema.optionalKey(Schema.String),
    pendingRequests: Schema.Array(
      Schema.Struct({ clientId: Schema.String, personId: Schema.String }),
    ),
  }),
  run: Schema.NullOr(StoredRun),
  dispatch: Schema.Literals([
    'none',
    'pending',
    'dispatched',
    'unavailable',
    'failed',
  ]),
  dispatchAction: Schema.Literals(['none', 'pause', 'resume', 'stop']),
  evidence: StoredEvidence,
  connection: Schema.Literal('current'),
})
const CommandResultSchema = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literal('accepted'),
    eventType: Schema.optionalKey(
      Schema.Literals([
        'ControlRequested',
        'ControlGranted',
        'OwnerTookControl',
        'ControlReconnectGraceStarted',
        'ControlReconnected',
        'ControlGraceExpired',
        'RunPaused',
        'RunResumed',
        'RunStopped',
        'FakeSequenceSkipped',
        'FakePhaseRetried',
        'FakeParkRequested',
        'RunMutationApplied',
      ]),
    ),
    message: Schema.optionalKey(Schema.String),
    run: Schema.optionalKey(StoredRun),
    snapshot: StoredSnapshot,
  }),
  Schema.Struct({
    outcome: Schema.Literal('rejected'),
    reason: Schema.Literals([
      'Unauthenticated',
      'FreshnessConflict',
      'PlanUnavailable',
      'PlanNotReady',
      'RunDefinitionAlreadyAccepted',
      'ClientReadOnly',
      'ControlLeaseLost',
      'OwnerRequired',
      'ControlRequestUnavailable',
      'ActiveRunConflict',
      'RunRevisionConflict',
      'AlreadyPaused',
      'AlreadyTerminal',
      'NotPaused',
      'ResumePhaseUnavailable',
      'IdempotencyConflict',
      'InvalidInput',
    ]),
    message: Schema.String,
  }),
])
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
  OwnerTookControl: 'Control returned to the owner desktop.',
  ControlReconnectGraceStarted:
    'Reconnect grace is active; accepted work continues.',
  ControlReconnected: 'Controller reconnected; control remains current.',
  ControlGraceExpired:
    'Reconnect grace expired. Control is unheld; accepted work continues.',
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
    readonly fixture?: 'm27' | 'plan-draft'
    readonly webDistPath?: string
  } = {},
) {
  if (databasePath !== ':memory:')
    mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA journal_mode = WAL')
  migrateDatabase(database)
  if (options.fixture !== undefined)
    installM27Fixture(database, options.fixture === 'm27')
  else initializeRuntimeState(database)
  const webHost = Effect.runSync(
    WebHost.pipe(
      Effect.provide(webHostLayer(options.webDistPath ?? '../web/dist')),
    ),
  )
  const originListener = Effect.runSync(
    OriginListener.pipe(Effect.provide(originListenerLayer)),
  )
  const listeners = new Map<ServerResponse, LocalIdentity>()
  let closed = false
  let emittedCursor = 0
  const publish = (type: string, cursor: number) => {
    void type
    void cursor
    for (const [response, identity] of listeners)
      response.write(sseProjection(database, identity))
  }
  const poll = setInterval(() => {
    expireReconnectGrace(database)
    const current = state(database)
    if (current.eventCursor <= emittedCursor) return
    emittedCursor = current.eventCursor
    publish('ProjectionChanged', current.eventCursor)
  }, 250)
  poll.unref()

  const handler = async (
    request: IncomingMessage,
    response: ServerResponse,
  ) => {
    const url = new URL(request.url ?? '/', 'http://local')
    if (request.method === 'GET' && url.pathname === '/health/live')
      return json(response, 200, { status: 'alive' })
    expireReconnectGrace(database)
    const identity = await identityResolver(request)
    if (identity === undefined)
      return unauthenticated(response, request.method, url.pathname)
    if (request.method === 'GET' && url.pathname === '/api/snapshot')
      return void Effect.runSync(
        bootstrapSnapshot(database, identity).pipe(
          Effect.flatMap((data) =>
            Schema.decodeUnknownEffect(BootstrapHttpSuccessEnvelope)({
              ok: true,
              data,
            }),
          ),
          Effect.map((body) => json(response, 200, body)),
        ),
      )
    if (request.method === 'GET' && url.pathname === '/api/health/ready')
      return json(response, 200, readiness(database))
    if (request.method === 'GET' && url.pathname === '/api/health/operations')
      return isOwner(identity)
        ? json(response, 200, operations(database))
        : json(response, 403, reject('OwnerRequired').body)
    if (request.method === 'GET' && url.pathname === '/api/events')
      return stream(request, response, database, identity, listeners)
    if (request.method === 'POST' && url.pathname === '/api/commands/control')
      return Effect.runPromise(
        controlCommandFromEnvelope(
          body(request),
          database,
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
      ).then(({ status, body }) => json(response, status, body))
    if (request.method === 'GET' && url.pathname === '/api/workspaces/plan')
      return workspace(response, database, 'plan')
    if (request.method === 'GET' && url.pathname === '/api/workspaces/process')
      return processWorkspace(response, database, url)
    if (request.method === 'GET' && url.pathname === '/api/library')
      return libraryPage(response, database, url)
    if (
      request.method === 'GET' &&
      url.pathname.startsWith('/api/library/assets/') &&
      url.pathname.endsWith('/download')
    )
      return downloadAsset(response, database, url, downloadGrants)
    if (
      request.method === 'GET' &&
      url.pathname.startsWith('/api/library/assets/')
    )
      return libraryDetail(
        response,
        database,
        decodedAssetId(url.pathname.slice('/api/library/assets/'.length)),
      )
    if (request.method === 'POST' && url.pathname === '/api/plan/commands')
      return Effect.runPromise(
        planCommandFromRequest(body(request), database, identity, publish).pipe(
          Effect.catchTags({
            'Server.PlanCommandInputInvalid': () =>
              planInvalidResponse(database, identity),
            'Server.PlanServiceUnavailable': () =>
              planServiceResponse(
                'PlanServiceUnavailable',
                'The Plan service is temporarily unavailable.',
              ),
          }),
          Effect.map(({ status, body }) => json(response, status, body)),
        ),
      )
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/start-run'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : runCommand(response, input, database, identity, publish)
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/pause-run'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : runInterventionCommand(
            response,
            input,
            Schema.decodeUnknownSync(PauseRun),
            'pause',
            database,
            identity,
            publish,
          )
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/resume-run'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : runInterventionCommand(
            response,
            input,
            Schema.decodeUnknownSync(ResumeRun),
            'resume',
            database,
            identity,
            publish,
          )
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/save-plan-draft'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : savePlanDraftCommand(response, input, database, identity, publish)
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/accept-run-definition'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : acceptRunDefinitionCommand(
            response,
            input,
            database,
            identity,
            publish,
          )
    }
    if (
      request.method === 'POST' &&
      [
        '/api/commands/stop-run',
        '/api/commands/skip-fake-sequence',
        '/api/commands/retry-fake-phase',
        '/api/commands/request-fake-park',
      ].includes(url.pathname)
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : fakePolicyCommand(
            response,
            input,
            url.pathname,
            database,
            identity,
            publish,
          )
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/preview-run-mutation'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : previewRunMutationCommand(
            response,
            input,
            database,
            identity,
            publish,
          )
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/apply-run-mutation'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : applyRunMutationCommand(
            response,
            input,
            false,
            database,
            identity,
            publish,
          )
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/api/commands/approve-disruptive-run-mutation'
    ) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : applyRunMutationCommand(
            response,
            input,
            true,
            database,
            identity,
            publish,
          )
    }
    if (request.method === 'POST' && controlPaths.has(url.pathname)) {
      const input = await body(request)
      return input === BodyTooLarge
        ? json(response, 413, reject('InvalidInput').body)
        : controlCommand(
            response,
            input,
            database,
            url.pathname,
            identity,
            publish,
          )
    }
    if (
      request.method === 'GET' &&
      Effect.runSync(webHost.asset(response, url.pathname, responseHeaders))
    )
      return
    if (
      request.method === 'GET' &&
      Effect.runSync(webHost.route(response, url.pathname, responseHeaders))
    )
      return
    if (url.pathname.startsWith('/api/'))
      return json(response, 404, reject('InvalidInput').body)
    response.writeHead(404, responseHeaders('text/plain; charset=utf-8')).end()
  }
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
    clearInterval(poll)
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
      const current = state(database)
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
      return persistEvidence(database, evidence, projectionIdentity)
    } catch {
      return undefined
    }
  }
  const ingestSeestarStackPush = (raw: unknown, receivedAt: string) => {
    const event = decodeSeestarPushEvent(raw)
    if (
      event?.Event !== 'Stack' ||
      !Number.isFinite(event.stacked_frame ?? event.stacked_frames)
    )
      return undefined
    const current = state(database)
    const failed =
      event.state?.toLowerCase() === 'fail' ||
      event.state?.toLowerCase() === 'cancel' ||
      (event.code !== undefined && event.code !== 0)
    const evidence: Evidence = {
      ...current.evidence,
      stack: {
        availability: failed ? 'unavailable' : 'available',
        observedAt: receivedAt,
        frameCount: event.stacked_frame ?? event.stacked_frames ?? 0,
        message: failed
          ? (event.error ??
            'Stack source unavailable; accepted run state is unchanged.')
          : 'Stack event received.',
      },
      quality: failed ? 'warning' : current.evidence.quality,
    }
    return persistEvidence(database, evidence, projectionIdentity)
  }
  const dispatch = async (
    kind: 'StopSolarTestObservation',
    workerId: string,
    invoke: ((payload: unknown) => Promise<unknown>) | undefined,
  ) => {
    const token = randomUUID()
    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          "UPDATE outbox SET state='failed',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error='claim expired',retry_after=? WHERE kind=? AND state='claimed' AND claim_until<=?",
        )
        .run(new Date().toISOString(), kind, new Date().toISOString())
      const raw: unknown = database
        .prepare(
          "SELECT id,payload FROM outbox WHERE kind=? AND state IN ('pending','failed') AND (retry_after IS NULL OR retry_after<=?) ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END,rowid LIMIT 1",
        )
        .get(kind, new Date().toISOString())
      const row = Schema.decodeUnknownSync(Schema.optional(OutboxClaimRow))(raw)
      if (row === undefined) {
        database.exec('COMMIT')
        return 'none' as const
      }
      const claimed = database
        .prepare(
          "UPDATE outbox SET state='claimed',claim_token=?,claimed_by=?,claim_until=?,attempts=attempts+1 WHERE id=? AND state IN ('pending','failed')",
        )
        .run(
          token,
          workerId,
          new Date(Date.now() + 30_000).toISOString(),
          row.id,
        )
      if (claimed.changes !== 1) {
        database.exec('COMMIT')
        return 'none' as const
      }
      database.exec('COMMIT')
      try {
        const accepted =
          invoke === undefined
            ? false
            : Schema.decodeUnknownSync(Schema.Boolean)(
                await invoke(JSON.parse(row.payload)),
              )
        database.exec('BEGIN IMMEDIATE')
        const acknowledged = database
          .prepare(
            "UPDATE outbox SET state=?,ack_at=?,claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error=? WHERE id=? AND state='claimed' AND claim_token=?",
          )
          .run(
            accepted ? 'dispatched' : 'failed',
            accepted ? new Date().toISOString() : null,
            accepted ? null : 'adapter rejected work',
            row.id,
            token,
          )
        database.exec('COMMIT')
        return acknowledged.changes === 1
          ? accepted
            ? ('dispatched' as const)
            : ('failed' as const)
          : ('superseded' as const)
      } catch {
        database.exec('BEGIN IMMEDIATE')
        const failed = database
          .prepare(
            "UPDATE outbox SET state='failed',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error=?,retry_after=? WHERE id=? AND state='claimed' AND claim_token=?",
          )
          .run('adapter failed', new Date().toISOString(), row.id, token)
        database.exec('COMMIT')
        return failed.changes === 1
          ? ('failed' as const)
          : ('superseded' as const)
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  const dispatchSolarTestOutbox = async (
    adapter:
      | {
          readonly startSolarTestObservation: (
            work: typeof SolarTestWork.Type,
          ) => Promise<'providerAcknowledged' | 'uncertain'>
        }
      | undefined,
    workerId = 'rig-worker',
  ) => {
    if (adapter === undefined) return 'unavailable' as const
    const token = randomUUID()
    const now = new Date().toISOString()
    database.exec('BEGIN IMMEDIATE')
    try {
      const expiredRaw: unknown = database
        .prepare(
          "SELECT payload FROM outbox WHERE kind='StartSolarTestObservation' AND state='claimed' AND claim_until<=? ORDER BY rowid LIMIT 1",
        )
        .get(now)
      const expired = Schema.decodeUnknownSync(
        Schema.optional(Schema.Struct({ payload: Schema.String })),
      )(expiredRaw)
      if (expired !== undefined) {
        const expiredWork = Schema.decodeUnknownSync(SolarTestWork)(
          JSON.parse(expired.payload),
        )
        database
          .prepare(
            "UPDATE outbox SET state='uncertain',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error='worker lease expired during a Solar start',retry_after=NULL WHERE kind='StartSolarTestObservation' AND state='claimed' AND claim_until<=?",
          )
          .run(now)
        database
          .prepare(
            "UPDATE solar_test_intents SET state='manualRecovery' WHERE intent_id=?",
          )
          .run(expiredWork.intentId)
        database
          .prepare('INSERT OR REPLACE INTO solar_test_recovery VALUES (?,?,?)')
          .run(expiredWork.intentId, 'manualRecovery', now)
        database
          .prepare(
            "UPDATE solar_test_evidence SET state='uncertain',message=?,observed_at=? WHERE intent_id=?",
          )
          .run(
            'Solar worker lease expired after a provider call may have started. Do not retry automatically; inspect the physical rig and recover manually.',
            now,
            expiredWork.intentId,
          )
      }
      const raw: unknown = database
        .prepare(
          "SELECT id,payload FROM outbox WHERE kind='StartSolarTestObservation' AND state='pending' ORDER BY rowid LIMIT 1",
        )
        .get()
      const row = Schema.decodeUnknownSync(Schema.optional(OutboxClaimRow))(raw)
      if (row === undefined) {
        database.exec('COMMIT')
        return 'none' as const
      }
      const claimed = database
        .prepare(
          "UPDATE outbox SET state='claimed',claim_token=?,claimed_by=?,claim_until=?,attempts=attempts+1 WHERE id=? AND state='pending'",
        )
        .run(
          token,
          workerId,
          new Date(Date.now() + 30_000).toISOString(),
          row.id,
        )
      if (claimed.changes !== 1) {
        database.exec('COMMIT')
        return 'none' as const
      }
      database.exec('COMMIT')
      const work = Schema.decodeUnknownSync(SolarTestWork)(
        JSON.parse(row.payload),
      )
      let outcome: 'providerAcknowledged' | 'uncertain'
      try {
        outcome = await adapter.startSolarTestObservation(work)
      } catch {
        outcome = 'uncertain'
      }
      database.exec('BEGIN IMMEDIATE')
      if (outcome === 'providerAcknowledged') {
        const acknowledged = database
          .prepare(
            "UPDATE outbox SET state='dispatched',ack_at=?,claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error=NULL WHERE id=? AND state='claimed' AND claim_token=?",
          )
          .run(new Date().toISOString(), row.id, token)
        if (acknowledged.changes === 1) {
          const acknowledgedAt = new Date().toISOString()
          database
            .prepare(
              "UPDATE solar_test_intents SET state='providerAcknowledged' WHERE intent_id=? AND state='awaitingAdapter'",
            )
            .run(work.intentId)
          database
            .prepare(
              'INSERT OR REPLACE INTO solar_test_provider_ack VALUES (?,?)',
            )
            .run(work.intentId, acknowledgedAt)
          database
            .prepare(
              "UPDATE solar_test_evidence SET state='awaitingStackEvidence',message=?,observed_at=? WHERE intent_id=?",
            )
            .run(
              'Provider acknowledged Solar view and bounded acquisition. Capture remains unconfirmed until a Stack event is observed.',
              acknowledgedAt,
              work.intentId,
            )
        }
        database.exec('COMMIT')
        return acknowledged.changes === 1
          ? ('providerAcknowledged' as const)
          : ('superseded' as const)
      }
      const uncertainAt = new Date().toISOString()
      const uncertain = database
        .prepare(
          "UPDATE outbox SET state='uncertain',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error='Solar start outcome is uncertain; manual recovery required',retry_after=NULL WHERE id=? AND state='claimed' AND claim_token=?",
        )
        .run(row.id, token)
      if (uncertain.changes === 1) {
        database
          .prepare(
            "UPDATE solar_test_intents SET state='manualRecovery' WHERE intent_id=?",
          )
          .run(work.intentId)
        database
          .prepare('INSERT OR REPLACE INTO solar_test_recovery VALUES (?,?,?)')
          .run(work.intentId, 'manualRecovery', uncertainAt)
        database
          .prepare(
            "UPDATE solar_test_evidence SET state='uncertain',message=?,observed_at=? WHERE intent_id=?",
          )
          .run(
            'Solar start timed out or failed after dispatch. Do not retry automatically; inspect the physical rig and recover manually.',
            uncertainAt,
            work.intentId,
          )
      }
      database.exec('COMMIT')
      return uncertain.changes === 1
        ? ('uncertain' as const)
        : ('superseded' as const)
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  const requestSolarTestStop = (intentId: string) => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const changed = database
        .prepare(
          "UPDATE solar_test_intents SET state='stopping' WHERE intent_id=? AND state IN ('awaitingAdapter','providerAcknowledged','stackObserved')",
        )
        .run(intentId)
      if (changed.changes === 1) {
        database
          .prepare(
            "UPDATE outbox SET state='cancelled',last_error='Solar stop requested before adapter dispatch' WHERE kind='StartSolarTestObservation' AND state='pending' AND payload LIKE ?",
          )
          .run(`%${intentId}%`)
        database
          .prepare(
            'INSERT INTO outbox (id,kind,payload,state) VALUES (?,?,?,?)',
          )
          .run(
            randomUUID(),
            'StopSolarTestObservation',
            JSON.stringify({ intentId }),
            'pending',
          )
      }
      database.exec('COMMIT')
      return changed.changes === 1
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  const dispatchSolarTestStopOutbox = async (
    adapter:
      | {
          readonly stopSolarTestObservation: (
            intentId: string,
          ) => Promise<boolean>
        }
      | undefined,
    workerId = 'rig-worker',
  ) => {
    const outcome = await dispatch(
      'StopSolarTestObservation',
      workerId,
      adapter === undefined
        ? undefined
        : async (payload) =>
            adapter.stopSolarTestObservation(
              Schema.decodeUnknownSync(
                Schema.Struct({ intentId: Schema.NonEmptyString }),
              )(payload).intentId,
            ),
    )
    if (outcome === 'dispatched')
      database
        .prepare(
          "UPDATE solar_test_intents SET state='stopped' WHERE state='stopping'",
        )
        .run()
    return outcome
  }
  const recordSolarStackEvidence = (
    intentId: string,
    raw: unknown,
    observedAt: string,
  ) => {
    const event = decodeSeestarPushEvent(raw)
    if (
      event?.Event !== 'Stack' ||
      !Number.isFinite(event.stacked_frame ?? event.stacked_frames) ||
      (event.code !== undefined && event.code !== 0)
    )
      return false
    database.exec('BEGIN IMMEDIATE')
    try {
      const updated = database
        .prepare(
          "UPDATE solar_test_intents SET state='stackObserved' WHERE intent_id=? AND state='providerAcknowledged'",
        )
        .run(intentId)
      if (updated.changes === 1)
        database
          .prepare(
            "UPDATE solar_test_evidence SET state='stackObserved',message=?,observed_at=? WHERE intent_id=?",
          )
          .run(
            `Stack evidence observed (${event.stacked_frame ?? event.stacked_frames} frames).`,
            observedAt,
            intentId,
          )
      database.exec('COMMIT')
      return updated.changes === 1
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  const resolveSolarTestCliIdentity = (
    externalSubject: string,
  ): LocalIdentity | undefined => {
    const raw: unknown = database
      .prepare(
        'SELECT person_id,role FROM memberships WHERE external_subject=?',
      )
      .get(externalSubject)
    const membership = Schema.decodeUnknownSync(Schema.optional(MembershipRow))(
      raw,
    )
    if (membership?.role !== 'owner') return undefined
    return {
      personId: membership.person_id,
      clientId: 'solar-test-cli',
      role: 'owner',
      capability: 'controlCapable',
    }
  }
  const submitSolarTestIntent = (
    raw: unknown,
    identity: LocalIdentity,
  ): SolarTestIntentResult => {
    if (!isOwner(identity))
      return { outcome: 'rejected', reason: 'OwnerRequired' }
    if (identity.capability !== 'controlCapable')
      return { outcome: 'rejected', reason: 'ClientReadOnly' }
    let input: typeof SolarTestIntentInput.Type
    try {
      input = Schema.decodeUnknownSync(SolarTestIntentInput)(raw)
    } catch {
      return { outcome: 'rejected', reason: 'InvalidInput' }
    }
    const semanticKey = createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          name: input.name,
          ownerPersonId: identity.personId,
        }),
      )
      .digest('hex')
    const existingRaw: unknown = database
      .prepare(
        'SELECT intents.intent_id,intents.name,intents.owner_person_id,intents.semantic_key,intents.state,evidence.state AS evidence_state FROM solar_test_intents AS intents JOIN solar_test_evidence AS evidence ON evidence.intent_id=intents.intent_id WHERE intents.idempotency_key=? AND intents.owner_person_id=?',
      )
      .get(input.idempotencyKey, identity.personId)
    const existing = Schema.decodeUnknownSync(
      Schema.optional(SolarTestIntentRow),
    )(existingRaw)
    if (existing !== undefined)
      return existing.semantic_key === semanticKey
        ? {
            outcome: 'accepted',
            intentId: existing.intent_id,
            name: existing.name,
            state: existing.state,
            evidence: existing.evidence_state,
          }
        : { outcome: 'rejected', reason: 'InvalidInput' }
    database.exec('BEGIN IMMEDIATE')
    try {
      const pendingRaw: unknown = database
        .prepare(
          "SELECT count(*) AS count FROM solar_test_intents WHERE state='awaitingAdapter'",
        )
        .get()
      const pending = Schema.decodeUnknownSync(CountRow)(pendingRaw)
      if (pending.count !== 0) {
        database.exec('ROLLBACK')
        return { outcome: 'rejected', reason: 'SolarTestPending' }
      }
      const intentId = randomUUID()
      const acceptedAt = new Date().toISOString()
      database
        .prepare('INSERT INTO solar_test_intents VALUES (?,?,?,?,?,?,?,?)')
        .run(
          intentId,
          input.idempotencyKey,
          input.name,
          identity.personId,
          identity.clientId,
          semanticKey,
          'awaitingAdapter',
          acceptedAt,
        )
      database
        .prepare('INSERT INTO solar_test_evidence VALUES (?,?,?,?)')
        .run(
          intentId,
          'awaitingStackEvidence',
          'Solar intent accepted. A future Seestar adapter must observe Stack evidence before capture is presented active.',
          acceptedAt,
        )
      database
        .prepare('INSERT INTO outbox (id,kind,payload,state) VALUES (?,?,?,?)')
        .run(
          randomUUID(),
          'StartSolarTestObservation',
          JSON.stringify({
            intentId,
            name: input.name,
            target: 'Sun',
            requiredEvidence: 'Stack',
          }),
          'pending',
        )
      database.exec('COMMIT')
      return {
        outcome: 'accepted',
        intentId,
        name: input.name,
        state: 'awaitingAdapter',
        evidence: 'awaitingStackEvidence',
      }
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
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
    const result = advanceFakeRunState(database, projectionIdentity())
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
    ingestSeestarStackPush,
    dispatchSolarTestOutbox,
    requestSolarTestStop,
    dispatchSolarTestStopOutbox,
    recordSolarStackEvidence,
    resolveSolarTestCliIdentity,
    submitSolarTestIntent,
    saveProcess,
    cleanupSavedOrphans,
    advanceFakeRun,
  }
}

export function installM27Fixture(
  database: DatabaseSync,
  includeFixtureDefinition = true,
) {
  migrateState(database)
  seedLibrary(database)
  seedWorkspaces(database)
  ensureM27FixturePlan(database, includeFixtureDefinition)
}
export function openPublisherDatabase(
  databasePath: string,
  allowedRoot = '/var/lib/astro-console/',
) {
  return openMigrationDatabase(databasePath, allowedRoot)
}
export function openProcessorDatabase(
  databasePath: string,
  allowedRoot = '/var/lib/astro-console/',
) {
  return openMigrationDatabase(databasePath, allowedRoot)
}
export function openMigrationDatabase(
  databasePath: string,
  allowedRoot: string,
) {
  if (
    !allowedRoot.startsWith('/') ||
    !allowedRoot.endsWith('/') ||
    !databasePath.startsWith(allowedRoot) ||
    /[\r\n]|(?:^|\/)\.\.(?:\/|$)/.test(databasePath)
  )
    throw new Error('Database path must be app-owned')
  mkdirSync(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL')
  migrateDatabase(database)
  return database
}

const controlPaths = new Set([
  '/api/commands/request-control',
  '/api/commands/grant-control',
  '/api/commands/take-control',
  '/api/commands/controller-disconnected',
  '/api/commands/controller-reconnected',
])
const isOwner = (identity: LocalIdentity) => identity.role === 'owner'

function migrateDatabase(db: DatabaseSync) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
  )
  const latestRaw: unknown = db
    .prepare(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
    )
    .get()
  const latest = Schema.decodeUnknownSync(MigrationRow)(latestRaw).version
  const migrations = [
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS control_requests (client_id TEXT PRIMARY KEY,person_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS memberships (external_subject TEXT PRIMARY KEY,person_id TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE IF NOT EXISTS library_assets (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,role TEXT NOT NULL,format TEXT NOT NULL,availability TEXT NOT NULL,comparison_group_id TEXT NOT NULL,captured_at TEXT NOT NULL,updated_at TEXT NOT NULL,sharpness REAL NOT NULL,detail TEXT NOT NULL);',
      ),
    () => migrateOutbox(db),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS workspace_projections (name TEXT PRIMARY KEY,value TEXT NOT NULL)',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS worker_status (worker_id TEXT PRIMARY KEY,state TEXT NOT NULL,adapter_state TEXT NOT NULL,last_heartbeat TEXT NOT NULL)',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS solar_test_intents (intent_id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL,name TEXT NOT NULL,owner_person_id TEXT NOT NULL,owner_client_id TEXT NOT NULL,semantic_key TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS solar_test_evidence (intent_id TEXT PRIMARY KEY,state TEXT NOT NULL,message TEXT NOT NULL,observed_at TEXT NOT NULL)',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS solar_test_provider_ack (intent_id TEXT PRIMARY KEY,acknowledged_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS solar_test_recovery (intent_id TEXT PRIMARY KEY,state TEXT NOT NULL,recorded_at TEXT NOT NULL)',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS process_save_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS process_asset_events (asset_id TEXT NOT NULL,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS process_save_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL)',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS asset_publications (asset_id TEXT PRIMARY KEY,checksum TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL)',
      ),
    () =>
      db.exec(
        "ALTER TABLE asset_publications ADD COLUMN object_key TEXT NOT NULL DEFAULT ''",
      ),
    () =>
      db.exec(
        "UPDATE outbox SET state='cancelled',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error='Retired deterministic fixture hardware work',retry_after=NULL WHERE kind IN ('StartM27Capture','StopStack','ResumeStack','StopRun') AND state IN ('pending','failed','claimed')",
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS source_ingest_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS source_ingest_events (asset_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS source_ingest_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL)',
      ),
    () => {},
    () => {},
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS observing_plans (plan_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,projection TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observing_plan_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))',
      ),
    () => {
      db.exec(
        'ALTER TABLE observing_plans ADD COLUMN run_eligible INTEGER NOT NULL DEFAULT 0',
      )
      migrateLegacyPlanWorkspace(db)
    },
    () => migrateLegacyPlanWorkspace(db),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS run_definitions (run_definition_id TEXT PRIMARY KEY,source_plan_id TEXT NOT NULL,source_plan_revision INTEGER NOT NULL,definition TEXT NOT NULL,accepted_at TEXT NOT NULL,UNIQUE(source_plan_id,source_plan_revision)); CREATE TABLE IF NOT EXISTS run_definition_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))',
      ),
    () => {},
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS run_intervention_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS run_mutation_previews (preview_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,run_revision INTEGER NOT NULL,owner_person_id TEXT NOT NULL,mutation TEXT NOT NULL,consequences TEXT NOT NULL,classification TEXT NOT NULL,expires_at TEXT NOT NULL,applied_at TEXT); CREATE TABLE IF NOT EXISTS run_mutation_preview_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))',
      ),
    () =>
      db.exec(
        'CREATE TABLE IF NOT EXISTS run_start_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))',
      ),
  ] as const
  if (latest > migrations.length)
    throw new Error(`Database schema ${latest} is newer than this release`)
  for (let index = latest; index < migrations.length; index += 1) {
    db.exec('BEGIN IMMEDIATE')
    try {
      migrations[index]?.()
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(
        index + 1,
        new Date().toISOString(),
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
function migrateLegacyPlanWorkspace(db: DatabaseSync) {
  const raw: unknown = db
    .prepare("SELECT value FROM workspace_projections WHERE name='plan'")
    .get()
  try {
    const row = Schema.decodeUnknownSync(StoredRow)(raw)
    const legacy = Schema.decodeUnknownSync(LegacyPlanWorkspace)(
      JSON.parse(row.value),
    )
    const first = legacy.sequences[0]
    if (first === undefined) return
    const plan = evaluatePlan({
      planId: legacy.planId,
      revision: legacy.revision,
      sequences: [
        {
          sequenceId: first.sequenceId,
          target: first.target,
          capture: first.capture,
          acquisition: first.acquisition,
          stopCondition: first.stopCondition,
          window: legacy.observingWindow,
          estimatedMinutes: Math.min(legacy.observingWindow.usableMinutes, 72),
          storageForecastMb: 1800,
          horizon: 'clear',
          storage: 'available',
        },
        {
          sequenceId: 'sequence-m27-color',
          target: first.target,
          capture: '18 × 180s · RGB',
          acquisition: 'Continue after luminance with the same solved center.',
          stopCondition: 'Stop at 18 verified frames or window end.',
          window: legacy.observingWindow,
          estimatedMinutes: Math.min(legacy.observingWindow.usableMinutes, 54),
          storageForecastMb: 1350,
          horizon: 'clear',
          storage: 'available',
        },
      ],
    })
    db.prepare(
      "UPDATE workspace_projections SET value=? WHERE name='plan'",
    ).run(JSON.stringify(plan))
  } catch {}
}
function ensureM27FixturePlan(
  db: DatabaseSync,
  includeFixtureDefinition: boolean,
) {
  const raw: unknown = db
    .prepare("SELECT value FROM workspace_projections WHERE name='plan'")
    .get()
  try {
    const row = Schema.decodeUnknownSync(StoredRow)(raw)
    const plan = Schema.decodeUnknownSync(PlanWorkspace)(JSON.parse(row.value))
    if (plan.planId !== 'plan-m27') return
    db.prepare(
      'INSERT OR IGNORE INTO observing_plans (plan_id,revision,projection) VALUES (?,?,?)',
    ).run(plan.planId, plan.revision, JSON.stringify(plan))
    db.prepare(
      'UPDATE observing_plans SET run_eligible=1 WHERE plan_id=? AND revision=3',
    ).run(plan.planId)
    if (!includeFixtureDefinition) return
    const definition: RunDefinition = {
      id: 'run-definition-m27-fixture',
      sourcePlanId: plan.planId,
      sourcePlanRevision: plan.revision,
      acceptedAt: '2026-07-25T00:00:00.000Z',
      executor: 'fixture',
      plan,
    }
    db.prepare('INSERT OR IGNORE INTO run_definitions VALUES (?,?,?,?,?)').run(
      definition.id,
      definition.sourcePlanId,
      definition.sourcePlanRevision,
      JSON.stringify(definition),
      definition.acceptedAt,
    )
  } catch {}
}
function migrateOutbox(db: DatabaseSync) {
  const raw: unknown = db.prepare('PRAGMA table_info(outbox)').all()
  const columns = new Set(
    Schema.decodeUnknownSync(Schema.Array(SqliteColumnRow))(raw).map(
      (column) => column.name,
    ),
  )
  for (const [name, definition] of [
    ['claim_token', 'TEXT'],
    ['claimed_by', 'TEXT'],
    ['claim_until', 'TEXT'],
    ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_error', 'TEXT'],
    ['retry_after', 'TEXT'],
    ['ack_at', 'TEXT'],
  ] as const)
    if (!columns.has(name))
      db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${definition}`)
}
function initializeRuntimeState(db: DatabaseSync) {
  const latestRaw: unknown = db
    .prepare('SELECT COALESCE(MAX(cursor), 0) AS cursor FROM events')
    .get()
  const latest = Schema.decodeUnknownSync(LatestCursorRow)(latestRaw)
  const insert = db.prepare('INSERT OR IGNORE INTO state VALUES (?,?)')
  for (const [key, value] of Object.entries({
    snapshotVersion: Math.max(1, latest.cursor),
    eventCursor: latest.cursor,
    planRevision: 0,
    leaseRevision: 0,
    leaseHolder: null,
    leaseState: 'unheld',
    reconnectGraceUntil: null,
    run: null,
    evidence: {
      frameId: 'uninitialized',
      capturedAt: '',
      quality: 'warning',
      desired: 'No observation plan is installed.',
      solved: 'No fixture or live observation evidence is installed.',
      uncertaintyArcsec: 0,
      stack: {
        availability: 'unavailable',
        observedAt: '',
        frameCount: 0,
        message: 'No Stack evidence is installed.',
      },
      correction: {
        state: 'exhausted',
        evidence: 'No active acquisition is installed.',
        bound: 'No correction budget is active.',
        protection:
          'Install an authorized plan and observation workflow before issuing commands.',
        action: 'none',
      },
    },
  }))
    insert.run(key, JSON.stringify(value))
}
function migrateState(db: DatabaseSync) {
  const latestRaw: unknown = db
    .prepare('SELECT COALESCE(MAX(cursor), 0) AS cursor FROM events')
    .get()
  const latest = Schema.decodeUnknownSync(LatestCursorRow)(latestRaw)
  const insert = db.prepare('INSERT OR IGNORE INTO state VALUES (?,?)')
  for (const [key, value] of Object.entries({
    snapshotVersion: Math.max(1, latest.cursor),
    eventCursor: latest.cursor,
    planRevision: 3,
    leaseRevision: 1,
    leaseHolder: 'desktop-owner',
    leaseState: 'held',
    reconnectGraceUntil: null,
    run: null,
    evidence: {
      frameId: 'frame-m27-042',
      capturedAt: '2026-07-23T03:12:00.000Z',
      quality: 'verified',
      desired: 'M27 center',
      solved: 'M27 center + 18 arcsec',
      uncertaintyArcsec: 4.2,
      stack: {
        availability: 'available',
        observedAt: '2026-07-23T03:12:00.000Z',
        frameCount: 42,
        message: 'Stack event received.',
      },
      correction: {
        state: 'automatic',
        evidence: 'Latest solve confirms the target remains in frame.',
        bound:
          'Correction budget 1 of 3; 18 arcsec is within the 30 arcsec bound.',
        protection: 'No operator action required; accepted capture continues.',
        action: 'none',
      },
    },
  }))
    insert.run(key, JSON.stringify(value))
}
function seedLibrary(db: DatabaseSync) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO library_assets VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
  const roles: ReadonlyArray<LibraryRole> = [
    'original',
    'preview',
    'intermediate',
    'linearMaster',
    'final',
    'diagnostic',
  ]
  for (let index = 1; index <= 144; index += 1) {
    const role = roles[index % roles.length] ?? 'original'
    const assetId = `asset-m27-${String(index).padStart(3, '0')}`
    const capturedAt = new Date(
      Date.UTC(2026, 6, 23, 3, 0, 0) - index * 180_000,
    ).toISOString()
    const availability =
      index % 13 === 0 ? 'temporarilyUnavailable' : 'availableLocally'
    const detail = {
      assetId,
      revision: 1,
      role,
      format:
        role === 'original' ? 'cameraRaw' : role === 'final' ? 'tiff' : 'fits',
      availability,
      capturedAt,
      comparisonGroupId: `m27-stack-${Math.ceil(index / 12)}`,
      lineage: {
        sourceAssetIds:
          index === 1
            ? [assetId]
            : [`asset-m27-${String(Math.max(1, index - 1)).padStart(3, '0')}`],
        runId: 'run-m27-001',
        solveAttemptId: 'solve-m27-001',
      },
      representations: [
        {
          label:
            availability === 'availableLocally'
              ? 'Local original retained'
              : 'Local original temporarily unavailable',
          state:
            availability === 'availableLocally'
              ? 'available'
              : 'temporarilyUnavailable',
        },
      ],
    }
    insert.run(
      assetId,
      1,
      role,
      detail.format,
      availability,
      detail.comparisonGroupId,
      capturedAt,
      new Date(Date.parse(capturedAt) + 60_000).toISOString(),
      1000 - index,
      JSON.stringify(detail),
    )
  }
}
function seedWorkspaces(db: DatabaseSync) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO workspace_projections VALUES (?,?)',
  )
  const plan = evaluatePlan({
    planId: 'plan-m27',
    revision: 3,
    sequences: [
      {
        sequenceId: 'sequence-m27-luminance',
        target: 'M27 · Dumbbell Nebula',
        capture: '24 × 180s · L',
        acquisition: 'Solve, center, focus, then start capture.',
        stopCondition: 'Stop at 24 verified frames or 01:02 local.',
        window: {
          startsAt: '2026-07-25T03:18:00.000Z',
          endsAt: '2026-07-25T05:02:00.000Z',
          usableMinutes: 104,
          peakAltitudeDeg: 62,
          horizonClearanceDeg: 28,
        },
        estimatedMinutes: 72,
        storageForecastMb: 1800,
        horizon: 'clear',
        storage: 'available',
      },
      {
        sequenceId: 'sequence-m27-color',
        target: 'M27 · Dumbbell Nebula',
        capture: '18 × 180s · RGB',
        acquisition: 'Continue after luminance with the same solved center.',
        stopCondition: 'Stop at 18 verified frames or window end.',
        window: {
          startsAt: '2026-07-25T03:18:00.000Z',
          endsAt: '2026-07-25T05:02:00.000Z',
          usableMinutes: 104,
          peakAltitudeDeg: 62,
          horizonClearanceDeg: 28,
        },
        estimatedMinutes: 54,
        storageForecastMb: 1350,
        horizon: 'clear',
        storage: 'available',
      },
    ],
  })
  db.prepare(
    'INSERT OR IGNORE INTO observing_plans (plan_id,revision,projection) VALUES (?,?,?)',
  ).run(plan.planId, plan.revision, JSON.stringify(plan))
  db.prepare(
    'UPDATE observing_plans SET run_eligible=1 WHERE plan_id=? AND revision=?',
  ).run(plan.planId, plan.revision)
  insert.run('plan', JSON.stringify(plan))
  insert.run(
    'process',
    JSON.stringify({
      sessionId: 'process-m27-001',
      revision: 4,
      phase: 'develop',
      sourceAssetId: 'asset-m27-001',
      sourceLabel: 'M27 linear master · FITS',
      preview: {
        label: 'Neutral stretch preview',
        state: 'synchronized',
        evidence:
          'Preview is synchronized from the service; it is not applied history.',
      },
      history: [
        {
          stepId: 'calibrate',
          label: 'Calibrate',
          state: 'applied',
          tool: 'Siril 1.2',
        },
        {
          stepId: 'stack',
          label: 'Linear stack',
          state: 'applied',
          tool: 'Siril 1.2',
        },
        {
          stepId: 'stretch',
          label: 'Neutral stretch',
          state: 'current',
          tool: 'Siril 1.2',
        },
      ],
      checkpoint: {
        stepId: 'stack',
        label: 'Linear stack checkpoint',
        protectedBy:
          'Source asset and applied history are retained while this preview is inspected.',
      },
      failure: { state: 'none', retryScope: 'No failed stage.' },
      protection:
        'Apply, Save, retry, discard, and source switching remain service commands outside this read-only slice.',
    }),
  )
}
function workspace(response: ServerResponse, db: DatabaseSync, name: 'plan') {
  return json(response, 200, planWorkspaceProjection(db, name))
}

function planWorkspaceProjection(db: DatabaseSync, name: 'plan') {
  const raw: unknown = db
    .prepare('SELECT value FROM workspace_projections WHERE name=?')
    .get(name)
  const row = Schema.decodeUnknownSync(StoredRow)(raw)
  return Schema.decodeUnknownSync(PlanWorkspace)(JSON.parse(row.value))
}
function evaluatePlan(input: {
  readonly planId: string
  readonly revision: number
  readonly sequences: ReadonlyArray<DraftSequence>
}): PlanProjection {
  const limitations: string[] = []
  const sequences = input.sequences.map((sequence) => {
    const prefix = `${sequence.sequenceId}: `
    if (sequence.horizon === 'missing')
      limitations.push(`${prefix}horizon fact is missing.`)
    if (sequence.horizon === 'blocked')
      limitations.push(`${prefix}horizon clearance is blocked.`)
    if (sequence.storage === 'missing')
      limitations.push(`${prefix}storage forecast is missing.`)
    if (sequence.storage === 'blocked')
      limitations.push(`${prefix}storage forecast is blocked.`)
    if (sequence.window.usableMinutes < sequence.estimatedMinutes)
      limitations.push(
        `${prefix}usable window is shorter than the estimated capture.`,
      )
    if (sequence.horizon === 'limited')
      limitations.push(`${prefix}horizon clearance is limited.`)
    if (sequence.storage === 'limited')
      limitations.push(`${prefix}storage forecast is limited.`)
    const blocked =
      sequence.horizon === 'missing' ||
      sequence.horizon === 'blocked' ||
      sequence.storage === 'missing' ||
      sequence.storage === 'blocked' ||
      sequence.window.usableMinutes < sequence.estimatedMinutes
    return {
      ...sequence,
      viability: blocked
        ? ('blocked' as const)
        : sequence.horizon === 'limited' || sequence.storage === 'limited'
          ? ('limited' as const)
          : ('viable' as const),
    }
  })
  const readiness: PlanReadiness = sequences.some(
    (sequence) => sequence.viability === 'blocked',
  )
    ? 'blocked'
    : sequences.some((sequence) => sequence.viability === 'limited')
      ? 'readyWithLimitations'
      : 'ready'
  const readinessSummary =
    readiness === 'ready'
      ? 'All supplied deterministic planning facts are viable.'
      : readiness === 'readyWithLimitations'
        ? 'The plan is usable with the named deterministic limitations.'
        : 'The plan is blocked by the named deterministic planning facts.'
  return {
    planId: input.planId,
    revision: input.revision,
    readiness,
    readinessSummary,
    limitations,
    sequences,
  }
}
function processWorkspace(
  response: ServerResponse,
  db: DatabaseSync,
  url: URL,
) {
  const raw: unknown = db
    .prepare("SELECT value FROM workspace_projections WHERE name='process'")
    .get()
  const row = Schema.decodeUnknownSync(StoredRow)(raw)
  const session = Schema.decodeUnknownSync(ProcessWorkspace)(
    JSON.parse(row.value),
  )
  const sourceAssetId = url.searchParams.get('sourceAssetId')
  if (sourceAssetId === null) return json(response, 200, session)
  const asset: unknown = db
    .prepare('SELECT asset_id,detail FROM library_assets WHERE asset_id=?')
    .get(sourceAssetId)
  const source = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ asset_id: Schema.String, detail: Schema.String }),
    ),
  )(asset)
  if (source === undefined)
    return json(response, 404, { outcome: 'rejected', reason: 'AssetNotFound' })
  const detail = Schema.decodeUnknownSync(LibraryDetail)(
    JSON.parse(source.detail),
  )
  if (detail.availability !== 'availableLocally')
    return json(response, 409, {
      outcome: 'rejected',
      reason: 'AssetUnavailable',
      message:
        'This asset is temporarily unavailable and cannot open in Process.',
    })
  return json(response, 200, {
    ...session,
    sourceAssetId: detail.assetId,
    sourceLabel: `${detail.role} · ${detail.format} · ${detail.assetId}`,
  })
}
function libraryPage(response: ServerResponse, db: DatabaseSync, url: URL) {
  try {
    const query = decodeLibraryQuery(url)
    const order = {
      capturedAtDescending: 'captured_at DESC, asset_id ASC',
      sharpestFirst: 'sharpness DESC, asset_id ASC',
      recentlyUpdated: 'updated_at DESC, asset_id ASC',
    } satisfies Record<LibrarySort, string>
    const filter = query.role === undefined ? '' : 'WHERE role=?'
    const bindings =
      query.role === undefined
        ? [query.pageSize + 1, query.cursor ?? 0]
        : [query.role, query.pageSize + 1, query.cursor ?? 0]
    const rowsRaw: unknown = db
      .prepare(
        `SELECT asset_id,revision,role,format,availability,comparison_group_id,detail FROM library_assets ${filter} ORDER BY ${order[query.sort]} LIMIT ? OFFSET ?`,
      )
      .all(...bindings)
    const rows = Schema.decodeUnknownSync(Schema.Array(LibraryAssetRow))(
      rowsRaw,
    )
    const results = rows.slice(0, query.pageSize).map((asset) => ({
      assetId: asset.asset_id,
      revision: asset.revision,
      role: asset.role,
      format: asset.format,
      availability: asset.availability,
      comparisonGroupId: asset.comparison_group_id,
    }))
    const current = state(db)
    return json(response, 200, {
      queryId: query.queryId,
      querySnapshotVersion: current.snapshotVersion,
      results,
      ...(rows.length > query.pageSize
        ? { nextCursor: String((query.cursor ?? 0) + query.pageSize) }
        : {}),
      catalogChanged: false,
    })
  } catch {
    return json(response, 400, {
      outcome: 'rejected',
      reason: 'InvalidInput',
      message: operatorMessages.InvalidInput,
    })
  }
}
function decodeLibraryQuery(url: URL) {
  const allowed = new Set(['queryId', 'cursor', 'pageSize', 'role', 'sort'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
    throw new Error('Unknown library query parameter')
  const cursor = url.searchParams.get('cursor')
  const pageSize = url.searchParams.get('pageSize') ?? '40'
  if (cursor !== null && !/^\d+$/.test(cursor))
    throw new Error('Malformed cursor')
  if (!/^\d+$/.test(pageSize)) throw new Error('Malformed page size')
  return Schema.decodeUnknownSync(LibraryQueryInput)({
    queryId: url.searchParams.get('queryId') ?? 'library-m27',
    ...(cursor === null ? {} : { cursor: Number(cursor) }),
    pageSize: Number(pageSize),
    ...(url.searchParams.get('role') === null
      ? {}
      : { role: url.searchParams.get('role') }),
    sort: url.searchParams.get('sort') ?? 'capturedAtDescending',
  })
}
function libraryDetail(
  response: ServerResponse,
  db: DatabaseSync,
  assetId: string,
) {
  if (
    !/^asset-(?:m27-\d{3}|process-[0-9a-f-]+|source-[a-z0-9-]+)$/.test(assetId)
  )
    return json(response, 400, {
      outcome: 'rejected',
      reason: 'InvalidInput',
      message: operatorMessages.InvalidInput,
    })
  const raw: unknown = db
    .prepare(
      'SELECT asset_id,revision,role,format,availability,comparison_group_id,detail FROM library_assets WHERE asset_id=?',
    )
    .get(assetId)
  const row = Schema.decodeUnknownSync(Schema.optional(LibraryAssetRow))(raw)
  if (row === undefined)
    return json(response, 404, { outcome: 'rejected', reason: 'AssetNotFound' })
  try {
    const parsed: unknown = JSON.parse(row.detail)
    return json(response, 200, Schema.decodeUnknownSync(LibraryDetail)(parsed))
  } catch {
    return json(response, 500, {
      outcome: 'rejected',
      reason: 'LibraryCorrupt',
    })
  }
}
function decodedAssetId(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
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
  const match = /^\/api\/library\/assets\/(.+)\/download$/.exec(url.pathname)
  if (match?.[1] === undefined)
    return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
  const assetId = decodedAssetId(match[1])
  if (
    !/^asset-(?:m27-\d{3}|process-[0-9a-f-]+|source-[a-z0-9-]+)$/.test(assetId)
  )
    return json(response, 400, { outcome: 'rejected', reason: 'InvalidInput' })
  const raw: unknown = db
    .prepare(
      'SELECT library_assets.asset_id,library_assets.role,library_assets.format,library_assets.availability,asset_publications.state,asset_publications.object_key FROM library_assets JOIN asset_publications ON asset_publications.asset_id=library_assets.asset_id WHERE library_assets.asset_id=?',
    )
    .get(assetId)
  const asset = Schema.decodeUnknownSync(Schema.optional(DownloadAssetRow))(raw)
  if (asset === undefined) {
    const known = Schema.decodeUnknownSync(
      Schema.optional(Schema.Struct({ asset_id: Schema.String })),
    )(
      db
        .prepare('SELECT asset_id FROM library_assets WHERE asset_id=?')
        .get(assetId),
    )
    return known === undefined
      ? json(response, 404, { outcome: 'rejected', reason: 'AssetNotFound' })
      : json(response, 409, { outcome: 'rejected', reason: 'AssetUnavailable' })
  }
  if (
    asset.availability !== 'published' ||
    asset.state !== 'published' ||
    asset.object_key === ''
  )
    return json(response, 409, {
      outcome: 'rejected',
      reason: 'AssetUnavailable',
    })
  const now = grants.now?.() ?? new Date()
  const expiresAt = new Date(now.valueOf() + 300_000).toISOString()
  let signedUrl: string
  try {
    signedUrl = await grants.issuer.issue({
      objectKey: asset.object_key,
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
function readiness(db: DatabaseSync) {
  const current = state(db)
  if (current.plan.readiness === 'unavailable')
    return {
      status: 'unavailable' as const,
      service: 'ready' as const,
      database: 'ready' as const,
      rig: 'unknown' as const,
      tunnel: 'unknown' as const,
      activeRun: 'none' as const,
      message:
        'Service and local database are ready, but no observation plan or fixture is installed.',
    }
  return {
    status: 'ready' as const,
    service: 'ready' as const,
    database: 'ready' as const,
    rig: 'unknown' as const,
    tunnel: 'unknown' as const,
    activeRun: current.run === null ? ('none' as const) : current.run.phase,
    message:
      current.run === null
        ? 'Service and local database are ready; rig and tunnel are not connected in this fixture.'
        : 'Service and local database are ready; accepted run state is retained while rig and tunnel remain unknown.',
  }
}
function operations(db: DatabaseSync) {
  const current = state(db)
  const schemaRaw: unknown = db
    .prepare(
      'SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations',
    )
    .get()
  const schema = Schema.decodeUnknownSync(MigrationRow)(schemaRaw).version
  const workerRaw: unknown = db
    .prepare(
      "SELECT worker_id,state,adapter_state,last_heartbeat FROM worker_status WHERE worker_id='rig-worker'",
    )
    .get()
  const worker = Schema.decodeUnknownSync(Schema.optional(WorkerStatusRow))(
    workerRaw,
  )
  return {
    release: 'local-web-fixture',
    schemaVersion: schema,
    sqlite: { journalMode: 'wal', checkpoint: 'unknown' as const },
    snapshot: {
      version: current.snapshotVersion,
      eventCursor: current.eventCursor,
      activeRun: current.run === null ? ('none' as const) : current.run.phase,
      lease: current.control.state,
    },
    worker:
      worker === undefined
        ? { status: 'unknown' as const }
        : {
            status: worker.state,
            adapter: worker.adapter_state,
            lastHeartbeat: worker.last_heartbeat,
          },
    disk: 'unknown' as const,
    config:
      current.plan.readiness === 'unavailable'
        ? ('uninitialized' as const)
        : ('fixture' as const),
    rig: 'unknown' as const,
    tunnel: 'unknown' as const,
  }
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
function state(
  db: DatabaseSync,
): Omit<Snapshot, 'generatedAt' | 'identity' | 'connection'> {
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
      'SELECT client_id,person_id FROM control_requests ORDER BY client_id',
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
        clientId: item.client_id,
        personId: item.person_id,
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
function expireReconnectGrace(db: DatabaseSync) {
  const grace = storedValue(db, 'reconnectGraceUntil')
  const leaseState = storedValue(db, 'leaseState')
  if (
    typeof grace !== 'string' ||
    leaseState !== 'reconnecting' ||
    Date.parse(grace) > Date.now()
  )
    return
  db.exec('BEGIN IMMEDIATE')
  try {
    const currentGrace = storedValue(db, 'reconnectGraceUntil')
    const currentState = storedValue(db, 'leaseState')
    if (
      typeof currentGrace !== 'string' ||
      currentState !== 'reconnecting' ||
      Date.parse(currentGrace) > Date.now()
    ) {
      db.exec('COMMIT')
      return
    }
    const cursor = Number(storedValue(db, 'eventCursor')) + 1
    commit(db, {
      snapshotVersion: Number(storedValue(db, 'snapshotVersion')) + 1,
      eventCursor: cursor,
      leaseRevision: Number(storedValue(db, 'leaseRevision')) + 1,
      leaseHolder: null,
      leaseState: 'unheld',
      reconnectGraceUntil: null,
    })
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'ControlGraceExpired',
      JSON.stringify({ message: operatorMessages.ControlGraceExpired }),
    )
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function snapshot(db: DatabaseSync, identity: LocalIdentity): Snapshot {
  return {
    ...state(db),
    generatedAt: new Date().toISOString(),
    identity,
    connection: 'current',
  }
}
function bootstrapSnapshot(db: DatabaseSync, identity: LocalIdentity) {
  const current = snapshot(db, identity)
  const observedAt = current.generatedAt
  const plan =
    current.plan.readiness === 'unavailable'
      ? undefined
      : bootstrapPlanWorkspaceProjection(db, identity, current)
  return Schema.decodeUnknownEffect(BootstrapSnapshot)({
    snapshotVersion: current.snapshotVersion,
    eventCursor: current.eventCursor,
    generatedAt: current.generatedAt,
    membership: {
      personId: identity.personId,
      role: identity.role ?? 'viewer',
      clientId: identity.clientId,
      capability: identity.capability,
    },
    control: {
      revision: current.control.revision,
      state: current.control.state,
      ...(current.control.holderClientId === null
        ? {}
        : { holderClientId: current.control.holderClientId }),
      ...(current.control.reconnectGraceUntil === undefined
        ? {}
        : { reconnectGraceUntil: current.control.reconnectGraceUntil }),
    },
    ...(plan === undefined ? {} : { plan }),
    activeRun:
      current.run === null
        ? { _tag: 'None' }
        : {
            _tag: 'Active',
            run: {
              runId: current.run.id,
              revision: current.run.revision,
              phase: current.run.phase,
              target: current.run.target,
              progress: current.run.progress,
              completedSequenceCount: current.run.completedSequenceCount ?? 0,
            },
          },
    health: {
      service: { state: 'healthy', observedAt },
      rig: {
        state: 'unknown',
        observedAt,
        reason: 'No rig observation is connected.',
      },
      tunnel: {
        state: 'unknown',
        observedAt,
        reason: 'No tunnel observation is connected.',
      },
      processing: {
        state: 'unknown',
        observedAt,
        reason: 'Processing availability has not been observed.',
      },
      publication: {
        state: 'unknown',
        observedAt,
        reason: 'Publication availability has not been observed.',
      },
      storage: {
        state: 'unknown',
        observedAt,
        reason: 'Storage health has not been observed.',
      },
    },
  })
}
function bootstrapPlanWorkspaceProjection(
  db: DatabaseSync,
  identity: LocalIdentity,
  current: Snapshot,
) {
  const plan = planWorkspaceProjection(db, 'plan')
  const currentDefinitionRaw: unknown = db
    .prepare(
      'SELECT definition FROM run_definitions WHERE source_plan_id=? AND source_plan_revision=?',
    )
    .get(plan.planId, plan.revision)
  const currentDefinition = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(currentDefinitionRaw)
  const acceptedForCurrentRevision =
    currentDefinition === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(currentDefinition.definition),
        )
  const acceptedRaw: unknown = db
    .prepare(
      'SELECT definition FROM run_definitions WHERE source_plan_id=? ORDER BY accepted_at DESC LIMIT 1',
    )
    .get(plan.planId)
  const acceptedDefinition = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(acceptedRaw)
  const accepted =
    acceptedDefinition === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(acceptedDefinition.definition),
        )
  const owner = isOwner(identity)
  const controller = current.control.holderClientId === identity.clientId
  const writable = identity.capability === 'controlCapable'
  const reason = <Unavailable>(eligible: boolean, unavailable: Unavailable) =>
    eligible ? { _tag: 'Eligible' as const } : unavailable
  const ownerWrite = owner && writable
  const activeFake = current.run !== null && hasFakeExecutor(db)
  const paused = current.run?.phase === 'paused'
  const advanced = (current.run?.activeSequenceIndex ?? 0) !== 0
  const terminal =
    current.run?.phase === 'completed' ||
    current.run?.phase === 'stopped' ||
    current.run?.phase === 'parkRequested'
  const previewRaw: unknown =
    current.run === null
      ? undefined
      : db
          .prepare(
            'SELECT preview_id,run_id,run_revision,owner_person_id,mutation,consequences,classification,expires_at,applied_at FROM run_mutation_previews WHERE run_id=? AND run_revision=? AND applied_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 1',
          )
          .get(current.run.id, current.run.revision, new Date().toISOString())
  const preview = Schema.decodeUnknownSync(
    Schema.optional(StoredMutationPreview),
  )(previewRaw)
  const previewVisible =
    preview !== undefined &&
    owner &&
    writable &&
    (controller || preview.owner_person_id === identity.personId)
  return {
    ...plan,
    ...(accepted === undefined
      ? {}
      : {
          acceptedRunDefinition: {
            id: accepted.id,
            sourcePlanRevision: accepted.sourcePlanRevision,
            acceptedAt: accepted.acceptedAt,
            executor: 'fake' as const,
          },
        }),
    ...(previewVisible
      ? {
          runMutationPreview: {
            previewId: preview.preview_id,
            classification: preview.classification,
            consequences: preview.consequences,
            expiresAt: preview.expires_at,
            approvalRequired: preview.classification === 'disruptive',
            ...(preview.classification === 'disruptive' && controller
              ? {
                  approvalToken: createHash('sha256')
                    .update(`${preview.preview_id}:${preview.consequences}`)
                    .digest('hex'),
                }
              : {}),
          },
        }
      : {}),
    actions: {
      saveDraft: reason(
        ownerWrite && current.run === null,
        !owner
          ? { _tag: 'Ineligible' as const, reason: 'ownerRequired' }
          : !writable
            ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
            : { _tag: 'Ineligible' as const, reason: 'activeRunPresent' },
      ),
      acceptRunDefinition: reason(
        ownerWrite &&
          current.run === null &&
          plan.readiness === 'ready' &&
          acceptedForCurrentRevision === undefined,
        !owner
          ? { _tag: 'Ineligible' as const, reason: 'ownerRequired' }
          : !writable
            ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
            : plan.readiness !== 'ready'
              ? { _tag: 'Ineligible' as const, reason: 'planNotReady' }
              : current.run !== null
                ? { _tag: 'Ineligible' as const, reason: 'activeRunPresent' }
                : {
                    _tag: 'Ineligible' as const,
                    reason: 'definitionAlreadyAccepted',
                  },
      ),
      startAcceptedRun: reason(
        writable &&
          controller &&
          current.run === null &&
          acceptedForCurrentRevision !== undefined,
        !writable
          ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
          : !controller
            ? { _tag: 'Ineligible' as const, reason: 'controlRequired' }
            : current.run !== null
              ? { _tag: 'Ineligible' as const, reason: 'activeRunPresent' }
              : {
                  _tag: 'Ineligible' as const,
                  reason: 'acceptedDefinitionRequired',
                },
      ),
      previewRunMutation: reason(
        activeFake && !terminal && !paused && !advanced && ownerWrite,
        !owner
          ? { _tag: 'Ineligible' as const, reason: 'ownerRequired' }
          : !writable
            ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
            : terminal
              ? { _tag: 'Ineligible' as const, reason: 'terminalRun' }
              : paused
                ? { _tag: 'Ineligible' as const, reason: 'pausedRun' }
                : advanced
                  ? { _tag: 'Ineligible' as const, reason: 'runAdvanced' }
                  : {
                      _tag: 'Ineligible' as const,
                      reason: 'activeRunRequired',
                    },
      ),
      applyRunMutation: reason(
        activeFake &&
          !terminal &&
          !paused &&
          !advanced &&
          writable &&
          owner &&
          controller &&
          previewVisible &&
          preview.classification !== 'disruptive',
        !writable
          ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
          : !controller
            ? { _tag: 'Ineligible' as const, reason: 'controlRequired' }
            : terminal
              ? { _tag: 'Ineligible' as const, reason: 'terminalRun' }
              : paused
                ? { _tag: 'Ineligible' as const, reason: 'pausedRun' }
                : advanced
                  ? { _tag: 'Ineligible' as const, reason: 'runAdvanced' }
                  : activeFake
                    ? { _tag: 'Ineligible' as const, reason: 'previewRequired' }
                    : {
                        _tag: 'Ineligible' as const,
                        reason: 'activeRunRequired',
                      },
      ),
      approveDisruptiveRunMutation: reason(
        activeFake &&
          !terminal &&
          !paused &&
          !advanced &&
          writable &&
          owner &&
          controller &&
          previewVisible &&
          preview.classification === 'disruptive',
        !writable
          ? { _tag: 'Ineligible' as const, reason: 'readOnlyClient' }
          : !controller
            ? { _tag: 'Ineligible' as const, reason: 'controlRequired' }
            : terminal
              ? { _tag: 'Ineligible' as const, reason: 'terminalRun' }
              : paused
                ? { _tag: 'Ineligible' as const, reason: 'pausedRun' }
                : advanced
                  ? { _tag: 'Ineligible' as const, reason: 'runAdvanced' }
                  : activeFake
                    ? { _tag: 'Ineligible' as const, reason: 'previewRequired' }
                    : {
                        _tag: 'Ineligible' as const,
                        reason: 'activeRunRequired',
                      },
      ),
    },
  }
}
function sseProjection(db: DatabaseSync, identity: LocalIdentity) {
  const event = Effect.runSync(
    bootstrapSnapshot(db, identity).pipe(
      Effect.flatMap((data) =>
        Schema.decodeUnknownEffect(BootstrapSseEventEnvelope)({
          id: data.eventCursor,
          event: 'ProjectionChanged',
          data,
        }),
      ),
    ),
  )
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}
function acceptRun(
  db: DatabaseSync,
  input: typeof StartRun.Type,
  identity: LocalIdentity,
) {
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        planId: input.planId,
        expectedPlanRevision: input.expectedPlanRevision,
        expectedLeaseRevision: input.expectedLeaseRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_start_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(receiptRaw)
  if (existing !== undefined)
    return existing.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(existing.response),
          ),
        }
      : reject('IdempotencyConflict')
  const definitionRaw: unknown = db
    .prepare(
      'SELECT definition FROM run_definitions WHERE source_plan_id=? AND source_plan_revision=?',
    )
    .get(input.planId, input.expectedPlanRevision)
  const definitionRow = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(definitionRaw)
  const definition =
    definitionRow === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(definitionRow.definition),
        )
  const legacy =
    definition === undefined
      ? legacyStartReplay(db, input, identity)
      : legacyStartReplay(db, input, identity, definition)
  if (legacy !== undefined) return legacy
  const current = state(db)
  if (current.plan.readiness !== 'ready' || !current.plan.runEligible)
    return reject('PlanUnavailable')
  if (
    input.planId !== current.plan.id ||
    input.expectedPlanRevision !== current.plan.revision ||
    input.expectedLeaseRevision !== current.control.revision
  )
    return reject('FreshnessConflict')
  if (current.control.holderClientId !== identity.clientId)
    return reject('ControlLeaseLost')
  if (definition === undefined) return reject('PlanUnavailable')
  if (current.run !== null) return reject('ActiveRunConflict')
  db.exec('BEGIN IMMEDIATE')
  try {
    const fixture = definition.executor === 'fixture'
    const run: Run = fixture
      ? {
          id: 'run-m27-001',
          revision: 1,
          phase: 'capture',
          target: definition.plan.sequences[0]?.target ?? current.plan.target,
          progress: 0,
          sourceDefinitionId: definition.id,
          activeSequenceIndex: 0,
          completedSequenceCount: 0,
        }
      : {
          id: `run-${definition.id}`,
          revision: 1,
          phase: 'preflight',
          target: definition.plan.sequences[0]?.target ?? current.plan.target,
          progress: 0,
          sourceDefinitionId: definition.id,
          activeSequenceIndex: 0,
          completedSequenceCount: 0,
        }
    const next = {
      ...current,
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: current.eventCursor + 1,
      run,
    }
    commit(db, {
      snapshotVersion: next.snapshotVersion,
      eventCursor: next.eventCursor,
      run: next.run,
    })
    const result: CommandResult = {
      outcome: 'accepted',
      run: next.run,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO run_start_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(result),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      next.eventCursor,
      'RunStarted',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      status: 202,
      body: result,
      event: { type: 'RunStarted', cursor: next.eventCursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function legacyStartReplay(
  db: DatabaseSync,
  input: typeof StartRun.Type,
  identity: LocalIdentity,
  definition?: typeof StoredRunDefinition.Type,
) {
  const raw: unknown = db
    .prepare('SELECT response FROM receipts WHERE idempotency_key=?')
    .get(input.idempotencyKey)
  const receipt = Schema.decodeUnknownSync(Schema.optional(ReceiptRow))(raw)
  if (receipt === undefined) return undefined
  const result = Schema.decodeUnknownOption(CommandResultSchema)(
    JSON.parse(receipt.response),
  )
  return Option.match(result, {
    onNone: () => reject('IdempotencyConflict'),
    onSome: (stored) =>
      stored.outcome === 'accepted' &&
      stored.snapshot.identity.personId === identity.personId &&
      stored.snapshot.identity.clientId === identity.clientId &&
      stored.snapshot.plan.id === input.planId &&
      stored.snapshot.plan.revision === input.expectedPlanRevision &&
      stored.snapshot.control.revision === input.expectedLeaseRevision &&
      definition !== undefined &&
      definition.sourcePlanId === input.planId &&
      definition.sourcePlanRevision === input.expectedPlanRevision &&
      stored.run?.sourceDefinitionId === definition.id
        ? { status: 200, body: stored }
        : reject('IdempotencyConflict'),
  })
}
function advanceFakeRunState(db: DatabaseSync, identity: LocalIdentity) {
  const current = state(db)
  if (
    current.run?.sourceDefinitionId === undefined ||
    current.run.activeSequenceIndex === undefined ||
    current.run.completedSequenceCount === undefined
  )
    return undefined
  const definitionRaw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(current.run.sourceDefinitionId)
  const definitionRow = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(definitionRaw)
  if (definitionRow === undefined) return undefined
  const definition = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(definitionRow.definition),
  )
  if (definition.executor !== 'fake') return undefined
  const transition = nextFakeRunTransition(current.run, definition)
  if (transition === undefined) return undefined
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: transition.run,
    })
    const body = {
      outcome: 'accepted' as const,
      run: transition.run,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      transition.eventType,
      JSON.stringify(body),
    )
    db.exec('COMMIT')
    return { body, event: { type: transition.eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function nextFakeRunTransition(
  run: Run,
  definition: typeof StoredRunDefinition.Type,
) {
  if (run.phase === 'preflight')
    return {
      eventType: 'RunPreflightCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'acquire' as const,
        progress: 10,
      },
    }
  if (run.phase === 'acquire')
    return {
      eventType: 'RunAcquireCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'capture' as const,
        progress: 25,
      },
    }
  if (run.phase === 'capture')
    return {
      eventType: 'RunCaptureCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'verify' as const,
        progress: 75,
      },
    }
  if (run.phase !== 'verify') return undefined
  const completedSequenceCount = run.completedSequenceCount
  const activeSequenceIndex = run.activeSequenceIndex
  if (completedSequenceCount === undefined || activeSequenceIndex === undefined)
    return undefined
  const completed = completedSequenceCount + 1
  const next = definition.plan.sequences[activeSequenceIndex + 1]
  if (next === undefined)
    return {
      eventType: 'RunCompleted',
      run: {
        ...run,
        revision: run.revision + 1,
        phase: 'completed' as const,
        progress: 100,
        completedSequenceCount: completed,
      },
    }
  return {
    eventType: 'RunSequenceVerified',
    run: {
      ...run,
      revision: run.revision + 1,
      phase: 'preflight' as const,
      target: next.target,
      progress: Math.floor(
        (completed / definition.plan.sequences.length) * 100,
      ),
      activeSequenceIndex: activeSequenceIndex + 1,
      completedSequenceCount: completed,
    },
  }
}

function runInterventionCommand<
  Input extends typeof PauseRun.Type | typeof ResumeRun.Type,
>(
  response: ServerResponse,
  raw: unknown | undefined,
  decode: (raw: unknown) => Input,
  intent: 'pause' | 'resume',
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const result = acceptRunIntervention(db, decode(raw), intent, identity)
    if ('event' in result && result.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return json(response, result.status, result.body)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}

function hasFakeRunDefinition(db: DatabaseSync) {
  const run = state(db).run
  if (run?.sourceDefinitionId === undefined) return false
  const raw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(run.sourceDefinitionId)
  const row = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  if (row === undefined) return false
  const definition = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(row.definition),
  )
  return definition.executor === 'fake' || definition.executor === 'fixture'
}
function hasFakeExecutor(db: DatabaseSync) {
  const run = state(db).run
  if (run?.sourceDefinitionId === undefined) return false
  const raw: unknown = db
    .prepare('SELECT definition FROM run_definitions WHERE run_definition_id=?')
    .get(run.sourceDefinitionId)
  const row = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  if (row === undefined) return false
  return (
    Schema.decodeUnknownSync(StoredRunDefinition)(JSON.parse(row.definition))
      .executor === 'fake'
  )
}

function acceptRunIntervention(
  db: DatabaseSync,
  input: typeof PauseRun.Type | typeof ResumeRun.Type,
  intent: 'pause' | 'resume',
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (!hasFakeRunDefinition(db)) return reject('RunRevisionConflict')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        intent,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_intervention_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(receiptRaw)
  if (existing !== undefined)
    return existing.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(existing.response),
          ),
        }
      : reject('IdempotencyConflict')
  expireReconnectGrace(db)
  const current = state(db)
  if (input.expectedLeaseRevision !== current.control.revision)
    return reject('ControlLeaseLost')
  if (current.control.holderClientId !== identity.clientId)
    return reject('ControlLeaseLost')
  if (intent === 'pause') {
    if (
      current.run === null ||
      input.expectedRunRevision !== current.run.revision
    )
      return reject('RunRevisionConflict')
    if (current.run.phase === 'paused') return reject('AlreadyPaused')
    if (current.run.phase === 'completed' || current.run.phase === 'stopped')
      return reject('AlreadyTerminal')
  }
  if (intent === 'resume') {
    if (current.run === null || current.run.phase !== 'paused')
      return reject('NotPaused')
    if (input.expectedRunRevision !== current.run.revision)
      return reject('RunRevisionConflict')
    if (current.run.resumablePhase === undefined)
      return reject('ResumePhaseUnavailable')
  }
  const run = current.run
  if (run === null) return reject('RunRevisionConflict')
  let nextRun: Run
  if (intent === 'pause') {
    const resumablePhase = resumableRunPhase(run.phase)
    if (resumablePhase === undefined) return reject('AlreadyTerminal')
    nextRun = {
      ...run,
      revision: run.revision + 1,
      phase: 'paused',
      resumablePhase,
    }
  } else {
    const { resumablePhase, ...resumed } = run
    if (resumablePhase === undefined) return reject('ResumePhaseUnavailable')
    nextRun = {
      ...resumed,
      revision: run.revision + 1,
      phase: resumablePhase,
    }
  }
  const eventType: ControlEvent =
    intent === 'pause' ? 'RunPaused' : 'RunResumed'
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: nextRun,
    })
    const result: CommandResult = {
      outcome: 'accepted',
      eventType,
      message: operatorMessages[eventType],
      run: nextRun,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO run_intervention_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(result),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      eventType,
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return { status: 202, body: result, event: { type: eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function fakePolicyCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  path: string,
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const result = acceptFakePolicy(
      db,
      Schema.decodeUnknownSync(FakePolicy)(raw),
      path,
      identity,
    )
    if ('event' in result && result.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return json(response, result.status, result.body)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}
function acceptFakePolicy(
  db: DatabaseSync,
  input: typeof FakePolicy.Type,
  path: string,
  identity: LocalIdentity,
) {
  if (path === '/api/commands/stop-run') {
    const existing = receipt(db, input.idempotencyKey)
    if (existing !== undefined) return { status: 200, body: existing }
  }
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (!hasFakeRunDefinition(db)) return reject('RunRevisionConflict')
  const current = state(db)
  const run = current.run
  if (
    input.expectedLeaseRevision !== current.control.revision ||
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  if (run === null || input.expectedRunRevision !== run.revision)
    return reject('RunRevisionConflict')
  const definition =
    run.sourceDefinitionId === undefined
      ? undefined
      : Schema.decodeUnknownSync(
          Schema.optional(Schema.Struct({ definition: Schema.String })),
        )(
          db
            .prepare(
              'SELECT definition FROM run_definitions WHERE run_definition_id=?',
            )
            .get(run.sourceDefinitionId),
        )
  if (definition === undefined) return reject('RunRevisionConflict')
  const sequences = Schema.decodeUnknownSync(StoredRunDefinition)(
    JSON.parse(definition.definition),
  ).plan.sequences
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        path,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
      }),
    )
    .digest('hex')
  const priorRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_intervention_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const prior = Schema.decodeUnknownSync(
    Schema.optional(InterventionReceiptRow),
  )(priorRaw)
  if (prior !== undefined)
    return prior.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(prior.response),
          ),
        }
      : reject('IdempotencyConflict')
  if (
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested'
  )
    return reject('AlreadyTerminal')
  if (run.phase === 'paused') return reject('PolicyUnavailable')
  const activeSequenceIndex = run.activeSequenceIndex
  const completedSequenceCount = run.completedSequenceCount
  if (activeSequenceIndex === undefined || completedSequenceCount === undefined)
    return reject('PolicyUnavailable')
  const nextSequence = sequences[activeSequenceIndex + 1]
  if (path === '/api/commands/retry-fake-phase' && run.retryPhase !== undefined)
    return reject('RetryExhausted')
  const nextRun: Run =
    path === '/api/commands/stop-run'
      ? { ...run, revision: run.revision + 1, phase: 'stopped' }
      : path === '/api/commands/skip-fake-sequence'
        ? nextSequence === undefined
          ? {
              ...run,
              revision: run.revision + 1,
              phase: 'completed',
              progress: 100,
              completedSequenceCount: completedSequenceCount + 1,
            }
          : {
              ...run,
              revision: run.revision + 1,
              phase: 'preflight',
              target: nextSequence.target,
              progress: Math.floor(
                ((completedSequenceCount + 1) / sequences.length) * 100,
              ),
              activeSequenceIndex: activeSequenceIndex + 1,
              completedSequenceCount: completedSequenceCount + 1,
            }
        : path === '/api/commands/retry-fake-phase'
          ? { ...run, revision: run.revision + 1, retryPhase: run.phase }
          : { ...run, revision: run.revision + 1, phase: 'parkRequested' }
  const eventType: ControlEvent =
    path === '/api/commands/stop-run'
      ? 'RunStopped'
      : path === '/api/commands/skip-fake-sequence'
        ? 'FakeSequenceSkipped'
        : path === '/api/commands/retry-fake-phase'
          ? 'FakePhaseRetried'
          : 'FakeParkRequested'
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: nextRun,
    })
    const body: CommandResult = {
      outcome: 'accepted',
      eventType,
      run: nextRun,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO run_intervention_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(body),
    )
    if (path === '/api/commands/stop-run')
      db.prepare('INSERT INTO receipts VALUES (?,?)').run(
        input.idempotencyKey,
        JSON.stringify(body),
      )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      eventType,
      JSON.stringify(body),
    )
    db.exec('COMMIT')
    return { status: 202, body, event: { type: eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const StoredMutationPreview = Schema.Struct({
  preview_id: Schema.String,
  run_id: Schema.String,
  run_revision: Schema.Int,
  owner_person_id: Schema.String,
  mutation: Schema.Literals([
    'reprioritizeSecond',
    'shortenSecond',
    'discardCurrent',
  ]),
  consequences: Schema.String,
  classification: Schema.Literals(['nonDisruptive', 'notice', 'disruptive']),
  expires_at: Schema.String,
  applied_at: Schema.NullOr(Schema.String),
})

function previewRunMutationCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const result = previewRunMutation(
      db,
      Schema.decodeUnknownSync(PreviewRunMutation)(raw),
      identity,
    )
    if ('event' in result) publish(result.event.type, result.event.cursor)
    return json(response, 202, result)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}

function previewRunMutation(
  db: DatabaseSync,
  input: typeof PreviewRunMutation.Type,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired').body
  if (identity.capability === 'readOnly') return reject('ClientReadOnly').body
  if (!hasFakeExecutor(db)) return reject('RunRevisionConflict').body
  const current = state(db)
  const run = current.run
  if (run === null || input.expectedRunRevision !== run.revision)
    return reject('RunRevisionConflict').body
  if (
    run.phase === 'paused' ||
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested' ||
    run.activeSequenceIndex !== 0
  )
    return reject('PolicyUnavailable').body
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        mutation: input.mutation,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_mutation_preview_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const receiptRow = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(receiptRaw)
  if (receiptRow !== undefined)
    return receiptRow.semantic_key === semanticKey
      ? JSON.parse(receiptRow.response)
      : reject('IdempotencyConflict').body
  const definition =
    run.sourceDefinitionId === undefined
      ? undefined
      : Schema.decodeUnknownSync(
          Schema.optional(Schema.Struct({ definition: Schema.String })),
        )(
          db
            .prepare(
              'SELECT definition FROM run_definitions WHERE run_definition_id=?',
            )
            .get(run.sourceDefinitionId),
        )
  const second =
    definition === undefined
      ? undefined
      : Schema.decodeUnknownSync(StoredRunDefinition)(
          JSON.parse(definition.definition),
        ).plan.sequences[1]
  if (second === undefined) return reject('PolicyUnavailable').body
  const classification =
    input.mutation === 'reprioritizeSecond'
      ? ('nonDisruptive' as const)
      : input.mutation === 'shortenSecond'
        ? ('notice' as const)
        : ('disruptive' as const)
  const consequences =
    input.mutation === 'reprioritizeSecond'
      ? `The unstarted second fake sequence (${second.target}) remains after the current sequence.`
      : input.mutation === 'shortenSecond'
        ? `The unstarted second fake sequence (${second.target}) is shortened in this fake run.`
        : `Current fake sequence progress is discarded and ${second.target} starts at preflight.`
  const preview = {
    previewId: `run-mutation-${randomUUID()}`,
    runId: run.id,
    runRevision: run.revision,
    mutation: input.mutation,
    classification,
    consequences,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    approvalRequired: classification === 'disruptive',
  }
  const result = {
    outcome: 'accepted' as const,
    preview,
    ...(classification === 'disruptive' &&
    current.control.holderClientId === identity.clientId
      ? {
          approvalToken: createHash('sha256')
            .update(`${preview.previewId}:${consequences}`)
            .digest('hex'),
        }
      : {}),
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
    })
    db.prepare(
      'INSERT INTO run_mutation_previews VALUES (?,?,?,?,?,?,?,?,NULL)',
    ).run(
      preview.previewId,
      run.id,
      run.revision,
      identity.personId,
      preview.mutation,
      consequences,
      classification,
      preview.expiresAt,
    )
    db.prepare(
      'INSERT INTO run_mutation_preview_receipts VALUES (?,?,?,?)',
    ).run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(result),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'RunMutationPreviewed',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      ...result,
      event: { type: 'RunMutationPreviewed', cursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function applyRunMutationCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  approved: boolean,
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const schema = approved ? ApproveDisruptiveRunMutation : ApplyRunMutation
    const result = applyRunMutation(
      db,
      Schema.decodeUnknownSync(schema)(raw),
      approved,
      identity,
    )
    if ('event' in result && result.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return json(response, result.status, result.body)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}

function applyRunMutation(
  db: DatabaseSync,
  input:
    typeof ApplyRunMutation.Type | typeof ApproveDisruptiveRunMutation.Type,
  approved: boolean,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (!hasFakeExecutor(db)) return reject('RunRevisionConflict')
  const current = state(db)
  const run = current.run
  if (
    input.expectedLeaseRevision !== current.control.revision ||
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        previewId: input.previewId,
        expectedLeaseRevision: input.expectedLeaseRevision,
        expectedRunRevision: input.expectedRunRevision,
        approved,
      }),
    )
    .digest('hex')
  const priorRaw: unknown = db
    .prepare(
      'SELECT semantic_key,response FROM run_intervention_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const prior = Schema.decodeUnknownSync(
    Schema.optional(
      Schema.Struct({ semantic_key: Schema.String, response: Schema.String }),
    ),
  )(priorRaw)
  if (prior !== undefined)
    return prior.semantic_key === semanticKey
      ? {
          status: 200,
          body: Schema.decodeUnknownSync(CommandResultSchema)(
            JSON.parse(prior.response),
          ),
        }
      : reject('IdempotencyConflict')
  if (run === null || input.expectedRunRevision !== run.revision)
    return reject('RunRevisionConflict')
  if (
    run.phase === 'completed' ||
    run.phase === 'stopped' ||
    run.phase === 'parkRequested'
  )
    return reject('PolicyUnavailable')
  const rowRaw: unknown = db
    .prepare(
      'SELECT preview_id,run_id,run_revision,owner_person_id,mutation,consequences,classification,expires_at,applied_at FROM run_mutation_previews WHERE preview_id=?',
    )
    .get(input.previewId)
  const preview = Schema.decodeUnknownSync(
    Schema.optional(StoredMutationPreview),
  )(rowRaw)
  if (preview === undefined || preview.run_id !== run.id)
    return reject('PreviewUnavailable')
  if (preview.applied_at !== null) return reject('PreviewUnavailable')
  if (Date.parse(preview.expires_at) <= Date.now())
    return reject('PreviewExpired')
  if (preview.run_revision !== run.revision)
    return reject('RunRevisionConflict')
  if (preview.classification === 'disruptive' && !approved)
    return reject('ApprovalRequired')
  if (preview.classification !== 'disruptive' && approved)
    return reject('ApprovalMismatch')
  if (
    preview.classification === 'disruptive' &&
    'approvalToken' in input &&
    input.approvalToken !==
      createHash('sha256')
        .update(`${preview.preview_id}:${preview.consequences}`)
        .digest('hex')
  )
    return reject('ApprovalMismatch')
  const nextRun: Run =
    preview.mutation === 'discardCurrent'
      ? {
          ...run,
          revision: run.revision + 1,
          phase: 'preflight',
          target: mutationNextTarget(db, run),
          progress: Math.floor(
            (((run.completedSequenceCount ?? 0) + 1) / 2) * 100,
          ),
          activeSequenceIndex: (run.activeSequenceIndex ?? 0) + 1,
          completedSequenceCount: (run.completedSequenceCount ?? 0) + 1,
          appliedMutations: [
            ...(run.appliedMutations ?? []),
            { previewId: preview.preview_id, kind: preview.mutation },
          ],
        }
      : {
          ...run,
          revision: run.revision + 1,
          appliedMutations: [
            ...(run.appliedMutations ?? []),
            { previewId: preview.preview_id, kind: preview.mutation },
          ],
        }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      run: nextRun,
    })
    db.prepare(
      'UPDATE run_mutation_previews SET applied_at=? WHERE preview_id=? AND applied_at IS NULL',
    ).run(new Date().toISOString(), preview.preview_id)
    const body: CommandResult = {
      outcome: 'accepted',
      eventType: 'RunMutationApplied',
      run: nextRun,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO run_intervention_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify(body),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'RunMutationApplied',
      JSON.stringify(body),
    )
    db.exec('COMMIT')
    return { status: 202, body, event: { type: 'RunMutationApplied', cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function mutationNextTarget(db: DatabaseSync, run: Run) {
  const raw: unknown =
    run.sourceDefinitionId === undefined
      ? undefined
      : db
          .prepare(
            'SELECT definition FROM run_definitions WHERE run_definition_id=?',
          )
          .get(run.sourceDefinitionId)
  const definition = Schema.decodeUnknownSync(
    Schema.optional(Schema.Struct({ definition: Schema.String })),
  )(raw)
  return definition === undefined
    ? run.target
    : (Schema.decodeUnknownSync(StoredRunDefinition)(
        JSON.parse(definition.definition),
      ).plan.sequences[(run.activeSequenceIndex ?? 0) + 1]?.target ??
        run.target)
}

function acceptControl(
  db: DatabaseSync,
  path: string,
  input: typeof ControlCommand.Type,
  identity: LocalIdentity,
) {
  expireReconnectGrace(db)
  const existing = receipt(db, input.idempotencyKey)
  if (existing !== undefined) return { status: 200, body: existing }
  const current = state(db)
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (input.expectedLeaseRevision !== current.control.revision)
    return reject('FreshnessConflict')
  if (
    path === '/api/commands/stop-run' &&
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  if (
    [
      '/api/commands/controller-disconnected',
      '/api/commands/controller-reconnected',
    ].includes(path) &&
    current.control.holderClientId !== identity.clientId
  )
    return reject('ControlLeaseLost')
  if (
    path === '/api/commands/controller-reconnected' &&
    current.control.state !== 'reconnecting'
  )
    return reject('FreshnessConflict')
  if (
    path === '/api/commands/stop-run' &&
    (current.run === null ||
      current.run.phase === 'stopped' ||
      input.expectedRunRevision !== current.run.revision)
  )
    return reject('FreshnessConflict')
  if (path === '/api/commands/grant-control' && !isOwner(identity))
    return reject('OwnerRequired')
  db.exec('BEGIN IMMEDIATE')
  try {
    let holder = current.control.holderClientId
    let leaseState = current.control.state
    let grace = current.control.reconnectGraceUntil ?? null
    let revision = current.control.revision
    let eventType: ControlEvent = 'ControlRequested'
    if (path === '/api/commands/request-control')
      db.prepare('INSERT OR IGNORE INTO control_requests VALUES (?,?)').run(
        identity.clientId,
        identity.personId,
      )
    if (path === '/api/commands/grant-control') {
      const requestRaw: unknown = db
        .prepare(
          'SELECT client_id FROM control_requests ORDER BY client_id LIMIT 1',
        )
        .get()
      const request = Schema.decodeUnknownSync(
        Schema.optional(ControlRequestRow),
      )(requestRaw)
      if (request === undefined) {
        db.exec('ROLLBACK')
        return reject('ControlRequestUnavailable')
      }
      holder = request.client_id
      leaseState = 'held'
      grace = null
      revision += 1
      eventType = 'ControlGranted'
      db.prepare('DELETE FROM control_requests WHERE client_id=?').run(holder)
    }
    if (path === '/api/commands/take-control') {
      holder = identity.clientId
      leaseState = 'held'
      grace = null
      revision += 1
      eventType = 'OwnerTookControl'
      db.exec('DELETE FROM control_requests')
    }
    if (path === '/api/commands/controller-disconnected') {
      leaseState = 'reconnecting'
      grace = new Date(Date.now() + 30_000).toISOString()
      revision += 1
      eventType = 'ControlReconnectGraceStarted'
    }
    if (path === '/api/commands/controller-reconnected') {
      leaseState = 'held'
      grace = null
      revision += 1
      eventType = 'ControlReconnected'
    }
    if (path === '/api/commands/stop-run') eventType = 'RunStopped'
    const nextRun =
      path === '/api/commands/stop-run' && current.run !== null
        ? {
            ...current.run,
            revision: current.run.revision + 1,
            phase: 'stopped' as const,
          }
        : current.run
    const cursor = current.eventCursor + 1
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
      leaseRevision: revision,
      leaseHolder: holder,
      leaseState,
      reconnectGraceUntil: grace,
      ...(nextRun === current.run ? {} : { run: nextRun }),
    })
    const result: CommandResult = {
      outcome: 'accepted',
      eventType,
      message: operatorMessages[eventType],
      snapshot: snapshot(db, identity),
    }
    record(db, input.idempotencyKey, result, cursor, eventType)
    db.exec('COMMIT')
    return { status: 202, body: result, event: { type: eventType, cursor } }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function commit(db: DatabaseSync, values: Record<string, unknown>) {
  const put = db.prepare('UPDATE state SET value=? WHERE key=?')
  for (const [key, value] of Object.entries(values))
    put.run(JSON.stringify(value), key)
}
function persistEvidence(
  db: DatabaseSync,
  evidence: Evidence,
  identityResolver: () => LocalIdentity,
) {
  const current = state(db)
  db.exec('BEGIN IMMEDIATE')
  try {
    commit(db, {
      evidence,
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: current.eventCursor + 1,
    })
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      current.eventCursor + 1,
      'ObservationProjected',
      JSON.stringify(evidence),
    )
    db.exec('COMMIT')
    return snapshot(db, identityResolver())
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function record(
  db: DatabaseSync,
  key: string,
  result: CommandResult,
  cursor: number,
  type: string,
) {
  db.prepare('INSERT INTO receipts VALUES (?,?)').run(
    key,
    JSON.stringify(result),
  )
  db.prepare('INSERT INTO events VALUES (?,?,?)').run(
    cursor,
    type,
    JSON.stringify(result),
  )
}
function receipt(db: DatabaseSync, key: string): CommandResult | undefined {
  const raw: unknown = db
    .prepare('SELECT response FROM receipts WHERE idempotency_key=?')
    .get(key)
  const row = Schema.decodeUnknownSync(Schema.optional(ReceiptRow))(raw)
  if (row === undefined) return undefined
  const parsed: unknown = JSON.parse(row.response)
  return Schema.decodeUnknownSync(CommandResultSchema)(parsed)
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
function runCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  return decodedCommand(
    response,
    raw,
    Schema.decodeUnknownSync(StartRun),
    (input) => acceptRun(db, input, identity),
    publish,
  )
}
function savePlanDraftCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const result = acceptPlanDraft(
      db,
      Schema.decodeUnknownSync(SavePlanDraft)(raw),
      identity,
    )
    if (result.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return json(response, result.status, result.body)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}
function acceptPlanDraft(
  db: DatabaseSync,
  input: typeof SavePlanDraft.Type,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  if (
    input.sequences.length < 2 ||
    new Set(input.sequences.map((sequence) => sequence.sequenceId)).size !==
      input.sequences.length
  )
    return reject('InvalidInput')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        planId: input.planId,
        expectedPlanRevision: input.expectedPlanRevision,
        sequences: input.sequences,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT response FROM observing_plan_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(Schema.optional(PlanReceiptRow))(
    receiptRaw,
  )
  if (existing !== undefined) {
    const stored = Schema.decodeUnknownSync(
      Schema.Struct({ semanticKey: Schema.String, result: Schema.Unknown }),
    )(JSON.parse(existing.response))
    return stored.semanticKey === semanticKey
      ? { status: 200, body: stored.result }
      : reject('IdempotencyConflict')
  }
  const current = state(db)
  if (current.plan.readiness === 'unavailable') return reject('PlanUnavailable')
  if (
    input.planId !== current.plan.id ||
    input.expectedPlanRevision !== current.plan.revision ||
    current.run !== null
  )
    return reject('FreshnessConflict')
  const currentPlan = planWorkspaceProjection(db, 'plan')
  const currentSequences = currentPlan.sequences.map(
    ({ viability, ...sequence }) => sequence,
  )
  if (JSON.stringify(input.sequences) === JSON.stringify(currentSequences))
    return reject('DraftUnchanged')
  const plan = evaluatePlan({
    planId: input.planId,
    revision: current.plan.revision + 1,
    sequences: input.sequences,
  })
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    db.prepare(
      'UPDATE observing_plans SET revision=?,projection=?,run_eligible=0 WHERE plan_id=? AND revision=?',
    ).run(
      plan.revision,
      JSON.stringify(plan),
      plan.planId,
      current.plan.revision,
    )
    db.prepare(
      "UPDATE workspace_projections SET value=? WHERE name='plan'",
    ).run(JSON.stringify(plan))
    commit(db, {
      planRevision: plan.revision,
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
    })
    const result: SavePlanDraftResult = {
      outcome: 'accepted',
      plan,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO observing_plan_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify({ semanticKey, result }),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'PlanDraftSaved',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      status: 202,
      body: result,
      event: { type: 'PlanDraftSaved', cursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function acceptRunDefinitionCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const result = acceptRunDefinition(
      db,
      Schema.decodeUnknownSync(AcceptRunDefinition)(raw),
      identity,
    )
    if (result.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return json(response, result.status, result.body)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}
function acceptRunDefinition(
  db: DatabaseSync,
  input: typeof AcceptRunDefinition.Type,
  identity: LocalIdentity,
) {
  if (!isOwner(identity)) return reject('OwnerRequired')
  if (identity.capability === 'readOnly') return reject('ClientReadOnly')
  const semanticKey = createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        planId: input.planId,
        expectedPlanRevision: input.expectedPlanRevision,
        expectedLeaseRevision: input.expectedLeaseRevision,
      }),
    )
    .digest('hex')
  const receiptRaw: unknown = db
    .prepare(
      'SELECT response FROM run_definition_receipts WHERE idempotency_key=? AND owner_person_id=?',
    )
    .get(input.idempotencyKey, identity.personId)
  const existing = Schema.decodeUnknownSync(
    Schema.optional(RunDefinitionReceiptRow),
  )(receiptRaw)
  if (existing !== undefined) {
    const stored = Schema.decodeUnknownSync(
      Schema.Struct({ semanticKey: Schema.String, result: Schema.Unknown }),
    )(JSON.parse(existing.response))
    return stored.semanticKey === semanticKey
      ? { status: 200, body: stored.result }
      : reject('IdempotencyConflict')
  }
  const current = state(db)
  if (current.plan.readiness === 'unavailable') return reject('PlanUnavailable')
  if (
    input.planId !== current.plan.id ||
    input.expectedPlanRevision !== current.plan.revision ||
    input.expectedLeaseRevision !== current.control.revision
  )
    return reject('FreshnessConflict')
  if (current.run !== null) return reject('ActiveRunConflict')
  if (current.plan.readiness !== 'ready') return reject('PlanNotReady')
  const definitionRaw: unknown = db
    .prepare(
      'SELECT run_definition_id,source_plan_id,source_plan_revision,definition,accepted_at FROM run_definitions WHERE source_plan_id=? AND source_plan_revision=?',
    )
    .get(input.planId, input.expectedPlanRevision)
  if (
    Schema.decodeUnknownSync(Schema.optional(RunDefinitionRow))(
      definitionRaw,
    ) !== undefined
  )
    return reject('RunDefinitionAlreadyAccepted')
  const planRaw: unknown = db
    .prepare(
      'SELECT projection FROM observing_plans WHERE plan_id=? AND revision=?',
    )
    .get(input.planId, input.expectedPlanRevision)
  const plan = Schema.decodeUnknownSync(
    Schema.Struct({ projection: Schema.String }),
  )(planRaw)
  const acceptedAt = new Date().toISOString()
  const definition: RunDefinition = {
    id: `run-definition-${randomUUID()}`,
    sourcePlanId: input.planId,
    sourcePlanRevision: input.expectedPlanRevision,
    acceptedAt,
    executor: 'fake',
    plan: Schema.decodeUnknownSync(PlanWorkspace)(JSON.parse(plan.projection)),
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const cursor = current.eventCursor + 1
    const marked = db
      .prepare(
        'UPDATE observing_plans SET run_eligible=1 WHERE plan_id=? AND revision=? AND run_eligible=0',
      )
      .run(input.planId, input.expectedPlanRevision)
    if (marked.changes !== 1) {
      db.exec('ROLLBACK')
      return reject('RunDefinitionAlreadyAccepted')
    }
    db.prepare('INSERT INTO run_definitions VALUES (?,?,?,?,?)').run(
      definition.id,
      definition.sourcePlanId,
      definition.sourcePlanRevision,
      JSON.stringify(definition),
      definition.acceptedAt,
    )
    commit(db, {
      snapshotVersion: current.snapshotVersion + 1,
      eventCursor: cursor,
    })
    const result: AcceptRunDefinitionResult = {
      outcome: 'accepted',
      runDefinition: definition,
      snapshot: snapshot(db, identity),
    }
    db.prepare('INSERT INTO run_definition_receipts VALUES (?,?,?,?)').run(
      input.idempotencyKey,
      identity.personId,
      semanticKey,
      JSON.stringify({ semanticKey, result }),
    )
    db.prepare('INSERT INTO events VALUES (?,?,?)').run(
      cursor,
      'RunDefinitionAccepted',
      JSON.stringify(result),
    )
    db.exec('COMMIT')
    return {
      status: 202,
      body: result,
      event: { type: 'RunDefinitionAccepted', cursor },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
function controlCommand(
  response: ServerResponse,
  raw: unknown | undefined,
  db: DatabaseSync,
  path: string,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) {
  return decodedCommand(
    response,
    raw,
    Schema.decodeUnknownSync(ControlCommand),
    (input) => acceptControl(db, path, input, identity),
    publish,
  )
}
function decodedCommand<Input>(
  response: ServerResponse,
  raw: unknown | undefined,
  decode: (raw: unknown) => Input,
  run: (input: Input) => {
    readonly status: number
    readonly body: CommandResult
    readonly event?: { readonly type: string; readonly cursor: number }
  },
  publish: (type: string, cursor: number) => void,
) {
  if (raw === undefined) return json(response, 400, reject('InvalidInput').body)
  try {
    const result = run(decode(raw))
    if (result.event !== undefined)
      publish(result.event.type, result.event.cursor)
    return json(response, result.status, result.body)
  } catch {
    return json(response, 400, reject('InvalidInput').body)
  }
}
const controlEnvelopeCommand = Schema.Union([
  Command.cases.RequestControl,
  Command.cases.TakeControl,
])
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
const controlCommandLayer = (
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) =>
  Layer.succeed(
    ControlCommandService,
    ControlCommandService.of({
      execute: Effect.fn('Server.ControlCommandService.execute')(function* (
        commandId: string,
        command: typeof controlEnvelopeCommand.Type,
      ) {
        const path = Command.guards.RequestControl(command)
          ? '/api/commands/request-control'
          : '/api/commands/take-control'
        const result = acceptControl(db, path, command, identity)
        if (result.body.outcome === 'rejected')
          return yield* Effect.fail(
            new CommandRejected({
              failure: commandFailure(commandId, result.body),
            }),
          )
        if ('event' in result && result.event !== undefined)
          publish(result.event.type, result.event.cursor)
        const data = yield* bootstrapSnapshot(db, identity)
        const body = yield* Schema.decodeUnknownEffect(
          CommandHttpSuccessEnvelope,
        )({
          ok: true,
          data,
        })
        return { status: result.status, body }
      }),
    }),
  )
const controlCommandFromEnvelope = Effect.fn(
  'Server.controlCommandFromEnvelope',
)(
  function* (
    request: Promise<unknown | undefined | typeof BodyTooLarge>,
    db: DatabaseSync,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => void,
  ) {
    void db
    void identity
    void publish
    const raw = yield* Effect.promise(() => request)
    if (raw === undefined || raw === BodyTooLarge)
      return yield* Effect.fail(new CommandInputInvalid())
    const envelope = yield* Schema.decodeUnknownEffect(CommandEnvelope)(
      raw,
    ).pipe(Effect.mapError(() => new CommandInputInvalid()))
    const command = yield* Schema.decodeUnknownEffect(controlEnvelopeCommand)(
      envelope.command,
    ).pipe(Effect.mapError(() => new CommandInputInvalid()))
    const service = yield* ControlCommandService
    return yield* service.execute(envelope.commandId, command)
  },
  (effect, _request, db, identity, publish) =>
    effect.pipe(Effect.provide(controlCommandLayer(db, identity, publish))),
)
const planCommandLayer = (
  db: DatabaseSync,
  identity: LocalIdentity,
  publish: (type: string, cursor: number) => void,
) =>
  Layer.succeed(
    PlanCommandService,
    PlanCommandService.of({
      execute: Effect.fn('Server.PlanCommandService.execute')(function* (
        intent: typeof PlanIntent.Type,
      ) {
        const response = yield* Effect.try({
          try: () => planIntentResponse(db, intent, identity),
          catch: () => new PlanServiceUnavailable(),
        })
        const event = yield* Effect.try({
          try: () =>
            Schema.decodeUnknownSync(
              Schema.optional(
                Schema.Struct({ type: Schema.String, cursor: Schema.Int }),
              ),
            )('event' in response ? response.event : undefined),
          catch: () => new PlanServiceUnavailable(),
        })
        if (event !== undefined) publish(event.type, event.cursor)
        const body = yield* planCommandResponse(
          intent,
          response.body,
          db,
          identity,
        ).pipe(Effect.mapError(() => new PlanServiceUnavailable()))
        return { status: response.status, body }
      }),
    }),
  )
function planIntentResponse(
  db: DatabaseSync,
  intent: typeof PlanIntent.Type,
  identity: LocalIdentity,
) {
  if (PlanIntent.guards.SaveDraft(intent))
    return acceptPlanDraft(db, intent, identity)
  if (PlanIntent.guards.AcceptRunDefinition(intent))
    return acceptRunDefinition(db, intent, identity)
  if (PlanIntent.guards.StartAcceptedRun(intent))
    return acceptRun(db, { ...intent, _tag: 'StartRunFromPlan' }, identity)
  if (PlanIntent.guards.PreviewRunMutation(intent)) {
    const body = previewRunMutation(db, intent, identity)
    return {
      status: body.outcome === 'rejected' ? reject(body.reason).status : 202,
      body,
    }
  }
  if (PlanIntent.guards.ApplyRunMutation(intent))
    return applyRunMutation(db, intent, false, identity)
  return applyRunMutation(db, intent, true, identity)
}
const planCommandFromRequest = Effect.fn('Server.planCommandFromRequest')(
  function* (
    request: Promise<unknown | undefined | typeof BodyTooLarge>,
    db: DatabaseSync,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => void,
  ) {
    void db
    void identity
    void publish
    const raw = yield* Effect.promise(() => request)
    if (raw === undefined || raw === BodyTooLarge)
      return yield* Effect.fail(new PlanCommandInputInvalid())
    const requestBody = yield* Schema.decodeUnknownEffect(PlanCommandRequest)(
      raw,
    ).pipe(Effect.mapError(() => new PlanCommandInputInvalid()))
    const service = yield* PlanCommandService
    return yield* service.execute(requestBody.intent)
  },
  (effect, _request, db, identity, publish) =>
    effect.pipe(Effect.provide(planCommandLayer(db, identity, publish))),
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
  db: DatabaseSync,
  identity: LocalIdentity,
) {
  const snapshot = yield* bootstrapSnapshot(db, identity)
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
const planCommandResponse = Effect.fn('Server.planCommandResponse')(function* (
  intent: typeof PlanIntent.Type,
  raw: unknown,
  db: DatabaseSync,
  identity: LocalIdentity,
) {
  const rejected = Schema.decodeUnknownOption(
    Schema.Struct({
      outcome: Schema.Literal('rejected'),
      reason: Schema.NonEmptyString,
      message: Schema.NonEmptyString,
    }),
  )(raw)
  const snapshot = yield* bootstrapSnapshot(db, identity)
  return yield* Option.match(rejected, {
    onNone: () =>
      Schema.decodeUnknownEffect(PlanCommandResponse)({
        _tag: 'Accepted',
        result: planCommandResult(intent, raw),
        snapshot,
      }),
    onSome: (failure) =>
      Schema.decodeUnknownEffect(PlanCommandResponse)({
        _tag: 'Rejected',
        failure: {
          _tag: 'Rejected',
          reason: failure.reason,
          summary: failure.message,
        },
        snapshot,
      }),
  })
})
function planCommandResult(intent: typeof PlanIntent.Type, raw: unknown) {
  if (PlanIntent.guards.SaveDraft(intent))
    return { _tag: 'DraftSaved' as const }
  if (PlanIntent.guards.AcceptRunDefinition(intent))
    return { _tag: 'RunDefinitionAccepted' as const }
  if (PlanIntent.guards.StartAcceptedRun(intent))
    return { _tag: 'RunStarted' as const }
  if (PlanIntent.guards.ApplyRunMutation(intent))
    return { _tag: 'RunMutationApplied' as const }
  if (PlanIntent.guards.ApproveDisruptiveRunMutation(intent))
    return { _tag: 'RunMutationApplied' as const }
  const preview = Schema.decodeUnknownSync(
    Schema.Struct({
      outcome: Schema.Literal('accepted'),
      preview: Schema.Struct({
        previewId: Schema.NonEmptyString,
        classification: Schema.Literals([
          'nonDisruptive',
          'notice',
          'disruptive',
        ]),
        consequences: Schema.NonEmptyString,
        expiresAt: Schema.NonEmptyString,
        approvalRequired: Schema.Boolean,
      }),
      approvalToken: Schema.optionalKey(Schema.NonEmptyString),
    }),
  )(raw)
  return {
    _tag: 'RunMutationPreviewed' as const,
    ...preview.preview,
    ...(preview.approvalToken === undefined
      ? {}
      : { approvalToken: preview.approvalToken }),
  }
}
function commandFailure(
  commandId: string,
  rejected: Extract<CommandResult, { readonly outcome: 'rejected' }>,
): CommandFailure {
  const common = {
    commandId,
    summary: rejected.message,
    retryable: false,
    refreshFromSnapshot: rejected.reason === 'FreshnessConflict',
    safeAlternatives: [],
  }
  const failure =
    rejected.reason === 'ClientReadOnly' ||
    rejected.reason === 'ControlLeaseLost' ||
    rejected.reason === 'OwnerRequired'
      ? {
          _tag: 'AuthorizationFailure',
          ...common,
          reason:
            rejected.reason === 'ClientReadOnly'
              ? 'ClientReadOnly'
              : rejected.reason === 'ControlLeaseLost'
                ? 'ControlLeaseLost'
                : 'OwnerRequired',
        }
      : rejected.reason === 'IdempotencyConflict'
        ? { _tag: 'IdempotencyConflict', ...common }
        : rejected.reason === 'InvalidInput'
          ? {
              _tag: 'InvalidInput',
              ...common,
              reason: 'ProposedChangeInvalid',
            }
          : {
              _tag: 'FreshnessConflict',
              ...common,
              reason: 'ReconnectRequired',
            }
  return Schema.decodeUnknownSync(CommandFailure)(failure)
}
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
function stream(
  request: IncomingMessage,
  response: ServerResponse,
  db: DatabaseSync,
  identity: LocalIdentity,
  listeners: Map<ServerResponse, LocalIdentity>,
) {
  response.writeHead(200, {
    ...responseHeaders('text/event-stream'),
    connection: 'keep-alive',
  })
  response.write(sseProjection(db, identity))
  listeners.set(response, identity)
  const heartbeat = setInterval(() => response.write(`: heartbeat\n\n`), 15_000)
  heartbeat.unref()
  request.on('close', () => {
    clearInterval(heartbeat)
    listeners.delete(response)
  })
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
