const TARGETS = [
  { id: "m27", name: "M27 · Dumbbell", type: "Planetary nebula", window: "22:04–00:43", windowStart: 4, windowEnd: 163, scheduledStart: 12, scheduledEnd: 150, scheduledLabel: "22:12–00:30", altitude: "72°", duration: "2h 18m", frames: "42", filters: "OIII 24 · Hα 18", fit: "Excellent fit · 13m margin", color: "var(--cyan)" },
  { id: "ngc7000", name: "NGC 7000", type: "Emission nebula", window: "22:58–03:18", windowStart: 58, windowEnd: 318, scheduledStart: 165, scheduledEnd: 238, scheduledLabel: "00:45–01:58", altitude: "71°", duration: "1h 13m", frames: "20", filters: "Hα 20", fit: "Good fit · 25m margin", color: "var(--violet)" },
  { id: "m31", name: "M31 · Andromeda", type: "Galaxy", window: "00:37–04:29", windowStart: 157, windowEnd: 389, scheduledStart: 252, scheduledEnd: 343, scheduledLabel: "02:12–03:43", altitude: "68°", duration: "1h 31m", frames: "72", filters: "L 36 · RGB 12 each", fit: "Fits with meridian flip", color: "var(--blue)" },
  { id: "ngc1499", name: "NGC 1499 · California", type: "Emission nebula", window: "02:16–04:29", windowStart: 256, windowEnd: 389, scheduledStart: null, scheduledEnd: null, scheduledLabel: null, altitude: "49°", duration: "58m", frames: "16", filters: "Hα 16", fit: "Optional · 14m margin", color: "var(--green)" }
]

const PLAN_PLOT = {
  durationMinutes: 390,
  ticks: [{ label: "22:00", minute: 0 }, { label: "00:00", minute: 120 }, { label: "02:00", minute: 240 }, { label: "04:00", minute: 360 }, { label: "04:30", minute: 390 }]
}

const FRAMES = [
  { id: "f08", number: "008", time: "22:35", quality: "accepted", fwhm: "2.8″", eccentricity: "0.42" },
  { id: "f09", number: "009", time: "22:38", quality: "accepted", fwhm: "2.9″", eccentricity: "0.43" },
  { id: "f10", number: "010", time: "22:41", quality: "marginal", fwhm: "3.7″", eccentricity: "0.48" },
  { id: "f11", number: "011", time: "22:44", quality: "accepted", fwhm: "3.0″", eccentricity: "0.43" },
  { id: "f12", number: "012", time: "22:48", quality: "accepted", fwhm: "2.9″", eccentricity: "0.43" },
  { id: "f13", number: "013", time: "22:51", quality: "accepted", fwhm: "3.1″", eccentricity: "0.44" },
  { id: "f14", number: "014", time: "22:54", quality: "rejected", fwhm: "4.6″", eccentricity: "0.61" },
  { id: "f15", number: "015", time: "22:58", quality: "marginal", fwhm: "3.8″", eccentricity: "0.49" }
]

const state = {
  workspace: "plan",
  railCollapsed: false,
  selectedTargetId: "m27",
  selectedFrameId: "f13",
  contextTab: "inspector",
  inspectorSubject: "context",
  frameFilter: "all",
  scenario: "healthy",
  feedback: ""
}

const workspaceContent = document.querySelector("[data-workspace-content]")
const contextContent = document.querySelector("[data-context-content]")
const phoneMonitor = document.querySelector("[data-phone-monitor]")

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest("button")
  if (!button) return

  const workspace = button.getAttribute("data-workspace")
  if (workspace) return updateState({ workspace, inspectorSubject: "context", feedback: `Switched to ${workspaceLabel(workspace)}. The active M27 run continues unchanged.` })

  if (button.hasAttribute("data-rail-toggle")) return updateState({ railCollapsed: !state.railCollapsed })
  if (button.hasAttribute("data-inspect-run")) return updateState({ contextTab: "inspector", inspectorSubject: "run", feedback: "Active run loaded in Inspector without changing the workspace." })

  const targetId = button.getAttribute("data-target-id")
  if (targetId) return updateState({ selectedTargetId: targetId, contextTab: "inspector", inspectorSubject: "context", feedback: "" })

  const frameId = button.getAttribute("data-frame-id")
  if (frameId) return updateState({ selectedFrameId: frameId, contextTab: "inspector", inspectorSubject: "context", feedback: "" })

  const contextTab = button.getAttribute("data-context-tab")
  if (contextTab) return updateState({ contextTab })

  const filter = button.getAttribute("data-frame-filter")
  if (filter) return updateState({ frameFilter: filter })

  const action = button.getAttribute("data-sim-action")
  if (action) return updateState({ feedback: `${action} — simulated only; no observatory command was sent.` })
})

