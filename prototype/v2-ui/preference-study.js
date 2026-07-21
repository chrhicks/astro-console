const STUDY = {
  id: "astro-console-v2-pairwise-ux",
  version: 2,
  storageKey: "astro-console:v2:pairwise-ux:v2",
  repeatCount: 3
}

const DIMENSIONS = [
  {
    id: "workspace-navigation",
    label: "Workspace navigation",
    question: "How should you move among Plan, Observe, Library, and Process?",
    context: "An active M27 run continues while you move between different kinds of work.",
    candidates: [
      { id: "workspace-top-tabs", title: "Horizontal workspace bar", summary: "Keep workspaces across the top, close to global run status." },
      { id: "workspace-left-rail", title: "Persistent workspace rail", summary: "Reserve the left edge for stable destinations and status marks." }
    ]
  },
  {
    id: "plan-structure",
    label: "Plan structure",
    question: "What should organize a multi-target night plan?",
    context: "Four sequences must fit between darkness, horizon limits, a meridian flip, and dawn.",
    candidates: [
      { id: "plan-timeline", title: "Sky-window timeline", summary: "Lead with when targets fit; inspect capture recipes second." },
      { id: "plan-ledger", title: "Sequence ledger", summary: "Lead with ordered recipes, policies, validation, and totals." }
    ]
  },
  {
    id: "observe-attention",
    label: "Observe attention",
    question: "What should dominate Observe during acquisition?",
    context: "The second solve is 71 arcseconds from target and one correction attempt remains.",
    candidates: [
      { id: "observe-guided", title: "Guided current phase", summary: "Focus on current evidence, recommendation, and bounded next action." },
      { id: "observe-canvas", title: "Stable activity canvas", summary: "Keep the whole observatory visible in consistent telemetry cards." }
    ]
  },
  {
    id: "active-run-surface",
    label: "Active-run surface",
    question: "How should a running observation remain visible in every workspace?",
    context: "You are reviewing last month's frames while tonight's M27 OIII sequence continues.",
    candidates: [
      { id: "run-compact-bar", title: "Compact persistent run bar", summary: "Reserve one stable row for progress, health, and essential actions." },
      { id: "run-floating-dock", title: "Floating run dock", summary: "Keep a compact movable surface above the current workspace." }
    ]
  },
  {
    id: "warning-presentation",
    label: "Warning presentation",
    question: "How should a quality warning ask for attention?",
    context: "FWHM has risen across four accepted frames, but capture can safely continue.",
    candidates: [
      { id: "warning-inline", title: "Inline consequence banner", summary: "Place the warning and its immediate remedy in the active context." },
      { id: "warning-center", title: "Warning center with count", summary: "Collect alerts in a ranked side surface with history and status." }
    ]
  },
  {
    id: "detail-disclosure",
    label: "Detail disclosure",
    question: "Where should supporting detail appear after selecting a sequence?",
    context: "You need to inspect M27 acquisition tolerances without losing the night-plan context.",
    candidates: [
      { id: "detail-inspector", title: "Persistent side inspector", summary: "Keep selected-object detail in a stable right-hand region." },
      { id: "detail-inline", title: "Inline row expansion", summary: "Expand detail directly below the selected object in context." }
    ]
  },
  {
    id: "information-density",
    label: "Information density",
    question: "How much operational detail should be visible before drilling in?",
    context: "You are scanning four sequences for time, yield, filters, storage, and readiness problems.",
    candidates: [
      { id: "density-compact", title: "Compact decision table", summary: "Expose comparable values at once with restrained emphasis." },
      { id: "density-progressive", title: "Progressive summary cards", summary: "Show one strong summary per target and reveal secondary metrics." }
    ]
  },
  {
    id: "review-organization",
    label: "Review organization",
    question: "How should captured evidence be organized for first review?",
    context: "A completed M27 sequence contains 42 accepted frames, 5 marginal frames, and 3 rejects.",
    candidates: [
      { id: "review-session", title: "Session filmstrip", summary: "Preserve time order and capture context across the sequence." },
      { id: "review-triage", title: "Quality triage board", summary: "Group evidence by accepted, marginal, and rejected decisions." }
    ]
  }
]

