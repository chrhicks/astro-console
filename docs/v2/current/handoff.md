# Gate 4 Session Handoff

Status: Gate 4 accepted and completed on July 21, 2026

Next gate: Gate 5 — executable scenario and contract harness

This is the durable continuation point for V2 work completed through Gate 4.
It summarizes the accepted Process model and points to the shared design rules
that later contracts and interfaces must preserve.

## Current Position

Four of seven convergence gates are complete:

1. Composite V2 workspace convergence.
2. Acquire evidence workflows.
3. Run mutation, reconnect, and control ownership.
4. Process model.

Gate 5 should translate these accepted interactions into canonical entities,
Effect Schema contract candidates, deterministic transitions, typed failures,
and UI-driving traces. It should discover contract details, not redesign the
accepted workspaces.

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

## Gate 5 Inputs

Gate 5 should make these service-facing concepts executable:

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

Define the Gate 5 shared scenario set and state ownership table from accepted
Gates 1–4 before writing production schemas. Each visible consequential action
must gain an eligibility rule, command, deterministic result, and typed failure
without introducing browser-owned observatory truth.
