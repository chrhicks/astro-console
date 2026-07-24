# Phase 1 Local Web Foundation

Status: **active implementation boundary**

## Outcomes

- Run reusable backend behavior in a service independent of Electron.
- Serve a local web client and typed API.
- Stream current observatory and run snapshots; reconnect without changing
  service activity.
- Implement bounded catalog query/pagination plus viewport virtualization.
- Add Plan, Observe, Library, and Process navigation with the persistent
  activity surface.
- Provide deterministic fake-observatory states for UI development.

## Exit Criteria

- Closing and reopening a browser does not alter service activity.
- Two local browsers observe the same authoritative state.
- Only the control lease holder can mutate observing state.
- Catalog scale stays behind bounded server query/pagination and virtualization.
- The accepted [visual style guide](visual-style-guide.md),
  [UI component library](ui-component-library.md), and
  [UI build contract](ui-build-contract.md) guide implementation.

## First Vertical Slice

`apps/v2-local-web` is the intentionally narrow Plan-to-Observe foundation:
the deterministic M27 fixture proves a server-owned SQLite WAL acceptance
transaction, trusted local identity/capability, durable event/receipt/outbox
records, and snapshot-first SSE delivery. It is evidence for the first two
exit criteria, not completion of Phase 1. Catalog virtualization, workspace
coverage, real adapters/workers, identity admission, recovery, and production
operations remain separate slices.

The shared-control-shell evidence adds one persisted control lease across
two trusted desktop deployments. It proves transfer and stale-controller
rejection while the active run continues; it does not yet establish managed
identity, remote ingress, or a real hardware pause adapter.

The bounded-Library evidence adds a deterministic persisted asset fixture with
a server-owned capped query/cursor/filter/sort boundary, stable-ID detail
delivery, and a fixed-window virtualized viewport. It proves Library lineage
and representation availability can be inspected without placing the catalog
in snapshot/SSE delivery or mounting the full page in the document. The next
vertical slice is current Observe evidence and protected decision context.

The Observe evidence-and-decision evidence now persists latest-frame quality,
geometry, uncertainty, and bounded automatic or exhausted correction state in
the authoritative projection. It proves exhausted recovery retains evidence,
states consequence/protection, and does not dispatch adapter or outbox work.
The next vertical slice is one decoded adapter-owned observation input.

The decoded observation-input boundary now accepts one fail-closed latest
solved-frame fixture, persists only decoded evidence, and proves a faithful
mapping into the exported V2 `AcquireSnapshot` schema. The test command uses
the contracts package's `tsx` loader solely to execute its TypeScript source
with `.js` internal specifiers. The next slice is a concrete rig-owned
observation source with availability and failure semantics.

The read-only Seestar Stack adapter uses the built SDK push-event decoder and
projects only valid Stack counters into evidence freshness and availability.
It has no connection, polling, host, or command surface; failed Stack events
retain the solved frame/geometry and leave accepted run state untouched. The
next slice chooses one bounded concrete rig capability beyond observation input.

## Historical Planning

The completed multi-phase roadmap and Phase 0.5 closeout rationale are in
[the Phase 1 foundation archive](../archive/phase-1-foundation/README.md) and
[the Phase 0.5 archive](../archive/phase-0.5/README.md). They are not active
implementation authority.
