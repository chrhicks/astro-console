# UI And UX Direction

Status: **current application UI direction**

## Goal

Keep the promoted Astro Console presentation coherent through its local visual
modules and application-owned workspace composition.

## Visual And Interaction Authority

The authoritative implementation is:

- domain-neutral visual modules and contained styles:
  `apps/web/src/components/ui`
- product composition and interaction: `apps/web/src/components/workspaces`, with shared shell and development simulation presentation under `apps/web/src/components`
- rendered application verification: the normal Plan, Observe, Library, and
  Process routes

The disposable prototype checkout, product demo, Gallery, and package source
were migration input only. They are not ongoing design, build, synchronization,
or verification authority. The older Astro Console visual guides, component
grammar, UX catalog, and Phase 0.5 material are also historical. Preserve those
records and use the current local web implementation for further work.

## Ownership Boundary

- The local UI implementation owns domain-neutral React visual modules, their
  accessibility and controlled interaction behavior, and their contained
  styling.
- Application workspace modules own product composition and local interaction
  state.
- Astro Console runtime and service modules own projections, routes, product
  wording, action eligibility, commands, revisions, and reconciliation with
  service truth.
- Do not copy workflow rules into the visual modules or create another package,
  Gallery, or compatibility layer.
- Historical demo fixtures do not prove Astro Console persistence, provider
  behavior, hardware results, or physical capture.

## Working Method

For one workflow or state at a time:

1. Identify the exact application route, state, and interaction in scope.
2. List the service facts, action eligibility, and command results it needs.
3. Map existing Astro Console projections to that composition.
4. Add the smallest missing service or contract projection. Do not replace a
   missing fact with a client fixture or inferred eligibility.
5. Compose the route from the local UI interface and application-owned
   adapters.
6. Review the rendered result at wide, compact, and 390 px phone widths; also
   check keyboard, focus, overflow, console, and read-only behavior.
7. Keep normal routes on the accepted local presentation after changes pass
   the agreed functional and visual review.

## Known Alignment Work

The first three Process projection gaps are closed: per-action eligibility,
complete Library detail for Process outputs, and deterministic unfinished
session resume. Item 3.5.1 also closes Library selection, whole Capture Set
intake, and the persistent Processing Project Sources view. Item 3.5.2 closes
persistent stage navigation, drafts, retained attempts, selected results, and
exact upstream lineage. Item 3.5.3 closes explicit Calibration recommendations,
draft choices, attempt-scoped source inclusion or removal, per-Light outcomes,
and deterministic output evidence. Item 3.5.4 closes explicit Registration
reference and settings, per-Light transform outcomes, viable-subset selection,
retained attempts, and exact Calibration lineage. Item 3.5.5 closes explicit
Stacking decisions, versioned results, saved Library Master lineage, and the
exact saved-Master Develop handoff. Item 3.5.6 closes the deterministic
astronomy Develop workspace, explicit Preview and Apply boundary, linear
history, paired star outputs, retry, comparison, and Library saves. The
integrated Item 3.5 review is also complete: the retained two-Capture-Set M27
journey passed functional and Designer review across all six Process stages,
public Library detail, restart, wide, compact, and read-only phone states. The
route audit and promotion are complete. The follow-on architecture audit is
complete, and its shared protocol, origin runtime, and workspace runtime
refactors do not change the visual authority.

- Library selection and whole Capture Set intake must lead to a persistent
  Processing Project, not directly into transient worker progress.
- Sources, Calibration, Registration, Stacking, Master, and Develop remain
  client navigation inside an explicitly opened Processing Project. Navigation
  is not durable Project state.
- The service owns source roles, recommendations, warnings, Current Results,
  immutable attempt evidence, lineage, eligibility, and denial reasons. The
  primary workspace shows Current Result; earlier attempts remain secondary
  evidence. Do not invent these facts in the client or delay deterministic work
  to make progress easier to see.
- Develop is an astronomy workflow. Preserve the dominant image workspace and
  astronomy operations without drifting into layers, masks, compositing, or a
  general Photoshop-style editor.

## Promotion State

Plan, Observe, Library, Library detail, and Process routes render the application-owned presentation.
The former presentation has been removed. Normal workspace routes render the
application workspaces directly. The root route `/` maps to Plan.
