import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import type { IncomingMessage } from "node:http"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import * as Schema from "effect/Schema"
import { AcquireSnapshot, RunSnapshot } from "../../../packages/v2-contracts/src/snapshots.ts"
import { configuredAdmission, configuredListenHost, configuredListenPort, configuredRuntime, createJwksKeyResolver, createLocalWebService, createMembershipBootstrapResolver, createProductionAccessAdmission } from "./server.ts"
import { createRigWorkerService, runRigWorkerFromEnvironment } from "./rig-worker.ts"
import { rigWorkerConfig } from "./rig-worker-config.ts"
import { runSolarTestIntentFromEnvironment } from "./solar-test.ts"
import { createSeestarSolarAdapter } from "./seestar-solar-adapter.ts"
import { createPublisherWorker } from "./publisher-worker.ts"
import { createStorageOperations } from "./storage-operations.ts"

test("local storage operations measure thresholded capture safety and clean only bounded recorded scratch orphans", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-storage-")); const scratch = join(root, "scratch"); const outputs = join(root, "outputs"); const originals = join(root, "originals"); const finals = join(root, "finals"); mkdirSync(scratch); mkdirSync(outputs); mkdirSync(originals); mkdirSync(finals)
  const databasePath = join(root, "state.sqlite"); const service = createLocalWebService(databasePath)
  writeFileSync(join(scratch, "eligible.tmp"), "scratch"); writeFileSync(join(scratch, "later.tmp"), "later"); writeFileSync(join(outputs, "orphan.tiff"), "orphan"); writeFileSync(join(originals, "raw.fits"), "original"); writeFileSync(join(finals, "final.tiff"), "final")
  symlinkSync(join(root, "outside"), join(scratch, "link.tmp")); writeFileSync(join(root, "outside"), "outside")
  service.database.prepare("INSERT INTO storage_scratch_entries VALUES (?,?)").run(join(scratch, "eligible.tmp"), "2000-01-01T00:00:00.000Z"); service.database.prepare("INSERT INTO storage_scratch_entries VALUES (?,?)").run(join(scratch, "later.tmp"), "2999-01-01T00:00:00.000Z"); service.database.prepare("INSERT INTO storage_scratch_entries VALUES (?,?)").run(join(scratch, "link.tmp"), "2000-01-01T00:00:00.000Z"); service.database.prepare("INSERT INTO process_save_orphans VALUES (?,?,?)").run(join(outputs, "orphan.tiff"), "checksum", "2000-01-01T00:00:00.000Z")
  let measurements = { freeBytes: 90, freeInodes: 90, writeLatencyMs: 4 }
  const operations = createStorageOperations(service.database, { scratchRoot: scratch, outputsRoot: outputs, cleanupBatchSize: 8, thresholds: { noticeFreeBytes: 100, blockFreeBytes: 50, criticalFreeBytes: 10, noticeFreeInodes: 100, blockFreeInodes: 50, criticalFreeInodes: 10, noticeWriteLatencyMs: 5, blockWriteLatencyMs: 10, criticalWriteLatencyMs: 20 }, probe: { freeBytes: () => measurements.freeBytes, freeInodes: () => measurements.freeInodes, writeLatencyMs: () => measurements.writeLatencyMs } })
  assert.deepEqual(operations.health(), { ...measurements, state: "notice", capture: "allow" })
  measurements = { freeBytes: 40, freeInodes: 90, writeLatencyMs: 4 }; assert.equal(operations.health().capture, "blockNewLongWork")
  measurements = { freeBytes: 90, freeInodes: 90, writeLatencyMs: 21 }; assert.equal(operations.health().capture, "throttleOptionalDerivedWrites")
  assert.deepEqual(operations.cleanup(), { removed: 2, missing: 0, refused: 1 }); assert.equal(existsSync(join(scratch, "eligible.tmp")), false); assert.equal(existsSync(join(outputs, "orphan.tiff")), false); assert.equal(existsSync(join(scratch, "later.tmp")), true); assert.equal(existsSync(join(scratch, "link.tmp")), true); assert.equal(existsSync(join(root, "outside")), true); assert.equal(existsSync(join(originals, "raw.fits")), true); assert.equal(existsSync(join(finals, "final.tiff")), true)
  unlinkSync(join(scratch, "link.tmp")); service.database.prepare("DELETE FROM storage_scratch_entries WHERE path=?").run(join(scratch, "link.tmp")); service.database.prepare("INSERT INTO storage_scratch_entries VALUES (?,?)").run(join(scratch, "missing.tmp"), "2000-01-01T00:00:00.000Z"); assert.deepEqual(operations.cleanup(), { removed: 0, missing: 1, refused: 0 }); assert.equal((service.database.prepare("SELECT count(*) AS count FROM storage_scratch_entries WHERE path=?").get(join(scratch, "missing.tmp")) as { count: number }).count, 0)
  service.close()
})

test("storage health is owner-visible and blocks only new long capture admission", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "astro-storage-admission-")); const scratch = join(root, "scratch"); const outputs = join(root, "outputs"); mkdirSync(scratch); mkdirSync(outputs)
  let freeBytes = 1_000; const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, undefined, { scratchRoot: scratch, outputsRoot: outputs, thresholds: { noticeFreeBytes: 100, blockFreeBytes: 50, criticalFreeBytes: 10, noticeFreeInodes: 100, blockFreeInodes: 50, criticalFreeInodes: 10, noticeWriteLatencyMs: 5, blockWriteLatencyMs: 10, criticalWriteLatencyMs: 20 }, probe: { freeBytes: () => freeBytes, freeInodes: () => 90, writeLatencyMs: () => 1 } })
  const listener = await service.listen(); t.after(async () => { await listener.close(); service.close() }); const base = `http://127.0.0.1:${listener.port}`
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json()); assert.equal((await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: snapshot.plan.revision, expectedLeaseRevision: snapshot.control.revision, idempotencyKey: "accepted-before-low-storage" }) })).status, 202); freeBytes = 5
  const health = await fetch(`${base}/api/health/operations`).then((response) => response.json()); assert.deepEqual(health.disk, { freeBytes: 5, freeInodes: 90, writeLatencyMs: 1, state: "critical", capture: "throttleOptionalDerivedWrites" }); assert.equal(JSON.stringify(health).includes(root), false)
  const rejected = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: snapshot.plan.revision, expectedLeaseRevision: snapshot.control.revision, idempotencyKey: "low-storage" }) }); assert.equal(rejected.status, 409); assert.equal((await rejected.json()).reason, "StorageUnavailable"); assert.equal((await fetch(`${base}/api/snapshot`).then((response) => response.json())).run.phase, "capture")
})

test("Process Save materializes configured sources before one Asset, lineage, receipt, and publication outbox transaction", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-process-save-")); const sources = join(root, "sources"); const outputs = join(root, "outputs")
  writeFileSync(join(root, "outside.fits"), "outside"); mkdirSync(sources); writeFileSync(join(sources, "linear.fits"), "linear-bytes"); writeFileSync(join(sources, "final.tiff"), "final-bytes")
  const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, { sourcesRoot: sources, outputsRoot: outputs, sources: { linear: "linear.fits", final: "final.tiff", escape: "../outside.fits" } })
  const command = { sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "save-1", outputs: [{ sourceId: "linear", representation: "linearMaster" }, { sourceId: "final", representation: "final" }] }
  const accepted = service.saveProcess(command)
  assert.equal(accepted.outcome, "accepted"); if (accepted.outcome !== "accepted") throw new Error("save did not accept")
  assert.equal(accepted.assetIds.length, 2); assert.equal(readdirSync(outputs).length, 2)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM process_asset_events").get() as { count: number }).count, 2); assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'").get() as { count: number }).count, 2)
  const event = service.database.prepare("SELECT checksum FROM process_asset_events WHERE asset_id=?").get(accepted.assetIds[0]) as { checksum: string }; const savedName = readdirSync(outputs).find((name) => name.startsWith(accepted.assetIds[0]))
  assert.equal(event.checksum, createHash("sha256").update(readFileSync(join(outputs, savedName ?? "missing"))).digest("hex"))
  assert.deepEqual(service.saveProcess(command), accepted); assert.equal(readdirSync(outputs).length, 2)
  const detail = service.database.prepare("SELECT detail FROM library_assets WHERE asset_id=?").get(accepted.assetIds[0]) as { detail: string }
  assert.doesNotMatch(detail.detail, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); assert.doesNotMatch(detail.detail, /outputs|checksum|storage/i)
  assert.equal(service.saveProcess({ ...command, idempotencyKey: "escape", outputs: [{ sourceId: "../outside.fits", representation: "final" }] }).outcome, "rejected")
  service.close()
})

test("Process Save rejects symlinks and records transaction-failure bytes as removable orphans", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-process-orphan-")); const sources = join(root, "sources"); const outputs = join(root, "outputs"); mkdirSync(sources); writeFileSync(join(sources, "source.fits"), "bytes"); writeFileSync(join(root, "outside.fits"), "outside"); symlinkSync(join(root, "outside.fits"), join(sources, "link.fits"))
  const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, { sourcesRoot: sources, outputsRoot: outputs, sources: { source: "source.fits", link: "link.fits" } })
  assert.equal(service.saveProcess({ sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "symlink", outputs: [{ sourceId: "link", representation: "final" }] }).outcome, "rejected")
  service.database.exec("CREATE TRIGGER reject_publication BEFORE INSERT ON outbox WHEN NEW.kind='PublishAsset' BEGIN SELECT RAISE(ABORT, 'forced publication failure'); END;")
  const failed = service.saveProcess({ sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "commit-failure", outputs: [{ sourceId: "source", representation: "final" }] })
  assert.deepEqual(failed, { outcome: "rejected", reason: "MaterializationFailed" }); assert.equal((service.database.prepare("SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'").get() as { count: number }).count, 0); assert.equal((service.database.prepare("SELECT count(*) AS count FROM process_save_orphans").get() as { count: number }).count, 1)
  assert.equal(service.cleanupSavedOrphans(), 1); assert.equal(readdirSync(outputs).length, 0); service.close()
})

