import { DatabaseSync } from 'node:sqlite'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  BootstrapSnapshot,
  BootstrapSseEventEnvelope,
  PlanWorkspaceProjection,
  PreflightSnapshot,
} from '@astro-console/protocol'
import type { Evidence, Snapshot } from '../services/domain-state.ts'
import type { LocalIdentity } from '../auth/identity.ts'

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
const StoredRun = Schema.Struct({
  id: Schema.String,
  revision: Schema.Int,
  phase: Schema.Literals([
    'preflight',
    'acquire',
    'capture',
    'verify',
    'recover',
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
    Schema.Literals(['preflight', 'acquire', 'capture', 'verify', 'recover']),
  ),
  retryPhase: Schema.optionalKey(
    Schema.Literals(['preflight', 'acquire', 'capture', 'verify', 'recover']),
  ),
  appliedMutations: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        previewId: Schema.String,
        kind: Schema.Literals([
          'reprioritizeSecond',
          'shortenSecond',
          'discardCurrent',
        ]),
      }),
    ),
  ),
  preflight: Schema.optionalKey(PreflightSnapshot),
})
const StoredState = Schema.Struct({
  snapshotVersion: Schema.Int,
  eventCursor: Schema.Int,
  planRevision: Schema.Int,
  leaseRevision: Schema.Int,
  leaseHolder: Schema.NullOr(Schema.String),
  leaseState: Schema.Literals(['held', 'reconnecting', 'unheld']),
  reconnectGraceUntil: Schema.NullOr(Schema.String),
  run: Schema.NullOr(StoredRun),
  evidence: StoredEvidence,
})
const StoredRow = Schema.Struct({ value: Schema.String })
const StoredRequest = Schema.Struct({
  request_id: Schema.String,
  client_id: Schema.String,
  person_id: Schema.String,
  created_at: Schema.String,
  expires_at: Schema.String,
  target_control_capable: Schema.Int,
})
const ObservingPlanRow = Schema.Struct({
  plan_id: Schema.String,
  revision: Schema.Int,
  projection: Schema.String,
  run_eligible: Schema.Int,
})

export type StateProjection = (
  db: DatabaseSync,
  identity: LocalIdentity,
  current: Snapshot,
) => unknown | undefined
export interface StateSqliteRepositoryShape {
  readonly state: () => Omit<
    Snapshot,
    'generatedAt' | 'identity' | 'connection'
  >
  readonly snapshot: (identity: LocalIdentity) => Snapshot
  readonly bootstrapSnapshot: (
    identity: LocalIdentity,
  ) => Effect.Effect<typeof BootstrapSnapshot.Type, Schema.SchemaError>
  readonly readiness: () => ReturnType<typeof projectReadiness>
  readonly operations: () => ReturnType<typeof projectOperations>
  readonly controllerConnected: (identity: LocalIdentity) => void
  readonly controllerDisconnected: (identity: LocalIdentity) => void
  readonly expireReconnectGrace: () => void
  readonly projectionEvent: (
    identity: LocalIdentity,
  ) => BootstrapSseEventEnvelope
  readonly commit: (values: Record<string, unknown>) => void
  readonly advanceProjectionCursor: () => number
  readonly persistEvidence: (
    evidence: Evidence,
    identity: () => LocalIdentity,
  ) => Snapshot
  readonly persistPreflight: (snapshot: typeof PreflightSnapshot.Type) => {
    readonly cursor: number
  }
}
export class StateSqliteRepository extends Context.Service<
  StateSqliteRepository,
  StateSqliteRepositoryShape
>()('@astro-console/server/StateSqliteRepository') {}

