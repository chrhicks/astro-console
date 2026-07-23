# Gate 5 Contract Handoff

Status: Gate 5 complete July 22, 2026

Current work: Gate 6 — bounded technical spikes

This is the durable continuation point for product work accepted through Gate
5. It preserves the Gate 4 Process decisions and the hardened future-server
contracts without requiring later work to ingest the full audit history.

## Current Position

Five of seven convergence gates are complete:

1. Composite V2 workspace convergence.
2. Acquire evidence workflows.
3. Run mutation, reconnect, and control ownership.
4. Process model.
5. Contract harness — accepted vocabulary, schemas, transitions, and
   future-server proofs.

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

Run Gate 6's first bounded technical spike: measure catalog rendering at
realistic Library scale and record the constraint and implementation decision.
Do not begin production transport or persistence design unless the measurement
requires a contract clarification.

## Gate 6 Handoff

Begin with the default V2 reading set, then load the Library portions of the
product specification and contract package only as the catalog measurement
needs them. Gate 5's 176 passing tests are a contract baseline, not a reason to
expand its model during the spike. The outcome must be a measured rendering
limit and a narrowly justified catalog strategy; it must not turn into general
Library implementation or reopen accepted interaction semantics.
