import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context, Layer, Schema } from 'effect'

const PlanMigrationRow = Schema.Struct({
  plan_id: Schema.String,
  projection: Schema.String,
})
const WorkspaceMigrationRow = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
})
const RunDefinitionMigrationRow = Schema.Struct({
  run_definition_id: Schema.String,
  definition: Schema.String,
})
const TableColumnRow = Schema.Struct({ name: Schema.String })

export class DatabasePathNotAppOwned extends Schema.TaggedErrorClass<DatabasePathNotAppOwned>()(
  'Database.PathNotAppOwned',
  { databasePath: Schema.String, allowedRoot: Schema.String },
) {}

export class OriginDatabase extends Context.Service<
  OriginDatabase,
  { readonly database: DatabaseSync }
>()('@astro-console/server/OriginDatabase') {}

export const originDatabaseLayer = (database: DatabaseSync) =>
  Layer.succeed(OriginDatabase, OriginDatabase.of({ database }))

export function openOriginDatabase(databasePath: string) {
  if (databasePath !== ':memory:')
    mkdirSync(dirname(databasePath), { recursive: true })
  return openDatabase(databasePath, 'PRAGMA journal_mode = WAL')
}

export function openPublisherDatabase(
  databasePath: string,
  allowedRoot = '/var/lib/astro-console/',
) {
  return openAppOwnedDatabase(databasePath, allowedRoot)
}

export function openAppOwnedDatabase(
  databasePath: string,
  allowedRoot: string,
) {
  if (
    !allowedRoot.startsWith('/') ||
    !allowedRoot.endsWith('/') ||
    !databasePath.startsWith(allowedRoot) ||
    /[\r\n]|(?:^|\/)\.\.(?:\/|$)/.test(databasePath)
  )
    throw new DatabasePathNotAppOwned({ databasePath, allowedRoot })
  mkdirSync(dirname(databasePath), { recursive: true })
  return openDatabase(
    databasePath,
    'PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL',
  )
}

function openDatabase(databasePath: string, pragmas: string) {
  const database = new DatabaseSync(databasePath)
  database.exec(pragmas)
  initializeSchema(database)
  return database
}

