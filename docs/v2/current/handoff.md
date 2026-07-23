# Gate 7 Final-Reference Handoff

Status: Gate 7 accepted July 23, 2026; V2 reference frozen

Current work: Gate 7 complete

This is the durable continuation point for Gate 7. It preserves accepted Gates
1–5 and Gate 6 constraints without requiring later work to ingest the full
history.

The accepted [Gate 7 trace and decision log](gate-07-walkthrough.md) freezes
the reference at [the accepted prototype hub](../../../prototype/v2-ui/index.html).
Its contract reconciliation and live wide, compact, and phone validation are
complete.

## Current Position

Six of seven convergence gates are complete:

1. Composite V2 workspace convergence.
2. Acquire evidence workflows.
3. Run mutation, reconnect, and control ownership.
4. Process model.
5. Contract harness — accepted vocabulary, schemas, transitions, and
   future-server proofs.
6. Technical spikes — catalog scale, solve geometry, and reconnect/preview
   constraints recorded.

Gate 5 translated the accepted interactions into canonical entities, Effect
Schema candidates, deterministic transitions, typed failures, UI-driving
traces, and deterministic future-server proofs. A walkthrough exposed shallow
fixtures and several real contract defects; the hardening pass corrected them
without reopening accepted UX.

The shared scenario set and state-ownership table are accepted in
[the Gate 5 baseline](gate-05-scenarios.md). The browser is stateless for
domain data; Process preview settings synchronize through a debounce; Process
sessions are durable resumable working resources rather than Library assets;
and local-original downloads stream on LAN or stage through private R2 for
remote delivery.

The accepted [consequential-action map](gate-05-action-map.md) assigns
authorization, eligibility, freshness guards, named intents, deterministic
results, durable evidence, and typed failures to every accepted scenario. It is
a language-level contract and is not yet production schema.

The accepted [canonical contract vocabulary](gate-05-contract-vocabulary.md)
names the aggregate roots, commands, snapshots, durable events, projection
events, failures, and service transitions shared by later schemas. It resolves
the overloaded use of “snapshot”: `RunDefinition` is the immutable content
accepted at run start, while `RunSnapshot` and `AppSnapshot` are current read
projections.

The standalone [V2 contracts package](../../../packages/v2-contracts/README.md)
is the executable Gate 5 candidate. It compiles all 33 command variants,
nine failure families, 38 typed durable events, branded freshness tokens,
UI-driving snapshots, event-gap recovery, and the exhaustive shared command
gate. Deterministic transitions cover shell/client state, Run, Control,
Acquire, Process, and Library, and all 43 accepted scenarios execute as
fixtures, with the completed regrade in the
[server-perspective audit](gate-05-server-audit.md). The package passes 176
tests across 21 suites and does not depend on the legacy Electron application.

## Gate 4 Decisions

- Process is a visual image editor, not a job administration dashboard.
- It has Build image and Develop image phases separated by a durable linear
  master.
- One service-owned current session has one linear edit history with Preview,
  Apply, Undo, Redo, and reset-preview. There are no user-visible branches.
- The image canvas is dominant. Steps remain at left; Operation, optional
  Assistant findings, and Inspector share the right context rail.
- Press-and-hold reveals the linear reference and returns to the current image
  on release, with pointer, touch, and keyboard equivalents.
- Compatible tools are selectable per operation. Exact versions, parameters,
  inputs, attempts, and outputs remain provenance underneath the editor.
- Assistance is optional and advisory. It can notify without stealing focus
  and can load an explained proposal into Preview, but only the user applies it.
- Failure retry is stage-local from the latest valid checkpoint. A Stretch
  failure does not rerun Calibration through Stack.
- Detailed diagnostics are available in a bounded owner-safe modal with raw
  tool output and exact retry scope; secrets and sensitive paths are redacted.
- Active capture alone does not pause processing. Throttling or exceptional
  pause requires measured pressure that threatens acquisition or host health.
- Reconnect displays ordinary current service state after an authoritative
  snapshot. The browser does not reconstruct or own the job.
- Source switching covers recent capture sessions, unfinished Process work,
  existing linear stacks, and Library browsing, with explicit protection for
  unsaved work.
- Save to Library may create several related FITS and display artifacts. There
  is no promoted-final concept. Discard removes unsaved derived work while
  preserving sources and saved artifacts.
- General comparison among several saved results belongs to Library; Process
  may link to it as a convenience.
- A first-class reusable recipe is deferred until the product demonstrates a
  real reuse need. Reproducibility comes from recorded inputs and operations.

## Accepted Reference And Validation

Iteration 3 is the accepted Process reference:

- [Gate 4 decision record](../gates/gate-04-process.md)
- [Interactive Process reference](../../../prototype/v2-ui/process-prototype.html)
- [Synthetic Process state model](../../../prototype/v2-ui/process-prototype.js)
- [V2 UX and design guidance](../ux-design-guidance.md)