document.querySelector("[data-scenario-control]")?.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLSelectElement)) return
  updateState({ scenario: event.target.value, contextTab: event.target.value === "healthy" ? state.contextTab : "alerts", feedback: "Synthetic scenario changed; the active run was not modified." })
})

render()

function updateState(change) {
  Object.assign(state, change)
  render()
}

function render() {
  renderShellState()
  renderRunState()
  renderWorkspace()
  renderContext()
  renderPhoneMonitor()
  renderFeedback()
}

function renderShellState() {
  const rail = document.querySelector("[data-composite-rail]")
  rail?.classList.toggle("collapsed", state.railCollapsed)
  document.querySelector("[data-rail-icon]").textContent = state.railCollapsed ? "»" : "«"
  document.querySelector("[data-rail-toggle]")?.setAttribute("aria-label", state.railCollapsed ? "Expand workspace rail" : "Collapse workspace rail")
  document.querySelectorAll("[data-workspace]").forEach((button) => {
    const active = button.getAttribute("data-workspace") === state.workspace
    button.classList.toggle("active", active)
    if (active) button.setAttribute("aria-current", "page")
    else button.removeAttribute("aria-current")
  })
  const scenarioControl = document.querySelector("[data-scenario-control]")
  if (scenarioControl instanceof HTMLSelectElement) scenarioControl.value = state.scenario
}

function renderRunState() {
  const scenario = scenarioPresentation()
  const subtitle = document.querySelector("[data-run-subtitle]")
  if (subtitle) subtitle.textContent = `Frame 14 of 24 · ${scenario.runLabel} · next: ${scenario.nextEvent}`

  const escalation = document.querySelector("[data-contextual-escalation]")
  escalation?.toggleAttribute("hidden", !scenario.contextualEscalation)
  if (escalation && scenario.contextualEscalation) escalation.innerHTML = `<span class="bad">●</span><span><strong>${scenario.contextualEscalation.title}</strong><small>${scenario.contextualEscalation.detail}</small></span><button class="button danger" type="button" data-context-tab="alerts">Open recovery</button>`
}

function renderWorkspace() {
  if (!workspaceContent) return
  if (state.workspace === "plan") workspaceContent.innerHTML = renderPlan()
  if (state.workspace === "observe") workspaceContent.innerHTML = renderObserve()
  if (state.workspace === "library") workspaceContent.innerHTML = renderLibrary()
  if (state.workspace === "process") workspaceContent.innerHTML = renderProcess()
}

function renderPlan() {
  const selected = selectedTarget()
  const grid = PLAN_PLOT.ticks.map((tick) => `<i class="plot-gridline" style="--tick:${plotPercent(tick.minute)}"></i>`).join("")
  const lanes = TARGETS.map((target) => `<div class="opportunity-lane ${target.id === selected.id ? "selected" : ""}"><button type="button" data-target-id="${target.id}" aria-pressed="${target.id === selected.id}"><strong>${target.name}</strong><small>${target.window}</small></button><span class="opportunity-plot">${grid}<span class="opportunity-window" style="--start:${plotPercent(target.windowStart)};--width:${plotPercent(target.windowEnd - target.windowStart)};--target:${target.color}" aria-label="Usable ${target.window}"></span>${target.scheduledStart === null ? "" : `<span class="scheduled-window" style="--start:${plotPercent(target.scheduledStart)};--width:${plotPercent(target.scheduledEnd - target.scheduledStart)};--target:${target.color}" aria-label="Scheduled ${target.scheduledLabel}, ${target.duration}">${target.duration}</span>`}</span></div>`).join("")
  const cards = TARGETS.map((target) => `<button class="plan-summary-card ${target.id === selected.id ? "selected" : ""}" type="button" data-target-id="${target.id}" aria-pressed="${target.id === selected.id}"><span><small>${target.type}</small><strong>${target.name}</strong></span><b>${target.fit}</b><span class="plan-card-foot"><i>${target.duration}</i><i>${target.frames} frames</i><i>Peak ${target.altitude}</i></span></button>`).join("")
  const ticks = PLAN_PLOT.ticks.map((tick) => `<i style="--tick:${plotPercent(tick.minute)}">${tick.label}</i>`).join("")
  return `<header class="workspace-heading"><div><p class="eyebrow">Plan workspace</p><h2>Monday · Summer narrowband</h2><p>Parallel sky opportunities with one executable schedule overlaid.</p></div><div class="button-row"><button class="button" type="button" data-sim-action="Validate current plan">Validate</button><button class="button primary" type="button" data-sim-action="Approve plan revision 7">Approve plan</button></div></header><div class="plan-metrics"><span><small>Darkness</small><b>22:11–04:29</b></span><span><small>Scheduled capture</small><b>5h 02m</b></span><span><small>Storage</small><b>38.6 GB</b></span><span><small>Moon</small><b>18% · sets 23:42</b></span></div><section class="opportunity-panel" aria-label="Target opportunity lanes from 22:00 to 04:30"><div class="opportunity-chart"><div class="opportunity-axis"><span>Target</span><span class="opportunity-axis-plot">${ticks}</span></div>${lanes}</div><div class="opportunity-key"><span><i></i>Usable target window</span><span><i class="scheduled"></i>Selected schedule</span></div></section><section><div class="pane-header"><h2>Target summaries</h2><span class="fine">Select a target to inspect its capture contract</span></div><div class="plan-card-grid">${cards}</div></section>`
}

