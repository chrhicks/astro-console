import { DatabaseSync } from 'node:sqlite'
import type { IncomingMessage } from 'node:http'
import {
  createPublicKey,
  createVerify,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { Schema } from 'effect'
import type {
  AdmissionObservation,
  AdmissionReason,
  LocalIdentity,
  RequestAdmission,
} from './identity.ts'

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
  resolve(
    kid: string,
    observe?: (outcome: 'success' | 'failed') => void,
  ): Promise<KeyObject | undefined>
  refresh(observe?: (outcome: 'success' | 'failed') => void): Promise<void>
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
  readonly observe?: (outcome: 'success' | 'failed') => void
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
  const refreshUnobserved = async () => {
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
  const refresh = async (
    observe:
      ((outcome: 'success' | 'failed') => void) | undefined = config.observe,
  ) => {
    try {
      await refreshUnobserved()
      observe?.('success')
    } catch (cause) {
      observe?.('failed')
      throw cause
    }
  }
  return {
    refresh,
    resolve: async (kid, observe) => {
      if (cached === undefined || now() >= expiresAt) {
        try {
          await refresh(observe)
        } catch {
          return undefined
        }
      }
      let key = cached?.get(kid)
      if (key !== undefined) return key
      if (unknownKids.has(kid)) return undefined
      try {
        await refresh(observe)
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
  observeJwks?: AdmissionObservation['jwks'],
) {
  const token = accessToken(request)
  if (token === undefined || !validClaims(config, token.claims))
    return {
      outcome: 'rejected' as const,
      reason: 'missingOrInvalidToken' as const,
    }
  const key = await config.keyResolver.resolve(token.header.kid, observeJwks)
  if (key === undefined)
    return { outcome: 'rejected' as const, reason: 'keyUnavailable' as const }
  return verifyAccessToken(token, key)
    ? { outcome: 'verified' as const, claims: token.claims }
    : { outcome: 'rejected' as const, reason: 'missingOrInvalidToken' as const }
}
export function createProductionAccessAdmission(config: {
  readonly issuer: string
  readonly audience: string
  readonly keyResolver: JwksKeyResolver
  readonly databasePath: string
  readonly clientContext: 'desktop' | 'phone'
  readonly bootstrap?: typeof MembershipBootstrap.Type
  readonly bootstrapResolver?: MembershipBootstrapResolver
  readonly observe?: (reason: AdmissionReason) => void
}): RequestAdmission {
  const staticPolicy =
    config.bootstrap === undefined
      ? undefined
      : membershipPolicy(config.bootstrap)
  if (staticPolicy === undefined && config.bootstrapResolver === undefined)
    throw new Error(
      'Production admission requires a membership bootstrap policy',
    )
  return async (request, observation) => {
    const observe = observation?.admission ?? config.observe
    const verified = await verifiedAccessClaims(
      config,
      request,
      observation?.jwks,
    )
    if (verified.outcome === 'rejected') {
      observe?.(verified.reason)
      return undefined
    }
    const claims = verified.claims
    if (claims.email === undefined) {
      observe?.('missingOrInvalidToken')
      return undefined
    }
    const policy = config.bootstrapResolver?.load() ?? staticPolicy
    if (policy === undefined) {
      observe?.('membershipUnavailable')
      return undefined
    }
    const email = claims.email
    if (email === undefined) return undefined
    const entry = policy.find((item) => item.email === normalizedEmail(email))
    if (!entry) {
      observe?.('notMember')
      return undefined
    }
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
      if (stored.person_id !== entry.personId || stored.role !== entry.role) {
        observe?.('membershipUnavailable')
        return undefined
      }
      const identity = {
        personId: stored.person_id,
        clientId: `access:${claims.sub}`,
        role: stored.role,
        capability:
          stored.role === 'owner' && config.clientContext === 'desktop'
            ? ('controlCapable' as const)
            : ('readOnly' as const),
      }
      observe?.('admitted')
      return identity
    } catch {
      try {
        membership.exec('ROLLBACK')
      } catch {}
      observe?.('membershipUnavailable')
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
