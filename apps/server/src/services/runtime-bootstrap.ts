import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import type {
  DraftSequence,
  PlanProjection,
  PlanReadiness,
  RunDefinition,
} from './domain-state.ts'
import { PlanWorkspaceProjection } from '@astro-console/v2-contracts'
import { seedLibrary } from '../persistence/library-sqlite-repository.ts'

const StoredRow = Schema.Struct({ value: Schema.String })
const LatestCursorRow = Schema.Struct({ cursor: Schema.Int })

export const evaluatePlan = (input: {
  readonly planId: string
  readonly revision: number
  readonly sequences: ReadonlyArray<DraftSequence>
}): PlanProjection => {
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
  return {
    planId: input.planId,
    revision: input.revision,
    readiness,
    readinessSummary:
      readiness === 'ready'
        ? 'All supplied planning facts are viable.'
        : readiness === 'readyWithLimitations'
          ? 'The plan is usable with the named limitations.'
          : 'The plan is blocked by the named planning facts.',
    limitations,
    sequences,
  }
}

const seedState = (db: DatabaseSync, values: Record<string, unknown>) => {
  const latest = Schema.decodeUnknownSync(LatestCursorRow)(
    db.prepare('SELECT COALESCE(MAX(cursor), 0) AS cursor FROM events').get(),
  )
  const insert = db.prepare('INSERT OR IGNORE INTO state VALUES (?,?)')
  for (const [key, value] of Object.entries({
    snapshotVersion: Math.max(1, latest.cursor),
    eventCursor: latest.cursor,
    ...values,
  }))
    insert.run(key, JSON.stringify(value))
}

export const initializeRuntimeState = (db: DatabaseSync) =>
  seedState(db, {
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
  })

const seedFixtureState = (db: DatabaseSync) =>
  seedState(db, {
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
  })

const fixtureSequences: ReadonlyArray<DraftSequence> = [
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
]

const seedWorkspaces = (db: DatabaseSync) => {
  const plan = evaluatePlan({
    planId: 'plan-m27',
    revision: 3,
    sequences: fixtureSequences,
  })
  db.prepare(
    'INSERT OR IGNORE INTO observing_plans (plan_id,revision,projection) VALUES (?,?,?)',
  ).run(plan.planId, plan.revision, JSON.stringify(plan))
  db.prepare(
    'UPDATE observing_plans SET run_eligible=1 WHERE plan_id=? AND revision=?',
  ).run(plan.planId, plan.revision)
  db.prepare('INSERT OR IGNORE INTO workspace_projections VALUES (?,?)').run(
    'plan',
    JSON.stringify(plan),
  )
}

export const installM27Fixture = (
  database: DatabaseSync,
  definitionKind: 'fixture' | 'fake' | false = 'fixture',
) => {
  seedFixtureState(database)
  seedLibrary(database)
  seedWorkspaces(database)
  const raw: unknown = database
    .prepare("SELECT value FROM workspace_projections WHERE name='plan'")
    .get()
  try {
    const plan = Schema.decodeUnknownSync(PlanWorkspaceProjection)(
      JSON.parse(Schema.decodeUnknownSync(StoredRow)(raw).value),
    )
    if (definitionKind === false) return
    const definition: RunDefinition = {
      id:
        definitionKind === 'fake'
          ? 'run-definition-m27-preflight'
          : 'run-definition-m27-fixture',
      sourcePlanId: plan.planId,
      sourcePlanRevision: plan.revision,
      acceptedAt: '2026-07-25T00:00:00.000Z',
      executor: definitionKind,
      plan,
    }
    database
      .prepare('INSERT OR IGNORE INTO run_definitions VALUES (?,?,?,?,?)')
      .run(
        definition.id,
        definition.sourcePlanId,
        definition.sourcePlanRevision,
        JSON.stringify(definition),
        definition.acceptedAt,
      )
  } catch {}
}

export const planWorkspaceProjection = (
  db: DatabaseSync,
  name: 'plan' = 'plan',
) =>
  Schema.decodeUnknownSync(PlanWorkspaceProjection)(
    JSON.parse(
      Schema.decodeUnknownSync(StoredRow)(
        db
          .prepare('SELECT value FROM workspace_projections WHERE name=?')
          .get(name),
      ).value,
    ),
  )