test("Process Save leaves no success metadata when later filesystem materialization fails", () => {
  const root = mkdtempSync(join(tmpdir(), "astro-process-write-failure-")); const sources = join(root, "sources"); const outputs = join(root, "outputs"); mkdirSync(sources); writeFileSync(join(sources, "first.fits"), "first")
  const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, { sourcesRoot: sources, outputsRoot: outputs, sources: { first: "first.fits", missing: "missing.tiff" } })
  const result = service.saveProcess({ sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "write-failure", outputs: [{ sourceId: "first", representation: "linearMaster" }, { sourceId: "missing", representation: "final" }] })
  assert.deepEqual(result, { outcome: "rejected", reason: "MaterializationFailed" }); assert.equal((service.database.prepare("SELECT count(*) AS count FROM library_assets WHERE asset_id LIKE 'asset-process-%'").get() as { count: number }).count, 0); assert.equal((service.database.prepare("SELECT count(*) AS count FROM process_save_receipts").get() as { count: number }).count, 0); assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox WHERE kind='PublishAsset'").get() as { count: number }).count, 0); assert.equal((service.database.prepare("SELECT count(*) AS count FROM process_save_orphans").get() as { count: number }).count, 1); assert.equal(readdirSync(outputs).some((name) => name.endsWith(".tmp")), false); assert.equal(service.cleanupSavedOrphans(), 1); assert.equal(readdirSync(outputs).length, 0)
  service.close()
})

test("publisher worker verifies fake provider metadata, retries idempotently, and keeps Library detail safe", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-publisher-")); const sources = join(root, "sources"); const outputs = join(root, "outputs"); mkdirSync(sources); writeFileSync(join(sources, "final.tiff"), "publication-bytes")
  const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, { sourcesRoot: sources, outputsRoot: outputs, sources: { final: "final.tiff" } })
  const saved = service.saveProcess({ sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "publisher-save", outputs: [{ sourceId: "final", representation: "final" }] })
  if (saved.outcome !== "accepted") throw new Error("save did not accept")
  const checksum = (service.database.prepare("SELECT checksum FROM process_asset_events WHERE asset_id=?").get(saved.assetIds[0]) as { checksum: string }).checksum
  service.database.prepare("INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)").run(saved.assetIds[0], checksum, "temporarilyUnavailable", new Date().toISOString(), "")
  const objects = new Map<string, { readonly bytes: Uint8Array; readonly checksum: string }>(); let mismatch = true; let puts = 0
  const worker = createPublisherWorker(service.database, { outputsRoot: outputs }, { put: async (key, bytes, metadata) => { puts += 1; objects.set(key, { bytes, checksum: metadata.checksum }) }, head: async (key) => { const object = objects.get(key); return object === undefined ? undefined : { checksum: mismatch ? "wrong-checksum" : object.checksum, bytes: object.bytes.byteLength } } })
  assert.equal(await worker.pass(), "failed"); assert.equal(service.database.prepare("SELECT availability FROM library_assets WHERE asset_id=?").get(saved.assetIds[0]).availability, "failedPublication")
  mismatch = false; assert.equal(await worker.pass(), "published"); assert.equal(await worker.pass(), "none"); assert.equal(puts, 2); assert.equal(objects.size, 1)
  assert.equal(service.database.prepare("SELECT object_key FROM asset_publications WHERE asset_id=?").get(saved.assetIds[0]).object_key, [...objects.keys()][0]); assert.match([...objects.keys()][0] ?? "", /^published\/run-m27-001\/finals\//)
  const detail = service.database.prepare("SELECT detail FROM library_assets WHERE asset_id=?").get(saved.assetIds[0]).detail as string
  assert.match(detail, /published/); assert.doesNotMatch(detail, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); assert.doesNotMatch(detail, /published\/run|checksum|credential|key/i)
  service.close()
})

test("publisher worker fails closed on conflicting durable publication checksum", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-publisher-conflict-")); const sources = join(root, "sources"); const outputs = join(root, "outputs"); mkdirSync(sources); writeFileSync(join(sources, "final.tiff"), "publication-bytes")
  const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, { sourcesRoot: sources, outputsRoot: outputs, sources: { final: "final.tiff" } }); const saved = service.saveProcess({ sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "publisher-conflict-save", outputs: [{ sourceId: "final", representation: "final" }] })
  if (saved.outcome !== "accepted") throw new Error("save did not accept")
  service.database.prepare("INSERT INTO asset_publications (asset_id,checksum,state,updated_at,object_key) VALUES (?,?,?,?,?)").run(saved.assetIds[0], "conflicting-checksum", "temporarilyUnavailable", new Date().toISOString(), "published/run-m27-001/finals/old")
  let puts = 0; const worker = createPublisherWorker(service.database, { outputsRoot: outputs }, { put: async () => { puts += 1 }, head: async () => undefined })
  assert.equal(await worker.pass(), "failed"); assert.equal(puts, 0); assert.equal(service.database.prepare("SELECT state FROM asset_publications WHERE asset_id=?").get(saved.assetIds[0]).state, "failedPublication"); assert.equal(service.database.prepare("SELECT state FROM outbox WHERE kind='PublishAsset'").get().state, "failed")
  service.close()
})

test("publisher worker lease expiry and stale acknowledgements cannot project stale provider work", async () => {
  const root = mkdtempSync(join(tmpdir(), "astro-publisher-lease-")); const sources = join(root, "sources"); const outputs = join(root, "outputs"); mkdirSync(sources); writeFileSync(join(sources, "final.tiff"), "publication-bytes")
  const service = createLocalWebService(join(root, "state.sqlite"), undefined, undefined, { sourcesRoot: sources, outputsRoot: outputs, sources: { final: "final.tiff" } }); const saved = service.saveProcess({ sessionId: "process-m27-001", expectedRevision: 4, idempotencyKey: "publisher-lease-save", outputs: [{ sourceId: "final", representation: "final" }] })
  if (saved.outcome !== "accepted") throw new Error("save did not accept")
  const keys: string[] = []; let stale = true
  const worker = createPublisherWorker(service.database, { outputsRoot: outputs }, { put: async (key) => { keys.push(key); if (stale) { stale = false; service.database.prepare("UPDATE outbox SET claim_token='newer-worker',claim_until=? WHERE kind='PublishAsset'").run("2000-01-01T00:00:00.000Z") } }, head: async () => ({ checksum: createHash("sha256").update("publication-bytes").digest("hex"), bytes: 17 }) })
  assert.equal(await worker.pass(), "superseded"); assert.equal(await worker.pass("replacement"), "published"); const row = service.database.prepare("SELECT state,attempts FROM outbox WHERE kind='PublishAsset'").get() as { state: string; attempts: number }; assert.equal(row.state, "dispatched"); assert.equal(row.attempts, 2); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(service.database.prepare("SELECT availability FROM library_assets WHERE asset_id=?").get(saved.assetIds[0]).availability, "published")
  service.close()
})

test("SQLite acceptance atomically persists run, event, receipt, and outbox", async (t) => {
  const service = createLocalWebService(join(mkdtempSync(join(tmpdir(), "astro-local-")), "state.sqlite"))
  const listener = await service.listen()
  t.after(async () => { await listener.close(); service.close() })
  const base = `http://127.0.0.1:${listener.port}`
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  const command = { _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: snapshot.plan.revision, expectedLeaseRevision: snapshot.control.revision, idempotencyKey: "m27-accept-1" }
  const accepted = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify(command) })
  assert.equal(accepted.status, 202)
  assert.equal((await accepted.json()).outcome, "accepted")
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count, 1)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM receipts").get() as { count: number }).count, 1)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 1)
  const replay = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify(command) })
  assert.equal(replay.status, 200)
  await listener.close(); service.close()
})

test("numbered SQLite migrations upgrade a legacy database and reject a newer schema", () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-migrations-")), "state.sqlite")
  const legacy = new DatabaseSync(databasePath); legacy.exec("CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL); CREATE TABLE control_requests (client_id TEXT PRIMARY KEY,person_id TEXT NOT NULL); CREATE TABLE memberships (external_subject TEXT PRIMARY KEY,person_id TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE library_assets (asset_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,role TEXT NOT NULL,format TEXT NOT NULL,availability TEXT NOT NULL,comparison_group_id TEXT NOT NULL,captured_at TEXT NOT NULL,updated_at TEXT NOT NULL,sharpness REAL NOT NULL,detail TEXT NOT NULL);"); legacy.close()
  const service = createLocalWebService(databasePath)
  assert.equal((service.database.prepare("SELECT max(version) AS version FROM schema_migrations").get() as { version: number }).version, 10); assert.equal((service.database.prepare("SELECT count(*) AS count FROM workspace_projections").get() as { count: number }).count, 2); assert.equal((service.database.prepare("SELECT count(*) AS count FROM pragma_table_info('outbox') WHERE name='claim_token'").get() as { count: number }).count, 1)
  service.close()
  const newer = new DatabaseSync(databasePath); newer.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(99, "2026-07-24T00:00:00.000Z"); newer.close()
  assert.throws(() => createLocalWebService(databasePath), /newer than this release/)
})

test("configured listener keeps ephemeral loopback defaults and bounds production values", async (t) => {
  assert.equal(configuredListenPort(undefined), 0); assert.equal(configuredListenPort("8080"), 8080); assert.equal(configuredListenHost(undefined), "127.0.0.1"); assert.equal(configuredListenHost("0.0.0.0"), "0.0.0.0")
  assert.throws(() => configuredListenPort("65536"), /integer/); assert.throws(() => configuredListenHost("192.168.1.2"), /must be/)
  assert.deepEqual(configuredRuntime({ ASTRO_LOCAL_WEB_DB: "/var/lib/astro-console/state.sqlite", ASTRO_LOCAL_WEB_PORT: "8080", ASTRO_LOCAL_WEB_BIND: "0.0.0.0", ASTRO_RELEASE: "2026.07.24" }), { databasePath: "/var/lib/astro-console/state.sqlite", release: "2026.07.24", port: 8080, host: "0.0.0.0" }); assert.throws(() => configuredRuntime({ ASTRO_RELEASE: "bad\nrelease" }), /invalid/)
  assert.throws(() => configuredAdmission({ ASTRO_ADMISSION_MODE: "development", ASTRO_LOCAL_WEB_BIND: "0.0.0.0" }, ":memory:"), /loopback/); assert.throws(() => configuredAdmission({ ASTRO_ADMISSION_MODE: "production" }, ":memory:"), /requires/)
  const service = createLocalWebService(); const listener = await service.listen(0)
  t.after(async () => { await listener.close(); service.close() })
  assert.ok(listener.port > 0)
})

