const STUDY = {
  id: "astro-console-v2-pairwise-refinement",
  version: 1,
  storageKey: "astro-console:v2:pairwise-refinement:v1",
  exportPrefix: "astro-console-v2-ux-refinement",
  repeatCount: 3
}

const DIMENSIONS = [
  {
    id: "left-rail-behavior",
    label: "Left-rail behavior",
    question: "How should the persistent workspace rail use its width?",
    context: "The rail must stay orienting from a wide planning screen through a compact live-observing layout.",
    candidates: [
      { id: "rail-always-labeled", title: "Always-labeled rail", summary: "Keep destination names visible at a stable width in every desktop workspace." },
      { id: "rail-adaptive", title: "Adaptive collapsible rail", summary: "Show labels when space permits and retain a compact icon rail when content needs width." }
    ]
  },
  {
    id: "timeline-form",
    label: "Sky-window timeline",
    question: "What form should the sky-window-first Plan workspace take?",
    context: "You need to compare four targets, understand overlaps, and still commit to one executable order.",
    candidates: [
      { id: "timeline-scheduled-night", title: "Continuous scheduled night", summary: "Place the selected sequence order on one continuous clock from dusk to dawn." },
      { id: "timeline-opportunity-lanes", title: "Parallel opportunity lanes", summary: "Show each target's usable window in parallel, with the selected schedule overlaid." }
    ]
  },
  {
    id: "guided-observe-composition",
    label: "Guided Observe composition",
    question: "How should a guided Observe screen compose evidence and action?",
    context: "The second solve is 71 arcseconds from target and one bounded correction attempt remains.",
    candidates: [
      { id: "observe-sequential-path", title: "Dominant sequential evidence path", summary: "Read evidence, interpretation, and next action as one top-to-bottom progression." },
      { id: "observe-evidence-action-split", title: "Evidence and action split", summary: "Keep image evidence dominant while a stable side region explains and offers the next action." }
    ]
  },
  {
    id: "run-bar-depth",
    label: "Active-run bar depth",
    question: "How much detail should the compact global run surface expose?",
    context: "Capture continues while you plan another night, and you want more context without leaving Plan.",
    candidates: [
      { id: "runbar-always-minimal", title: "Always-minimal run bar", summary: "Keep only phase, target, health, progress, and one essential action globally visible." },
      { id: "runbar-expandable", title: "Compact bar with expandable detail", summary: "Keep the same compact baseline and allow an in-place detail shelf when requested." }
    ]
  },
  {
    id: "inspector-alerts-organization",
    label: "Inspector and alerts",
    question: "How should selected-object detail and cross-workspace alerts share the right side?",
    context: "You are editing an M27 sequence while a non-blocking focus warning arrives from the active run.",
    candidates: [
      { id: "right-rail-tabbed", title: "Tabbed contextual rail", summary: "Use one right rail with explicit Inspector and Alerts tabs sharing the same footprint." },
      { id: "inspector-alert-drawer", title: "Inspector plus alert drawer", summary: "Keep selection detail persistent and let an alert drawer or inbox coexist above it." }
    ]
  },
  {
    id: "warning-escalation",
    label: "Warning escalation",
    question: "How should a new operational warning enter the interface?",
    context: "Frame quality is drifting, but capture remains safe and the full warning history may matter later.",
    candidates: [
      { id: "warning-center-first", title: "Warning-center first", summary: "Signal the ranked warning center and let the operator open the active finding there." },
      { id: "warning-context-plus-history", title: "Contextual banner with center history", summary: "Explain the active consequence in context while retaining durable history in the center." }
    ]
  },
  {
    id: "progressive-card-density",
    label: "Progressive-card density",
    question: "How should progressive Plan cards support comparison?",
    context: "You are deciding whether M27, NGC 7000, M31, and NGC 1499 still fit after a forecast change.",
    candidates: [
      { id: "cards-single-summary", title: "Single summary with drill-in", summary: "Give each target one primary fitness statement and reveal its secondary values on demand." },
      { id: "cards-aligned-comparison", title: "Aligned comparative summaries", summary: "Keep the card model while aligning a small common metric set across every target." }
    ]
  },
  {
    id: "filmstrip-enhancement",
    label: "Chronological review",
    question: "How should the chronological filmstrip support quality investigation?",
    context: "A 50-frame M27 sequence contains 42 accepted, 5 marginal, and 3 rejected frames.",
    candidates: [
      { id: "filmstrip-badges-filters", title: "Quality badges and filters", summary: "Keep chronology primary, annotate every frame, and filter the strip by decision or metric." },
      { id: "filmstrip-triage-lens", title: "Triage lens over chronology", summary: "Keep the timeline intact and open a temporary quality-grouped lens above the same evidence." }
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

choiceButtons.forEach((button) => button.addEventListener("click", () => choose(button.getAttribute("data-choice"))))
previewButtons.forEach((button) => button.addEventListener("click", () => setCompactPreview(button.getAttribute("data-preview-side"))))

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
    const progress = session.choices.length === 0 ? "New shuffled refinement session." : `Resumed at ${session.choices.length} of ${schedule.length} choices.`
    resumeStatus.textContent = storageAvailable ? `${progress} Saved separately from Study One.` : `${progress} Local saving is unavailable.`
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
    return original?.selectedId === repeated?.selectedId
  })
  const consistentCount = repeatResults.filter(Boolean).length
  const leftCount = session.choices.filter((choice) => choice.selectedSide === "left").length
  const leftRate = Math.round((leftCount / session.choices.length) * 100)
  const rightRate = 100 - leftRate
  const biasSignal = Math.abs(leftRate - rightRate) >= 28 ? "Possible position effect" : "No strong position signal"

  const summary = document.querySelector("[data-result-summary]")
  if (summary) summary.innerHTML = `<div class="result-stat"><small>Repeat consistency</small><strong>${consistentCount} / ${repeats.length}</strong><span>${consistentCount === repeats.length ? "Stable across hidden repeats" : "Some refinements changed on repeat"}</span></div><div class="result-stat"><small>Left selection</small><strong>${leftRate}%</strong><span>${leftCount} of ${session.choices.length} choices</span></div><div class="result-stat"><small>Right selection</small><strong>${rightRate}%</strong><span>${session.choices.length - leftCount} of ${session.choices.length} choices</span></div><div class="result-stat"><small>Position check</small><strong>${biasSignal}</strong><span>Diagnostic only, not a correction</span></div>`

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
  const remainingOrientations = shuffle([...Array.from({ length: remainingLeftCount }, () => true), ...Array.from({ length: 5 - remainingLeftCount }, () => false)], random)
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
  return { id: `${dimension.id}:${occurrence}`, dimensionId: dimension.id, dimension, left: firstCandidateLeft ? first : second, right: firstCandidateLeft ? second : first, repeated }
}

