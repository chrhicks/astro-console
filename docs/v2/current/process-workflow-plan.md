# Item 3.5 — Explicit Process Workflow

Status: **Accepted epic; Item 3.5.1 complete; Item 3.5.2 next**

Item 3 proved durable worker-owned execution. Item 3.5 reshapes that execution
into the operator workflow: choose evidence, assign its role, run explicit
Calibration, Registration, and Stacking stages, save a Master, then Develop
that exact Master with astronomy-specific tools.

This work comes before Item 4 route promotion.

## Product Boundary

### Library

Library is where the operator finds and selects retained evidence.

- Select individual frames from the grid.
- Select a whole **Capture Set**. This replaces user-facing names such as
  `m27-stack-1`, because the group has not been stacked yet.
- Open the selection as a new Processing Project or add it to an existing
  project.
- Resolve a whole-set selection to the exact asset IDs and revisions present at
  that time. Later captures do not silently join the project.

### Processing Project

A Processing Project owns one target for its Lights. It may combine Capture
Sets from several nights when they belong to that target. Calibration support
frames are target-independent.

Project sources have these roles:

- Lights
- Darks
- Flats
- Bias
- Dark flats
- Unassigned

Process provides a full Library picker for adding sources. It reports target,
role, and metadata conflicts, but it does not turn advisory quality rules into
hard gates. The operator may continue with a viable subset or record `Use
anyway` for the current stage attempt.

## Explicit Stages

The persistent project navigation is:

1. **Sources** — choose frames, assign roles, and inspect recommendations. This
   stage does not run processing work.
2. **Calibration** — configure and explicitly Run or Rerun calibration.
3. **Registration** — choose a reference, configure alignment, and explicitly
   Run or Rerun registration.
4. **Stacking** — configure weighting and rejection, then explicitly Run or
   Rerun stacking.
5. **Master** — inspect and save the selected stacked result to Library.
6. **Develop** — open the exact saved Master and apply astronomy-specific image
   development operations.

The current worker checkpoints remain useful implementation detail:

| Operator stage | Current worker work   |
| -------------- | --------------------- |
| Sources        | Validate              |
| Calibration    | Calibrate and Debayer |
| Registration   | Align                 |
| Stacking       | Evaluate and Stack    |

The service must not automatically move through several operator stages after
one broad `Build` action. Each executable stage starts only when the owner uses
its explicit Run or Rerun action.

## Small Durable Model

Keep the model linear and versioned. Do not introduce a general DAG, event
sourcing, or a normalized database row for every frame decision.

- A project contains its exact sources, roles, target, and current selected
  results.
- Each executable stage has one editable draft, bounded draft undo/redo, an
  append-only attempt list, and one selected result.
- An attempt freezes its input asset revisions, upstream result, settings,
  tool identity, recommendations, operator overrides, per-frame outcomes,
  diagnostics, outputs, and timestamps.
- Registration names the Calibration attempt it used. Stacking names the
  Registration attempt it used. Develop names the saved Master it used.
- A newer upstream result does not delete an older downstream result. The UI
  marks the older result as based on an earlier attempt and lets the owner
  select or rerun deliberately.
- Store this state in the existing Process aggregate as bounded structured data
  where practical. Reuse the `processing_work` ledger and
  `processing_artifacts` records for worker ownership and files.
- Extend the existing OpenTelemetry path with low-cardinality stage, operation,
  outcome, retry or reconciliation, and pressure attributes. Exact project,
  attempt, asset, path, and checksum values remain durable domain evidence, not
  metric labels.

## Decisions And Overrides

Keep different kinds of judgment distinct:

- Library judgment: `Accepted`, `Rejected`, or `Unreviewed`.
- Platform recommendation: `Include`, `Exclude`, or `Review`.
- Stage outcome: `Succeeded`, `Warning`, `Failed`, or `Unavailable`.
- Operator override: `Use anyway`.

`Use anyway` belongs to the current stage draft and its resulting attempt.
Draft undo/redo may add or remove it before Run. Once Run starts, the attempt
freezes the decision. A later attempt does not inherit it unless the owner
explicitly chooses to rerun with the same settings.

Only technically impossible work is unavailable. Examples include missing or
unreadable bytes and a frame with no usable registration transform. Metadata
or quality concerns are advisory. One failed frame does not block a stage when
a viable subset remains.

## Delivery Slices

### Item 3.5.1 — Library Selection And Project Intake

**Status:** Complete.

**Operator result:** Select individual frames or a whole Capture Set in
Library, open a new Processing Project or add to an existing one, then see the
exact sources, target, provenance, and suggested roles in Sources. No
Calibration work starts automatically.

**Service scope:** Add the project/source contracts and commands. Resolve set
membership to exact asset IDs and revisions. Enforce one target for Lights
while projecting overridable warnings rather than artificial quality gates.

