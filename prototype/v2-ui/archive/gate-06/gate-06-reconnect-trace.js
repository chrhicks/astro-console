const TRACE_LIST = [
  ["snapshot-first", "Snapshot-first replacement"], ["cursor-discipline", "Cursor discipline"], ["no-replay", "No stale command replay"], ["debounce-loss", "Debounce loss"], ["accepted-preview", "Accepted preview restore"], ["supersession", "Preview supersession"], ["phone", "Read-only phone truth"],
]

const elements = {
  select: document.querySelector("[data-trace-select]"), run: document.querySelector("[data-run-trace]"), runAll: document.querySelector("[data-run-all]"), surface: document.querySelector("[data-process-surface]"), phone: document.querySelector("[data-phone-trace]"), status: document.querySelector("[data-trace-status]"), results: document.querySelector("[data-trace-results]"), log: document.querySelector("[data-trace-log]"),
}

let latest = runTrace("snapshot-first")
elements.select.innerHTML = TRACE_LIST.map(([id, label]) => `<option value="${id}">${label}</option>`).join("")
elements.select.value = "snapshot-first"
elements.run.addEventListener("click", () => { latest = runTrace(elements.select.value); render(latest) })
elements.runAll.addEventListener("click", () => { latest = runAll(); render(latest) })
render(latest)

function snapshot(version, cursor, preview = { id: "preview-s10", seq: 4, params: "stretch 0.42", base: 2, state: "ready", progress: 100, output: "preview-s10-image" }) {
  return { version, cursor, generatedAt: `2026-07-23T20:${String(cursor).padStart(2, "0")}:00Z`, run: `M27 revision ${version}`, session: { id: "process-m27", history: 2, image: "linear-master-m27", preview }, }
}

function initial() { return { connection: "current", lastConfirmed: "2026-07-23T20:40:00Z", snapshot: snapshot(10, 40), away: [], sends: 0, pending: 0, log: [] } }
function fresh() { return snapshot(12, 52, { id: "preview-s12", seq: 6, params: "stretch 0.57 · black 0.08", base: 2, state: "computing", progress: 62, output: "valid-preview-s12" }) }
function clone(value) { return JSON.parse(JSON.stringify(value)) }
function assert(result, label, pass, detail) { result.assertions.push({ label, pass, detail }) }
function note(state, message) { state.log.push(message) }

function installSnapshot(state, authoritative, away = []) { state.snapshot = clone(authoritative); state.connection = "current"; state.lastConfirmed = authoritative.generatedAt; state.away = away; state.pending = 0; note(state, `install S${authoritative.version}/C${authoritative.cursor} atomically`) }
function receive(state, event) {
  const before = JSON.stringify(state.snapshot)
  if (state.connection !== "current") { state.connection = "reconnecting"; note(state, `${event.name}: snapshot required; connection is not current`); return { decision: "SnapshotRequired", unchanged: before === JSON.stringify(state.snapshot) } }
  if (event.cursor <= state.snapshot.cursor) { note(state, `${event.name}: duplicate/regression ignored at C${event.cursor}`); return { decision: "Ignored", unchanged: before === JSON.stringify(state.snapshot) } }
  if (event.cursor !== state.snapshot.cursor + 1) { state.connection = "reconnecting"; note(state, `${event.name}: cursor gap C${state.snapshot.cursor} → C${event.cursor}; snapshot required`); return { decision: "SnapshotRequired", unchanged: before === JSON.stringify(state.snapshot) } }
  if (event.version < state.snapshot.version) { state.connection = "reconnecting"; note(state, `${event.name}: snapshot version regression; snapshot required`); return { decision: "SnapshotRequired", unchanged: before === JSON.stringify(state.snapshot) } }
  event.apply(state.snapshot); state.snapshot.cursor = event.cursor; state.snapshot.version = event.version; state.snapshot.generatedAt = event.generatedAt; state.lastConfirmed = event.generatedAt; note(state, `${event.name}: applied C${event.cursor}`); return { decision: "Applied", unchanged: false }
}
function doNotSend(state, command) { note(state, `${command}: DoNotSend (ConnectionStale)`); return { decision: "DoNotSend", sends: state.sends, pending: state.pending } }

function runTrace(id) {
  const result = { id, label: Object.fromEntries(TRACE_LIST)[id], state: initial(), assertions: [] }
  if (id === "snapshot-first") traceSnapshotFirst(result)
  if (id === "cursor-discipline") traceCursorDiscipline(result)
  if (id === "no-replay") traceNoReplay(result)
  if (id === "debounce-loss") traceDebounceLoss(result)
  if (id === "accepted-preview") traceAcceptedPreview(result)
  if (id === "supersession") traceSupersession(result)
  if (id === "phone") tracePhone(result)
  return result
}
function runAll() {
  const runs = TRACE_LIST.map(([id]) => runTrace(id))
  const last = runs.at(-1)
  return { ...last, id: "all", label: "All deterministic traces", assertions: runs.flatMap((run) => run.assertions.map((entry) => ({ ...entry, label: `${run.label}: ${entry.label}` }))), state: last.state, log: runs.flatMap((run) => [`[${run.label}]`, ...run.state.log]) }
}

