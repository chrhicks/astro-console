import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import { decodeSeestarPushEvent } from 'seestar-sdk'
import type { LocalIdentity } from './identity.ts'

const SolarTestIntentInput = Schema.Struct({
  name: Schema.NonEmptyString.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(120),
  ),
  idempotencyKey: Schema.NonEmptyString.check(Schema.isMaxLength(128)),
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
const MembershipRow = Schema.Struct({
  person_id: Schema.String,
  role: Schema.String,
})

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

export interface SolarTestAdapter {
  readonly startSolarTestObservation: (
    work: typeof SolarTestWork.Type,
  ) => Promise<'providerAcknowledged' | 'uncertain'>
  readonly stopSolarTestObservation: (intentId: string) => Promise<boolean>
}

export interface SolarWorkServiceShape {
  readonly dispatchStart: (
    adapter: SolarTestAdapter | undefined,
    workerId: string,
  ) => Effect.Effect<
    'providerAcknowledged' | 'uncertain' | 'none' | 'superseded' | 'unavailable'
  >
  readonly dispatchStop: (
    adapter: SolarTestAdapter | undefined,
    workerId: string,
  ) => Effect.Effect<'dispatched' | 'failed' | 'none' | 'superseded'>
  readonly recordStackEvidence: (
    intentId: string,
    raw: unknown,
    observedAt: string,
  ) => Effect.Effect<boolean>
  readonly requestStop: (intentId: string) => Effect.Effect<boolean>
  readonly resolveCliIdentity: (
    externalSubject: string,
  ) => Effect.Effect<LocalIdentity | undefined>
  readonly submitIntent: (
    raw: unknown,
    identity: LocalIdentity,
  ) => Effect.Effect<SolarTestIntentResult>
}

export class SolarWorkService extends Context.Service<
  SolarWorkService,
  SolarWorkServiceShape
>()('@astro-console/server/SolarWorkService') {}

export const solarWorkServiceLayer = (database: DatabaseSync) =>
  Layer.effect(
    SolarWorkService,
    Effect.sync(() => {
      const transaction = <A>(operation: () => A) => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const value = operation()
          database.exec('COMMIT')
          return value
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      }
      const dispatchStop = Effect.fn('SolarWorkService.dispatchStop')(
        function* (adapter: SolarTestAdapter | undefined, workerId: string) {
          const token = randomUUID()
          const row = transaction(() => {
            const now = new Date().toISOString()
            database
              .prepare(
                "UPDATE outbox SET state='failed',claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error='claim expired',retry_after=? WHERE kind='StopSolarTestObservation' AND state='claimed' AND claim_until<=?",
              )
              .run(now, now)
            const raw = database
              .prepare(
                "SELECT id,payload FROM outbox WHERE kind='StopSolarTestObservation' AND state IN ('pending','failed') AND (retry_after IS NULL OR retry_after<=?) ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END,rowid LIMIT 1",
              )
              .get(now)
            const next = Schema.decodeUnknownSync(
              Schema.optional(OutboxClaimRow),
            )(raw)
            if (next === undefined) return undefined
            const claimed = database
              .prepare(
                "UPDATE outbox SET state='claimed',claim_token=?,claimed_by=?,claim_until=?,attempts=attempts+1 WHERE id=? AND state IN ('pending','failed')",
              )
              .run(
                token,
                workerId,
                new Date(Date.now() + 30_000).toISOString(),
                next.id,
              )
            return claimed.changes === 1 ? next : undefined
          })
          if (row === undefined) return 'none' as const
          let accepted = false
          try {
            accepted =
              adapter === undefined
                ? false
                : yield* Effect.promise(() =>
                    adapter.stopSolarTestObservation(
                      Schema.decodeUnknownSync(
                        Schema.Struct({ intentId: Schema.NonEmptyString }),
                      )(JSON.parse(row.payload)).intentId,
                    ),
                  )
          } catch {}
          const outcome = transaction(() => {
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
            if (accepted && acknowledged.changes === 1)
              database
                .prepare(
                  "UPDATE solar_test_intents SET state='stopped' WHERE state='stopping'",
                )
                .run()
            return acknowledged.changes === 1
              ? accepted
                ? ('dispatched' as const)
                : ('failed' as const)
              : ('superseded' as const)
          })
          return outcome
        },
      )
      const dispatchStart = Effect.fn('SolarWorkService.dispatchStart')(
        function* (adapter: SolarTestAdapter | undefined, workerId: string) {
          if (adapter === undefined) return 'unavailable' as const
          const token = randomUUID()
          const now = new Date().toISOString()
          const row = transaction(() => {
            const expired = Schema.decodeUnknownSync(
              Schema.optional(Schema.Struct({ payload: Schema.String })),
            )(
              database
                .prepare(
                  "SELECT payload FROM outbox WHERE kind='StartSolarTestObservation' AND state='claimed' AND claim_until<=? ORDER BY rowid LIMIT 1",
                )
                .get(now),
            )
            if (expired !== undefined) {
              const work = Schema.decodeUnknownSync(SolarTestWork)(
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
                .run(work.intentId)
              database
                .prepare(
                  'INSERT OR REPLACE INTO solar_test_recovery VALUES (?,?,?)',
                )
                .run(work.intentId, 'manualRecovery', now)
              database
                .prepare(
                  "UPDATE solar_test_evidence SET state='uncertain',message=?,observed_at=? WHERE intent_id=?",
                )
                .run(
                  'Solar worker lease expired after a provider call may have started. Do not retry automatically; inspect the physical rig and recover manually.',
                  now,
                  work.intentId,
                )
            }
            const raw = database
              .prepare(
                "SELECT id,payload FROM outbox WHERE kind='StartSolarTestObservation' AND state='pending' ORDER BY rowid LIMIT 1",
              )
              .get()
            const next = Schema.decodeUnknownSync(
              Schema.optional(OutboxClaimRow),
            )(raw)
            if (next === undefined) return undefined
            const claimed = database
              .prepare(
                "UPDATE outbox SET state='claimed',claim_token=?,claimed_by=?,claim_until=?,attempts=attempts+1 WHERE id=? AND state='pending'",
              )
              .run(
                token,
                workerId,
                new Date(Date.now() + 30_000).toISOString(),
                next.id,
              )
            return claimed.changes === 1 ? next : undefined
          })
          if (row === undefined) return 'none' as const
          const work = Schema.decodeUnknownSync(SolarTestWork)(
            JSON.parse(row.payload),
          )
          let providerOutcome: 'providerAcknowledged' | 'uncertain'
          try {
            providerOutcome = yield* Effect.promise(() =>
              adapter.startSolarTestObservation(work),
            )
          } catch {
            providerOutcome = 'uncertain'
          }
          return transaction(() => {
            if (providerOutcome === 'providerAcknowledged') {
              const acknowledgedAt = new Date().toISOString()
              const acknowledged = database
                .prepare(
                  "UPDATE outbox SET state='dispatched',ack_at=?,claim_token=NULL,claimed_by=NULL,claim_until=NULL,last_error=NULL WHERE id=? AND state='claimed' AND claim_token=?",
                )
                .run(acknowledgedAt, row.id, token)
              if (acknowledged.changes === 1) {
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
                .prepare(
                  'INSERT OR REPLACE INTO solar_test_recovery VALUES (?,?,?)',
                )
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
            return uncertain.changes === 1
              ? ('uncertain' as const)
              : ('superseded' as const)
          })
        },
      )
      const recordStackEvidence = Effect.fn(
        'SolarWorkService.recordStackEvidence',
      )(function* (intentId: string, raw: unknown, observedAt: string) {
        const event = decodeSeestarPushEvent(raw)
        if (
          event?.Event !== 'Stack' ||
          !Number.isFinite(event.stacked_frame ?? event.stacked_frames) ||
          (event.code !== undefined && event.code !== 0)
        )
          return false
        return transaction(() => {
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
          return updated.changes === 1
        })
      })
      const requestStop = Effect.fn('SolarWorkService.requestStop')(function* (
        intentId: string,
      ) {
        return transaction(() => {
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
          return changed.changes === 1
        })
      })
      const resolveCliIdentity = Effect.fn(
        'SolarWorkService.resolveCliIdentity',
      )(function* (externalSubject: string) {
        const membership = Schema.decodeUnknownSync(
          Schema.optional(MembershipRow),
        )(
          database
            .prepare(
              'SELECT person_id,role FROM memberships WHERE external_subject=?',
            )
            .get(externalSubject),
        )
        return membership?.role === 'owner'
          ? {
              personId: membership.person_id,
              clientId: 'solar-test-cli',
              role: 'owner' as const,
              capability: 'controlCapable' as const,
            }
          : undefined
      })
      const submitIntent = Effect.fn('SolarWorkService.submitIntent')(
        function* (raw: unknown, identity: LocalIdentity) {
          if (identity.role !== 'owner')
            return { outcome: 'rejected', reason: 'OwnerRequired' } as const
          if (identity.capability !== 'controlCapable')
            return { outcome: 'rejected', reason: 'ClientReadOnly' } as const
          const input = Schema.decodeUnknownResult(SolarTestIntentInput)(raw)
          if (Result.isFailure(input))
            return { outcome: 'rejected', reason: 'InvalidInput' } as const
          const decoded = input.success
          const semanticKey = createHash('sha256')
            .update(
              JSON.stringify({
                version: 1,
                name: decoded.name,
                ownerPersonId: identity.personId,
              }),
            )
            .digest('hex')
          const existing = Schema.decodeUnknownSync(
            Schema.optional(SolarTestIntentRow),
          )(
            database
              .prepare(
                'SELECT intents.intent_id,intents.name,intents.owner_person_id,intents.semantic_key,intents.state,evidence.state AS evidence_state FROM solar_test_intents AS intents JOIN solar_test_evidence AS evidence ON evidence.intent_id=intents.intent_id WHERE intents.idempotency_key=? AND intents.owner_person_id=?',
              )
              .get(decoded.idempotencyKey, identity.personId),
          )
          if (existing !== undefined)
            return existing.semantic_key === semanticKey
              ? ({
                  outcome: 'accepted',
                  intentId: existing.intent_id,
                  name: existing.name,
                  state: existing.state,
                  evidence: existing.evidence_state,
                } as const)
              : ({ outcome: 'rejected', reason: 'InvalidInput' } as const)
          return transaction(() => {
            const pending = Schema.decodeUnknownSync(CountRow)(
              database
                .prepare(
                  "SELECT count(*) AS count FROM solar_test_intents WHERE state='awaitingAdapter'",
                )
                .get(),
            )
            if (pending.count !== 0)
              return {
                outcome: 'rejected',
                reason: 'SolarTestPending',
              } as const
            const intentId = randomUUID()
            const acceptedAt = new Date().toISOString()
            database
              .prepare(
                'INSERT INTO solar_test_intents VALUES (?,?,?,?,?,?,?,?)',
              )
              .run(
                intentId,
                decoded.idempotencyKey,
                decoded.name,
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
              .prepare(
                'INSERT INTO outbox (id,kind,payload,state) VALUES (?,?,?,?)',
              )
              .run(
                randomUUID(),
                'StartSolarTestObservation',
                JSON.stringify({
                  intentId,
                  name: decoded.name,
                  target: 'Sun',
                  requiredEvidence: 'Stack',
                }),
                'pending',
              )
            return {
              outcome: 'accepted',
              intentId,
              name: decoded.name,
              state: 'awaitingAdapter',
              evidence: 'awaitingStackEvidence',
            } as const
          })
        },
      )
      return SolarWorkService.of({
        dispatchStart,
        dispatchStop,
        recordStackEvidence,
        requestStop,
        resolveCliIdentity,
        submitIntent,
      })
    }),
  )

export const createSolarWorkService = (database: DatabaseSync) =>
  Effect.runSync(
    SolarWorkService.pipe(Effect.provide(solarWorkServiceLayer(database))),
  )