test("rig worker configuration is disabled by default and fails closed for Seestar", () => {
  assert.deepEqual(rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: "/state.sqlite" }), { mode: "disabled", databasePath: "/state.sqlite" })
  assert.deepEqual(rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: "/state.sqlite", ASTRO_RIG_WORKER_MODE: "seestar", ASTRO_SEESTAR_HOST: "192.168.4.63", ASTRO_SEESTAR_PEM_PATH: "/run/secrets/seestar.pem" }), { mode: "seestar", databasePath: "/state.sqlite", rigId: "seestar-s30", host: "192.168.4.63", pemPath: "/run/secrets/seestar.pem" })
  assert.throws(() => rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: "/state.sqlite", ASTRO_RIG_WORKER_MODE: "seestar" }), /ASTRO_SEESTAR_HOST/)
  assert.throws(() => rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: "/state.sqlite", ASTRO_RIG_WORKER_MODE: "alpaca" }), /disabled or seestar/)
})

test("disabled rig worker exits without creating or mutating its database", async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-worker-disabled-")), "state.sqlite")
  const worker = createRigWorkerService(rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: databasePath }), { startM27Capture: async () => true })
  assert.equal(await worker.runOnce(), "disabled")
  assert.deepEqual(await worker.run(), { passes: 0, health: { mode: "disabled", status: "disabled", databasePath } })
  assert.deepEqual(await runRigWorkerFromEnvironment({ ASTRO_LOCAL_WEB_DB: databasePath }), { passes: 0, health: { mode: "disabled", status: "disabled", databasePath } })
  assert.equal(existsSync(databasePath), false)
})

test("owner-only Solar test intent persists separate pending work and Stack-evidence boundary", () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-solar-intent-")), "state.sqlite")
  const service = createLocalWebService(databasePath)
  const input = { name: "Solar filter verification", idempotencyKey: "solar-test-001" }
  assert.deepEqual(service.submitSolarTestIntent(input, { personId: "viewer", clientId: "viewer", role: "viewer", capability: "controlCapable" }), { outcome: "rejected", reason: "OwnerRequired" })
  assert.deepEqual(service.submitSolarTestIntent(input, { personId: "owner", clientId: "phone", role: "owner", capability: "readOnly" }), { outcome: "rejected", reason: "ClientReadOnly" })
  assert.deepEqual(service.submitSolarTestIntent({ name: "x", idempotencyKey: "bad" }, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" }), { outcome: "rejected", reason: "InvalidInput" })
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM solar_test_intents").get() as { count: number }).count, 0)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 0)
  const accepted = service.submitSolarTestIntent(input, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" })
  assert.equal(accepted.outcome, "accepted")
  if (accepted.outcome !== "accepted") throw new Error("Expected Solar test intent acceptance")
  assert.equal(accepted.state, "awaitingAdapter"); assert.equal(accepted.evidence, "awaitingStackEvidence")
  const intent = service.database.prepare("SELECT name,owner_person_id,owner_client_id,state FROM solar_test_intents WHERE intent_id=?").get(accepted.intentId) as { name: string; owner_person_id: string; owner_client_id: string; state: string }
  assert.equal(intent.name, input.name); assert.equal(intent.owner_person_id, "owner"); assert.equal(intent.owner_client_id, "desktop"); assert.equal(intent.state, "awaitingAdapter")
  const evidence = service.database.prepare("SELECT state,message FROM solar_test_evidence WHERE intent_id=?").get(accepted.intentId) as { state: string; message: string }
  assert.equal(evidence.state, "awaitingStackEvidence"); assert.match(evidence.message, /Stack evidence/)
  const outbox = service.database.prepare("SELECT kind,payload,state,attempts FROM outbox WHERE kind='StartSolarTestObservation'").get() as { kind: string; payload: string; state: string; attempts: number }
  assert.equal(outbox.kind, "StartSolarTestObservation"); assert.equal(outbox.state, "pending"); assert.equal(outbox.attempts, 0); assert.deepEqual(JSON.parse(outbox.payload), { intentId: accepted.intentId, name: input.name, target: "Sun", requiredEvidence: "Stack" })
  assert.deepEqual(service.submitSolarTestIntent(input, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" }), accepted)
  assert.deepEqual(service.submitSolarTestIntent({ name: "Solar filter verification retry changed", idempotencyKey: input.idempotencyKey }, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" }), { outcome: "rejected", reason: "InvalidInput" })
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox WHERE kind='StartSolarTestObservation'").get() as { count: number }).count, 1)
  assert.deepEqual(service.submitSolarTestIntent({ name: "Second Solar test", idempotencyKey: "solar-test-002" }, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" }), { outcome: "rejected", reason: "SolarTestPending" })
  service.close()
  const recovered = createLocalWebService(databasePath)
  assert.deepEqual(recovered.submitSolarTestIntent(input, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" }), accepted)
  const recoveredOutbox = recovered.database.prepare("SELECT state,attempts FROM outbox WHERE kind='StartSolarTestObservation'").get() as { state: string; attempts: number }
  assert.equal(recoveredOutbox.state, "pending"); assert.equal(recoveredOutbox.attempts, 0)
  recovered.close()
})

test("Solar test CLI requires explicit confirmation before opening the database", () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-solar-cli-")), "state.sqlite")
  assert.throws(() => runSolarTestIntentFromEnvironment({ ASTRO_LOCAL_WEB_DB: databasePath }), /ASTRO_SOLAR_TEST_CONFIRM/)
  assert.equal(existsSync(databasePath), false)
  const seeded = createLocalWebService(databasePath)
  seeded.database.prepare("INSERT INTO memberships VALUES (?,?,?)").run("solar-owner-subject", "owner", "owner")
  seeded.database.prepare("INSERT INTO memberships VALUES (?,?,?)").run("solar-viewer-subject", "viewer", "viewer")
  seeded.close()
  const base = { ASTRO_LOCAL_WEB_DB: databasePath, ASTRO_SOLAR_TEST_CONFIRM: "submit-solar-test", ASTRO_SOLAR_TEST_NAME: "Solar filter verification", ASTRO_SOLAR_TEST_IDEMPOTENCY_KEY: "solar-cli-001" }
  assert.deepEqual(runSolarTestIntentFromEnvironment({ ...base, ASTRO_SOLAR_TEST_SUBJECT: "unknown-subject" }), { outcome: "rejected", reason: "OwnerRequired" })
  assert.deepEqual(runSolarTestIntentFromEnvironment({ ...base, ASTRO_SOLAR_TEST_SUBJECT: "solar-viewer-subject" }), { outcome: "rejected", reason: "OwnerRequired" })
  const result = runSolarTestIntentFromEnvironment({ ...base, ASTRO_SOLAR_TEST_SUBJECT: "solar-owner-subject" })
  assert.equal(result.outcome, "accepted")
  if (result.outcome !== "accepted") throw new Error("Expected Solar CLI acceptance")
  const stopped = runSolarTestIntentFromEnvironment({ ASTRO_LOCAL_WEB_DB: databasePath, ASTRO_SOLAR_TEST_CONFIRM: "submit-solar-test", ASTRO_SOLAR_TEST_ACTION: "stop", ASTRO_SOLAR_TEST_SUBJECT: "solar-owner-subject", ASTRO_SOLAR_TEST_INTENT_ID: result.intentId })
  assert.deepEqual(stopped, { outcome: "accepted" })
  const inspected = createLocalWebService(databasePath)
  assert.equal(inspected.database.prepare("SELECT state FROM solar_test_intents WHERE intent_id=?").get(result.intentId).state, "stopping")
  assert.equal(inspected.database.prepare("SELECT state FROM outbox WHERE kind='StopSolarTestObservation'").get().state, "pending")
  inspected.close()
})

test("Solar adapter stop closes Stack before the Solar view", async () => {
  const calls: string[] = []
  const adapter = createSeestarSolarAdapter({ mode: "seestar", databasePath: "/state.sqlite", rigId: "seestar-s30", host: "192.168.4.63", pemPath: "/run/secrets/seestar.pem" }, { onStack: () => undefined, deviceFactory: () => ({ connectAndAuth: async () => true, disconnect: () => undefined, preflightCheck: async () => ({ host: "192.168.4.63", raw: { deviceState: null, viewState: null, setting: null, diskVolume: null, piInfo: null, time: null }, warnings: [] }), startStack: async () => true, startView: async () => true, stopStack: async () => { calls.push("stack"); return true }, stopView: async () => { calls.push("view"); return true }, rawClient: { subscribeToPushEvents: () => () => undefined } }) })
  assert.equal(await adapter.stopSolarTestObservation("solar-intent"), true)
  assert.deepEqual(calls, ["stack", "view"])
})

test("operational endpoints expose bounded admitted health without internal detail", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  assert.deepEqual(await fetch(`${base}/health/live`).then((response) => response.json()), { status: "alive" })
  const ready = await fetch(`${base}/api/health/ready`).then((response) => response.json())
  assert.deepEqual(ready, { status: "ready", service: "ready", database: "ready", rig: "unknown", tunnel: "unknown", activeRun: "none", message: "Service and local database are ready; rig and tunnel are not connected in this fixture." })
  const operations = await fetch(`${base}/api/health/operations`).then((response) => response.json())
  assert.equal(operations.release, "local-web-fixture"); assert.equal(operations.schemaVersion, 10); assert.equal(operations.sqlite.journalMode, "wal"); assert.equal(operations.rig, "unknown"); assert.equal(JSON.stringify(operations).includes("/"), false)
  const denied = createLocalWebService(":memory:", () => ({ personId: "viewer", clientId: "viewer", capability: "readOnly" })); const deniedListener = await denied.listen()
  assert.equal((await fetch(`http://127.0.0.1:${deniedListener.port}/api/health/operations`)).status, 403); assert.equal((await fetch(`http://127.0.0.1:${deniedListener.port}/api/health/ready`)).status, 200)
  await deniedListener.close(); denied.close()
})

test("request-context admission rejects before snapshot, stream, query, or mutation routing", async (t) => {
  const service = createLocalWebService(":memory:", (request) => request?.headers.authorization === "Bearer verified-owner" ? { personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable", role: "owner" } : undefined)
  const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  for (const path of ["/api/snapshot", "/api/events", "/api/library"]) assert.equal((await fetch(`${base}${path}`)).status, 401)
  assert.equal((await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ personId: "owner-chicks", capability: "controlCapable" }) })).status, 401)
  const admitted = await fetch(`${base}/api/snapshot`, { headers: { authorization: "Bearer verified-owner", "x-client-capability": "readOnly" } }).then((response) => response.json())
  assert.equal(admitted.identity.capability, "controlCapable")
})

test("verified Access assertions map durable memberships without trusting request authority", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-access-")), "state.sqlite")
  const seeded = createLocalWebService(databasePath)
  seeded.database.prepare("INSERT INTO memberships VALUES (?,?,?)").run("access-owner", "owner-chicks", "owner")
  seeded.database.prepare("INSERT INTO memberships VALUES (?,?,?)").run("access-viewer", "maya", "viewer")
  seeded.close()
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const issuer = "https://chicks.cloudflareaccess.com"
  const audience = "access-audience"
  const claim = (subject: string, overrides: Record<string, unknown> = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key", typ: "JWT" })).toString("base64url")
    const email = subject === "access-owner" ? "owner@example.com" : subject === "access-viewer" ? "viewer@example.com" : "unknown@example.com"
    const payload = Buffer.from(JSON.stringify({ sub: subject, email, iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1_000) + 60, ...overrides })).toString("base64url")
    return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url")}`
  }
  const keyResolver = createJwksKeyResolver({ url: "https://chicks.cloudflareaccess.com/cdn-cgi/access/certs", fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "fixture-key", use: "sig" }] }) }) })
  const admission = createProductionAccessAdmission({ issuer, audience, keyResolver, databasePath, clientContext: "desktop", bootstrap: [{ email: "owner@example.com", personId: "owner-chicks", role: "owner" }, { email: "viewer@example.com", personId: "maya", role: "viewer" }] })
  const service = createLocalWebService(databasePath, admission)
  const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const authorized = (token: string) => ({ "cf-access-jwt-assertion": token, "x-client-capability": "controlCapable" })
  const owner = await fetch(`${base}/api/snapshot`, { headers: authorized(claim("access-owner")) }).then((response) => response.json())
  assert.equal(owner.identity.personId, "owner-chicks")
  assert.equal(owner.identity.capability, "controlCapable")
  const viewer = await fetch(`${base}/api/snapshot`, { headers: authorized(claim("access-viewer")) }).then((response) => response.json())
  assert.equal(viewer.identity.capability, "readOnly")
  assert.equal((await fetch(`${base}/api/commands/start-run`, { method: "POST", headers: authorized(claim("access-viewer")), body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "viewer-start" }) })).status, 403)
  assert.equal((await fetch(`${base}/api/snapshot`, { headers: authorized(claim("unknown-subject")) })).status, 401)
  for (const token of [claim("access-owner", { exp: Math.floor(Date.now() / 1_000) - 1 }), claim("access-owner", { iss: "https://forged.example" }), claim("access-owner", { aud: "wrong-audience" }), `${claim("access-owner")}.forged`]) assert.equal((await fetch(`${base}/api/snapshot`, { headers: authorized(token) })).status, 401)
})

