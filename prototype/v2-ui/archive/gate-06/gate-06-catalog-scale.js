const PAGE_SIZE = 250
const ROW_HEIGHT = 76
const OVERSCAN = 6
const MAX_COMPARISON = 4

const state = {
  assets: [],
  filtered: [],
  selectedIds: new Set(),
  selectedAssetId: "",
  size: 10000,
  strategy: "virtual",
  sort: "newest",
  filter: "all",
  page: 0,
  metrics: {},
}

const elements = {
  size: document.querySelector("[data-size]"),
  strategy: document.querySelector("[data-strategy]"),
  sort: document.querySelector("[data-sort]"),
  filter: document.querySelector("[data-filter]"),
  install: document.querySelector("[data-install]"),
  scenario: document.querySelector("[data-run-scenario]"),
  viewport: document.querySelector("[data-viewport]"),
  spacer: document.querySelector("[data-spacer]"),
  results: document.querySelector("[data-results]"),
  status: document.querySelector("[data-catalog-status]"),
  notice: document.querySelector("[data-notice]"),
  metrics: document.querySelector("[data-metrics]"),
  comparison: document.querySelector("[data-comparison-list]"),
  comparisonHint: document.querySelector("[data-comparison-hint]"),
  detail: document.querySelector("[data-detail]"),
  paging: document.querySelector("[data-paging]"),
  pageLabel: document.querySelector("[data-page-label]"),
  previous: document.querySelector("[data-previous-page]"),
  next: document.querySelector("[data-next-page]"),
}

elements.install.addEventListener("click", installCatalog)
elements.scenario.addEventListener("click", runInteractionSample)
elements.size.addEventListener("change", () => { state.size = Number(elements.size.value) })
elements.strategy.addEventListener("change", () => { state.strategy = elements.strategy.value })
elements.sort.addEventListener("change", () => { state.sort = elements.sort.value; applyCatalogView("sort") })
elements.filter.addEventListener("change", () => { state.filter = elements.filter.value; applyCatalogView("filter") })
elements.viewport.addEventListener("scroll", () => renderCatalogRows())
elements.results.addEventListener("click", onResultClick)
elements.comparison.addEventListener("click", onComparisonClick)
document.querySelector("[data-clear-selection]").addEventListener("click", () => {
  state.selectedIds.clear()
  renderCatalogRows()
  renderSelection()
})
elements.previous.addEventListener("click", () => { state.page -= 1; renderCatalogRows() })
elements.next.addEventListener("click", () => { state.page += 1; renderCatalogRows() })

installCatalog()

function installCatalog() {
  state.size = Number(elements.size.value)
  state.strategy = elements.strategy.value
  state.sort = elements.sort.value
  state.filter = elements.filter.value
  state.page = 0
  state.selectedIds.clear()
  const started = performance.now()
  state.assets = createAssets(state.size)
  state.metrics.installMs = performance.now() - started
  state.selectedAssetId = state.assets[0]?.id ?? ""
  applyCatalogView("render")
  elements.notice.textContent = `${formatCount(state.size)} deterministic assets installed using ${strategyLabel()}. Synthetic state is local to this page.`
}

function createAssets(size) {
  return Array.from({ length: size }, (_, index) => {
    const group = Math.floor(index / 4)
    const target = ["M27", "NGC 7000", "Elephant Trunk", "M31", "Veil East"][group % 5]
    const filter = ["OIII", "Hα", "SII", "L", "RGB"][index % 5]
    const quality = index % 17 === 0 ? "rejected" : index % 7 === 0 ? "marginal" : "accepted"
    const role = index % 23 === 0 ? "linear master" : index % 29 === 0 ? "derived preview" : "original"
    const availability = index % 31 === 0 ? "expiring" : index % 37 === 0 ? "preparing" : "available locally"
    const capture = new Date(Date.UTC(2026, 6, 22, 1, 0, 0) - index * 183000)
    const fwhm = 2.1 + ((index * 13) % 27) / 10
    return {
      id: `asset-${String(index + 1).padStart(6, "0")}`,
      group: `source-group-${String(group + 1).padStart(5, "0")}`,
      target,
      filter,
      quality,
      role,
      availability,
      capturedAt: capture.toISOString(),
      exposure: index % 5 === 3 ? 300 : 180,
      gain: index % 5 === 3 ? 0 : 100,
      fwhm,
      eccentricity: (0.31 + ((index * 7) % 23) / 100).toFixed(2),
      drift: (4 + (index % 29)).toFixed(0),
      reason: quality === "accepted" ? "Sharpness and shape inside the session threshold" : quality === "marginal" ? "Sharpness rose above the review threshold" : "Trailing exceeded the rejection threshold",
      representationCount: index % 11 === 0 ? 2 : 1,
    }
  })
}

