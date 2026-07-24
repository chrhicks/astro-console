import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"
import { createLocalWebService } from "./server.ts"

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
  assert.deepEqual(await oversized.json(), { outcome: "rejected", reason: "InvalidInput", message: "The service could not read that action." })
  await listener.close(); service.close()
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

test("two server-configured desktops transfer control without stopping the accepted run", async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), "astro-control-")), "state.sqlite")
  const owner = createLocalWebService(databasePath, () => ({ personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable" }))
  const friend = createLocalWebService(databasePath, () => ({ personId: "friend-ada", clientId: "desktop-ada", capability: "controlCapable" }))
  const ownerListener = await owner.listen(); const friendListener = await friend.listen()
  t.after(async () => { await ownerListener.close(); await friendListener.close(); owner.close(); friend.close() })
  const ownerBase = `http://127.0.0.1:${ownerListener.port}`; const friendBase = `http://127.0.0.1:${friendListener.port}`
  const initial = await fetch(`${ownerBase}/api/snapshot`).then((response) => response.json())
  await fetch(`${ownerBase}/api/commands/start-run`, { method: "POST", body: JSON.stringify({ _tag: "StartRunFromPlan", planId: "plan-m27", expectedPlanRevision: 3, expectedLeaseRevision: initial.control.revision, idempotencyKey: "run-before-takeover" }) })
  await fetch(`${friendBase}/api/commands/request-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "ada-request" }) })
  const granted = await fetch(`${ownerBase}/api/commands/grant-control`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 1, idempotencyKey: "owner-grant" }) })
  assert.equal(granted.status, 202)
  const oldController = await fetch(`${ownerBase}/api/commands/pause-run`, { method: "POST", body: JSON.stringify({ expectedLeaseRevision: 2, idempotencyKey: "old-pause" }) })
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
  const owner = createLocalWebService(databasePath, () => ({ personId: "owner-chicks", clientId: "desktop-owner", capability: "controlCapable" }))
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

test("serves the accepted V1 light symbol from the local application origin", async (t) => {
  const service = createLocalWebService(); const listener = await service.listen()
  t.after(async () => { await listener.close(); service.close() })
  const response = await fetch(`http://127.0.0.1:${listener.port}/assets/brand/alignment-aperture-light.svg`)
  assert.equal(response.headers.get("content-type"), "image/svg+xml")
  assert.match(await response.text(), /svg/)
  await listener.close(); service.close()
})