test("production admission rechecks normalized bootstrap policy and revokes removed viewer subjects", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-production-access-")), "state.sqlite"); const seeded = createLocalWebService(databasePath); seeded.close()
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }); const issuer = "https://access.example"; const audience = "audience"; const claim = (email: string) => { const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "viewer-key" })).toString("base64url"); const payload = Buffer.from(JSON.stringify({ sub: "viewer-subject", email, iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1_000) + 60 })).toString("base64url"); return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url")}` }
  const keyResolver = createJwksKeyResolver({ url: "https://access.example/certs", fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "viewer-key", use: "sig" }] }) }) })
  const config = { issuer, audience, keyResolver, databasePath, clientContext: "desktop" as const, bootstrap: [{ email: " Viewer@Example.com ", personId: "viewer", role: "viewer" as const }] }
  const admitted = createProductionAccessAdmission(config); const request = { headers: { "cf-access-jwt-assertion": claim("viewer@example.com") } } as IncomingMessage
  assert.deepEqual(await admitted(request), { personId: "viewer", clientId: "access:viewer-subject", capability: "readOnly", role: "viewer" }); assert.equal(((new DatabaseSync(databasePath)).prepare("SELECT count(*) AS count FROM memberships WHERE external_subject='viewer-subject'").get() as { count: number }).count, 1)
  const revoked = createProductionAccessAdmission({ ...config, bootstrap: [] }); assert.equal(await revoked(request), undefined); assert.throws(() => createProductionAccessAdmission({ ...config, bootstrap: [{ ...config.bootstrap[0] }, { ...config.bootstrap[0], email: "viewer@example.com" }] }), /unique/)
})

test("production admission reloads a removed membership bootstrap file before the next interval", async () => {
  const directory = mkdtempSync(join(tmpdir(), "astro-bootstrap-reload-")); const databasePath = join(directory, "state.sqlite"); const bootstrapPath = join(directory, "membership.json"); const seeded = createLocalWebService(databasePath); seeded.close()
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }); const issuer = "https://access.example"; const audience = "bootstrap-audience"; let now = 1_000
  writeFileSync(bootstrapPath, JSON.stringify([{ email: "owner@example.com", personId: "reload-owner", role: "owner" }]))
  const keyResolver = createJwksKeyResolver({ url: "https://access.example/certs", fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "reload-key", use: "sig" }] }) }) })
  const admission = createProductionAccessAdmission({ issuer, audience, keyResolver, databasePath, clientContext: "desktop", bootstrapResolver: createMembershipBootstrapResolver({ path: bootstrapPath, now: () => now }) })
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "reload-key" })).toString("base64url"); const payload = Buffer.from(JSON.stringify({ sub: "reload-subject", email: "owner@example.com", iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1_000) + 60 })).toString("base64url"); const token = `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url")}`; const request = { headers: { "cf-access-jwt-assertion": token } } as IncomingMessage
  assert.equal((await admission(request))?.personId, "reload-owner")
  unlinkSync(bootstrapPath); now += 1_000
  assert.equal(await admission(request), undefined)
})

test("a configured non-fixture owner has role-based operations and grant authority while viewers and phones remain read-only", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-role-owner-")), "state.sqlite"); const seeded = createLocalWebService(databasePath); seeded.close()
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }); const issuer = "https://access.example"; const audience = "role-audience"
  const claim = (subject: string, email: string) => { const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "owner-key" })).toString("base64url"); const payload = Buffer.from(JSON.stringify({ sub: subject, email, iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1_000) + 60 })).toString("base64url"); return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url")}` }
  const keyResolver = createJwksKeyResolver({ url: "https://access.example/certs", fetcher: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "owner-key", use: "sig" }] }) }) })
  const config = { issuer, audience, keyResolver, databasePath, clientContext: "desktop" as const, bootstrap: [{ email: "owner@example.com", personId: "observatory-primary", role: "owner" as const }, { email: "viewer@example.com", personId: "guest-observer", role: "viewer" as const }] }
  const service = createLocalWebService(databasePath, createProductionAccessAdmission(config)); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const ownerHeaders = { "cf-access-jwt-assertion": claim("owner-subject", "owner@example.com") }; const viewerHeaders = { "cf-access-jwt-assertion": claim("viewer-subject", "viewer@example.com") }
  const ownerSnapshot = await fetch(`${base}/api/snapshot`, { headers: ownerHeaders }).then((response) => response.json())
  assert.equal(ownerSnapshot.identity.personId, "observatory-primary"); assert.equal(ownerSnapshot.identity.role, "owner"); assert.equal(ownerSnapshot.identity.capability, "controlCapable")
  assert.equal((await fetch(`${base}/api/health/operations`, { headers: ownerHeaders })).status, 200)
  assert.equal((await fetch(`${base}/api/health/operations`, { headers: viewerHeaders })).status, 403)
  assert.equal((await fetch(`${base}/api/commands/grant-control`, { method: "POST", headers: viewerHeaders, body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "viewer-may-not-grant" }) })).status, 403)
  assert.equal((await fetch(`${base}/api/commands/request-control`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "owner-request" }) })).status, 202)
  assert.equal((await fetch(`${base}/api/commands/grant-control`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "owner-grant" }) })).status, 202)
  const phoneAdmission = createProductionAccessAdmission({ ...config, clientContext: "phone" })
  const phoneIdentity = await phoneAdmission({ headers: { "cf-access-jwt-assertion": claim("owner-phone-subject", "owner@example.com") } } as IncomingMessage)
  assert.deepEqual(phoneIdentity, { personId: "observatory-primary", clientId: "access:owner-phone-subject", role: "owner", capability: "readOnly" })
})