function plotPercent(minutes) {
  return `${((minutes / PLAN_PLOT.durationMinutes) * 100).toFixed(3)}%`
}

function renderObserve() {
  const scenario = scenarioPresentation()
  const header = `<header class="workspace-heading"><div><p class="eyebrow">Observe · ${scenario.phase}</p><h2>${scenario.observeHeading}</h2><p>${scenario.observeSubheading}</p></div><span class="pill ${scenario.pillClass}">${scenario.runLabel}</span></header>`
  const evidence = renderObserveEvidence(scenario)
  const assessment = `<section class="observe-assessment"><p class="eyebrow">Assessment</p><h3>${scenario.interpretationTitle}</h3><p>${scenario.interpretation}</p><ul>${scenario.evidencePoints.map((point) => `<li>${point}</li>`).join("")}</ul></section>`
  if (state.scenario === "healthy") return `${header}<div class="observe-composition healthy">${evidence}${assessment}</div>`
  const decision = `<section class="observe-decision ${state.scenario === "recovery" ? "blocking" : "recommended"}"><p class="eyebrow">${state.scenario === "recovery" ? "Blocking recovery decision" : "Recommendation"}</p><h3>${scenario.actionTitle}</h3><p>${scenario.actionDetail}</p><button class="button ${scenario.actionClass}" type="button" data-sim-action="${scenario.actionLabel}">${scenario.actionLabel}</button><small>Simulation only. The service would own eligibility and approval.</small></section>`
  if (state.scenario === "recovery") return `${header}<div class="observe-composition recovery">${decision}${assessment}<div class="supporting-evidence">${evidence}</div></div>`
  return `${header}<div class="observe-composition warning">${evidence}<div>${assessment}${decision}</div></div>`
}

function renderObserveEvidence(scenario) {
  return `<section class="observe-evidence"><p class="eyebrow">Latest evidence</p><div class="evidence-frame" role="img" aria-label="Synthetic latest M27 OIII evidence frame"><span class="frame-label top-left">M27_OIII_014 · 180s · gain 100</span><span class="target-ring"></span><span class="frame-label bottom-right">FWHM ${scenario.fwhm} · RMS 0.74″ · background 612 ADU</span></div><div class="stat-grid"><div class="stat"><small>Frame</small><strong>14 / 24</strong></div><div class="stat"><small>FWHM</small><strong>${scenario.fwhm}</strong></div><div class="stat"><small>Guiding</small><strong>0.74″</strong></div><div class="stat"><small>Storage</small><strong>${scenario.storage}</strong></div></div></section>`
}

