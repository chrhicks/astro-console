# Phase 3 Closeout Handoff

Status: **Phases 3 and 4 are complete with deterministic local proof; Phase 5 planning is next**

## What Is Complete

Phase 3 delivers a server-owned Observe, Acquire, and Capture path in
`apps/server` and `apps/web`:

- Opt-in Alpaca preflight reads four declared mount facts with GET only.
- Polar guidance records solved evidence and requires current in-tolerance
  operator acceptance; it never sends a motor command.
- Deep-sky plate solve and lunar disk/limb acquisition keep provisional driver
  acknowledgement separate from fresh image evidence.
- Pointing correction completes only after a later solved image verifies it.
- Live-frame evidence and managed capture expose bounded quality, storage,
  drift, progress, stop-condition, and action facts.
- Recovery provides bounded ordinary attempts, one changed-parameter series,
  Skip, Abort, and reconciliation that retains prior verified pointing.

## Verified Evidence And Limits

Current local validation passes contracts **184/184**, server **72/72**, and
web **61/61**. Focused integration proof covers typed HTTP, lease/revision and
idempotency guards, SQLite persistence, SSE, restart, reconnect/no browser
replay, and owner/viewer/phone projections. Designer evidence passes at wide,
compact, and 390 px layouts.

This proves deterministic adapters, local service behavior, and browser
presentation only. It does not prove a real provider call, camera or mount
communication, movement, plate solving, storage on a live rig, or physical
capture.

## Phase 4 Closeout

Phase 4 Library and Frame Review is complete through Continuum Epic
`tkt-jnzkma5n`. It proves deterministic immutable captured-frame intake,
inspection facts, durable review, transient comparison, and the available
Observe-to-Library handoff. Current validation is contracts **186/186**, server
**79/79**, web **63/63**, production builds, and Designer PASS at wide,
compact, and 390 px. It does not prove a provider, device, or physical capture.

## Next Action

Phase 4 Library and Frame Review planning is recorded in
[the Phase 4 plan](phase-4-planning.md), including Continuum Epic
`tkt-jnzkma5n`. Its capture-to-asset, inspection, and durable-review contract
boundary is accepted. Immutable deterministic captured frames now materialize
into Library with checksum, lineage, receipts, restart, HTTP, and SSE proof.
Inspection now records deterministic preview facts, quality metrics, rationale,
provenance, and unavailable/failed truth separately from originals. The next
task adds compact Observe live-frame review. Library now provides durable
owner-only review decisions, browser-transient comparison, and read-only phone
protection with functional and Designer evidence. Observe now projects the
current Library-backed frame in a compact card. Plan the separately authorized
Phase 5 Process Workspace work. Do not extend the Phase 3
fixtures into provider or hardware behavior without a new authorized boundary
and proof plan.

## Historical Record

The prior working handoff and completed Phase 3 plan are preserved in the
[Phase 3 archive](../archive/phase-3/README.md). Completed Phase 2 planning is
in the [plans archive](../archive/plans/phase-2-implementation-plan-2026-08-04.md).