test("production Access JWKS admission refreshes by kid, bounds cache use, and fails closed", async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-jwks-")), "state.sqlite"); const seeded = createLocalWebService(databasePath); seeded.close()
  const oldKeys = generateKeyPairSync("rsa", { modulusLength: 2048 }); const newKeys = generateKeyPairSync("rsa", { modulusLength: 2048 }); const issuer = "https://access.example"; const audience = "jwks-audience"; let now = 1_000; let calls = 0
  let document = { keys: [{ ...oldKeys.publicKey.export({ format: "jwk" }), kid: "old-kid", use: "sig" }] }
  const resolver = createJwksKeyResolver({ url: "https://access.example/cdn-cgi/access/certs", cacheTtlMs: 1_000, now: () => now, fetcher: async () => { calls += 1; return { ok: true, status: 200, text: async () => JSON.stringify(document) } } })
  const claim = (kid: string, keys: ReturnType<typeof generateKeyPairSync>) => { const header = Buffer.from(JSON.stringify({ alg: "RS256", kid })).toString("base64url"); const payload = Buffer.from(JSON.stringify({ sub: "rotation-subject", email: "owner@example.com", iss: issuer, aud: audience, exp: Math.floor(Date.now() / 1_000) + 60 })).toString("base64url"); return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url")}` }
  const admission = createProductionAccessAdmission({ issuer, audience, keyResolver: resolver, databasePath, clientContext: "desktop", bootstrap: [{ email: "owner@example.com", personId: "rotating-owner", role: "owner" }] })
  const request = (token: string) => ({ headers: { "cf-access-jwt-assertion": token } } as IncomingMessage)
  assert.equal((await admission(request(claim("old-kid", oldKeys))))?.personId, "rotating-owner"); assert.equal(calls, 1)
  document = { keys: [{ ...newKeys.publicKey.export({ format: "jwk" }), kid: "new-kid", use: "sig" }] }
  assert.equal((await admission(request(claim("new-kid", newKeys))))?.personId, "rotating-owner"); assert.equal(calls, 2)
  assert.equal(await admission(request(claim("old-kid", oldKeys))), undefined); assert.equal(calls, 3)
  assert.equal(await admission(request(claim("unknown-kid", newKeys))), undefined); assert.equal(calls, 4)
  assert.equal(await admission(request(claim("unknown-kid", newKeys))), undefined); assert.equal(calls, 4)
  now += 1_000; document = { keys: [] }
  assert.equal(await admission(request(claim("new-kid", newKeys))), undefined); assert.equal(calls, 5)
  const missingKid = claim("new-kid", newKeys).replace(/eyJhbGciOiJSUzI1NiIsImtpZCI6Im5ldy1raWQifQ/, Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url"))
  assert.equal(await admission(request(missingKid)), undefined); assert.equal(calls, 5)
})

test("accepted pause dispatches StopStack once through an injected worker", async () => {
  const service = createLocalWebService()
  const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  const start = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "pause-start" }) }).then((response) => response.json())
  const paused = await fetch(`${base}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: start.run.revision, idempotencyKey: "pause-once" }) }).then((response) => response.json())
  assert.equal(paused.snapshot.run.phase, "paused")
  let calls = 0
  assert.equal(await service.dispatchPauseOutbox({ stopStack: async () => { calls += 1; return true } }), "dispatched")
  assert.equal(await service.dispatchPauseOutbox({ stopStack: async () => { calls += 1; return true } }), "none")
  assert.equal(calls, 1)
  await listener.close(); service.close()
})

test("SQLite worker claims prevent duplicate dispatch and retryable failures recover after restart", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-worker-")), "state.sqlite")
  const service = createLocalWebService(databasePath); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "claim-start" }) })
  await fetch(`${base}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: 1, idempotencyKey: "claim-pause" }) })
  let calls = 0
  const adapter = { stopStack: async () => { calls += 1; await new Promise((done) => setTimeout(done, 15)); return true } }
  assert.deepEqual(await Promise.all([service.dispatchPauseOutbox(adapter, "worker-a"), service.dispatchPauseOutbox(adapter, "worker-b")]), ["dispatched", "none"])
  assert.equal(calls, 1)
  const acknowledged = service.database.prepare("SELECT state,claimed_by,ack_at,attempts FROM outbox WHERE kind='StopStack'").get() as { state: string; claimed_by: string | null; ack_at: string | null; attempts: number }
  assert.equal(acknowledged.state, "dispatched"); assert.equal(acknowledged.claimed_by, null); assert.notEqual(acknowledged.ack_at, null); assert.equal(acknowledged.attempts, 1)
  service.database.prepare("UPDATE state SET value=? WHERE key='run'").run("null")
  await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "stale-start" }) })
  await fetch(`${base}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: 1, idempotencyKey: "stale-pause" }) })
  let release!: () => void
  const stale = service.dispatchPauseOutbox({ stopStack: async () => new Promise<boolean>((done) => { release = () => done(true) }) }, "stale-worker")
  await new Promise((done) => setTimeout(done, 0))
  service.database.prepare("UPDATE outbox SET claim_token='replacement-token' WHERE kind='StopStack' AND state='claimed'").run()
  release()
  assert.equal(await stale, "superseded")
  service.database.prepare("UPDATE outbox SET state='dispatched',claim_token=NULL,claimed_by=NULL,claim_until=NULL WHERE kind='StopStack' AND claim_token='replacement-token'").run()
  service.database.prepare("UPDATE state SET value=? WHERE key='run'").run("null")
  await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "retry-start" }) })
  await fetch(`${base}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: 1, idempotencyKey: "retry-pause" }) })
  assert.equal(await service.dispatchPauseOutbox({ stopStack: async () => false }), "failed")
  service.close()
  const recovered = createLocalWebService(databasePath)
  t.after(() => recovered.close())
  assert.equal(await recovered.dispatchPauseOutbox({ stopStack: async () => true }, "recovered-worker"), "dispatched")
  const retried = recovered.database.prepare("SELECT state,attempts,last_error FROM outbox WHERE kind='StopStack' ORDER BY rowid DESC LIMIT 1").get() as { state: string; attempts: number; last_error: string | null }
  assert.equal(retried.state, "dispatched"); assert.equal(retried.attempts, 2); assert.equal(retried.last_error, null)
})

test("a rig worker dispatches only a Solar test and records provider acknowledgement separately from Stack evidence", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-rig-worker-")), "state.sqlite")
  const service = createLocalWebService(databasePath); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const intent = service.submitSolarTestIntent({ name: "Solar worker test", idempotencyKey: "rig-worker-solar" }, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" })
  if (intent.outcome !== "accepted") throw new Error("Expected Solar intent")
  let calls = 0
  const config = rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: databasePath, ASTRO_RIG_WORKER_MODE: "seestar", ASTRO_SEESTAR_HOST: "192.168.4.63", ASTRO_SEESTAR_PEM_PATH: "/run/secrets/seestar.pem" })
  const worker = createRigWorkerService(config, { startSolarTestObservation: async (work) => { calls += 1; assert.equal(work.intentId, intent.intentId); return "providerAcknowledged" }, stopSolarTestObservation: async () => true, close: () => undefined })
  assert.deepEqual(await Promise.all([worker.runOnce(), worker.runOnce()]), ["providerAcknowledged", "none"])
  assert.equal(calls, 1)
  let row = service.database.prepare("SELECT id,state,claim_token,ack_at,attempts FROM outbox WHERE kind='StartSolarTestObservation'").get() as { id: string; state: string; claim_token: string | null; ack_at: string | null; attempts: number }
  assert.equal(row.state, "dispatched"); assert.equal(row.claim_token, null); assert.notEqual(row.ack_at, null); assert.equal(row.attempts, 1)
  assert.equal(service.database.prepare("SELECT state FROM solar_test_intents WHERE intent_id=?").get(intent.intentId).state, "providerAcknowledged")
  assert.equal(service.recordSolarStackEvidence(intent.intentId, { Event: "Stack", stacked_frame: 1 }, "2026-07-27T12:00:00.000Z"), true)
  assert.equal(service.database.prepare("SELECT state FROM solar_test_intents WHERE intent_id=?").get(intent.intentId).state, "stackObserved")
  assert.equal(calls, 1); assert.equal(row.state, "dispatched"); assert.equal(row.claim_token, null); assert.notEqual(row.ack_at, null); assert.equal(row.attempts, 1)
  const uncertainIntent = service.submitSolarTestIntent({ name: "Solar uncertain worker test", idempotencyKey: "rig-worker-solar-uncertain" }, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" })
  if (uncertainIntent.outcome !== "accepted") throw new Error("Expected Solar uncertain intent")
  const uncertainWorker = createRigWorkerService(config, { startSolarTestObservation: async () => "uncertain", stopSolarTestObservation: async () => true, close: () => undefined }, { workerId: "uncertain-worker" })
  assert.equal(await uncertainWorker.runOnce(), "uncertain")
  assert.equal(service.database.prepare("SELECT state FROM solar_test_intents WHERE intent_id=?").get(uncertainIntent.intentId).state, "manualRecovery")
  assert.equal(service.database.prepare("SELECT state FROM outbox WHERE kind='StartSolarTestObservation' AND state='uncertain'").get().state, "uncertain")
  uncertainWorker.close()
  const expiredIntent = service.submitSolarTestIntent({ name: "Solar expired lease test", idempotencyKey: "rig-worker-solar-expired" }, { personId: "owner", clientId: "desktop", role: "owner", capability: "controlCapable" })
  if (expiredIntent.outcome !== "accepted") throw new Error("Expected Solar expired intent")
  service.database.prepare("UPDATE outbox SET state='claimed',claim_token='expired',claim_until=? WHERE kind='StartSolarTestObservation' AND state='pending'").run("2000-01-01T00:00:00.000Z")
  assert.equal(await worker.runOnce(), "none")
  assert.equal(service.database.prepare("SELECT state FROM solar_test_intents WHERE intent_id=?").get(expiredIntent.intentId).state, "manualRecovery")
  assert.equal(service.database.prepare("SELECT state FROM solar_test_recovery WHERE intent_id=?").get(expiredIntent.intentId).state, "manualRecovery")
  worker.close()
})

test("enabled worker without an adapter reports liveness and retains pending capture work", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-rig-unconfigured-")), "state.sqlite")
  const service = createLocalWebService(databasePath); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "rig-unconfigured-start" }) })
  const config = rigWorkerConfig({ ASTRO_LOCAL_WEB_DB: databasePath, ASTRO_RIG_WORKER_MODE: "seestar", ASTRO_SEESTAR_HOST: "192.168.4.63", ASTRO_SEESTAR_PEM_PATH: "/run/secrets/seestar.pem" })
  const worker = createRigWorkerService(config, undefined, { now: () => new Date("2026-07-25T12:00:00.000Z") })
  assert.equal(await worker.runOnce(), "unavailable")
  assert.deepEqual(worker.health(), { mode: "seestar", status: "alive", adapter: "unconfigured", lastHeartbeat: "2026-07-25T12:00:00.000Z" })
  const pending = service.database.prepare("SELECT state,attempts FROM outbox WHERE kind='StartM27Capture'").get() as { state: string; attempts: number }
  assert.equal(pending.state, "pending"); assert.equal(pending.attempts, 0)
  const operations = await fetch(`${base}/api/health/operations`).then((response) => response.json())
  assert.deepEqual(operations.worker, { status: "alive", adapter: "unconfigured", lastHeartbeat: "2026-07-25T12:00:00.000Z" })
  assert.deepEqual(await worker.run({ maxPasses: 1 }), { passes: 1, health: { mode: "seestar", status: "stopped", adapter: "unconfigured", lastHeartbeat: "2026-07-25T12:00:00.000Z" } })
})