function renderLibrary() {
  const visibleFrames = state.frameFilter === "all" ? FRAMES : FRAMES.filter((frame) => frame.quality === state.frameFilter)
  const filters = ["all", "accepted", "marginal", "rejected"].map((filter) => `<button type="button" data-frame-filter="${filter}" aria-pressed="${state.frameFilter === filter}">${filterLabel(filter)} · ${filter === "all" ? FRAMES.length : FRAMES.filter((frame) => frame.quality === filter).length}</button>`).join("")
  const frames = visibleFrames.map((frame) => `<button class="library-frame ${frame.quality} ${frame.id === state.selectedFrameId ? "selected" : ""}" type="button" data-frame-id="${frame.id}" aria-pressed="${frame.id === state.selectedFrameId}"><span class="frame-thumb"><i>✦</i></span><span><b>#${frame.number}</b><small>${frame.time}</small></span><em>${qualitySymbol(frame.quality)} ${frame.quality}</em><small>FWHM ${frame.fwhm}</small></button>`).join("")
  return `<header class="workspace-heading"><div><p class="eyebrow">Library workspace</p><h2>M27 · OIII session chronology</h2><p>Time order remains primary; quality badges and filters accelerate investigation.</p></div><span class="pill live">42 accepted · 5 marginal · 3 rejected</span></header><div class="library-filters" role="group" aria-label="Filter frames by quality">${filters}</div><div class="library-filmstrip" aria-label="Chronological session frames">${frames || `<p class="muted">No frames match this quality filter.</p>`}</div><section class="library-trend"><div><p class="eyebrow">Session trend</p><h3>Focus softened after frame 12</h3><p class="muted">Chronology makes the rise visible without moving marginal evidence into a separate collection.</p></div><svg viewBox="0 0 500 110" role="img" aria-label="Synthetic FWHM trend rising late in the session"><path d="M0 82H500M0 42H500" class="gridline"/><polyline points="0,76 60,72 120,75 180,66 240,70 300,60 360,55 420,28 500,22"/></svg></section>`
}

function renderProcess() {
  return `<header class="workspace-heading"><div><p class="eyebrow">Process workspace · unresolved study</p><h2>M27 OIII/Hα candidate stack</h2><p>This lightweight state establishes navigation and provenance without pretending the processing interaction model is settled.</p></div><span class="pill warning">Needs dedicated study</span></header><div class="process-provenance"><section><small>Inputs</small><strong>42 OIII · 31 Hα</strong><p>Accepted originals from July 20 run</p></section><span>→</span><section><small>Recipe</small><strong>Calibrate · align · stack</strong><p>Median combine · 2× drizzle off</p></section><span>→</span><section><small>Output</small><strong>M27 revision 03</strong><p>Derived asset · sources retained</p></section></div><div class="process-placeholder"><span class="mini-block"></span><div><h3>Processing remains near the data</h3><p>Recipe editing, intermediate comparison, tool adapters, and scheduling against active capture still require a focused prototype.</p><button class="button" type="button" data-sim-action="Queue processing study placeholder">Simulate queue</button></div></div>`
}

function renderContext() {
  const scenario = scenarioPresentation()
  const alerts = alertsForScenario()
  document.querySelectorAll("[data-context-tab]").forEach((button) => {
    const selected = button.getAttribute("data-context-tab") === state.contextTab
    button.setAttribute("aria-selected", String(selected))
    button.setAttribute("tabindex", selected ? "0" : "-1")
  })
  const count = document.querySelector("[data-alert-count]")
  if (count) count.textContent = String(alerts.length)
  if (!contextContent) return

  if (state.contextTab === "alerts") {
    contextContent.innerHTML = `<div class="context-heading"><p class="eyebrow">Warning center</p><h2>${alerts.length} active</h2><p>Ranked findings across the observatory, with history retained.</p></div><div class="alert-list">${alerts.map((alert) => `<article class="alert-item ${alert.level}"><span>${alert.level === "critical" ? "●" : "▲"}</span><div><strong>${alert.title}</strong><p>${alert.detail}</p><small>${alert.time} · ${alert.scope}</small></div>${alert.action ? `<button class="button" type="button" data-sim-action="${alert.action}">${alert.action}</button>` : ""}</article>`).join("")}</div>`
    return
  }

  contextContent.innerHTML = renderInspector(scenario)
}