function createSession() {
  const seedBytes = new Uint32Array(1)
  crypto.getRandomValues(seedBytes)
  return { studyId: STUDY.id, version: STUDY.version, seed: seedBytes[0], startedAt: new Date().toISOString(), completedAt: null, choices: [] }
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
    study: { id: STUDY.id, version: STUDY.version, foundation: "astro-console-v2-pairwise-ux", dimensions: DIMENSIONS.map((dimension) => dimension.id) },
    session: { seed: session.seed, startedAt: session.startedAt, completedAt: session.completedAt },
    schedule: schedule.map((comparison, index) => ({ comparisonId: comparison.id, dimensionId: comparison.dimensionId, shownLeftId: comparison.left.id, shownRightId: comparison.right.id, compactFirstPreviewSide: compactFirstSide(index), repeated: comparison.repeated })),
    choices: session.choices
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${STUDY.exportPrefix}-${session.seed}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function renderPreview(id) {
  const previews = {
    "rail-always-labeled": `<span class="mini-app"><span class="refine-labeled-rail"><b>✦ Observatory</b><i>◫ Plan</i><i class="on">◉ Observe</i><i>▧ Library</i><i>⌁ Process</i><em>Run healthy</em></span><span class="mini-main"><small>M27 · OIII</small><strong>Capture 14 of 24</strong><span class="mini-block"></span></span></span>`,
    "rail-adaptive": `<span class="mini-app"><span class="mini-rail"><b>✦</b><i>P</i><i class="on">O</i><i>L</i><i>Pr</i><em>»</em></span><span class="mini-main"><small>Adaptive rail · labels on focus or expand</small><strong>M27 · Capture 14 of 24</strong><span class="mini-block"></span></span></span>`,
    "timeline-scheduled-night": `<span class="mini-axis"><i>22:00</i><i>00:00</i><i>02:00</i><i>04:00</i></span><span class="mini-track"><b style="--w:31%;--c:var(--cyan)">M27 · 2h18</b><b style="--w:20%;--c:var(--violet)">NGC 7000 · 1h13</b><b style="--w:25%;--c:var(--blue)">M31 · 1h31</b></span><span class="mini-foot"><small>One executable order</small><strong>83% utilized</strong></span>`,
    "timeline-opportunity-lanes": `<span class="refine-lane-axis"><i>22</i><i>00</i><i>02</i><i>04</i></span><span class="refine-lanes"><span><b>M27</b><i style="--start:4%;--width:46%"></i><em style="--start:9%;--width:33%">scheduled</em></span><span><b>NGC 7000</b><i style="--start:18%;--width:58%"></i><em style="--start:45%;--width:20%">scheduled</em></span><span><b>M31</b><i style="--start:39%;--width:58%"></i><em style="--start:64%;--width:25%">scheduled</em></span><span><b>NGC 1499</b><i style="--start:62%;--width:36%"></i></span></span><span class="mini-foot"><small>Windows + selected overlay</small><strong>3 overlaps visible</strong></span>`,
    "observe-sequential-path": `<span class="mini-steps"><i>✓ Slew</i><i>✓ Solve</i><i class="on">Correct</i><i>Verify</i></span><span class="refine-sequence"><span class="mini-sky"><i class="ring"></i><i class="point"></i><i class="vector"></i></span><small>71″ remaining · tolerance 45″</small><b>Evidence suggests one bounded correction</b><strong>Continue correction</strong></span>`,
    "observe-evidence-action-split": `<span class="refine-split"><span><span class="mini-sky"><i class="ring"></i><i class="point"></i><i class="vector"></i></span><small>Solve 02 · RMS 0.41″</small></span><span class="refine-action"><small>Current decision</small><b>71″ remaining</b><em>One attempt remains inside policy.</em><strong>Continue correction</strong></span></span>`,
    "runbar-always-minimal": `<span class="mini-workspace-ghost">Plan · Tuesday draft</span><span class="mini-runbar"><i class="pulse"></i><span><b>M27 · OIII</b><small>Capture 14/24 · healthy</small></span><em>58%</em><strong>Pause</strong></span><span class="mini-summary-cards"><span><b>NGC 7000</b><small>1h13 · ready</small><i>›</i></span><span><b>M31</b><small>1h31 · flip</small><i>›</i></span></span>`,
    "runbar-expandable": `<span class="mini-workspace-ghost">Plan · Tuesday draft</span><span class="mini-runbar"><i class="pulse"></i><span><b>M27 · OIII</b><small>Capture 14/24 · healthy</small></span><em>58%⌃</em></span><span class="refine-run-detail"><i><small>Exposure</small><b>01:47 / 03:00</b></i><i><small>Guiding</small><b>0.74″</b></i><i><small>Quality</small><b>3.1″</b></i><i><small>Next</small><b>Dither</b></i></span>`,
    "right-rail-tabbed": `<span class="mini-app"><span class="mini-main"><small>Plan · M27 selected</small><span class="mini-block"></span></span><span class="refine-right-rail"><span><b class="on">Inspector</b><b>Alerts · 1</b></span><strong>M27 sequence</strong><i>Center ≤45″</i><i>OIII 24 × 180s</i><i>Retry acquire ×2</i></span></span>`,
    "inspector-alert-drawer": `<span class="mini-app"><span class="mini-main"><small>Plan · M27 selected</small><span class="mini-block"></span></span><span class="refine-right-rail"><span class="refine-alert-chip"><b>▲ Focus drift</b><small>Open inbox ›</small></span><strong>M27 sequence</strong><i>Center ≤45″</i><i>OIII 24 × 180s</i><i>Retry acquire ×2</i></span></span>`,
    "warning-center-first": `<span class="mini-top"><b>M27 · Capture 14/24</b><i>Warnings 2 ▲</i></span><span class="mini-app"><span class="mini-main"><strong>Capture continues</strong><span class="mini-block"></span></span><span class="mini-alerts"><b>Warning center <i>2</i></b><span><strong>Quality drift</strong><small>Focus suggested · now</small></span><span><strong>Forecast</strong><small>Cloud after 03:10</small></span></span></span>`,
    "warning-context-plus-history": `<span class="mini-top"><b>M27 · Capture 14/24</b><i>History · 2</i></span><span class="mini-warning"><i>▲</i><span><b>Star size is trending upward</b><small>Focus now costs 2m20s · retained in history</small></span><strong>Focus after frame</strong></span><span class="mini-cards"><i class="wide"><small>Latest evidence</small><b>FWHM 3.8″ ↑</b></i><i><small>Guiding</small><b>0.74″</b></i></span>`,
    "cards-single-summary": `<span class="refine-single-cards"><span><small>M27 · Dumbbell</small><b>Excellent fit · 13m margin</b><i>Details ›</i></span><span><small>NGC 7000</small><b>Good fit · 25m margin</b><i>Details ›</i></span><span><small>M31</small><b>Fits with meridian flip</b><i>Details ›</i></span></span>`,
    "cards-aligned-comparison": `<span class="refine-compare-cards"><b><i>Target</i><i>Time</i><i>Alt</i><i>Margin</i></b><span><strong>M27</strong><i>2h18</i><i>72°</i><i>13m</i></span><span><strong>NGC 7000</strong><i>1h13</i><i>71°</i><i>25m</i></span><span><strong>M31</strong><i>1h31</i><i>68°</i><i>38m</i></span><span><strong>NGC 1499</strong><i>58m</i><i>49°</i><i>14m</i></span></span>`,
    "filmstrip-badges-filters": `<span class="refine-filterbar"><b>All · 50</b><i>Accepted 42</i><i>Marginal 5</i><i>Rejected 3</i></span><span class="mini-filmstrip"><i class="good">✓ 01</i><i class="good">✓ 02</i><i class="warned">▲ 03</i><i class="good">✓ 04</i><i class="badframe">× 05</i><i class="good">✓ 06</i></span><span class="mini-trend"><i></i><i></i><i></i><i></i><i></i></span><span class="mini-foot"><small>Chronology retained</small><strong>Filter: all</strong></span>`,
    "filmstrip-triage-lens": `<span class="mini-review-head"><b>M27 · chronological strip</b><small>Lens: quality ⌃</small></span><span class="refine-triage-lens"><span><b>Marginal · 5</b><i></i><i></i></span><span><b>Rejected · 3</b><i></i></span></span><span class="mini-filmstrip"><i class="good">01</i><i class="good">02</i><i class="warned">03</i><i class="good">04</i><i class="badframe">05</i></span>`
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
  previewButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.getAttribute("data-preview-side") === side)))
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