function applyCatalogView(kind) {
  if (!state.assets.length) return
  const started = performance.now()
  state.filtered = state.assets
    .filter((asset) => state.filter === "all" || asset.quality === state.filter)
    .toSorted((left, right) => compareAssets(left, right, state.sort))
  state.page = 0
  elements.viewport.scrollTop = 0
  state.metrics[`${kind}Ms`] = performance.now() - started
  renderCatalogRows()
  renderSelection()
}

function compareAssets(left, right, sort) {
  if (sort === "sharpest") return left.fwhm - right.fwhm || right.capturedAt.localeCompare(left.capturedAt)
  if (sort === "target") return left.target.localeCompare(right.target) || right.capturedAt.localeCompare(left.capturedAt)
  return right.capturedAt.localeCompare(left.capturedAt)
}

function renderCatalogRows() {
  const started = performance.now()
  const pageAssets = state.strategy === "paged"
    ? state.filtered.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE)
    : state.filtered
  const windowed = state.strategy !== "full"
  const first = windowed ? Math.max(0, Math.floor(elements.viewport.scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
  const visibleCount = windowed ? Math.ceil(elements.viewport.clientHeight / ROW_HEIGHT) + OVERSCAN * 2 : pageAssets.length
  const rows = pageAssets.slice(first, first + visibleCount)
  elements.spacer.style.height = `${pageAssets.length * ROW_HEIGHT}px`
  elements.results.style.transform = `translateY(${first * ROW_HEIGHT}px)`
  elements.results.innerHTML = rows.map(assetRow).join("")
  state.metrics.renderMs = performance.now() - started
  state.metrics.domRows = rows.length
  state.metrics.visibleAssets = pageAssets.length
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE))
  elements.paging.hidden = state.strategy !== "paged"
  elements.pageLabel.textContent = `Page ${state.page + 1} of ${totalPages} · ${PAGE_SIZE} assets`
  elements.previous.disabled = state.page === 0
  elements.next.disabled = state.page >= totalPages - 1
  elements.status.innerHTML = `<strong>${formatCount(state.filtered.length)}</strong> matching assets · <strong>${formatCount(state.metrics.domRows)}</strong> mounted rows · ${strategyLabel()}`
  renderMetrics()
}

function assetRow(asset) {
  const selected = state.selectedIds.has(asset.id)
  return `<button class="asset-row" type="button" data-asset-id="${asset.id}" aria-pressed="${selected}">
    <span class="mono">${selected ? "✓" : ""}</span><span class="preview" aria-hidden="true">✦</span><span><strong>${asset.target} · ${asset.filter} · ${asset.id}</strong><small>${formatCapture(asset.capturedAt)} · ${asset.exposure}s · gain ${asset.gain} · ${asset.role}</small></span><span><span class="row-chip ${asset.quality}">${asset.quality}</span><small>FWHM ${asset.fwhm.toFixed(1)}″ · ecc ${asset.eccentricity}</small></span><span><small>${asset.availability}</small><small>${asset.representationCount} representation${asset.representationCount === 1 ? "" : "s"}</small></span><span class="row-chip">${asset.group.slice(-5)}</span>
  </button>`
}

