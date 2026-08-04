import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Schema } from 'effect'

export class DatabasePathNotAppOwned extends Schema.TaggedErrorClass<DatabasePathNotAppOwned>()(
  'Database.PathNotAppOwned',
  { databasePath: Schema.String, allowedRoot: Schema.String },
) {}

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

export function openProcessorDatabase(
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
  database.exec(
    "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,claim_token TEXT,claimed_by TEXT,claim_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,retry_after TEXT,ack_at TEXT); CREATE TABLE IF NOT EXISTS control_requests (request_id TEXT PRIMARY KEY,client_id TEXT NOT NULL UNIQUE,person_id TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,target_control_capable INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS control_command_receipts (idempotency_key TEXT NOT NULL,actor_person_id TEXT NOT NULL,actor_client_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,actor_person_id,actor_client_id)); CREATE TABLE IF NOT EXISTS memberships (external_subject TEXT PRIMARY KEY,person_id TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE IF NOT EXISTS library_assets (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,role TEXT NOT NULL,format TEXT NOT NULL,availability TEXT NOT NULL,comparison_group_id TEXT NOT NULL,captured_at TEXT NOT NULL,updated_at TEXT NOT NULL,sharpness REAL NOT NULL,detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_projections (name TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS process_save_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS process_asset_events (asset_id TEXT NOT NULL,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS process_save_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS asset_publications (asset_id TEXT PRIMARY KEY,checksum TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL,object_key TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS source_ingest_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS source_ingest_events (asset_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS source_ingest_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS observing_plans (plan_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,projection TEXT NOT NULL,run_eligible INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS observing_plan_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_definitions (run_definition_id TEXT PRIMARY KEY,source_plan_id TEXT NOT NULL,source_plan_revision INTEGER NOT NULL,definition TEXT NOT NULL,accepted_at TEXT NOT NULL,UNIQUE(source_plan_id,source_plan_revision)); CREATE TABLE IF NOT EXISTS run_definition_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_intervention_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_mutation_previews (preview_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,run_revision INTEGER NOT NULL,owner_person_id TEXT NOT NULL,mutation TEXT NOT NULL,consequences TEXT NOT NULL,classification TEXT NOT NULL,expires_at TEXT NOT NULL,applied_at TEXT); CREATE TABLE IF NOT EXISTS run_mutation_preview_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id)); CREATE TABLE IF NOT EXISTS run_start_receipts (idempotency_key TEXT NOT NULL,owner_person_id TEXT NOT NULL,semantic_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,owner_person_id))",
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS acquire_sessions (run_id TEXT PRIMARY KEY,session TEXT NOT NULL); CREATE TABLE IF NOT EXISTS acquire_receipts (idempotency_key TEXT NOT NULL,actor_client_id TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(idempotency_key,actor_client_id)); CREATE TABLE IF NOT EXISTS acquire_work (attempt_id TEXT PRIMARY KEY,state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS captured_frame_receipts (idempotency_key TEXT PRIMARY KEY,semantic_key TEXT NOT NULL,response TEXT NOT NULL); CREATE TABLE IF NOT EXISTS captured_frame_events (asset_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,checksum TEXT NOT NULL); CREATE TABLE IF NOT EXISTS captured_frame_orphans (path TEXT PRIMARY KEY,checksum TEXT NOT NULL,recorded_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS frame_inspections (asset_id TEXT PRIMARY KEY,state TEXT NOT NULL,detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS asset_reviews (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,review TEXT NOT NULL); CREATE TABLE IF NOT EXISTS asset_review_receipts (asset_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(asset_id,idempotency_key))',
  )
  database.exec(
    'CREATE TABLE IF NOT EXISTS processing_workspace (id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL)',
  )
}