let storageAvailable = true
let session = loadSession()
let schedule = buildSchedule(session.seed)

const comparisonView = document.querySelector('[data-study-view="comparison"]')
const resultsView = document.querySelector('[data-study-view="results"]')
const resetDialog = document.getElementById("reset-study-dialog")
const choiceButtons = [...document.querySelectorAll("[data-choice]")]
const previewButtons = [...document.querySelectorAll("[data-preview-side]")]

persistSession()
render()

choiceButtons.forEach((button) => {
  button.addEventListener("click", () => choose(button.getAttribute("data-choice")))
})

previewButtons.forEach((button) => {
  button.addEventListener("click", () => setCompactPreview(button.getAttribute("data-preview-side")))
})

document.addEventListener("keydown", (event) => {
  if (comparisonView?.hasAttribute("hidden") || resetDialog?.open) return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
  if (event.key === "ArrowLeft" || event.key === "1") {
    event.preventDefault()
    choose("left")
  }
  if (event.key === "ArrowRight" || event.key === "2") {
    event.preventDefault()
    choose("right")
  }
})

document.querySelectorAll("[data-reset-open]").forEach((button) => {
  button.addEventListener("click", () => {
    if (resetDialog instanceof HTMLDialogElement) resetDialog.showModal()
  })
})

document.querySelector("[data-reset-cancel]")?.addEventListener("click", () => {
  if (resetDialog instanceof HTMLDialogElement) resetDialog.close()
})

document.querySelector("[data-reset-confirm]")?.addEventListener("click", () => {
  clearStoredSession()
  session = createSession()
  schedule = buildSchedule(session.seed)
  persistSession()
  if (resetDialog instanceof HTMLDialogElement) resetDialog.close()
  render()
  document.querySelector("[data-study-view]")?.scrollIntoView({ behavior: "smooth", block: "start" })
})

document.querySelector("[data-export]")?.addEventListener("click", exportResults)

function choose(side) {
  if (side !== "left" && side !== "right") return

  const comparison = schedule[session.choices.length]
  if (!comparison) return

  session.choices.push({
    comparisonId: comparison.id,
    dimensionId: comparison.dimensionId,
    shownLeftId: comparison.left.id,
    shownRightId: comparison.right.id,
    selectedId: side === "left" ? comparison.left.id : comparison.right.id,
    selectedSide: side,
    chosenAt: new Date().toISOString()
  })
  if (session.choices.length === schedule.length) session.completedAt = new Date().toISOString()
  persistSession()
  render()
  document.querySelector("[data-study-view]:not([hidden])")?.scrollIntoView({ behavior: "smooth", block: "start" })
}

function render() {
  const complete = session.choices.length === schedule.length
  comparisonView?.toggleAttribute("hidden", complete)
  resultsView?.toggleAttribute("hidden", !complete)

  const resumeStatus = document.querySelector("[data-resume-status]")
  if (resumeStatus) {
    const progress = session.choices.length === 0 ? "New shuffled session." : `Resumed at ${session.choices.length} of ${schedule.length} choices.`
    resumeStatus.textContent = storageAvailable ? `${progress} Saved locally.` : `${progress} Local saving is unavailable.`
  }

  if (complete) {
    renderResults()
    return
  }

  const comparison = schedule[session.choices.length]
  if (!comparison) return

  setCompactPreview(compactFirstSide(session.choices.length))

  setText("[data-dimension-label]", comparison.dimension.label)
  setText("[data-progress-label]", `Comparison ${session.choices.length + 1} of ${schedule.length}`)
  setText("[data-question]", comparison.dimension.question)
  setText("[data-context]", comparison.dimension.context)
  setText("[data-left-title]", comparison.left.title)
  setText("[data-left-summary]", comparison.left.summary)
  setText("[data-right-title]", comparison.right.title)
  setText("[data-right-summary]", comparison.right.summary)

  const progressBar = document.querySelector("[data-progress-bar]")
  if (progressBar instanceof HTMLElement) progressBar.style.width = `${(session.choices.length / schedule.length) * 100}%`

  const leftPreview = document.querySelector("[data-left-preview]")
  const rightPreview = document.querySelector("[data-right-preview]")
  if (leftPreview) leftPreview.innerHTML = renderPreview(comparison.left.id)
  if (rightPreview) rightPreview.innerHTML = renderPreview(comparison.right.id)

  choiceButtons.forEach((button) => {
    const side = button.getAttribute("data-choice")
    const candidate = side === "left" ? comparison.left : comparison.right
    button.setAttribute("aria-label", `Choose ${side}: ${candidate.title}. ${candidate.summary}`)
  })
}

