# Phase 2 Implementation Planning

Status: **next V2.0 phase — Plan and Managed Runs**

This document plans execution of Phase 2 in the durable
[V2 delivery plan](delivery-plan.md). It is not an alternative backlog and it
does not replace the delivery plan during cleanup.

## Objective

Deliver the Phase 2 operator outcome: an approved multi-sequence observing
plan becomes an immutable `RunDefinition` that a service-owned bounded sequence
state machine can execute and recover. The browser presents evidence and
intent; it never owns execution.

## Execution Method

1. Select the smallest Phase 2 outcome that advances the end-to-end path.
2. Define its canonical durable owner, accepted scenario, consequential action,
   typed failures, and proof boundary before implementation.
3. Implement and verify that vertical slice, including the required UI/design
   validation when it affects a user surface.
4. Check off the completed delivery-plan outcome and record evidence in the
   relevant current handoff. Then select the next Phase 2 slice.

## Scope Control

- Preserve Phase 1's verified boundaries until an explicit Phase 2 slice
  changes them. Rig-worker liveness is not capture proof; M13 publication is
  not a general processing workflow.
- Do not add physical Solar execution, general processing, storage-health
  operations, or stronger client/session presence merely because they were
  previously deferred. They belong to their named later phase or to
  [post-V2.0 notes](v2-post-v2.0-notes.md) unless the delivery plan changes.
- Minimal implementation does not weaken evidence: the selected proof boundary
  must match the claim.

## First Planning Packet

Before the first code slice, create an accepted packet for the selected Phase 2
outcome with the scenario, durable owner, action/failure contract, focused
verification, proof boundary, and intentionally deferred remainder.

## First Slice: Multi-Sequence Draft and Deterministic Validation

Status: **complete July 30, 2026 — deterministic fixture proof only**

Build the first real Plan outcome without pretending that the local fixture is
an observatory planner: an admitted owner can persist a two-or-more-sequence
draft, see its ordered window/readiness projection, and receive a service-owned
validation result. This replaces the read-only M27 Plan projection only in the
explicit deterministic fixture used for the slice. A normal unconfigured
runtime continues to say that no plan is installed.

### Implemented Scenario

Given an admitted owner on a control-capable desktop and no active run, the
owner saves a two-sequence future plan. The service stores the draft, evaluates
the supplied planning facts, and projects each sequence's order, usable window,
altitude, horizon clearance, estimated time, and storage forecast. It returns
one plan readiness result:

- `ready` when every critical fact is viable;
- `readyWithLimitations` when an explicitly named limitation remains; or
- `blocked` when a required fact is missing or incompatible.

The Plan surface presents the order, the evidence behind the verdict, and the
named limitation or block. It does not start a run. Refresh and workspace
navigation replace the browser projection from SQLite and cannot alter the
draft.

### Canonical Owner And Contract

`ObservingPlan` is the durable service-owned record. It owns the source-plan
revision, ordered sequence definitions, evaluation inputs, validation result,
and named limitations. The browser submits a revision-guarded draft intent and
only renders the returned projection; it does not calculate a verdict or
decide that a missing fact is safe.

This is the first required extension beyond the accepted contract harness,
which begins at an already validated plan. The implementation packet must name
and Schema-decode a single draft-save intent, with an idempotency key and
expected plan revision. Its result is either the persisted next revision or a
typed rejection. At minimum, reject stale revisions, malformed or duplicate
sequence input, a read-only client, unavailable plan evaluation, and any
critical missing/unsafe planning fact. Exact HTTP routes and SQLite tables are
implementation detail.

`StartRunFromPlan` remains unchanged and unavailable in this slice. The
existing M27 start-run fixture proves only the earlier lease/receipt/SSE
foundation; it is not a Phase 2 managed-run implementation.

### Focused Verification

- A real SQLite/HTTP/SSE integration scenario persists a two-sequence draft,
  returns the same validated projection after a fresh service instance, and
  emits one authoritative update.
- Deterministic cases cover ready, a named non-critical limitation, and each
  critical block named above; stale or repeated submissions create no extra
  revision or event.
- A local-web smoke flow shows the wide desktop, compact desktop, and 390 px
  read-only phone projection. The phone exposes the same verdict and no draft
  or run mutation. Designer review is required for the UI change.

### Proof Boundary And Deferred Remainder

The evaluator consumes explicitly configured deterministic planning facts. Its
tests prove persistence, revision/idempotency, projection, and the chosen
readiness rules—not live ephemerides, a surveyed horizon, free disk space,
rig capabilities, device safety, or physical observability. Those inputs need
their own provider-backed slice before a plan may be presented as operationally
ready.

Also deferred: target discovery/catalog, real astronomy calculation, live
readiness providers, `RunDefinition` acceptance, the sequence executor,
pause/stop/skip/retry/park, active-run edits, hardware calls, and all Solar or
processing work. The next packet after this slice should connect a persisted
validated plan to immutable `RunDefinition` acceptance, still using a fake
executor before any device boundary.

### Recorded Evidence

The local-web service now persists an admitted owner’s two-sequence deterministic
draft in SQLite, revision-guards and idempotently replays saves, publishes the
updated Plan projection through SSE, and restores it after a service restart.
The fixture-only owner desktop exposes `Save deterministic two-sequence draft`;
the phone exposes the same evidence without any mutation. Saved drafts are
explicitly non-executable: `runEligible` is false, `StartRunFromPlan` rejects
them, and no browser `Run plan` control is rendered.

Local-web build and integration tests pass **61/61**. The migration suite covers
fresh, schema-13, schema-15, and existing-fixture upgrade paths. UI validation
and Designer review passed at wide, compact, and 390 px phone widths, including
save-to-SSE truth, restart persistence, no horizontal overflow, and responsive
control restoration.
