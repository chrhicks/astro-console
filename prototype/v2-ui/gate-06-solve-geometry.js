const FIXTURES = [
  { id: "centered-31", label: "Centering · 31″ verified", kind: "centering", error: 31, ra: 24, dec: -20, uncertainty: 6 },
  { id: "threshold-45", label: "Centering · 45″ tolerance edge", kind: "centering", error: 45, ra: 36, dec: -27, uncertainty: 7 },
  { id: "correct-71", label: "Centering · 71″ correction", kind: "centering", error: 71, ra: 58, dec: -41, uncertainty: 8 },
  { id: "bound-600", label: "Centering · 600″ automatic bound", kind: "centering", error: 600, ra: 480, dec: -360, uncertainty: 18 },
  { id: "approval-742", label: "Centering · 742″ approval", kind: "centering", error: 742, ra: 618, dec: -411, uncertainty: 21 },
  { id: "polar-1.3", label: "Polar · 1.3′ verified", kind: "polar", error: 1.3, alt: 0.7, az: -1.1, uncertainty: 0.4 },
  { id: "polar-2", label: "Polar · 2.0′ tolerance edge", kind: "polar", error: 2, alt: -1.2, az: 1.6, uncertainty: 0.5 },
  { id: "polar-18.4", label: "Polar · 18.4′ physical adjustment", kind: "polar", error: 18.4, alt: -11.2, az: 14.6, uncertainty: 1.6 },
  { id: "no-solution", label: "No solution · offset unknown", kind: "none" },
]

const state = { fixture: FIXTURES[2] }
const elements = {
  fixture: document.querySelector("[data-fixture]"), canvas: document.querySelector("[data-canvas]"), facts: document.querySelector("[data-facts]"), guidance: document.querySelector("[data-guidance]"), phone: document.querySelector("[data-phone]"), status: document.querySelector("[data-status]"), measurements: document.querySelector("[data-measurements]"), rerun: document.querySelector("[data-rerun]"),
}

elements.fixture.innerHTML = FIXTURES.map((fixture) => `<option value="${fixture.id}">${fixture.label}</option>`).join("")
elements.fixture.value = state.fixture.id
elements.fixture.addEventListener("change", () => { state.fixture = FIXTURES.find((fixture) => fixture.id === elements.fixture.value) ?? FIXTURES[0]; render() })
elements.rerun.addEventListener("click", runChecks)
window.addEventListener("resize", () => requestAnimationFrame(runChecks))
render()

function render() {
  elements.canvas.innerHTML = renderOverlay(state.fixture)
  elements.facts.innerHTML = renderFacts(state.fixture)
  elements.guidance.hidden = state.fixture.kind !== "polar"
  elements.guidance.innerHTML = state.fixture.kind === "polar" ? physicalGuidance(state.fixture) : ""
  elements.phone.innerHTML = renderPhone(state.fixture)
  requestAnimationFrame(runChecks)
}

function renderOverlay(fixture) {
  const base = `<svg viewBox="0 0 800 500" role="img" aria-label="${ariaLabel(fixture)}" data-overlay><defs><marker id="geometry-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0l10 5-10 5z"/></marker></defs>${stars()}<path class="nebula" d="M275 344c52-116 176-163 282-69 38 34 20 107-45 115-85 10-99-56-164-15-59 38-106 9-73-31z"/>`
  if (fixture.kind === "none") return `${base}<g class="failure"><path d="M348 203l104 104m0-104L348 307" fill="none" stroke="currentColor" stroke-width="4"/><text x="400" y="345">NO SOLUTION</text><text class="failure-note" x="400" y="371">OFFSET UNKNOWN · FRAME PRESERVED</text></g></svg><div class="geometry-legend" data-legend><span><i></i>No correction vector is available when offset is unknown</span></div>`
  const point = geometry(fixture)
  const desired = fixture.kind === "polar" ? "CELESTIAL POLE" : "DESIRED CENTER"
  const measured = fixture.kind === "polar" ? "MEASURED MOUNT AXIS" : "SOLVED CENTER"
  const numeric = fixture.kind === "polar" ? `${fixture.error.toFixed(1)}′` : `${fixture.error}″ correction`
  const orbit = fixture.kind === "polar" ? `<circle cx="400" cy="250" r="118" fill="none" stroke="rgba(143,182,255,.24)" stroke-dasharray="3 8" stroke-width="1.5"/>` : ""
  return `${base}${orbit}<g class="desired" data-desired><circle cx="400" cy="250" r="22"/><path d="M400 212v76M362 250h76"/><text x="400" y="199" data-desired-label>${desired}</text></g><g class="measured" data-measured><circle cx="${point.x}" cy="${point.y}" r="16"/><circle class="uncertainty" cx="${point.x}" cy="${point.y}" r="27"/><path d="M${point.x - 23} ${point.y}h46M${point.x} ${point.y - 23}v46"/><text x="${point.x}" y="${point.y + 47}" data-measured-label>${measured}</text></g><line class="vector" data-vector x1="${point.x}" y1="${point.y}" x2="400" y2="250" marker-end="url(#geometry-arrow)"/><text class="vector-label" data-vector-label x="${(point.x + 400) / 2}" y="${(point.y + 250) / 2 - 14}">${numeric}</text></svg><div class="geometry-legend" data-legend><span><i class="desired"></i>${desired}</span><span><i class="solved"></i>${measured}</span><span><i></i>Arrow: measured → desired</span></div>`
}

