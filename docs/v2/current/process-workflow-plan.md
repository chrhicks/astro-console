# Item 3.5 — Explicit Process Workflow

Status: **Accepted epic; Items 3.5.1–3.5.5 complete; Item 3.5.6 next**

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

## Decisions And Source Inclusion

Keep different kinds of judgment distinct:

- Library judgment: `Accepted`, `Rejected`, or `Unreviewed`.
- Platform recommendation: `Include`, `Exclude`, or `Review`.
- Stage outcome: `Succeeded`, `Warning`, `Failed`, or `Unavailable`.
- Operator choice: use an advisory source for the current stage or remove it
  from the project.

The UI names the source type and the actual consequence, for example `Use this
Flat` or `Remove from project`. The inclusion choice belongs to the current
stage draft and its resulting attempt. Draft undo/redo may add or remove it
before Run. Once Run starts, the attempt freezes the decision. Removing a
source from the project prunes the current draft choice but does not remove
completed attempt evidence.

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

**Status:** Complete.

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

The completed slice proves these paths through local contracts, SQLite service
integration, web tests, and functional browser inspection. Draft history keeps
at most ten undo and ten redo snapshots. Attempts remain append-only and freeze
exact source revisions, roles, settings, and selected upstream lineage. A
deterministic stage harness proves command acceptance, worker claim and
settlement, artifact persistence, live projection refresh, and restart-safe
mechanics. It does not prove Calibration, Registration, or Stacking science or
production processing quality.

### Item 3.5.3 — Explicit Calibration

**Status:** Complete.

**Operator result:** Assign Lights and calibration roles, inspect metadata and
recommendations, adjust a Calibration draft, explicitly include a mismatched
support source or remove it from the project, and Run or Rerun. Inspect
per-frame outcomes and continue uncalibrated where the selected operation
technically permits it.

**Service scope:** Freeze calibration inputs, settings, overrides, tool
identity, outputs, and frame outcomes into each attempt. Preserve the last
valid result through failure and restart.

**Proof:** Cover compatible and mismatched support frames, a changed draft,
inclusion undo/redo, source removal and re-add, partial success, exact rerun
inputs, and restart without replay.

The completed slice freezes exact source revisions, Library roles and formats,
recommendations, settings, overrides, tool identity, per-Light outcomes, and
checksum-bound deterministic JSON outputs. Derived or unknown Library inputs
are technically unavailable and cannot be included. Advisory mismatches can be
included explicitly for the current draft, or removed from the project. Undo
and redo retain the draft choice. Removal is blocked while stage work is active
and never deletes completed attempt evidence; re-add creates a fresh advisory
choice. Failed reruns keep the last selected valid result, and claimed work
resumes without replay. Local contract, SQLite service, worker, web, and
browser evidence cover these paths. The adapter proves deterministic
orchestration and evidence materialization only; it does not prove
astronomy-quality calibration or an external processing tool.

### Item 3.5.4 — Explicit Registration

**Status:** Complete.

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

The completed MVP binds each Registration attempt to one exact selected
Calibration result. Its bounded draft keeps a reference Light, alignment
model, star-detection setting, and explicit warning-frame choices through undo
and redo. Run or Rerun freezes those facts, exact source revisions, and the
deterministic adapter identity. Attempts retain per-Light outcomes,
diagnostics, checksum-bound transform evidence, and the viable Light subset;
a frame without a usable transform never enters the next Stack input. Earlier
attempts and the last valid selected result survive reruns and restart without
worker replay. Local contract, SQLite service, worker, browser, and Designer
proof cover this deterministic flow only; they do not prove astronomy-quality
alignment or an external registration tool.

### Item 3.5.5 — Explicit Stacking And Saved Master

**Status:** Complete.

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

The completed MVP binds each Stacking attempt to one exact selected
Registration result and its viable transforms. Its bounded draft keeps minimal
weighting and rejection settings plus explicit frame choices through undo and
redo. Run or Rerun freezes those facts and creates versioned deterministic
FITS evidence with diagnostics and exact lineage. The owner may select an
earlier result, save that exact result once as a retained Library Master, and
open Develop only from that saved asset. Restart keeps attempts, selection,
Library lineage, and the Develop handoff without replay. Local contract,
SQLite service, worker, browser, and Designer proof cover this deterministic
flow only; they do not prove astronomy-quality stacking or an external
processing tool.

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
