# V2 Prototype Hub

This is an isolated, dependency-free static workspace for V2 interaction,
domain-model, and architecture studies. It is not the current product, does
not import Electron code, and never contacts observatory hardware.

## Open Locally

From the repository root:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/prototype/v2-ui/
```

Serving from the repository root keeps the hub's relative link to the existing
Seestar processing report working. Opening the HTML files directly also works
for the V2 pages, but the linked prior report is easiest to browse through the
local server.

## Current Studies

- `plan-timeline.html`: timeline-first night planning.
- `plan-ledger.html`: sequence-table-first night planning.
- `observe-guided.html`: phase-focused, evidence-led observing.
- `observe-canvas.html`: stable activity canvas observing.
- `preference-study.html`: Study One, a foundational pairwise UX study across eight interface
  dimensions, with three interleaved reversed hidden repeats, balanced compact
  A/B preview order, local resume, consistency and position-bias signals, and
  raw JSON export.
- `refinement-study.html`: Study Two, an isolated pairwise refinement study
  across eight narrower combinations informed by Study One, using the same
  bias controls and its own saved session and export identity.
- `composite-prototype.html`: Composite Iteration 2 combines the validated
  workspace rail, compact inspectable run surface, structurally aligned Plan
  opportunity lanes, scenario-responsive Observe, chronological Library,
  shared Inspector/Alerts rail, and read-only phone monitor.
- `acquire-prototype.html`: Gate 02 accepted on July 21, 2026; a standalone
  Observe / Acquire reference with seven synthetic plate-solving and
  polar-alignment scenarios, centrally derived policy decisions, immutable
  attempt evidence, and a read-only phone monitor. Acceptance covers the
  interaction model, not final visual polish.
- `run-authority-prototype.html`: Gate 03 accepted on July 21, 2026; the
  scenario-driven reference covers proportional active-run mutation, stale
  revision rejection,
  disconnect and snapshot-first reconstruction, presence, exclusive control,
  controller grace, owner takeover, stale-controller rejection, and the same
  canonical truth on a read-only phone.
- `process-prototype.html`: Gate 04 accepted on July 21, 2026; iteration 3 is
  the focused visual editor reference with
  Steps, a dominant synthetic image canvas, and one shared Operation,
  Assistant, and Inspector context rail. It includes non-stealing unread
  suggestions and explicit proposal previews, stage-local retry with bounded
  owner-safe diagnostics, metadata-aware data switching, completion actions,
  measured-pressure throttling, format-aware Save to Library, and a read-only
  phone monitor across seven synthetic scenarios.
- `convergence-roadmap.html`: the finite remaining gates, stop criteria, and
  promotion/discard rules that end in one V2 interaction specification and one
  backend-facing domain/contract model.
- `domain-model.html`: candidate run-state and ownership model.
- `architecture.html`: local and remote web topology.

Shared presentation and lightweight interactions live in `styles.css` and
`app.js`; each isolated preference schedule and result model lives in its
corresponding `preference-study.js` or `refinement-study.js`. Add future studies
as standalone pages, then inventory them on `index.html` with type, status,
scenario, and hypothesis metadata.

The composite prototype owns its synthetic application state centrally in
`composite-prototype.js`. Workspace navigation, selection, filters, context,
warnings, and simulated action feedback never call observatory APIs or modify
either preference study's saved session.

The Acquire prototype follows the same boundary in `acquire-prototype.js`.
Its scenario, evidence selection, Inspector/Alerts context, policy, geometry,
and recommended decision all come from one synthetic state and rule model.

The Run Authority prototype centralizes each synthetic service truth and its
derived decision in `run-authority-prototype.js`. Renderers consume that
projection; they do not infer mutation impact, freshness, or control authority.

The Process prototype keeps its synthetic session model in
`process-prototype.js`. The service-facing model owns the current linear edit
history, applied steps, checkpoints, and saved artifact lineage. Temporary
controls demonstrate preview state, while explicit Apply, Undo, Redo, Save,
and Discard actions make the lifecycle legible without exposing execution
records as the primary experience.

## Safety Boundary

All actions are simulations that only update local page text or open a dialog.
There are no network requests, device APIs, observatory or backend persistence,
package scripts, or runtime dependencies in this workspace. The only file-like
outputs are the preference studies' explicit browser-initiated JSON downloads.

Each preference study writes its own versioned, defensively validated session
to a distinct browser `localStorage` key so it can resume after a refresh. Its
reset control removes only that study's local record, and its export control
creates a study-specific local JSON download; neither operation sends data
anywhere.