function onResultClick(event) {
  const button = event.target.closest("[data-asset-id]")
  if (!button) return
  const started = performance.now()
  const asset = state.assets.find((candidate) => candidate.id === button.dataset.assetId)
  if (!asset) return
  state.selectedAssetId = asset.id
  if (state.selectedIds.has(asset.id)) state.selectedIds.delete(asset.id)
  else if (canCompare(asset)) state.selectedIds.add(asset.id)
  else elements.notice.textContent = `Comparison accepts up to ${MAX_COMPARISON} related assets. Choose a peer from ${asset.group} or clear the current comparison.`
  state.metrics.selectMs = performance.now() - started
  renderCatalogRows()
  renderSelection()
}

function canCompare(asset) {
  if (state.selectedIds.size === 0) return true
  if (state.selectedIds.size >= MAX_COMPARISON) return false
  const first = state.assets.find((candidate) => candidate.id === [...state.selectedIds][0])
  return first?.group === asset.group
}

function onComparisonClick(event) {
  const button = event.target.closest("[data-remove-id]")
  if (!button) return
  state.selectedIds.delete(button.dataset.removeId)
  renderCatalogRows()
  renderSelection()
}

function renderSelection() {
  const selected = state.assets.find((asset) => asset.id === state.selectedAssetId) ?? state.assets[0]
  const compared = state.assets.filter((asset) => state.selectedIds.has(asset.id))
  elements.comparisonHint.textContent = compared.length
    ? `${compared.length} related asset${compared.length === 1 ? "" : "s"} selected from ${compared[0].group}.`
    : `Select up to ${MAX_COMPARISON} assets from one lineage group.`
  elements.comparison.innerHTML = compared.length
    ? compared.map((asset) => `<button type="button" data-remove-id="${asset.id}" aria-pressed="true"><span>${asset.target} · ${asset.filter}<small class="muted">${asset.id} · FWHM ${asset.fwhm.toFixed(1)}″</small></span><span aria-label="Remove ${asset.id}">×</span></button>`).join("")
    : `<p class="fine">No comparison selected.</p>`
  elements.detail.innerHTML = selected ? detailRows(selected) : ""
}

function detailRows(asset) {
  return [
    ["Asset", asset.id], ["Captured", formatCapture(asset.capturedAt)], ["Review", `${asset.quality} · ${asset.reason}`], ["Lineage", asset.group], ["Availability", asset.availability], ["Metrics", `FWHM ${asset.fwhm.toFixed(1)}″ · eccentricity ${asset.eccentricity} · drift ${asset.drift}″`],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")
}

function renderMetrics() {
  const metrics = [
    ["Synthetic assets", formatCount(state.assets.length)], ["Strategy", strategyLabel()], ["Install", formatMs(state.metrics.installMs)], ["Filter / sort", formatMs(state.metrics.filterMs ?? state.metrics.sortMs)], ["Render", formatMs(state.metrics.renderMs)], ["Selection", formatMs(state.metrics.selectMs)], ["Mounted rows", formatCount(state.metrics.domRows ?? 0)], ["Visible set", formatCount(state.metrics.visibleAssets ?? 0)],
  ]
  elements.metrics.innerHTML = metrics.map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join("")
}

function runInteractionSample() {
  const started = performance.now()
  state.filter = "accepted"
  state.sort = "sharpest"
  elements.filter.value = state.filter
  elements.sort.value = state.sort
  applyCatalogView("filter")
  const group = state.filtered[0]?.group
  const related = state.assets.filter((asset) => asset.group === group).slice(0, MAX_COMPARISON)
  state.selectedIds.clear()
  related.forEach((asset) => state.selectedIds.add(asset.id))
  state.selectedAssetId = related[0]?.id ?? state.selectedAssetId
  state.metrics.sampleMs = performance.now() - started
  renderCatalogRows()
  renderSelection()
  elements.notice.textContent = `Interaction sample ran: accepted filter, sharpest sort, then related comparison. Total scripted browser work: ${formatMs(state.metrics.sampleMs)}. Restore another filter or sort to continue.`
}

function strategyLabel() {
  if (state.strategy === "full") return "full DOM render"
  if (state.strategy === "paged") return "paged + windowed"
  return "windowed results"
}

function formatCapture(value) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value)) + " UTC"
}

function formatCount(value) { return new Intl.NumberFormat("en-US").format(value) }
function formatMs(value) { return typeof value === "number" ? `${value.toFixed(1)} ms` : "—" }
