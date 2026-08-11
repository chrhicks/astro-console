import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'
import type {
  AcceptedRunDefinitionRecord,
  DraftSequence,
  PlanProjection,
  PlanReadiness,
} from './domain-state.ts'
import { PlanWorkspaceProjection } from '@astro-console/protocol'
import { RunDefinition } from './run-domain.ts'
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
    const estimatedMinutes = Math.max(
      1,
      Math.ceil(sequence.definition.estimatedDurationSeconds / 60),
    )
    if (sequence.horizon === 'missing')
      limitations.push(`${prefix}horizon fact is missing.`)
    if (sequence.horizon === 'blocked')
      limitations.push(`${prefix}horizon clearance is blocked.`)
    if (sequence.storage === 'missing')
      limitations.push(`${prefix}storage forecast is missing.`)
    if (sequence.storage === 'blocked')
      limitations.push(`${prefix}storage forecast is blocked.`)
    if (sequence.window.usableMinutes < estimatedMinutes)
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
      sequence.window.usableMinutes < estimatedMinutes
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

const fixtureSequenceDefinitions = [
  {
    sequenceId: 'sequence-m27-luminance',
    targetName: 'M27 · Dumbbell Nebula',
    acquisitionMode: 'deepSkyPlateSolve' as const,
    rightAscensionHours: 19.9934,
    declinationDegrees: 22.7212,
    exposureSeconds: 180,
    frameCount: 24,
    binning: 1,
    filterName: 'L',
    earliestStart: '2026-07-25T03:18:00.000Z',
    latestEnd: '2026-07-25T05:02:00.000Z',
    minimumAltitudeDegrees: 25,
    horizonClearanceDegrees: 5,
    recenterThresholdArcsec: 30,
    maxSolveAttempts: 3,
    maxCaptureRetries: 2,
    acquireFailure: 'pause' as const,
    captureFailure: 'retry' as const,
    estimatedDurationSeconds: 4320,
    estimatedStorageBytes: 1_800_000_000,
    priority: 0,
  },
  {
    sequenceId: 'sequence-m27-color',
    targetName: 'M27 · Dumbbell Nebula',
    acquisitionMode: 'deepSkyPlateSolve' as const,
    rightAscensionHours: 19.9934,
    declinationDegrees: 22.7212,
    exposureSeconds: 180,
    frameCount: 18,
    binning: 1,
    filterName: 'RGB',
    earliestStart: '2026-07-25T03:18:00.000Z',
    latestEnd: '2026-07-25T05:02:00.000Z',
    minimumAltitudeDegrees: 25,
    horizonClearanceDegrees: 5,
    recenterThresholdArcsec: 30,
    maxSolveAttempts: 3,
    maxCaptureRetries: 2,
    acquireFailure: 'pause' as const,
    captureFailure: 'retry' as const,
    estimatedDurationSeconds: 3240,
    estimatedStorageBytes: 1_350_000_000,
    priority: 1,
  },
]

const fixtureSequences: ReadonlyArray<DraftSequence> =
  fixtureSequenceDefinitions.map((definition) => ({
    sequenceId: definition.sequenceId,
    window: {
      startsAt: '2026-07-25T03:18:00.000Z',
      endsAt: '2026-07-25T05:02:00.000Z',
      usableMinutes: 104,
      peakAltitudeDeg: 62,
      horizonClearanceDeg: 28,
    },
    horizon: 'clear',
    storage: 'available',
    definition,
  }))

const cameraSimulationDefinition = {
  sequenceId: 'sequence-m101-camera',
  targetName: 'M101 · Pinwheel Galaxy',
  acquisitionMode: 'cameraOnly' as const,
  rightAscensionHours: 14.0535,
  declinationDegrees: 54.3489,
  exposureSeconds: 15,
  frameCount: 1,
  binning: 1,
  filterName: 'No filter',
  minimumAltitudeDegrees: 20,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 30,
  maxSolveAttempts: 1,
  maxCaptureRetries: 1,
  acquireFailure: 'pause' as const,
  captureFailure: 'pause' as const,
  estimatedDurationSeconds: 15,
  estimatedStorageBytes: 51_000_000,
  priority: 0,
}