export const stateSqliteRepositoryLayer = (
  db: DatabaseSync,
  projections: {
    readonly plan: StateProjection
    readonly observe: StateProjection
  },
) =>
  Layer.sync(StateSqliteRepository, () => {
    const storedValue = (key: string): unknown => {
      const row = Schema.decodeUnknownSync(Schema.optional(StoredRow))(
        db.prepare('SELECT value FROM state WHERE key=?').get(key),
      )
      if (row === undefined) throw new Error(`Missing stored state: ${key}`)
      return JSON.parse(row.value)
    }
    const commit = (values: Record<string, unknown>) => {
      const put = db.prepare('UPDATE state SET value=? WHERE key=?')
      for (const [key, value] of Object.entries(values))
        put.run(JSON.stringify(value), key)
    }
    const advanceProjectionCursor = () => {
      const current = state()
      const cursor = current.eventCursor + 1
      db.exec('BEGIN IMMEDIATE')
      try {
        commit({
          snapshotVersion: current.snapshotVersion + 1,
          eventCursor: cursor,
        })
        db.exec('COMMIT')
        return cursor
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const expireControlRequests = () => {
      db.prepare('DELETE FROM control_requests WHERE expires_at<=?').run(
        new Date().toISOString(),
      )
    }
    const state = (): Omit<
      Snapshot,
      'generatedAt' | 'identity' | 'connection'
    > => {
      expireControlRequests()
      const stored = Schema.decodeUnknownSync(StoredState)({
        snapshotVersion: storedValue('snapshotVersion'),
        eventCursor: storedValue('eventCursor'),
        planRevision: storedValue('planRevision'),
        leaseRevision: storedValue('leaseRevision'),
        leaseHolder: storedValue('leaseHolder'),
        leaseState: storedValue('leaseState'),
        reconnectGraceUntil: storedValue('reconnectGraceUntil'),
        run: storedValue('run'),
        evidence: storedValue('evidence'),
      })
      const requests = Schema.decodeUnknownSync(Schema.Array(StoredRequest))(
        db
          .prepare(
            'SELECT request_id,client_id,person_id,created_at,expires_at,target_control_capable FROM control_requests ORDER BY client_id',
          )
          .all(),
      )
      const storedPlan = Schema.decodeUnknownSync(
        Schema.optional(ObservingPlanRow),
      )(
        db
          .prepare(
            "SELECT plan_id,revision,projection,run_eligible FROM observing_plans WHERE plan_id='plan-m27'",
          )
          .get(),
      )
      const projection =
        storedPlan === undefined
          ? undefined
          : Schema.decodeUnknownSync(PlanWorkspaceProjection)(
              JSON.parse(storedPlan.projection),
            )
      return {
        snapshotVersion: stored.snapshotVersion,
        eventCursor: stored.eventCursor,
        plan:
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
                target:
                  projection.sequences[0]?.definition.targetName ??
                  'Observation plan',
                readiness: projection.readiness,
                runEligible: storedPlan.run_eligible === 1,
              },
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
    const expireReconnectGrace = () => {
      const grace = storedValue('reconnectGraceUntil'),
        leaseState = storedValue('leaseState')
      if (
        typeof grace !== 'string' ||
        leaseState !== 'reconnecting' ||
        Date.parse(grace) > Date.now()
      )
        return
      db.exec('BEGIN IMMEDIATE')
      try {
        const currentGrace = storedValue('reconnectGraceUntil'),
          currentState = storedValue('leaseState'),
          previousHolder = storedValue('leaseHolder')
        if (
          typeof currentGrace !== 'string' ||
          currentState !== 'reconnecting' ||
          Date.parse(currentGrace) > Date.now()
        ) {
          db.exec('COMMIT')
          return
        }
        if (typeof previousHolder !== 'string') {
          db.exec('ROLLBACK')
          return
        }
        const cursor = Number(storedValue('eventCursor')) + 1
        commit({
          snapshotVersion: Number(storedValue('snapshotVersion')) + 1,
          eventCursor: cursor,
          leaseRevision: Number(storedValue('leaseRevision')) + 1,
          leaseHolder: null,
          leaseState: 'unheld',
          reconnectGraceUntil: null,
        })
        db.prepare('INSERT INTO events VALUES (?,?,?)').run(
          cursor,
          'ControlLeaseExpired',
          JSON.stringify({
            _tag: 'ControlLeaseExpired',
            previousHolderClientId: previousHolder,
          }),
        )
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const controllerConnected = (identity: LocalIdentity) => {
      const current = state()
      if (
        current.control.holderClientId !== identity.clientId ||
        current.control.state !== 'reconnecting'
      )
        return
      db.exec('BEGIN IMMEDIATE')
      try {
        commit({
          snapshotVersion: current.snapshotVersion + 1,
          eventCursor: current.eventCursor + 1,
          leaseState: 'held',
          reconnectGraceUntil: null,
        })
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const controllerDisconnected = (identity: LocalIdentity) => {
      const current = state()
      if (
        current.control.holderClientId !== identity.clientId ||
        current.control.state !== 'held'
      )
        return
      db.exec('BEGIN IMMEDIATE')
      try {
        commit({
          snapshotVersion: current.snapshotVersion + 1,
          eventCursor: current.eventCursor + 1,
          leaseState: 'reconnecting',
          reconnectGraceUntil: new Date(Date.now() + 60_000).toISOString(),
        })
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const snapshot = (identity: LocalIdentity): Snapshot => ({
      ...state(),
      generatedAt: new Date().toISOString(),
      identity,
      connection: 'current',
    })
    const bootstrapSnapshot = (identity: LocalIdentity) => {
      const current = snapshot(identity),
        observedAt = current.generatedAt
      const plan =
        current.plan.readiness === 'unavailable'
          ? undefined
          : projections.plan(db, identity, current)
      const observe =
        current.run === null
          ? undefined
          : projections.observe(db, identity, current)
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
          pendingRequests: current.control.pendingRequests,
        },
        ...(plan === undefined ? {} : { plan }),
        ...(observe === undefined ? {} : { observe }),
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
                  completedSequenceCount:
                    current.run.completedSequenceCount ?? 0,
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
    const projectionEvent = (identity: LocalIdentity) =>
      Effect.runSync(
        bootstrapSnapshot(identity).pipe(
          Effect.flatMap((data) =>
            Schema.decodeUnknownEffect(BootstrapSseEventEnvelope)({
              id: data.eventCursor,
              event: 'ProjectionChanged',
              data,
            }),
          ),
        ),
      )
    const readiness = () => projectReadiness(state())
    const operations = () => projectOperations(state())
    const persistEvidence = (
      evidence: Evidence,
      identity: () => LocalIdentity,
    ) => {
      const current = state()
      db.exec('BEGIN IMMEDIATE')
      try {
        commit({
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
        return snapshot(identity())
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    const persistPreflight = (preflight: typeof PreflightSnapshot.Type) => {
      const current = state()
      if (current.run === null) throw new Error('No active run')
      const cursor = current.eventCursor + 1
      db.exec('BEGIN IMMEDIATE')
      try {
        commit({
          run: { ...current.run, preflight },
          snapshotVersion: current.snapshotVersion + 1,
          eventCursor: cursor,
        })
        db.prepare('INSERT INTO events VALUES (?,?,?)').run(
          cursor,
          'PreflightRefreshed',
          JSON.stringify(preflight),
        )
        db.exec('COMMIT')
        return { cursor }
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    return {
      state,
      snapshot,
      bootstrapSnapshot,
      readiness,
      operations,
      controllerConnected,
      controllerDisconnected,
      expireReconnectGrace,
      projectionEvent,
      commit,
      advanceProjectionCursor,
      persistEvidence,
      persistPreflight,
    }
  })

const projectReadiness = (
  current: Omit<Snapshot, 'generatedAt' | 'identity' | 'connection'>,
) =>
  current.plan.readiness === 'unavailable'
    ? {
        status: 'unavailable' as const,
        service: 'ready' as const,
        database: 'ready' as const,
        rig: 'unknown' as const,
        tunnel: 'unknown' as const,
        activeRun: 'none' as const,
        message:
          'Service and local database are ready, but no observation plan or fixture is installed.',
      }
    : {
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
const projectOperations = (
  current: Omit<Snapshot, 'generatedAt' | 'identity' | 'connection'>,
) => ({
  release: 'server',
  schemaVersion: 'current',
  sqlite: { journalMode: 'wal', checkpoint: 'unknown' as const },
  snapshot: {
    version: current.snapshotVersion,
    eventCursor: current.eventCursor,
    activeRun: current.run === null ? ('none' as const) : current.run.phase,
    lease: current.control.state,
  },
  disk: 'unknown' as const,
  config:
    current.plan.readiness === 'unavailable'
      ? ('uninitialized' as const)
      : ('fixture' as const),
  rig: 'unknown' as const,
  tunnel: 'unknown' as const,
})
