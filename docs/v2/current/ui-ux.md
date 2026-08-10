# UI And UX Direction

Status: **current direction for the Nightbook UI migration**

## Goal

Promote the opt-in Astro Console beta presentation to the main UI. The beta is
an integration client for the official Nightbook demo and `@nightbook/ui`; it
is not a separate design authority.

## Visual And Interaction Authority

The authoritative source is the external Nightbook workspace:

- composed product demo:
  `/Users/chicks/dev/personal/kimi_workspace/nightbook-prototype/apps/nightbook-demo`
- React component package:
  `/Users/chicks/dev/personal/kimi_workspace/nightbook-prototype/packages/ui`
- isolated component gallery:
  `/Users/chicks/dev/personal/kimi_workspace/nightbook-prototype/apps/gallery`
- containment consumer:
  `/Users/chicks/dev/personal/kimi_workspace/nightbook-prototype/apps/resetless-consumer`

Use the rendered React demo as the authority for page composition, hierarchy,
interaction, responsive behavior, and visual treatment. Use the Gallery and
package source for component behavior and public APIs. `READINESS.md` and
`COMPONENT-CONTRACTS.md` in that workspace explain the package boundary and
verification surface.

The older Astro Console visual guides, component grammar, UX catalog, and
Phase 0.5 material are historical. Existing non-beta `apps/web` workspaces and
CSS remain running code until promotion, but they are not design references
and should not receive further visual-system work.

## Ownership Boundary

- `@nightbook/ui` owns domain-neutral, tested React components and their
  contained styling.
- The Nightbook demo owns product composition and interaction reference.
- Astro Console owns service projections, routes, product wording, action
  eligibility, commands, revisions, and reconciliation with service truth.
- Astro Console must not copy workflow rules into the package or recreate
  package components in local hard-coded component layers.
- Demo fixtures demonstrate states and interactions. They do not prove Astro
  Console persistence, provider behavior, hardware results, or physical
  capture.

## Working Method

For one demo workflow or state at a time:

1. Identify the exact demo page, state, and interaction to reproduce.
2. List the service facts, action eligibility, and command results it needs.
3. Map existing Astro Console projections to that composition.
4. Add the smallest missing service or contract projection. Do not replace a
   missing fact with a client fixture or inferred eligibility.
5. Compose the beta from `@nightbook/ui` and application-owned adapters.
6. Compare the result with the demo at wide, compact, and 390 px phone widths;
   also check keyboard, focus, overflow, console, and read-only behavior.
7. Promote the beta route only after all four workspaces pass the agreed
   functional and visual review.

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
next work is the explicit beta audit and route-promotion decision.

- Library selection and whole Capture Set intake must lead to a persistent
  Processing Project, not directly into transient worker progress.
- Sources, Calibration, Registration, Stacking, Master, and Develop must remain
  navigable after work completes. Earlier attempts and their evidence remain
  inspectable.
- The service owns source roles, recommendations, warnings, attempts, selected
  results, lineage, eligibility, and denial reasons. Do not invent these in the
  client or delay deterministic work to make progress easier to see.
- Develop is an astronomy workflow. Preserve the dominant image workspace and
  astronomy operations without drifting into layers, masks, compositing, or a
  general Photoshop-style editor.

## Promotion Boundary

Until the owner approves route promotion, `?ui=beta` remains the comparison
and integration path and the existing routes remain the default. Promotion is
a later product decision with its own functional and Designer evidence. Old UI
code retirement follows successful promotion; it is not part of design
authority cleanup.
