# Phase 2 Planning Handoff

Status: **prepared — select one vertical slice before implementation**

## Starting Point

Phase 1 is closed. Its local-web foundation, private artifact delivery,
same-host SQLite resilience, and rig-worker liveness are established with the
proof boundaries recorded in the [current handoff](handoff.md). The accepted
V2 UX, run authority, service-owned truth, and visual implementation
authorities remain in force.

## Planning Rules

1. Start with the [product specification](product-spec.md), current handoff,
   and the one accepted gate or infrastructure section needed for the chosen
   slice.
2. Select one operator outcome and one durable owner. Do not bundle unrelated
   deferred work merely because it was deferred from Phase 1.
3. Define the real proof boundary before implementation: local simulation,
   filesystem/SQLite, provider/transport, browser, host, or supervised device.
4. Preserve the Phase 1 boundaries until a new slice explicitly changes them.
   In particular, rig-worker liveness is not capture proof, and the M13
   publication is not a general processing workflow.
5. Keep the first implementation packet narrow: accepted scenario, canonical
   state and action owner, typed failures, focused verification, and an
   explicit deferred remainder.

## Candidate Work, Not Commitments

The active product record still defers several independent directions:

- supervised Solar/device execution proof;
- Process workflow commands and worker execution UX;
- storage-health or cleanup operations; and
- stronger production client/session presence.

These are alternatives for the next planning decision, not a Phase 2 backlog
to implement wholesale. Re-evaluate the relevant product and operations
authority before selecting one.

## First Session Outcome

Produce an accepted implementation packet for one slice. It must say what
will be built, what evidence proves it, what remains intentionally unproven,
and which current documents become authoritative for that slice. Only then
begin implementation.