test("current controller resumes only the paused revision and replays idempotently", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "resume-start" }) })
  const paused = await fetch(`${base}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: 1, idempotencyKey: "resume-pause" }) }).then((response) => response.json())
  assert.equal(paused.snapshot.run.phase, "paused")
  const command = { expectedLeaseRevision: 1, expectedRunRevision: 2, idempotencyKey: "resume-once" }
  const resumed = await fetch(`${base}/api/commands/resume-run`, { method: "POST", body: JSON.stringify(command) })
  assert.equal(resumed.status, 202)
  assert.equal((await resumed.json()).snapshot.run.phase, "capture")
  assert.equal((await fetch(`${base}/api/commands/resume-run`, { method: "POST", body: JSON.stringify(command) })).status, 200)
  assert.equal((await fetch(`${base}/api/commands/resume-run`, { method: "POST", body: JSON.stringify({ ...command, expectedRunRevision: 2, idempotencyKey: "resume-stale" }) })).status, 409)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox WHERE kind='ResumeStack'").get() as { count: number }).count, 1)
  let calls = 0
  assert.equal(await service.dispatchResumeOutbox({ startStack: async () => { calls += 1; return true } }), "dispatched")
  assert.equal(await service.dispatchResumeOutbox({ startStack: async () => { calls += 1; return true } }), "none")
  assert.equal(calls, 1)
})

test("resume preserves accepted capture when start-stack dispatch is unavailable or fails", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const resume = async (key: string) => {
    await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: `${key}-start` }) })
    await fetch(`${base}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: 1, idempotencyKey: `${key}-pause` }) })
    return fetch(`${base}/api/commands/resume-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, expectedRunRevision: 2, idempotencyKey: `${key}-resume` }) })
  }
  await resume("resume-unavailable")
  assert.equal(await service.dispatchResumeOutbox(undefined), "failed")
  let snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.run.phase, "capture")
  assert.equal(snapshot.dispatch, "failed")
  assert.equal(snapshot.dispatchAction, "resume")
  service.database.prepare("UPDATE state SET value=? WHERE key='run'").run("null")
  service.database.prepare("UPDATE state SET value=? WHERE key='snapshotVersion'").run("4")
  await resume("resume-failed")
  assert.equal(await service.dispatchResumeOutbox({ startStack: async () => { throw new Error("device unavailable") } }), "failed")
  snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.run.phase, "capture")
  assert.equal(snapshot.dispatch, "failed")
  assert.equal(snapshot.dispatchAction, "resume")
  assert.equal(await service.dispatchResumeOutbox({ startStack: async () => true }), "dispatched")
})

test("current controller terminally stops an active run exactly once and preserves dispatch truth", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "stop-start" }) })
  const command = { expectedLeaseRevision: 1, expectedRunRevision: 1, idempotencyKey: "stop-once" }
  const stopped = await fetch(`${base}/api/commands/stop-run`, { method: "POST", body: JSON.stringify(command) })
  assert.equal(stopped.status, 202)
  assert.equal((await stopped.json()).eventType, "RunStopped")
  assert.equal((await fetch(`${base}/api/commands/stop-run`, { method: "POST", body: JSON.stringify(command) })).status, 200)
  assert.equal((await fetch(`${base}/api/commands/stop-run`, { method: "POST", body: JSON.stringify({ ...command, idempotencyKey: "stop-terminal", expectedRunRevision: 2 }) })).status, 409)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox WHERE kind='StopRun'").get() as { count: number }).count, 1)
  assert.equal(await service.dispatchStopOutbox({ stopStack: async () => false }), "failed")
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.run.phase, "stopped")
  assert.equal(snapshot.dispatch, "failed")
  assert.equal(snapshot.dispatchAction, "stop")
  assert.match(snapshot.evidence.correction.protection, /accepted capture continues/)
  const html = await fetch(`${base}/`).then((response) => response.text())
  assert.match(html, /Latest solve evidence is preserved\. This run is terminally stopped; no automatic correction or capture will continue\./)
  assert.match(html, /s\.run\?\.phase==='paused'/)
  assert.equal(html.includes("text(q('#correction-protection'),s.evidence.correction.protection)"), false)
  assert.equal(await service.dispatchStopOutbox({ stopStack: async () => true }), "dispatched")
})

test("startup backfills shared-control state for a legacy local database without changing accepted work", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-legacy-")), "state.sqlite")
  const legacy = new DatabaseSync(databasePath)
  legacy.exec("CREATE TABLE state (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE events (cursor INTEGER PRIMARY KEY,type TEXT NOT NULL,snapshot TEXT NOT NULL); CREATE TABLE receipts (idempotency_key TEXT PRIMARY KEY,response TEXT NOT NULL); CREATE TABLE outbox (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL);")
  const put = legacy.prepare("INSERT INTO state VALUES (?,?)")
  for (const [key, value] of Object.entries({ snapshotVersion: 7, eventCursor: 11, planRevision: 3, run: { id: "run-accepted-before-control", revision: 4, phase: "capture", target: "M27 · Dumbbell Nebula", progress: 42 } })) put.run(key, JSON.stringify(value))
  legacy.prepare("INSERT INTO events VALUES (?,?,?)").run(11, "RunStarted", "{\"accepted\":true}")
  legacy.prepare("INSERT INTO receipts VALUES (?,?)").run("legacy-receipt", "{\"accepted\":true}")
  legacy.prepare("INSERT INTO outbox VALUES (?,?,?,?)").run("legacy-outbox", "StartM27Capture", "{}", "pending")
  legacy.close()

  const service = createLocalWebService(databasePath)
  const listener = await service.listen()
  t.after(async () => { await listener.close(); service.close() })
  const snapshot = await fetch(`http://127.0.0.1:${listener.port}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.snapshotVersion, 7)
  assert.equal(snapshot.eventCursor, 11)
  assert.equal(snapshot.run.id, "run-accepted-before-control")
  assert.equal(snapshot.control.holderClientId, "desktop-owner")
  assert.equal(snapshot.control.revision, 1)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count, 1)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM receipts").get() as { count: number }).count, 1)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 1)
  await listener.close(); service.close()
})

test("persisted exhausted correction keeps evidence visible without issuing work and projects over SSE", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const stream = await fetch(`${base}/api/events`); const reader = stream.body?.getReader(); await reader?.read()
  const evidence = { frameId: "frame-m27-042", capturedAt: "2026-07-23T03:12:00.000Z", quality: "warning", desired: "M27 center", solved: "M27 center + 46 arcsec", uncertaintyArcsec: 7.1, correction: { state: "exhausted", evidence: "Three solve-guided corrections did not return M27 within the framing bound.", bound: "Correction budget 3 of 3 exhausted; 46 arcsec exceeds the 30 arcsec bound.", protection: "Accepted capture is protected; no automatic correction or hardware command was issued.", action: "Review recovery in Observe before any new command." } }
  service.database.prepare("UPDATE state SET value=? WHERE key='evidence'").run(JSON.stringify(evidence))
  service.database.prepare("UPDATE state SET value=? WHERE key='snapshotVersion'").run("2")
  service.database.prepare("UPDATE state SET value=? WHERE key='eventCursor'").run("1")
  const changed = await Promise.race([reader?.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("missing exhausted evidence projection")), 2_000))])
  const projected = new TextDecoder().decode(changed?.value)
  assert.match(projected, /ProjectionChanged/)
  assert.match(projected, /Correction budget 3 of 3 exhausted/)
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.evidence.frameId, "frame-m27-042")
  assert.equal(snapshot.evidence.correction.state, "exhausted")
  assert.equal(snapshot.evidence.correction.action, "Review recovery in Observe before any new command.")
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 0)
  await reader?.cancel(); await listener.close(); service.close()
})

test("decoded adapter observation updates service evidence and malformed input fails closed", () => {
  const service = createLocalWebService()
  const accepted = service.ingestObservation({ frameId: "frame-adapter-001", capturedAt: "2026-07-24T02:00:00.000Z", quality: "verified", desired: "M27 center", solved: "M27 center + 8 arcsec", uncertaintyArcsec: 2.5, correctionState: "automatic", correctionEvidence: "Adapter solve accepted.", correctionBound: "8 arcsec within 30 arcsec bound.", protection: "No operator action required." })
  assert.equal(accepted?.evidence.frameId, "frame-adapter-001")
  const before = JSON.stringify(accepted?.evidence)
  assert.equal(service.ingestObservation({ frameId: "", correctionState: "automatic" }), undefined)
  assert.equal(JSON.stringify(service.ingestObservation({ frameId: "", correctionState: "automatic" })?.evidence), undefined)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 0)
  assert.equal(JSON.stringify(service.database.prepare("SELECT value FROM state WHERE key='evidence'").get()).includes("frame-adapter-001"), true)
  assert.equal(before.includes("frame-adapter-001"), true)
  service.close()
})

test("Seestar Stack push adapter decodes SDK events, projects availability, and fails closed", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const stream = await fetch(`${base}/api/events`); const reader = stream.body?.getReader(); await reader?.read()
  const accepted = service.ingestSeestarStackPush({ Event: "Stack", stacked_frame: "43", percent: "62" }, "2026-07-24T02:10:00.000Z")
  assert.equal(accepted?.evidence.stack.availability, "available")
  assert.equal(accepted?.evidence.stack.frameCount, 43)
  const projected = new TextDecoder().decode((await reader?.read()).value)
  assert.match(projected, /Stack event received/)
  const before = accepted?.evidence.frameId
  assert.equal(service.ingestSeestarStackPush({ Event: "PlateSolve", stacked_frame: 44 }, "2026-07-24T02:11:00.000Z"), undefined)
  const failed = service.ingestSeestarStackPush({ Event: "Stack", stacked_frame: 43, state: "fail", error: "camera transport lost" }, "2026-07-24T02:12:00.000Z")
  assert.equal(failed?.evidence.frameId, before)
  assert.equal(failed?.evidence.stack.availability, "unavailable")
  assert.match(failed?.evidence.stack.message ?? "", /camera transport lost/)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 0)
  await reader?.cancel(); await listener.close(); service.close()
})