const targetSimulationDefinition = {
  sequenceId: 'sequence-ngc7000-acquire',
  targetName: 'NGC 7000 · North America Nebula',
  acquisitionMode: 'deepSkyPlateSolve' as const,
  rightAscensionHours: 20.9702585970534,
  declinationDegrees: 44.1274120130098,
  exposureSeconds: 120,
  frameCount: 1,
  binning: 1,
  filterName: 'No filter',
  minimumAltitudeDegrees: 20,
  horizonClearanceDegrees: 5,
  recenterThresholdArcsec: 5,
  maxSolveAttempts: 2,
  maxCaptureRetries: 1,
  acquireFailure: 'pause' as const,
  captureFailure: 'pause' as const,
  estimatedDurationSeconds: 255,
  estimatedStorageBytes: 55_000_000,
  priority: 0,
}

const recoverySimulationDefinition = {
  ...cameraSimulationDefinition,
  sequenceId: 'sequence-m101-acquire-recovery',
  acquisitionMode: 'deepSkyPlateSolve' as const,
  rightAscensionHours: 14.0532684955997,
  declinationDegrees: 54.3484963301173,
  maxSolveAttempts: 2,
  estimatedDurationSeconds: 50,
}

export const installDevelopmentSimulationPlan = (
  database: DatabaseSync,
  scenario: string = 'exposure-success',
) => {
  const developmentSimulationDefinition =
    scenario === 'target-evidence-progression'
      ? targetSimulationDefinition
      : scenario === 'solve-success-no-solution'
        ? recoverySimulationDefinition
        : cameraSimulationDefinition
  const sequence: DraftSequence = {
    sequenceId: developmentSimulationDefinition.sequenceId,
    window: {
      startsAt: '2026-08-08T00:00:00.000Z',
      endsAt: '2026-08-09T00:00:00.000Z',
      usableMinutes: 1440,
      peakAltitudeDeg: 72,
      horizonClearanceDeg: 35,
    },
    horizon: 'clear',
    storage: 'available',
    definition: developmentSimulationDefinition,
  }
  const plan = evaluatePlan({
    planId: 'plan-m27',
    revision: 3,
    sequences: [sequence],
  })
  database
    .prepare(
      'INSERT INTO observing_plans (plan_id,revision,projection,run_eligible) VALUES (?,?,?,0) ON CONFLICT(plan_id) DO UPDATE SET revision=excluded.revision,projection=excluded.projection,run_eligible=0',
    )
    .run(plan.planId, plan.revision, JSON.stringify(plan))
  database
    .prepare(
      "INSERT INTO workspace_projections (name,value) VALUES ('plan',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
    )
    .run(JSON.stringify(plan))
  database
    .prepare("UPDATE state SET value=? WHERE key='planRevision'")
    .run(JSON.stringify(plan.revision))
}

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
    const definition: AcceptedRunDefinitionRecord = {
      id:
        definitionKind === 'fake'
          ? 'run-definition-m27-preflight'
          : 'run-definition-m27-fixture',
      definition: Schema.decodeUnknownSync(RunDefinition)({
        runId: definitionKind === 'fake' ? 'run-m27-fake' : 'run-m27-fixture',
        executor: definitionKind,
        sourcePlanId: plan.planId,
        sourcePlanRevision: plan.revision,
        acceptedAt: '2026-07-25T00:00:00.000Z',
        acceptedLimitations: [],
        executionContext: {
          rigId: 'fixture-rig',
          mountDeviceId: 'fixture-mount',
          cameraDeviceId: 'fixture-camera',
          latitudeDegrees: 39.95,
          longitudeDegrees: -75.16,
          elevationMeters: 30,
          completionBehavior: 'hold',
          unsafeBehavior: 'pauseAndPark',
        },
        sequences: plan.sequences.map((sequence) => sequence.definition),
      }),
      plan,
    }
    database
      .prepare('INSERT OR IGNORE INTO run_definitions VALUES (?,?,?,?,?)')
      .run(
        definition.id,
        definition.definition.sourcePlanId,
        definition.definition.sourcePlanRevision,
        JSON.stringify(definition),
        definition.definition.acceptedAt,
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