function renderFacts(fixture) {
  if (fixture.kind === "none") return fact("Solve result", "OFFSET UNKNOWN") + fact("Mount correction", "Not available") + fact("Vector magnitude", "Not inferred") + fact("Evidence", "Frame preserved")
  if (fixture.kind === "polar") return fact("Axis error", `${fixture.error.toFixed(1)}′ ±${fixture.uncertainty.toFixed(1)}′`) + fact("Altitude", signed(fixture.alt, "′")) + fact("Azimuth", signed(fixture.az, "′")) + fact("Tolerance", "≤2.0′")
  return fact("Center error", `${fixture.error}″ ±${fixture.uncertainty}″`) + fact("Requested RA", signed(fixture.ra, "″")) + fact("Requested Dec", signed(fixture.dec, "″")) + fact("Tolerance / bound", "≤45″ / ≤600″")
}

function renderPhone(fixture) {
  const title = fixture.kind === "none" ? "No plate-solve solution" : fixture.kind === "polar" ? "Polar alignment measurement" : "Target centering measurement"
  const summary = fixture.kind === "none" ? "OFFSET UNKNOWN · no correction vector or mount movement is available." : fixture.kind === "polar" ? `${fixture.error.toFixed(1)}′ axis error · Alt ${fixture.alt < 0 ? "raise" : "lower"} ${Math.abs(fixture.alt).toFixed(1)}′ · Az ${fixture.az > 0 ? "left" : "right"} ${Math.abs(fixture.az).toFixed(1)}′.` : `${fixture.error}″ center error · requested RA ${signed(fixture.ra, "″")} · Dec ${signed(fixture.dec, "″")}.`
  return `<section data-phone-summary data-phone-controls="none"><div class="phone-mode-label"><span>Read-only geometry monitor</span><small>No controls</small></div><p class="eyebrow">Acquire / latest solve</p><h2>${title}</h2><p class="muted">${summary}</p><div class="fact-grid">${renderFacts(fixture)}</div>${fixture.kind === "polar" ? `<div class="physical-guidance">${physicalGuidance(fixture)}</div>` : ""}</section>`
}

function physicalGuidance(fixture) {
  return `<article><small>Physical altitude</small><strong>${fixture.alt < 0 ? "↑ RAISE" : "↓ LOWER"} ${Math.abs(fixture.alt).toFixed(1)}′</strong></article><article><small>Physical azimuth</small><strong>${fixture.az > 0 ? "← LEFT" : "→ RIGHT"} ${Math.abs(fixture.az).toFixed(1)}′</strong></article>`
}