test("local solved-frame evidence faithfully decodes as the V2 AcquireSnapshot contract", () => {
  const service = createLocalWebService()
  const snapshot = service.ingestObservation({ frameId: "frame-contract-001", capturedAt: "2026-07-24T02:00:00.000Z", quality: "verified", desired: "M27 center", solved: "M27 center + 8 arcsec", uncertaintyArcsec: 2.5, correctionState: "automatic", correctionEvidence: "Adapter solve accepted.", correctionBound: "8 arcsec within 30 arcsec bound.", protection: "No operator action required." })
  const evidence = snapshot?.evidence
  const contract = Schema.decodeUnknownSync(AcquireSnapshot)({ revision: 1, mode: "pointing", phase: "verifying", recoverySeries: 0, attemptCount: 1, latestEvidence: { _tag: "Solved", attemptId: "attempt-m27-001", sourceFrameAssetId: evidence?.frameId, correction: { rightAscensionArcsec: 8, declinationArcsec: 0, convention: "mountRaDec" }, magnitudeArcsec: 8, uncertaintyArcsec: evidence?.uncertaintyArcsec }, attention: evidence?.correction.protection, actions: [] })
  assert.equal(contract.latestEvidence?._tag, "Solved")
  assert.equal(contract.latestEvidence?.sourceFrameAssetId, "frame-contract-001")
  service.close()
})

test("accepted paused local run faithfully decodes as the V2 RunSnapshot contract", () => {
  const contract = Schema.decodeUnknownSync(RunSnapshot)({ runId: "run-m27-001", revision: 2, sourcePlanId: "plan-m27", phase: "paused", completedSequenceCount: 0, acceptedMutations: [], warnings: [], lastConfirmedAt: "2026-07-24T02:00:00.000Z", actions: [] })
  assert.equal(contract.phase, "paused")
  assert.equal(contract.revision, 2)
})

test("accepted terminal local run faithfully decodes as the V2 RunSnapshot contract", () => {
  const contract = Schema.decodeUnknownSync(RunSnapshot)({ runId: "run-m27-001", revision: 3, sourcePlanId: "plan-m27", phase: "stopped", completedSequenceCount: 0, acceptedMutations: [], warnings: [], lastConfirmedAt: "2026-07-24T02:00:00.000Z", actions: [] })
  assert.equal(contract.phase, "stopped")
  assert.equal(contract.revision, 3)
})

test("Library queries enforce bounded pages, cursor order, role filters, and allowed sorts", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const first = await fetch(`${base}/api/library?queryId=library-check&pageSize=3&sort=sharpestFirst`).then((response) => response.json())
  assert.equal(first.results.length, 3)
  assert.equal(first.results[0].assetId, "asset-m27-001")
  assert.equal(first.nextCursor, "3")
  const next = await fetch(`${base}/api/library?queryId=library-check&pageSize=3&cursor=${first.nextCursor}&sort=sharpestFirst`).then((response) => response.json())
  assert.equal(next.results[0].assetId, "asset-m27-004")
  const originals = await fetch(`${base}/api/library?queryId=library-check&pageSize=5&role=original&sort=capturedAtDescending`).then((response) => response.json())
  assert.equal(originals.results.every((asset: { role: string }) => asset.role === "original"), true)
  assert.equal((await fetch(`${base}/api/library?pageSize=101&sort=capturedAtDescending`)).status, 400)
  assert.equal((await fetch(`${base}/api/library?pageSize=5&cursor=not-a-cursor&sort=capturedAtDescending`)).status, 400)
  assert.equal((await fetch(`${base}/api/library?pageSize=5&sort=unsafe`)).status, 400)
  await listener.close(); service.close()
})

test("Library detail uses stable identities and snapshot delivery remains catalog-bounded", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const detail = await fetch(`${base}/api/library/assets/asset-m27-001`).then((response) => response.json())
  assert.equal(detail.assetId, "asset-m27-001")
  assert.equal(detail.lineage.runId, "run-m27-001")
  assert.equal(JSON.stringify(detail).includes("objectKey"), false)
  assert.equal(JSON.stringify(detail).includes("/Users/"), false)
  assert.equal((await fetch(`${base}/api/library/assets/malformed`)).status, 400)
  assert.equal((await fetch(`${base}/api/library/assets/asset-m27-999`)).status, 404)
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.evidence.frameId, "frame-m27-042")
  assert.equal(snapshot.evidence.correction.action, "none")
  assert.equal("results" in snapshot, false)
  assert.equal(JSON.stringify(snapshot).includes("asset-m27-"), false)
  const html = await fetch(`${base}/`).then((response) => response.text())
  assert.match(html, /id="library-results"/)
  assert.match(html, /id="evidence-surface"/)
  assert.match(html, /id="stack-source"/)
  assert.match(html, /id="stack-trace" role="status"/)
  assert.match(html, /Pause capture/)
  assert.match(html, /Resume capture/)
  assert.match(html, /Stop run/)
  assert.match(html, /\/api\/commands\/stop-run/)
  assert.match(html, /\/api\/commands\/resume-run/)
  assert.match(html, /expectedRunRevision:s\.run\.revision/)
  assert.match(html, /id="pause-dispatch" role="status"/)
  assert.match(html, /stop-stack dispatch failed/)
  assert.match(html, /id="pause-consequence" role="status"/)
  assert.match(html, /Pause accepts resumable capture and requests Seestar stop-stack/)
  assert.match(html, /Resume restores capture and requests Seestar start-stack/)
  assert.match(html, /start-stack dispatch failed/)
  assert.match(html, /Stop is terminal: M27 cannot be resumed/)
  assert.match(html, /terminal stop-stack dispatch completed/)
  assert.match(html, /Stack observed /)
  assert.match(html, /correction-protection/)
  assert.match(html, /id="library-prev" aria-label="Previous Library results window" disabled/)
  assert.match(html, /id="library-next" aria-label="Next Library results window" disabled/)
  assert.match(html, /libraryNext\.onclick=/)
  assert.match(html, /start\+12/)
  assert.match(html, /\/api\/library\?queryId=library-m27&pageSize=40/)
  await listener.close(); service.close()
})

test("a failed durable outbox write rolls back the entire run acceptance", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  service.database.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'forced outbox failure'); END;")
  const failed = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "rollback-run" }) })
  assert.equal(failed.status, 400)
  assert.deepEqual(await failed.json(), { outcome: "rejected", reason: "InvalidInput", message: "The service could not read that action." })
  const after = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(after.run, null)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count, 0)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM receipts").get() as { count: number }).count, 0)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 0)
  await listener.close(); service.close()
})

test("HTTP boundary rejects stale and server-configured phone intents without state change", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  const stale = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 0, expectedLeaseRevision: 1, idempotencyKey: "stale" }) })
  assert.equal(stale.status, 409)
  const phoneService = createLocalWebService(":memory:", () => ({ personId: "owner-chicks", clientId: "phone-monitor", capability: "readOnly" }))
  const phoneListener = await phoneService.listen()
  t.after(async () => { await listener.close(); service.close(); await phoneListener.close(); phoneService.close() })
  const phone = await fetch(`http://127.0.0.1:${phoneListener.port}/api/commands/start-run`, { method: "POST", headers: { "x-client-capability": "controlCapable" }, body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "phone" }) })
  assert.equal(phone.status, 403)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count, 0)
  await listener.close(); service.close(); await phoneListener.close(); phoneService.close()
})

test("authenticated workspace projections preserve future intent, bounded Library evidence, and a stable Process handoff", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const plan = await fetch(`${base}/api/workspaces/plan`).then((response) => response.json())
  assert.equal(plan.planId, "plan-m27"); assert.equal(plan.readiness, "ready"); assert.equal(plan.sequences[0].capture, "24 × 180s · L"); assert.equal(plan.observingWindow.horizonClearanceDeg, 28); assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(plan.observingWindow.startsAt)), "23:18"); assert.equal(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(plan.observingWindow.endsAt)), "01:02")
  const library = await fetch(`${base}/api/library?queryId=workspace-coverage&pageSize=1&sort=capturedAtDescending`).then((response) => response.json())
  assert.equal(library.results.length, 1); assert.equal(library.nextCursor, "1")
  const assetId = library.results[0].assetId
  const detail = await fetch(`${base}/api/library/assets/${assetId}`).then((response) => response.json())
  assert.equal(detail.assetId, assetId); assert.equal(detail.lineage.runId, "run-m27-001")
  const process = await fetch(`${base}/api/workspaces/process?sourceAssetId=${assetId}`).then((response) => response.json())
  assert.equal(process.sourceAssetId, assetId); assert.equal(process.preview.state, "synchronized"); assert.equal(process.history.at(-1).state, "current"); assert.match(process.protection, /Apply, Save/)
  const snapshot = await fetch(`${base}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.run, null); assert.equal((service.database.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count, 0)
  assert.equal((await fetch(`${base}/api/workspaces/process?sourceAssetId=asset-other`)).status, 404)
  const unavailable = await fetch(`${base}/api/workspaces/process?sourceAssetId=asset-m27-013`)
  assert.equal(unavailable.status, 409); assert.deepEqual(await unavailable.json(), { outcome: "rejected", reason: "AssetUnavailable", message: "This asset is temporarily unavailable and cannot open in Process." })
})

test("workspace projections remain behind existing admission", async (t) => {
  const service = createLocalWebService(":memory:", () => undefined); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  for (const path of ["/api/workspaces/plan", "/api/workspaces/process", "/api/library?queryId=workspace-coverage&sort=capturedAtDescending"]) assert.equal((await fetch(`${base}${path}`)).status, 401)
})

test("a request query cannot select phone or controller capability", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  const queried = await fetch(`${base}/api/snapshot?mode=phone`, { headers: { "x-client-capability": "readOnly" } }).then((response) => response.json())
  assert.equal(queried.identity.capability, "controlCapable")
  const phoneService = createLocalWebService(":memory:", () => ({ personId: "owner-chicks", clientId: "phone-monitor", capability: "readOnly" }))
  const phoneListener = await phoneService.listen()
  t.after(async () => { await listener.close(); service.close(); await phoneListener.close(); phoneService.close() })
  const trustedPhone = await fetch(`http://127.0.0.1:${phoneListener.port}/api/snapshot?mode=desktop`).then((response) => response.json())
  assert.equal(trustedPhone.identity.capability, "readOnly")
  const html = await fetch(`http://127.0.0.1:${phoneListener.port}/`).then((response) => response.text())
  assert.match(html, /s\.identity\.capability==='readOnly'/)
  assert.match(html, /v\.message/)
  assert.match(html, /data-room="Plan"/)
  assert.match(html, /data-room="Observe"/)
  assert.match(html, /data-room="Library"/)
  assert.match(html, /data-room="Process"/)
  assert.match(html, /if\(s\.identity\.capability==='readOnly'\)return/)
  assert.match(html, /if\(innerWidth<=600\)return/)
  assert.match(html, /addEventListener\('resize',\(\)=>\{if\(projection\)render\(projection\)\}\)/)
  assert.match(html, /addEventListener\('orientationchange',\(\)=>\{if\(projection\)render\(projection\)\}\)/)
  assert.match(html, /detail\.availability==='availableLocally'/)
  assert.match(html, /temporarily unavailable and cannot open in Process/)
  assert.match(html, /select\('Observe'\)/)
  assert.match(html, /SERVICE TRUTH<button id="return" hidden/)
  assert.match(html, /q\('#return'\)\.hidden=!s\.run/)
  assert.equal(html.includes("MutationObserver"), false)
  for (const raw of ["ControlGranted", "ControlRequested", "ControlLeaseLost"]) assert.equal(html.includes(raw), false)
  await listener.close(); service.close(); await phoneListener.close(); phoneService.close()
})