function renderResults() {
  const repeats = schedule.filter((comparison) => comparison.repeated)
  const repeatResults = repeats.map((comparison) => {
    const original = session.choices.find((choice) => choice.comparisonId === `${comparison.dimensionId}:base`)
    const repeated = session.choices.find((choice) => choice.comparisonId === comparison.id)
    return { dimensionId: comparison.dimensionId, consistent: original?.selectedId === repeated?.selectedId }
  })
  const consistentCount = repeatResults.filter((result) => result.consistent).length
  const leftCount = session.choices.filter((choice) => choice.selectedSide === "left").length
  const leftRate = Math.round((leftCount / session.choices.length) * 100)
  const rightRate = 100 - leftRate
  const biasSignal = Math.abs(leftRate - rightRate) >= 28 ? "Possible position effect" : "No strong position signal"

  const summary = document.querySelector("[data-result-summary]")
  if (summary) {
    summary.innerHTML = `
      <div class="result-stat"><small>Repeat consistency</small><strong>${consistentCount} / ${repeats.length}</strong><span>${consistentCount === repeats.length ? "Stable across hidden repeats" : "Some choices changed on repeat"}</span></div>
      <div class="result-stat"><small>Left selection</small><strong>${leftRate}%</strong><span>${leftCount} of ${session.choices.length} choices</span></div>
      <div class="result-stat"><small>Right selection</small><strong>${rightRate}%</strong><span>${session.choices.length - leftCount} of ${session.choices.length} choices</span></div>
      <div class="result-stat"><small>Position check</small><strong>${biasSignal}</strong><span>Diagnostic only, not a correction</span></div>`
  }

  const results = document.querySelector("[data-result-list]")
  if (!results) return

  results.innerHTML = DIMENSIONS.map((dimension) => {
    const original = session.choices.find((choice) => choice.comparisonId === `${dimension.id}:base`)
    const repeated = session.choices.find((choice) => choice.comparisonId === `${dimension.id}:repeat`)
    const chosen = candidateById(dimension, original?.selectedId)
    const repeatedChoice = candidateById(dimension, repeated?.selectedId)
    const repeatMarkup = repeated
      ? `<span class="result-repeat ${original?.selectedId === repeated.selectedId ? "consistent" : "inconsistent"}">Repeat: ${repeatedChoice?.title} · ${original?.selectedId === repeated.selectedId ? "consistent" : "changed"}</span>`
      : `<span class="result-repeat">Not repeated</span>`

    return `<article class="result-row"><span class="pill ui">${dimension.label}</span><div><h3>${chosen?.title ?? "Unknown choice"}</h3><p>${chosen?.summary ?? ""}</p></div>${repeatMarkup}</article>`
  }).join("")
}