function runChecks() {
  const overlay = document.querySelector("[data-overlay]")
  if (!overlay) return
  const matrix = overlay.getScreenCTM()
  if (!matrix) return
  const svgRect = overlay.getBoundingClientRect()
  const scale = matrix.a
  const common = [check("SVG intrinsic / viewBox", `${overlay.viewBox.baseVal.width}×${overlay.viewBox.baseVal.height} → ${svgRect.width.toFixed(1)}×${svgRect.height.toFixed(1)} CSS px`, overlay.viewBox.baseVal.width === 800 && overlay.viewBox.baseVal.height === 500 && scale > 0)]
  if (state.fixture.kind === "none") {
    const unknown = overlay.textContent.includes("OFFSET UNKNOWN")
    const vectorAbsent = !overlay.querySelector("[data-vector]")
    renderChecks([...common, check("Unknown offset / vector", vectorAbsent ? "OFFSET UNKNOWN · vector absent" : "Vector rendered unexpectedly", unknown && vectorAbsent), check("Legend / ARIA", legendAndAria(overlay), hasLegendAndAria(overlay))])
    elements.status.textContent = "No-solution fixture: offset remains unknown; geometry direction and anchor checks are intentionally not applicable."
    return
  }
  const point = geometry(state.fixture)
  const target = screenPoint(overlay, 400, 250)
  const actualDesired = screenPoint(overlay, Number(overlay.querySelector("[data-desired] circle")?.getAttribute("cx")), Number(overlay.querySelector("[data-desired] circle")?.getAttribute("cy")))
  const actualMeasured = screenPoint(overlay, Number(overlay.querySelector("[data-measured] circle")?.getAttribute("cx")), Number(overlay.querySelector("[data-measured] circle")?.getAttribute("cy")))
  const expectedMeasured = screenPoint(overlay, point.x, point.y)
  const desiredResidual = distance(target, actualDesired)
  const measuredResidual = distance(expectedMeasured, actualMeasured)
  const maxResidual = Math.max(desiredResidual, measuredResidual)
  const vector = overlay.querySelector("[data-vector]")
  const vectorStart = screenPoint(overlay, Number(vector?.getAttribute("x1")), Number(vector?.getAttribute("y1")))
  const vectorEnd = screenPoint(overlay, Number(vector?.getAttribute("x2")), Number(vector?.getAttribute("y2")))
  const expectedStart = screenPoint(overlay, point.x, point.y)
  const directionDot = (vectorEnd.x - vectorStart.x) * (target.x - expectedStart.x) + (vectorEnd.y - vectorStart.y) * (target.y - expectedStart.y)
  const angle = Math.atan2(vectorEnd.y - vectorStart.y, vectorEnd.x - vectorStart.x) * 180 / Math.PI
  const labelsClear = labelsClearOfMarkers(overlay)
  const checks = [...common, check("Anchor residuals", `desired ${desiredResidual.toFixed(3)} · measured ${measuredResidual.toFixed(3)} CSS px (max ≤0.5)`, maxResidual <= 0.5), check("Vector direction", `${angle.toFixed(1)}° · measured → desired`, directionDot > 0), check("Labels / marker clearance", labelsClear ? "clear" : "collision detected", labelsClear), check("Legend / ARIA", legendAndAria(overlay), hasLegendAndAria(overlay))]
  renderChecks(checks)
  elements.status.textContent = `${state.fixture.label}: geometry is normalized for direction and anchor fidelity; ${state.fixture.kind === "polar" ? "Alt/Az physical guidance" : "RA/Dec magnitude"} remains numeric text.`
}

function labelsClearOfMarkers(overlay) {
  const labels = ["[data-desired-label]", "[data-measured-label]", "[data-vector-label]"].map((selector) => overlay.querySelector(selector)?.getBoundingClientRect()).filter(Boolean)
  const markers = ["[data-desired] circle", "[data-measured] circle"].map((selector) => overlay.querySelector(selector)?.getBoundingClientRect()).filter(Boolean)
  return labels.every((label) => markers.every((marker) => rectGap(label, marker) >= 2))
}

function legendAndAria(overlay) { return `${overlay.parentElement?.querySelectorAll("[data-legend] span").length ?? 0} legend items · ${overlay.getAttribute("aria-label")}` }
function hasLegendAndAria(overlay) { return Boolean(overlay.parentElement?.querySelector("[data-legend]") && overlay.getAttribute("aria-label")) }
function renderChecks(checks) { elements.measurements.innerHTML = checks.map((item) => `<div class="measurement ${item.pass ? "pass" : "fail"}"><small>${item.label}</small><strong>${item.value}</strong></div>`).join("") }
function check(label, value, pass) { return { label, value, pass } }
function geometry(fixture) {
  if (fixture.kind === "polar") { const magnitude = Math.max(fixture.error, 0.1); const length = Math.min(180, Math.max(55, fixture.error * 7)); return { x: 400 + (fixture.az / magnitude) * length, y: 250 - (fixture.alt / magnitude) * length } }
  const magnitude = Math.max(fixture.error, 1); const length = Math.min(190, Math.max(62, fixture.error * 0.34)); return { x: 400 - (fixture.ra / magnitude) * length, y: 250 + (fixture.dec / magnitude) * length }
}
function stars() { return [[77,68,1],[132,172,1],[194,92,1.4],[248,309,1],[315,135,1],[356,390,1.3],[471,77,1],[522,348,1],[579,118,1.5],[637,287,1],[704,72,1],[746,402,1.2],[90,419,1],[672,435,1]].map(([x, y, radius]) => `<circle class="star" cx="${x}" cy="${y}" r="${radius}"/>`).join("") }
function screenPoint(svg, x, y) { const matrix = svg.getScreenCTM(); if (!matrix) return { x: 0, y: 0 }; const point = new DOMPoint(x, y).matrixTransform(matrix); return { x: point.x, y: point.y } }
function distance(left, right) { return Math.hypot(left.x - right.x, left.y - right.y) }
function rectGap(left, right) { return Math.max(0, Math.max(right.left - left.right, left.left - right.right, right.top - left.bottom, left.top - right.bottom)) }
function fact(label, value) { return `<div class="fact"><small>${label}</small><strong>${value}</strong></div>` }
function signed(value, unit) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(value % 1 ? 1 : 0)}${unit}` }
function ariaLabel(fixture) { if (fixture.kind === "none") return "Preserved frame with no plate-solve solution and unknown offset"; return fixture.kind === "polar" ? `Measured mount axis ${fixture.error.toFixed(1)} arcminutes from celestial pole` : `Desired and solved center separated by ${fixture.error} arcseconds` }