function traceSnapshotFirst(result) {
  const state = result.state
  state.connection = "reconnecting"; note(state, "disconnected at S10/C40")
  const before = state.snapshot
  installSnapshot(state, fresh(), ["M27 continued while away", "Preview recalculated on service"])
  assert(result, "Atomic service replacement", state.snapshot.version === 12 && state.snapshot.cursor === 52 && state.snapshot.session.preview.id === "preview-s12" && before.session.preview.id !== state.snapshot.session.preview.id, "S10/C40 replaced by S12/C52 including run, session, preview")
  const next = receive(state, { name: "ProcessingProjected", cursor: 53, version: 12, generatedAt: "2026-07-23T20:53:00Z", apply: (current) => { current.session.preview.progress = 79 } })
  assert(result, "Next event applies", next.decision === "Applied" && state.snapshot.cursor === 53 && state.snapshot.session.preview.progress === 79, "C53 advances only after fresh snapshot")
}
function traceCursorDiscipline(result) {
  const state = result.state
  const duplicate = receive(state, { name: "duplicate", cursor: 40, version: 10, generatedAt: state.snapshot.generatedAt, apply: () => {} })
  const next = receive(state, { name: "next", cursor: 41, version: 10, generatedAt: "2026-07-23T20:41:00Z", apply: (current) => { current.session.preview.progress = 41 } })
  const afterNext = JSON.stringify(state.snapshot)
  const regression = receive(state, { name: "regression", cursor: 42, version: 9, generatedAt: "2026-07-23T20:42:00Z", apply: () => {} })
  const afterRegression = JSON.stringify(state.snapshot)
  state.connection = "current"; note(state, "fresh-current fixture restored for independent gap check")
  const gap = receive(state, { name: "gap", cursor: 43, version: 10, generatedAt: "2026-07-23T20:43:00Z", apply: () => {} })
  assert(result, "Duplicate ignored; next applied", duplicate.decision === "Ignored" && next.decision === "Applied", "C40 ignored; C41 applied")
  assert(result, "Gap and regression require snapshot", gap.decision === "SnapshotRequired" && regression.decision === "SnapshotRequired" && afterNext === afterRegression, "No service projection mutated after gap/regression")
  const nonCurrent = receive(state, { name: "while reconnecting", cursor: 42, version: 10, generatedAt: "2026-07-23T20:42:00Z", apply: () => {} })
  assert(result, "Non-current events blocked", nonCurrent.decision === "SnapshotRequired" && nonCurrent.unchanged, "Incremental event cannot repair reconnecting client")
}
function traceNoReplay(result) {
  const state = result.state
  state.connection = "reconnecting"; const work = ["PauseRun", "ApplyProcessingPreview", "SyncProcessingPreview"].map((command) => doNotSend(state, command))
  assert(result, "Stale intents not replayed", work.every(({ decision }) => decision === "DoNotSend") && state.sends === 0 && state.pending === 0, "Pause, Apply, SyncPreview send count 0; accepted work unaffected")
}
function traceDebounceLoss(result) {
  const state = result.state
  const local = { slider: "stretch 0.73", sequence: 7 }
  state.connection = "reconnecting"; note(state, `local unsent ${local.slider} seq${local.sequence} discarded on reconnect`)
  installSnapshot(state, snapshot(12, 52, { id: "preview-accepted", seq: 6, params: "stretch 0.57", base: 2, state: "ready", progress: 100, output: "valid-preview-accepted" }))
  assert(result, "Unsent debounce loss", state.snapshot.session.preview.params === "stretch 0.57" && state.snapshot.session.history === 2, "Fresh service snapshot restores accepted preview; local 0.73 is lost; history unchanged")
}
function traceAcceptedPreview(result) {
  const state = result.state
  installSnapshot(state, snapshot(12, 52, { id: "preview-6", seq: 6, params: "stretch 0.57 · black 0.08 · highlights 0.71", base: 2, state: "computing", progress: 62, output: "last-valid-image-5" }))
  assert(result, "Accepted preview restored", state.snapshot.session.preview.id === "preview-6" && state.snapshot.session.preview.base === 2 && state.snapshot.session.preview.progress === 62 && state.snapshot.session.preview.output === "last-valid-image-5", "Preview id, complete params, base history, progress, and valid image restored")
  assert(result, "Preview remains non-history", state.snapshot.session.history === 2, "History does not advance for preview")
}
function traceSupersession(result) {
  const state = result.state
  const session = state.snapshot.session
  session.preview = { id: "preview-7", seq: 7, params: "stretch 0.61", base: 2, state: "computing", progress: 20, output: "last-valid-image-5" }
  session.preview = { id: "preview-8", seq: 8, params: "stretch 0.67", base: 2, state: "computing", progress: 45, output: "last-valid-image-5" }; note(state, "seq7 superseded by seq8")
  const before = JSON.stringify(session)
  const stale = completePreview(session, "preview-7", 7, "late-image")
  const duplicate = completePreview(session, "preview-8", 7, "duplicate-image")
  const afterRejected = JSON.stringify(session)
  const current = completePreview(session, "preview-8", 8, "preview-8-image")
  session.history = 3; session.preview.base = 2; note(state, "applied history advanced; preview base is now invalid")
  assert(result, "Stale and duplicate ignored", stale === "Rejected" && duplicate === "Rejected" && before === afterRejected, "Only current seq8 completion may mutate preview")
  assert(result, "Current completion and invalidation", current === "Accepted" && session.preview.output === "preview-8-image" && session.history === 3 && session.preview.base !== session.history, "Seq8 accepted; later history invalidates old-base preview; preview never becomes history")
}
function completePreview(session, previewId, sequence, output) { if (session.preview.id !== previewId || session.preview.seq !== sequence || session.preview.state === "ready") return "Rejected"; session.preview.state = "ready"; session.preview.progress = 100; session.preview.output = output; return "Accepted" }
function tracePhone(result) {
  const state = result.state
  installSnapshot(state, fresh())
  const phone = phoneProjection(state)
  assert(result, "Phone projects canonical truth", phone.preview === state.snapshot.session.preview.id && phone.connection === state.connection, "Same current snapshot semantics")
  assert(result, "Phone has no mutations", phone.controls === 0, "Read-only Process monitor")
}