function buildSchedule(seed) {
  const random = makeRandom(seed)
  const order = shuffle(DIMENSIONS, random)
  const repeated = order.slice(0, STUDY.repeatCount)
  const repeatedOrientations = repeated.map(() => random() >= 0.5)
  const remainingLeftCount = random() >= 0.5 ? 3 : 2
  const remainingOrientations = shuffle([
    ...Array.from({ length: remainingLeftCount }, () => true),
    ...Array.from({ length: 5 - remainingLeftCount }, () => false)
  ], random)
  const orientations = [...repeatedOrientations, ...remainingOrientations]

  const base = order.map((dimension, index) => makeComparison(dimension, "base", orientations[index], false))
  const repeatSchedule = repeated.map((dimension) => {
    const original = base.find((comparison) => comparison.dimensionId === dimension.id)
    return makeComparison(dimension, "repeat", original?.left.id !== dimension.candidates[0].id, true)
  })
  return base.flatMap((comparison, index) => {
    if (index === 3) return [comparison, repeatSchedule[0]]
    if (index === 5) return [comparison, repeatSchedule[1]]
    if (index === 7) return [comparison, repeatSchedule[2]]
    return [comparison]
  })
}

function makeComparison(dimension, occurrence, firstCandidateLeft, repeated) {
  const [first, second] = dimension.candidates
  return {
    id: `${dimension.id}:${occurrence}`,
    dimensionId: dimension.id,
    dimension,
    left: firstCandidateLeft ? first : second,
    right: firstCandidateLeft ? second : first,
    repeated
  }
}

function createSession() {
  const seedBytes = new Uint32Array(1)
  crypto.getRandomValues(seedBytes)
  return {
    studyId: STUDY.id,
    version: STUDY.version,
    seed: seedBytes[0],
    startedAt: new Date().toISOString(),
    completedAt: null,
    choices: []
  }
}

function loadSession() {
  let stored
  try {
    stored = localStorage.getItem(STUDY.storageKey)
  } catch {
    storageAvailable = false
    return createSession()
  }
  if (!stored) return createSession()

  try {
    const value = JSON.parse(stored)
    if (isValidSession(value)) return value
  } catch {
    // Invalid browser-owned state is discarded below.
  }
  clearStoredSession()
  return createSession()
}

function isValidSession(value) {
  if (!value || typeof value !== "object") return false
  if (value.studyId !== STUDY.id || value.version !== STUDY.version) return false
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) return false
  if (typeof value.startedAt !== "string" || !Array.isArray(value.choices)) return false
  if (value.completedAt !== null && typeof value.completedAt !== "string") return false

  const expected = buildSchedule(value.seed)
  if (value.choices.length > expected.length) return false
  if ((value.choices.length === expected.length) !== (typeof value.completedAt === "string")) return false

  return value.choices.every((choice, index) => {
    const comparison = expected[index]
    if (!choice || typeof choice !== "object" || !comparison) return false
    if (choice.comparisonId !== comparison.id || choice.dimensionId !== comparison.dimensionId) return false
    if (choice.shownLeftId !== comparison.left.id || choice.shownRightId !== comparison.right.id) return false
    if (choice.selectedSide !== "left" && choice.selectedSide !== "right") return false
    if (choice.selectedId !== (choice.selectedSide === "left" ? comparison.left.id : comparison.right.id)) return false
    return typeof choice.chosenAt === "string"
  })
}

function persistSession() {
  if (!storageAvailable) return
  try {
    localStorage.setItem(STUDY.storageKey, JSON.stringify(session))
  } catch {
    storageAvailable = false
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(STUDY.storageKey)
  } catch {
    storageAvailable = false
  }
}