**Proof:** Cover individual selection, whole-set selection, several same-target
nights, Lights plus calibration frames, restart with the exact frozen sources,
and Designer review at wide, compact, and 390 px.

The completed slice proves those paths through local contracts, SQLite service
integration, web tests, and functional browser inspection. It also proves that
project intake creates no `processing_work` row. It does not prove Calibration,
production processing quality, a provider command, or a physical capture.

### Item 3.5.2 — Stage Drafts, Attempts, And Navigation

**Operator result:** Move among persistent Sources, Calibration, Registration,
Stacking, Master, and Develop views. Inspect earlier attempts and selected
results at any time. Explicit Run and Rerun replace the broad automatic Build
action.

**Service scope:** Add bounded stage drafts and undo/redo, append-only attempts,
selected results, and upstream lineage. Reuse worker claims, restart
reconciliation, stale-result rejection, artifacts, pressure handling, and
OpenTelemetry evidence from Item 3.

**Proof:** Show that command acceptance returns before work completes, restart
does not replay claimed work, stale settlement is rejected, and older
downstream results remain inspectable after an upstream rerun.

### Item 3.5.3 — Explicit Calibration

**Operator result:** Assign Lights and calibration roles, inspect metadata and
recommendations, adjust a Calibration draft, record `Use anyway` where needed,
and explicitly Run or Rerun. Inspect per-frame outcomes and continue
uncalibrated where the selected operation technically permits it.

**Service scope:** Freeze calibration inputs, settings, overrides, tool
identity, outputs, and frame outcomes into each attempt. Preserve the last
valid result through failure and restart.

**Proof:** Cover compatible and mismatched support frames, a changed draft,
override undo/redo, partial success, exact rerun inputs, and restart without
replay.

### Item 3.5.4 — Explicit Registration

**Operator result:** Choose a reference and settings, run Registration, inspect
which frames registered, warned, failed, or were unavailable, and proceed with
a viable subset. Rerun without losing earlier attempts.

**Service scope:** Bind each attempt to an exact Calibration result. Persist
transforms, diagnostics, overrides, and failed-frame evidence. A frame without
a usable transform cannot enter the selected Stack input, but it does not block
other viable frames.

**Proof:** Cover reference changes, mixed outcomes, `Use anyway` where
technically valid, missing-transform exclusion, retained earlier results, and
restart/retry behavior.

### Item 3.5.5 — Explicit Stacking And Saved Master

**Operator result:** Configure weights and rejection, inspect recommended
Include/Exclude/Review decisions, run or rerun Stack, compare versioned results,
select one Master, save it to Library, and open Develop from that exact saved
Master.

**Service scope:** Bind each Stack attempt to an exact Registration result.
Persist weights, decisions, overrides, diagnostics, outputs, and saved Library
lineage. Keep save idempotent and preserve saved artifacts when unsaved project
work is discarded.

**Proof:** Cover mixed frame decisions, stage override, several Stack versions,
Master save, exact Develop handoff, restart, and source/saved-artifact
preservation.

### Item 3.5.6 — Astronomy Develop Workspace

**Operator result:** Develop a saved Master with Preview, explicit Apply,
undo/redo, comparison, retry, and saves. Initial operation families are:

- astrometry and WCS;
- background extraction;
- SPCC or other astronomy color calibration;
- green-noise reduction;
- stretching;
- simple cyan, yellow, red, and saturation controls;
- star removal and starless processing;
- adding stars back; and
- other Siril or RC Astro operations after an adapter is selected.

Star removal may create paired starless and star-companion outputs. These are
related astronomy artifacts, not general layers.

**Service scope:** Add a typed astronomy-operation catalog and durable operation
attempts using deterministic adapters first. Keep stale-preview protection,
checkpoint retry, restart recovery, exact tool/settings provenance, and Library
save lineage.

**Proof:** Exercise the complete product path with deterministic operations,
including paired star outputs, apply failure and retry, undo/redo, refresh,
restart, and save. Production Siril and RC Astro quality remain separate
adapter proof.

### Item 3.5.7 — Integrated Operator Review And Closeout

**Operator result:** Complete the full journey from Plan and Observe through
Library selection, a multi-night Processing Project, explicit Calibration,
Registration, and Stacking, saved Master, astronomy Develop, and final Library
artifact. Every completed attempt remains inspectable after fast worker work.

**Proof:** Run functional review and Designer review at wide, compact, and 390
px, including keyboard, focus, overflow, console, restart, retry, warning,
override, and read-only phone evidence. Reconcile current documentation and
leave Item 4 route promotion as the next explicit owner decision.

## Explicit Non-Goals

Item 3.5 is not a general photo editor. It does not add layers, masks, brushes,
painting, text, arbitrary selections, compositing, or a general node graph.
It also does not select or prove the production Siril or RC Astro adapter.