function initializeSchema(database: DatabaseSync) {
  dropRetiredProcessingData(database)
  database.exec(
    "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,claim_token TEXT,claimed_by TEXT,claim_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,retry_after TEXT,ack_at TEXT); CREATE TABLE IF NOT EXISTS control_requests (request_id TEXT PRIMARY KEY,client_id TEXT NOT NULL UNIQUE,person_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,target_control_capable INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS control_command_receipts (idempotency_key TEXT NOT NULL,actor_person_id TEXT NOT NULL,actor_client_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,actor_person_id,actor_client_id)); CREATE TABLE IF NOT EXISTS memberships (external_subject TEXT PRIMARY KEY,person_id TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE IF NOT EXISTS library_assets (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,role TEXT NOT NULL,format TEXT NOT NULL,availability TEXT NOT NULL,comparison_group_id TEXT NOT NULL,captured_at TEXT NOT NULL,updated_at TEXT NOT NULL,sharpness REAL NOT NULL,detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_projections (name TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS process_asset_events (asset_id TEXT NOT NULL,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS asset_publications (asset_id TEXT PRIMARY KEY,checksum TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,object_key TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS source_ingest_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS source_ingest_events (asset_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS source_ingest_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observing_plans (plan_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,projection TEXT NOT NULL,run_eligible INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS observing_plan_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_definitions (run_definition_id TEXT PRIMARY KEY,source_plan_id TEXT NOT NULL,source_plan_revision INTEGER NOT NULL,definition TEXT NOT NULL,accepted_at TEXT NOT NULL,UNIQUE(source_plan_id,source_plan_revision)); CREATE TABLE IF NOT EXISTS run_definition_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_intervention_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_mutation_previews (preview_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,run_revision INTEGER NOT NULL,owner_person_id TEXT NOT NULL,mutation TEXT NOT NULL,consequences TEXT NOT NULL,classification TEXT NOT NULL,expires_at TEXT NOT NULL,applied_at TEXT); CREATE TABLE IF NOT EXISTS run_mutation_preview_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_start_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))",
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS acquire_sessions (run_id TEXT PRIMARY KEY,session TEXT NOT NULL); CREATE TABLE IF NOT EXISTS acquire_receipts (idempotency_key TEXT NOT NULL,actor_client_id TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,actor_client_id)); CREATE TABLE IF NOT EXISTS camera_observations (run_id TEXT PRIMARY KEY,observation TEXT NOT NULL); CREATE TABLE IF NOT EXISTS acquire_work (attempt_id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS plate_solve_runs (attempt_id TEXT PRIMARY KEY,source_asset_id TEXT NOT NULL,evidence TEXT NOT NULL); CREATE TABLE IF NOT EXISTS captured_frame_receipts (idempotency_key TEXT PRIMARY KEY,semantic_key TEXT NOT NULL,response TEXT NOT NULL); CREATE TABLE IF NOT EXISTS captured_frame_events (asset_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS captured_frame_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS frame_inspections (asset_id TEXT PRIMARY KEY,state TEXT NOT NULL,detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS asset_reviews (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,review TEXT NOT NULL); CREATE TABLE IF NOT EXISTS asset_review_receipts (asset_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(asset_id,idempotency_key))',
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS configured_acquire_work (effect_id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL)',
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS processing_work (work_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,stage TEXT,checkpoint TEXT,claim_token TEXT,enqueued_at TEXT NOT NULL,claimed_at TEXT,settled_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT)',
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS processing_artifacts (artifact_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,work_id TEXT NOT NULL,output_id TEXT,path TEXT NOT NULL,checksum TEXT NOT NULL,saved INTEGER NOT NULL DEFAULT 0)',
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS processing_projects (project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,project TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS processing_project_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))',
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS run_executor_work (work_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,command_attempted_at TEXT,acknowledged_at TEXT,settled_at TEXT,last_error TEXT)',
  )
  migrateStructuredRunDefinitions(database)
}

function dropRetiredProcessingData(database: DatabaseSync) {
  const columns = (table: string) =>
    Schema.decodeUnknownSync(Schema.Array(TableColumnRow))(
      database.prepare(`PRAGMA table_info(${table})`).all(),
    ).map((row) => row.name)
  const projects = columns('processing_projects')
  const receipts = columns('processing_project_receipts')
  const work = columns('processing_work')
  const artifacts = columns('processing_artifacts')
  const incompatible =
    (projects.length > 0 && !projects.includes('project')) ||
    (receipts.length > 0 && !receipts.includes('semantic_key')) ||
    (work.length > 0 &&
      (!work.includes('project_id') || work.includes('session_id'))) ||
    (artifacts.length > 0 &&
      (!artifacts.includes('project_id') || artifacts.includes('session_id')))
  if (incompatible)
    database.exec(
      'DROP TABLE IF EXISTS processing_projects; DROP TABLE IF EXISTS processing_project_receipts; DROP TABLE IF EXISTS processing_work; DROP TABLE IF EXISTS processing_artifacts',
    )
  database.exec(
    'DROP TABLE IF EXISTS processing_workspace; DROP TABLE IF EXISTS process_save_receipts; DROP TABLE IF EXISTS process_save_orphans',
  )
}

function migrateStructuredRunDefinitions(database: DatabaseSync) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const planRows = Schema.decodeUnknownSync(Schema.Array(PlanMigrationRow))(
      database.prepare('SELECT plan_id,projection FROM observing_plans').all(),
    )
    for (const row of planRows) {
      const plan = parseRecord(row.projection)
      const upgraded = upgradePlan(plan)
      if (upgraded !== plan)
        database
          .prepare('UPDATE observing_plans SET projection=? WHERE plan_id=?')
          .run(JSON.stringify(upgraded), row.plan_id)
    }

    const workspaceRows = Schema.decodeUnknownSync(
      Schema.Array(WorkspaceMigrationRow),
    )(
      database
        .prepare(
          "SELECT name,value FROM workspace_projections WHERE name='plan'",
        )
        .all(),
    )
    for (const row of workspaceRows) {
      const plan = parseRecord(row.value)
      const upgraded = upgradePlan(plan)
      if (upgraded !== plan)
        database
          .prepare('UPDATE workspace_projections SET value=? WHERE name=?')
          .run(JSON.stringify(upgraded), row.name)
    }

    const definitionRows = Schema.decodeUnknownSync(
      Schema.Array(RunDefinitionMigrationRow),
    )(
      database
        .prepare('SELECT run_definition_id,definition FROM run_definitions')
        .all(),
    )
    for (const row of definitionRows) {
      const stored = parseRecord(row.definition)
      if (stored === undefined) continue
      const plan = upgradePlan(recordValue(stored, 'plan'))
      if (plan === undefined) continue
      const currentDefinition = recordValue(stored, 'definition')
      const definition =
        currentDefinition === undefined
          ? upgradeLegacyDefinition(stored, plan, row.run_definition_id)
          : currentDefinition
      if (definition === undefined) continue
      if (
        currentDefinition === undefined ||
        plan !== recordValue(stored, 'plan')
      )
        database
          .prepare(
            'UPDATE run_definitions SET definition=? WHERE run_definition_id=?',
          )
          .run(
            JSON.stringify({
              id: stringValue(stored, 'id') ?? row.run_definition_id,
              definition,
              plan,
            }),
            row.run_definition_id,
          )
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function upgradePlan(plan: unknown): Record<string, unknown> | undefined {
  if (!isRecord(plan) || !Array.isArray(plan.sequences)) return undefined
  let changed = false
  const sequences = plan.sequences.map((value, index) => {
    if (!isRecord(value) || isRecord(value.definition)) return value
    changed = true
    return { ...value, definition: deriveSequenceDefinition(value, index) }
  })
  return changed ? { ...plan, sequences } : plan
}

function upgradeLegacyDefinition(
  stored: Record<string, unknown>,
  plan: Record<string, unknown>,
  definitionId: string,
) {
  const executor = stringValue(stored, 'executor')
  const sourcePlanId = stringValue(stored, 'sourcePlanId')
  const sourcePlanRevision = numberValue(stored, 'sourcePlanRevision')
  const acceptedAt = stringValue(stored, 'acceptedAt')
  if (
    (executor !== 'fake' && executor !== 'fixture') ||
    sourcePlanId === undefined ||
    sourcePlanRevision === undefined ||
    acceptedAt === undefined ||
    !Array.isArray(plan.sequences)
  )
    return undefined
  const sequences = plan.sequences
    .map((sequence) => recordValue(sequence, 'definition'))
    .filter(isRecord)
  if (sequences.length === 0) return undefined
  const requiresSite = sequences.some(
    (sequence) => sequence.acquisitionMode === 'deepSkyPlateSolve',
  )
  return {
    runId: executor === 'fixture' ? 'run-m27-001' : `run-${definitionId}`,
    executor,
    sourcePlanId,
    sourcePlanRevision,
    acceptedAt,
    acceptedLimitations: Array.isArray(plan.limitations)
      ? plan.limitations
          .filter((summary): summary is string => typeof summary === 'string')
          .map((summary, index) => ({
            limitationId: `legacy-limitation-${index + 1}`,
            summary,
          }))
      : [],
    executionContext: {
      rigId: `legacy-${executor}-rig`,
      cameraDeviceId: `legacy-${executor}-camera`,
      ...(requiresSite
        ? {
            mountDeviceId: `legacy-${executor}-mount`,
            latitudeDegrees: 0,
            longitudeDegrees: 0,
            elevationMeters: 0,
          }
        : {}),
      completionBehavior: 'hold',
      unsafeBehavior: 'pauseAndPark',
    },
    sequences,
  }
}

function deriveSequenceDefinition(
  sequence: Record<string, unknown>,
  priority: number,
) {
  const capture = stringValue(sequence, 'capture') ?? ''
  const captureMatch = capture.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)s/i)
  const windowValue = recordValue(sequence, 'window')
  const window = isRecord(windowValue) ? windowValue : undefined
  const acquisition = stringValue(sequence, 'acquisition') ?? ''
  const estimatedMinutes = numberValue(sequence, 'estimatedMinutes') ?? 1
  const storageForecastMb = numberValue(sequence, 'storageForecastMb') ?? 1
  return {
    sequenceId:
      stringValue(sequence, 'sequenceId') ?? `legacy-sequence-${priority + 1}`,
    targetName: stringValue(sequence, 'target') ?? 'Legacy target',
    acquisitionMode: /solve|center/i.test(acquisition)
      ? 'deepSkyPlateSolve'
      : 'cameraOnly',
    rightAscensionHours: 0,
    declinationDegrees: 0,
    exposureSeconds: captureMatch === null ? 1 : Number(captureMatch[2]),
    frameCount: captureMatch === null ? 1 : Number(captureMatch[1]),
    binning: 1,
    ...(typeof window?.['startsAt'] === 'string'
      ? { earliestStart: window['startsAt'] }
      : {}),
    ...(typeof window?.['endsAt'] === 'string'
      ? { latestEnd: window['endsAt'] }
      : {}),
    minimumAltitudeDegrees: 0,
    horizonClearanceDegrees: 0,
    recenterThresholdArcsec: 30,
    maxSolveAttempts: 1,
    maxCaptureRetries: 0,
    acquireFailure: 'pause',
    captureFailure: 'pause',
    estimatedDurationSeconds: Math.max(1, estimatedMinutes * 60),
    estimatedStorageBytes: Math.max(
      1,
      Math.round(storageForecastMb * 1_000_000),
    ),
    priority,
  }
}

function parseRecord(value: string) {
  const parsed: unknown = JSON.parse(value)
  return isRecord(parsed) ? parsed : undefined
}

function recordValue(value: unknown, key: string) {
  return isRecord(value) && key in value ? value[key] : undefined
}

function stringValue(value: unknown, key: string) {
  const candidate = recordValue(value, key)
  return typeof candidate === 'string' ? candidate : undefined
}

function numberValue(value: unknown, key: string) {
  const candidate = recordValue(value, key)
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