Validation exercised the reference at 1600 px and 1000 px desktop widths and a
390 px read-only phone width. It confirmed no page overflow or console errors,
the three-region hierarchy, responsive context reflow, no phone mutations,
Assistant unread and proposal behavior, stage-local failure diagnostics, save,
discard, and protected source switching.

## Gate 5 Outputs

Gate 5 made these service-facing concepts executable:

- authoritative snapshots, revisions, and snapshot-first reconnect;
- `ProcessingSession`, ordered applied operations, history position, sources,
  current output, and comparison reference;
- preview versus applied state and invalidation rules;
- operation/tool compatibility and parameter validation;
- checkpoints, attempts, diagnostics, and stage-local retry eligibility;
- stable asset identity, lineage, selected save formats, and publication
  availability independent of processing health;
- discard and source-switch dispositions;
- measured resource pressure and truthful throttling reasons; and
- phone/read-only and owner-only diagnostics eligibility.

The contract harness must preserve the workspace boundary: Library owns
durable assets and saved-result comparison; Process owns the current editing
session; neither owns the rig or observing lease.

## Deferred, Not Open

- Exact visual polish and final copy.
- A reusable recipe/preset system.
- User-visible branching or arbitrary edit-history navigation.
- General multi-artifact comparison inside Process.
- A specific final list of Siril, RCAstro, or other adapters.
- Automatic assistant application.
- Automatic processing pause merely because capture is active.

These are not Gate 5 invitations unless contract evidence exposes a direct
conflict with an accepted product invariant.

## Single Next Action

Begin Phase 0.5: finalize the official V2 style and design guide from the
accepted product, contract, and prototype references. Reopen an accepted
interaction model only for a recorded product-invariant conflict—not
implementation convenience, copy polish, or visual taste. Begin Phase 1 only
after the user accepts that design authority.

The [Phase 0.5 design-system brief](phase-0.5-design-system-brief.md) is the
current method and deliverable boundary for that work.

## Gate 7 Bootstrap

### Read in this order

1. [V2 Start Here](../README.md).
2. [UX and design guidance](../ux-design-guidance.md).
3. This handoff.
4. [Convergence plan](convergence-plan.md).
5. Load the authoritative artifacts below only as the walkthrough needs them;
   do not broadly read archives.

### Authoritative evidence

- [Accepted prototype hub](../../../prototype/v2-ui/index.html) for the chosen
  visual references.
- [Gate 1 Composite](../gates/gate-01-composite.md), [Gate 2 Acquire](../gates/gate-02-acquire.md),
  [Gate 3 Run authority](../gates/gate-03-run-authority.md), and
  [Gate 4 Process](../gates/gate-04-process.md) for accepted interaction
  decisions.
- [Gate 5 baseline](gate-05-scenarios.md),
  [action map](gate-05-action-map.md),
  [contract vocabulary](gate-05-contract-vocabulary.md), and the
  [executable contracts package](../../../packages/v2-contracts/README.md) for
  scenario, ownership, and service-language reconciliation.
- The three Gate 6 results linked below for implementation constraints.

### Walkthrough and verification

Walk one coherent operator story through Plan, Acquire, capture, a warning or
recovery, Library review, Process, reconnect, and control transfer. Reconcile
each consequential step to the Gate 5 scenario/action evidence and the
corresponding accepted prototype state; distinguish service truth from browser
presentation.

Verify the final reference at wide desktop (1600 px), compact desktop (1000
px), and read-only phone (390 px): no page overflow or console errors, keyboard
paths and named controls on desktop, and no mutation controls on phone. Record
the walkthrough trace, a decision log of accepted/deferred/rejected matters,
and the frozen-reference location or revision.

### Stop, reopen, and non-goals

Stop when the walkthrough and trace reconciliation satisfy the convergence-plan
criteria and no unresolved choice can change the first local-web foundation.
Reopen an accepted model only when the walkthrough exposes a conflict with a
product invariant; implementation convenience, copy polish, or visual taste is
not enough.

Gate 7 does not add production transport, persistence, hardware adapters,
Library redesign, new workspace models, recipes, user-visible history branches,
or phone mutation controls. It does not rerun Gate 6 benchmarks except to
verify an actual conflict with their recorded constraints.

## Gate 6 Results

The completed [catalog-scale result](gate-06-catalog-scale.md) rejects full-DOM
rendering and establishes the implementation boundary: a bounded server query
with a virtualized viewport. Client-only paging does not solve the unbounded
installation and sort cost. The completed
[solve-geometry result](gate-06-solve-geometry.md) retains normalized direction
plus numeric magnitude, records the small-offset label-clearance constraint,
and preserves the phone summary-only projection. The completed
[reconnect-trace result](gate-06-reconnect-trace.md) establishes snapshot-first
replacement, cursor discipline, stale-intent suppression, preview
supersession, and the read-only phone projection.

Gate 7 should consume these three constraints as evidence, not reopen their
accepted workspace or service-ownership decisions.