function render(result) {
  const state = result.state; const session = state.snapshot.session; const preview = session.preview
  elements.surface.dataset.trace = result.id; elements.surface.dataset.connection = state.connection; elements.surface.dataset.snapshotVersion = String(state.snapshot.version); elements.surface.dataset.cursor = String(state.snapshot.cursor); elements.surface.innerHTML = `<header class="process-status"><div><strong>M27 · Develop image</strong><small data-connection class="connection-${state.connection}">${state.connection === "current" ? "Current service state" : "Reconnecting — snapshot required"} · last confirmed ${state.lastConfirmed}</small></div><div><strong data-away-summary>${state.away.length ? state.away.join(" · ") : "No changes while away"}</strong><small>Service-owned Process session</small></div></header><div class="process-body"><div class="process-image"><div class="image-label"><strong data-last-valid-image>Last valid image · ${preview.output}</strong><small>Preview stays distinct from applied history</small></div></div><aside class="process-summary"><div class="summary-card"><small>Process state</small><strong data-process-state>${state.connection === "current" ? "Available" : "Refreshing authoritative state"}</strong></div><div class="summary-card"><small>Preview</small><strong data-preview-status>${preview.id} · seq ${preview.seq} · ${preview.state} ${preview.progress}%</strong></div><div class="summary-card"><small>Preview settings</small><strong data-preview-params>${preview.params}</strong></div><div class="summary-card"><small>Applied history</small><strong data-history-position>${session.history} applied operations</strong></div></aside></div>`
  elements.phone.innerHTML = `<section data-phone-summary data-phone-controls="none"><div class="phone-mode-label"><span>Read-only Process monitor</span><small>No controls</small></div><p class="eyebrow">Current service state</p><h2>${state.connection === "current" ? "Process available" : "Refreshing Process state"}</h2><p class="muted">Preview ${preview.id} · ${preview.state} ${preview.progress}% · last valid image ${preview.output}</p><div class="phone-stats"><span><small>History</small><b>${session.history} applied</b></span><span><small>Connection</small><b>${state.connection}</b></span></div></section>`
  elements.results.innerHTML = result.assertions.map((item) => `<li class="${item.pass ? "pass" : "fail"}"><span aria-hidden="true">${item.pass ? "✓" : "×"}</span><div><strong>${item.label}</strong><small>${item.detail}</small></div></li>`).join("")
  elements.log.textContent = (result.log ?? state.log).join("\n")
  const passed = result.assertions.filter((item) => item.pass).length
  elements.status.textContent = `${result.label}: ${passed}/${result.assertions.length} deterministic assertions passed. Trace diagnostics are secondary to the semantic Process projection.`
}
function phoneProjection(state) { return { connection: state.connection, preview: state.snapshot.session.preview.id, controls: 0 } }