function renderInspector(scenario) {
  if (state.inspectorSubject === "run") return `<div class="context-heading"><p class="eyebrow">Active run</p><h2>M27 · OIII capture</h2><p>${scenario.runLabel} · frame 14 of 24 · 58%</p></div><dl class="context-details"><div><dt>State</dt><dd>${scenario.phase}</dd></div><div><dt>Progress</dt><dd>14 / 24 OIII</dd></div><div><dt>Exposure</dt><dd>01:47 / 03:00</dd></div><div><dt>Quality</dt><dd>FWHM ${scenario.fwhm}</dd></div><div><dt>Guiding</dt><dd>0.74″ RMS</dd></div><div><dt>Storage</dt><dd>${scenario.storage}</dd></div><div><dt>Next event</dt><dd>${scenario.nextEvent}</dd></div><div><dt>Controller</dt><dd>Chicks · local</dd></div></dl><div class="button-row"><button class="button" type="button" data-sim-action="Pause after current frame">Pause after frame</button><button class="button danger" type="button" data-sim-action="Stop and park">Stop…</button></div>`
  if (state.workspace === "plan") {
    const target = selectedTarget()
    return `<div class="context-heading"><p class="eyebrow">Selected target</p><h2>${target.name}</h2><p>${target.type} · peak ${target.altitude}</p></div><dl class="context-details"><div><dt>Usable window</dt><dd>${target.window}</dd></div><div><dt>Scheduled</dt><dd>${target.duration}</dd></div><div><dt>Capture</dt><dd>${target.filters}</dd></div><div><dt>Expected yield</dt><dd>${target.frames} frames</dd></div><div><dt>Fit</dt><dd>${target.fit}</dd></div><div><dt>Acquire policy</dt><dd>Center ≤45″ · retry ×2</dd></div></dl><button class="button" type="button" data-sim-action="Edit ${target.name} sequence">Edit sequence</button>`
  }
  if (state.workspace === "library") {
    const frame = selectedFrame()
    return `<div class="context-heading"><p class="eyebrow">Selected evidence</p><h2>M27 OIII #${frame.number}</h2><p>${frame.time} · 180s · gain 100</p></div><div class="context-frame-preview"><span>✦</span></div><dl class="context-details"><div><dt>Decision</dt><dd>${frame.quality}</dd></div><div><dt>FWHM</dt><dd>${frame.fwhm}</dd></div><div><dt>Eccentricity</dt><dd>${frame.eccentricity}</dd></div><div><dt>Provenance</dt><dd>Run 7 · Sequence M27 OIII</dd></div></dl>`
  }
  if (state.workspace === "process") return `<div class="context-heading"><p class="eyebrow">Processing context</p><h2>Revision 03</h2><p>Lightweight placeholder</p></div><dl class="context-details"><div><dt>Sources</dt><dd>73 accepted frames</dd></div><div><dt>Recipe</dt><dd>Draft · not executed</dd></div><div><dt>Priority</dt><dd>Below active capture</dd></div></dl>`
  return `<div class="context-heading"><p class="eyebrow">Active evidence</p><h2>M27 OIII #014</h2><p>${scenario.runLabel} · latest synthetic frame</p></div><dl class="context-details"><div><dt>Phase</dt><dd>${scenario.phase}</dd></div><div><dt>Quality</dt><dd>FWHM ${scenario.fwhm}</dd></div><div><dt>Guiding</dt><dd>0.74″ RMS</dd></div><div><dt>Storage</dt><dd>${scenario.storage}</dd></div><div><dt>Controller</dt><dd>Chicks · local</dd></div></dl>`
}

function renderPhoneMonitor() {
  if (!phoneMonitor) return
  const scenario = scenarioPresentation()
  const alerts = alertsForScenario()
  const recent = FRAMES.slice(-3).reverse()
  phoneMonitor.innerHTML = `<div class="phone-mode-label"><span>Read-only phone monitor</span><small>Controls are intentionally unavailable</small></div><section class="phone-status"><p class="eyebrow">Tonight · active run</p><h2>M27 · OIII capture</h2><p>${scenario.runLabel} · frame 14 of 24</p><div class="progress-track"><span style="--progress:58%"></span></div><div class="phone-stats"><span><small>Progress</small><b>58%</b></span><span><small>Exposure</small><b>01:47</b></span><span><small>Guiding</small><b>0.74″</b></span><span><small>Storage</small><b>${scenario.storage}</b></span></div></section>${alerts.length ? `<section class="phone-alert"><span class="${alerts[0].level === "critical" ? "bad" : "warn"}">${alerts[0].level === "critical" ? "●" : "▲"}</span><div><strong>${alerts[0].title}</strong><p>${alerts[0].detail}</p></div></section>` : ""}<section class="phone-evidence"><div><p class="eyebrow">Latest evidence</p><h3>M27 OIII #014</h3></div><div class="evidence-frame" role="img" aria-label="Synthetic latest M27 frame"><span class="frame-label top-left">22:54 · 180s</span><span class="target-ring"></span><span class="frame-label bottom-right">FWHM ${scenario.fwhm}</span></div></section><section><div class="pane-header"><h3>Recent frames</h3><span class="fine">Chronological</span></div><div class="phone-recent">${recent.map((frame) => `<article><span class="${frame.quality}">${qualitySymbol(frame.quality)}</span><div><strong>#${frame.number} · ${frame.quality}</strong><small>${frame.time} · FWHM ${frame.fwhm}</small></div></article>`).join("")}</div></section>`
}