function exportResults() {
  const payload = {
    exportVersion: 1,
    study: { id: STUDY.id, version: STUDY.version, dimensions: DIMENSIONS.map((dimension) => dimension.id) },
    session: { seed: session.seed, startedAt: session.startedAt, completedAt: session.completedAt },
    schedule: schedule.map((comparison) => ({
      comparisonId: comparison.id,
      dimensionId: comparison.dimensionId,
      shownLeftId: comparison.left.id,
      shownRightId: comparison.right.id,
      compactFirstPreviewSide: compactFirstSide(schedule.indexOf(comparison)),
      repeated: comparison.repeated
    })),
    choices: session.choices
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `astro-console-v2-ux-preferences-${session.seed}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function renderPreview(id) {
  const previews = {
    "workspace-top-tabs": `<span class="mini-top"><b>◉ M27 · Capture 14/24</b><i>Healthy</i></span><span class="mini-tabs"><b>Plan</b><b class="on">Observe</b><b>Library</b><b>Process</b></span><span class="mini-main"><em>Latest frame</em><strong>OIII · 01:47 / 03:00</strong><small>FWHM 3.1″ · RMS 0.74″</small></span>`,
    "workspace-left-rail": `<span class="mini-app"><span class="mini-rail"><b>✦</b><i>P</i><i class="on">O</i><i>L</i><i>Pr</i></span><span class="mini-main"><em>M27 · Capture</em><strong>Frame 14 of 24</strong><small>Healthy · OIII · 5h 41m left</small><span class="mini-block"></span></span></span>`,
    "plan-timeline": `<span class="mini-axis"><i>22:00</i><i>00:00</i><i>02:00</i><i>04:00</i></span><span class="mini-track"><b style="--w:31%;--c:var(--cyan)">M27 · OIII/Hα</b><b style="--w:20%;--c:var(--violet)">NGC 7000</b><b style="--w:25%;--c:var(--blue)">M31 · LRGB</b></span><span class="mini-foot"><small>Darkness 22:11–04:29</small><strong>83% utilized</strong></span>`,
    "plan-ledger": `<span class="mini-table"><b><i>Target</i><i>Filter</i><i>Frames</i><i>Total</i></b><span><i>M27</i><i>OIII/Hα</i><i>42</i><i>2h18</i></span><span><i>NGC 7000</i><i>Hα</i><i>20</i><i>1h13</i></span><span><i>M31</i><i>LRGB</i><i>72</i><i>1h31</i></span><span><i>NGC 1499</i><i>Hα</i><i>16</i><i>58m</i></span></span><span class="mini-foot"><small>150 frames · 38.6 GB</small><strong>4 validated</strong></span>`,
    "observe-guided": `<span class="mini-steps"><i>✓ Slew</i><i>✓ Solve</i><i class="on">Correct</i><i>Verify</i></span><span class="mini-sky"><i class="ring"></i><i class="point"></i><i class="vector"></i></span><span class="mini-decision"><small>71″ remaining · tolerance 45″</small><strong>Apply one bounded correction</strong></span>`,
    "observe-canvas": `<span class="mini-cards"><i class="wide"><small>Latest evidence</small><b>M27 OIII · accepted</b></i><i><small>Exposure</small><b>01:47</b></i><i><small>Guiding</small><b>0.74″</b></i><i><small>Quality</small><b>3.1″</b></i><i><small>Storage</small><b>42.1 GB</b></i></span>`,
    "run-compact-bar": `<span class="mini-workspace-ghost">Library · M27 review</span><span class="mini-runbar"><i class="pulse"></i><span><b>Tonight · M27 OIII</b><small>Capture 14/24 · healthy</small></span><em>58%</em><strong>Pause</strong></span><span class="mini-library"><i></i><i></i><i></i></span>`,
    "run-floating-dock": `<span class="mini-workspace-ghost">Library · M27 review</span><span class="mini-library"><i></i><i></i><i></i></span><span class="mini-dock"><i class="pulse"></i><span><b>M27 · 14/24</b><small>OIII · healthy</small></span><em>58%</em></span>`,
    "warning-inline": `<span class="mini-runbar"><span><b>M27 OIII · Capture</b><small>Frame 14 of 24</small></span><em>58%</em></span><span class="mini-warning"><i>▲</i><span><b>Star size is trending upward</b><small>Focus now costs 2m 20s</small></span><strong>Focus after frame</strong></span><span class="mini-cards"><i><small>FWHM</small><b>3.8″ ↑</b></i><i><small>Guiding</small><b>0.74″</b></i></span>`,
    "warning-center": `<span class="mini-app"><span class="mini-main"><em>M27 · Capture</em><strong>Frame 14 of 24</strong><span class="mini-block"></span></span><span class="mini-alerts"><b>Warnings <i>2</i></b><span><strong>Quality drift</strong><small>Focus suggested · now</small></span><span><strong>Forecast</strong><small>Cloud after 03:10</small></span></span></span>`,
    "detail-inspector": `<span class="mini-app"><span class="mini-main"><span class="mini-list"><i class="on">M27 · 2h18</i><i>NGC 7000 · 1h13</i><i>M31 · 1h31</i></span></span><span class="mini-inspector"><small>Selected sequence</small><b>M27 · Dumbbell</b><i>Center ≤ 45″</i><i>OIII 24 × 180s</i><i>Retry acquire ×2</i></span></span>`,
    "detail-inline": `<span class="mini-list"><i>M27 · 2h18 <b>⌃</b></i><span class="mini-expanded"><small>Center ≤45″ · retry ×2</small><b>OIII 24 × 180s</b><b>Hα 18 × 180s</b></span><i>NGC 7000 · 1h13 <b>⌄</b></i><i>M31 · 1h31 <b>⌄</b></i></span>`,
    "density-compact": `<span class="mini-table dense"><b><i>Target</i><i>Time</i><i>Yield</i><i>Risk</i></b><span><i>M27</i><i>2h18</i><i>42</i><i>Low</i></span><span><i>NGC 7000</i><i>1h13</i><i>20</i><i>Low</i></span><span><i>M31</i><i>1h31</i><i>72</i><i>Flip</i></span><span><i>NGC 1499</i><i>58m</i><i>16</i><i>Cloud</i></span></span><span class="mini-metrics"><i>4h28 capture</i><i>86% efficient</i><i>38.6 GB</i></span>`,
    "density-progressive": `<span class="mini-summary-cards"><span><b>M27 · Dumbbell</b><small>2h18 · 42 frames</small><i>Ready</i></span><span><b>NGC 7000</b><small>1h13 · 20 frames</small><i>Ready</i></span><span><b>M31 · Andromeda</b><small>1h31 · 72 frames</small><i>Flip</i></span></span>`,
    "review-session": `<span class="mini-review-head"><b>M27 · July 20</b><small>50 frames · 2h31</small></span><span class="mini-filmstrip"><i class="good">01</i><i class="good">02</i><i class="warned">03</i><i class="good">04</i><i class="badframe">05</i><i class="good">06</i></span><span class="mini-trend"><i></i><i></i><i></i><i></i><i></i></span><span class="mini-foot"><small>Chronological · filter OIII</small><strong>42 accepted</strong></span>`,
    "review-triage": `<span class="mini-review-head"><b>M27 · Quality triage</b><small>50 frames</small></span><span class="mini-triage"><span><b>Accepted · 42</b><i></i><i></i><i></i></span><span><b>Marginal · 5</b><i></i><i></i></span><span><b>Rejected · 3</b><i></i></span></span>`
  }
  return previews[id] ?? ""
}

function candidateById(dimension, id) {
  return dimension.candidates.find((candidate) => candidate.id === id)
}

function setText(selector, value) {
  const element = document.querySelector(selector)
  if (element) element.textContent = value
}

function setCompactPreview(side) {
  if (side !== "left" && side !== "right") return
  const grid = document.querySelector(".preference-grid")
  if (grid instanceof HTMLElement) grid.dataset.previewSide = side
  previewButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-preview-side") === side))
  })
}

function compactFirstSide(index) {
  return (index + (session.seed & 1)) % 2 === 0 ? "left" : "right"
}

function shuffle(values, random) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const value = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = value
  }
  return result
}

function makeRandom(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let output = value
    output = Math.imul(output ^ (output >>> 15), output | 1)
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61)
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296
  }
}