test("malformed and oversized bodies become bounded InvalidInput rejections", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const malformed = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: "{" })
  assert.deepEqual(await malformed.json(), { outcome: "rejected", reason: "InvalidInput", message: "The service could not read that action." })
  const oversized = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: "x".repeat(16_385) })
  assert.equal(oversized.status, 413); assert.deepEqual(await oversized.json(), { outcome: "rejected", reason: "InvalidInput", message: "The service could not read that action." })
  await listener.close(); service.close()
})

test("protected responses install browser security headers without caching service truth", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const response = await fetch(`${base}/api/snapshot`)
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("x-frame-options"), "DENY"); assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/)
  const asset = await fetch(`${base}/assets/brand/alignment-aperture-light.svg`)
  assert.equal(asset.headers.get("cache-control"), "public, max-age=3600"); assert.equal(asset.headers.get("content-security-policy"), response.headers.get("content-security-policy"))
})

test("SSE sends a snapshot before durable cursor catch-up and never replays a command", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  assert.notEqual(reader, undefined)
  const first = new TextDecoder().decode((await reader?.read()).value)
  assert.match(first, /event: snapshot/)
  const started = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "sse-run" }) })
  assert.equal(started.status, 202)
  const next = new TextDecoder().decode((await reader?.read()).value)
  assert.match(next, /event: RunStarted/)
  await reader?.cancel(); await listener.close(); service.close()
})

test("browser reconnect installs a current snapshot and its stale shell offers no mutation replay", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen(); const base = `http://127.0.0.1:${listener.port}`
  t.after(async () => { await listener.close(); service.close() })
  const firstStream = await fetch(`${base}/api/events`); const firstReader = firstStream.body?.getReader(); await firstReader?.read(); await firstReader?.cancel()
  const started = await fetch(`${base}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "reconnect-start" }) })
  assert.equal(started.status, 202)
  const reconnectStream = await fetch(`${base}/api/events`); const reconnectReader = reconnectStream.body?.getReader(); const reconnect = new TextDecoder().decode((await reconnectReader?.read()).value)
  assert.match(reconnect, /event: snapshot/); assert.match(reconnect, /"phase":"capture"/)
  assert.equal((service.database.prepare("SELECT count(*) AS count FROM outbox WHERE kind='StartM27Capture'").get() as { count: number }).count, 1)
  const shell = await fetch(`${base}/`).then((response) => response.text())
  assert.match(shell, /connection lost · last confirmed/); assert.match(shell, /no action will be replayed/); assert.match(shell, /s\.connection==='stale'/)
  await reconnectReader?.cancel(); await listener.close(); service.close()
})

test("expired reconnect grace survives restart, releases control to nobody, and preserves accepted work", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-lease-recovery-")), "state.sqlite")
  const owner = createLocalWebService(databasePath, () => ({ personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable", role: "owner" }))
  const friend = createLocalWebService(databasePath, () => ({ personId: "friend-ada", clientId: "desktop-ada", capability: "controlCapable" }))
  const ownerListener = await owner.listen(); const friendListener = await friend.listen(); const ownerBase = `http://127.0.0.1:${ownerListener.port}`; const friendBase = `http://127.0.0.1:${friendListener.port}`
  await fetch(`${ownerBase}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: 1, idempotencyKey: "lease-recovery-run" }) })
  const impostor = await fetch(`${friendBase}/api/commands/controller-disconnected`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "impostor-disconnect" }) }).then((response) => response.json())
  assert.equal(impostor.reason, "ControlLeaseLost")
  await fetch(`${friendBase}/api/commands/request-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "lease-recovery-request" }) })
  await fetch(`${ownerBase}/api/commands/grant-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "lease-recovery-grant" }) })
  const disconnected = await fetch(`${friendBase}/api/commands/controller-disconnected`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 2, idempotencyKey: "lease-recovery-disconnect" }) }).then((response) => response.json())
  assert.equal(disconnected.eventType, "ControlReconnectGraceStarted")
  await ownerListener.close(); await friendListener.close(); owner.close(); friend.close()
  const persisted = new DatabaseSync(databasePath); persisted.prepare("UPDATE state SET value=? WHERE key='reconnectGraceUntil'").run(JSON.stringify("2000-01-01T00:00:00.000Z")); persisted.close()
  const recovered = createLocalWebService(databasePath, () => ({ personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable", role: "owner" })); const recoveredListener = await recovered.listen()
  t.after(async () => { await recoveredListener.close(); recovered.close() })
  const snapshot = await fetch(`http://127.0.0.1:${recoveredListener.port}/api/snapshot`).then((response) => response.json())
  assert.equal(snapshot.control.holderClientId, null); assert.equal(snapshot.control.state, "unheld"); assert.equal(snapshot.control.revision, 4); assert.equal(snapshot.run.phase, "capture")
  assert.equal((recovered.database.prepare("SELECT type FROM events ORDER BY cursor DESC LIMIT 1").get() as { type: string }).type, "ControlGraceExpired")
  await recoveredListener.close(); recovered.close()
})

test("two server-configured desktops transfer control without stopping the accepted run", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-control-")), "state.sqlite")
  const owner = createLocalWebService(databasePath, () => ({ personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable", role: "owner" }))
  const friend = createLocalWebService(databasePath, () => ({ personId: "friend-ada", clientId: "desktop-ada", capability: "controlCapable" }))
  const ownerListener = await owner.listen(); const friendListener = await friend.listen()
  t.after(async () => { await ownerListener.close(); await friendListener.close(); owner.close(); friend.close() })
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`; const friendBase = `http://127.0.0.1:${friendListener.port}`
  const initial = await fetch(`${ownerBase}/api/snapshot`).then((response) => response.json())
  await fetch(`${ownerBase}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: initial.control.revision, idempotencyKey: "run-before-takeover" }) })
  await fetch(`${friendBase}/api/commands/request-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "ada-request" }) })
  const granted = await fetch(`${ownerBase}/api/commands/grant-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "owner-grant" }) })
  assert.equal(granted.status, 202)
  const oldController = await fetch(`${ownerBase}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 2, expectedRunRevision: 1, idempotencyKey: "old-pause" }) })
  const oldResult = await oldController.json()
  assert.equal(oldResult.reason, "ControlLeaseLost")
  assert.equal(oldResult.message, "Control changed hands. Your command was not sent to the observatory; the accepted run continues.")
  const after = await fetch(`${friendBase}/api/snapshot`).then((response) => response.json())
  assert.equal(after.control.holderClientId, "desktop-ada")
  assert.equal(after.run.phase, "capture")
  assert.equal((owner.database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: number }).count, 1)
  await ownerListener.close(); await friendListener.close(); owner.close(); friend.close()
})

test("an owner SSE projection advances when a friend writes the shared SQLite database", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-projection-")), "state.sqlite")
  const owner = createLocalWebService(databasePath, () => ({ personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable", role: "owner" }))
  const friend = createLocalWebService(databasePath, () => ({ personId: "friend-ada", clientId: "desktop-ada", capability: "controlCapable" }))
  const ownerListener = await owner.listen(); const friendListener = await friend.listen()
  t.after(async () => { await ownerListener.close(); await friendListener.close(); owner.close(); friend.close() })
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`; const friendBase = `http://127.0.0.1:${friendListener.port}`
  const stream = await fetch(`${ownerBase}/api/events`); const reader = stream.body?.getReader(); await reader?.read()
  await fetch(`${friendBase}/api/commands/request-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "projection-request" }) })
  const changed = await Promise.race([
    reader?.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("owner did not receive cross-process projection")), 2_000)),
  ])
  const text = new TextDecoder().decode(changed?.value)
  assert.match(text, /event: ProjectionChanged/)
  assert.match(text, /desktop-ada/)
  await reader?.cancel(); await ownerListener.close(); await friendListener.close(); owner.close(); friend.close()
})

test("listener shutdown closes a consumed keep-alive request", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen()
  t.after(() => service.close())
  const response = await fetch(`http://127.0.0.1:${listener.port}/api/health/ready`)
  assert.equal(response.status, 200); await response.text()
  await Promise.race([listener.close(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("listener shutdown timed out")), 1_000))])
})

test("serves the accepted V1 light symbol from the local application origin", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen()
  t.after(async () => { await listener.close(); service.close() })
  const response = await fetch(`http://127.0.0.1:${listener.port}/assets/brand/alignment-aperture-light.svg`)
  assert.equal(response.headers.get("content-type"), "image/svg+xml")
  assert.match(await response.text(), /Astro Console V1 symbol/)
  await listener.close(); service.close()
})

test("a missing packaged brand asset is a bounded 404 rather than a server failure", async (t) => {
  const service = createLocalWebService(":memory:", undefined, new URL("file:///tmp/astro-console-missing-brand.svg")); const listener = await service.listen()
  t.after(async () => { await listener.close(); service.close() })
  const response = await fetch(`http://127.0.0.1:${listener.port}/assets/brand/alignment-aperture-light.svg`)
  assert.equal(response.status, 404); assert.equal(await response.text(), "Brand asset unavailable")
})