function renderFeedback() {
  const feedback = document.querySelector("[data-feedback]")
  feedback?.toggleAttribute("hidden", !state.feedback)
  if (feedback) feedback.textContent = state.feedback
}

function scenarioPresentation() {
  if (state.scenario === "quality-warning") return {
    runLabel: "quality warning", phase: "Capture", pillClass: "warning", fwhm: "3.8″ ↑", storage: "42.1 GB", nextEvent: "Focus recommended", observeHeading: "Frame quality is drifting", observeSubheading: "Capture remains safe while the evidence points toward focus degradation.", interpretationTitle: "Focus degradation is likely", interpretation: "FWHM rose across four frames while guiding and eccentricity stayed stable. Temperature dropped 1.8°C since the last focus run.", evidencePoints: ["Four-frame FWHM trend: 2.7″ → 3.8″", "Guiding stable at 0.74″ RMS", "Confidence 82%; current exposure remains useful"], actionTitle: "Focus after the current frame", actionDetail: "This interrupts no exposure and costs an estimated 2m 20s.", actionLabel: "Approve focus after frame", actionClass: "primary", contextualEscalation: null
  }
  if (state.scenario === "recovery") return {
    runLabel: "recovery required", phase: "Recover", pillClass: "warning", fwhm: "3.8″", storage: "Offline", nextEvent: "Hold new exposures", observeHeading: "Storage must be reconciled", observeSubheading: "The current frame remains in camera memory; starting another would put evidence at risk.", interpretationTitle: "The frame is not persisted evidence yet", interpretation: "Storage disappeared after frame 13. The service must re-establish the app-owned path and validate the current download before capture resumes.", evidencePoints: ["Last verified write at 22:51:16", "Current exposure retained in camera memory", "Rig control and guiding remain healthy"], actionTitle: "Start bounded storage recovery", actionDetail: "Reconnect storage, download once, validate bytes and metadata, then decide whether capture may resume.", actionLabel: "Approve recovery sequence", actionClass: "danger", contextualEscalation: { title: "Capture held: storage is unavailable", detail: "No new exposure will begin until the current frame can be persisted and verified." }
  }
  return {
    runLabel: "healthy", phase: "Capture", pillClass: "live", fwhm: "3.1″", storage: "42.1 GB", nextEvent: "Dither after frame 15", observeHeading: "Useful evidence is accumulating", observeSubheading: "The latest frame and recent trend remain inside the approved capture policy.", interpretationTitle: "Continue the approved sequence", interpretation: "Guiding, focus, framing, temperature, and storage remain stable. Thirteen stored frames have passed quality gates.", evidencePoints: ["13 accepted frames · 100% yield", "Pointing drift 18″ since center", "37.4 GB projected free at completion"], actionTitle: "No intervention needed", actionDetail: "Continue OIII capture and dither after frame 15 as planned.", actionLabel: "Acknowledge recommendation", actionClass: "", contextualEscalation: null
  }
}

function alertsForScenario() {
  const forecast = { level: "advisory", title: "Forecast confidence is moderate", detail: "Cloud probability rises to 24% after 03:10.", time: "22:52", scope: "Night plan", action: "" }
  if (state.scenario === "quality-warning") return [{ level: "warning", title: "Frame quality is trending softer", detail: "FWHM increased across four frames; focus after the current exposure is recommended.", time: "22:54", scope: "M27 capture", action: "Approve focus after frame" }, forecast]
  if (state.scenario === "recovery") return [{ level: "critical", title: "Capture storage unavailable", detail: "Current frame is held in camera memory; new exposures are blocked pending reconciliation.", time: "22:54", scope: "Observatory storage", action: "Approve recovery sequence" }, forecast]
  return [forecast]
}

function selectedTarget() {
  return TARGETS.find((target) => target.id === state.selectedTargetId) ?? TARGETS[0]
}

function selectedFrame() {
  return FRAMES.find((frame) => frame.id === state.selectedFrameId) ?? FRAMES[0]
}

function workspaceLabel(workspace) {
  return workspace.charAt(0).toUpperCase() + workspace.slice(1)
}

function filterLabel(filter) {
  return filter.charAt(0).toUpperCase() + filter.slice(1)
}

function qualitySymbol(quality) {
  if (quality === "accepted") return "✓"
  if (quality === "marginal") return "▲"
  return "×"
}
