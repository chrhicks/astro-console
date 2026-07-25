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
retain the solved frame/geometry and leave accepted run state untouched.

The PauseRun/ResumeRun/StopRun evidence now proves an owner-held,
run-revision-guarded transition among `capture`, `paused`, and terminal
`stopped`. `StopRun` is distinct from resumable `StopStack`: it records
`RunStopped`, queues explicit stop work, and cannot be resumed. Explicit
injected workers delegate to the Seestar stop/start-stack methods; unavailable
or failed dispatch leaves accepted state intact and exposes a clear Observe
trace. The next slice should establish the real rig lifecycle/worker
coordination rather than adding browser-side recovery.

That lifecycle coordination is now proven locally: a SQLite claim/lease guards
each pause, resume, or terminal-stop dispatch, acknowledgements require the
same claim token, and failed or expired claims are retryable after service
restart. It proves one live claim, not physical exactly-once across an expired
lease; provider calls are at-least-once until the production provider offers
an idempotency contract. A scheduled worker process is also not yet installed.

The admission evidence now gates every local-web request behind a
server-resolved identity. A concrete Cloudflare Access assertion adapter
verifies RS256 signature, issuer, audience, and expiry before looking up the
subject in SQLite owner/viewer membership; desktop and phone capability follow
from that trusted mapping. It is an origin boundary, not tunnel deployment:
JWKS/key rotation, revocation, Cloudflare configuration, and production LAN
binding remain separate operations work.

The reconnect and lease-recovery evidence now records a durable grace period
for the current holder. A browser disconnect renders last-confirmed state as
stale and sends no queued command; a fresh SSE snapshot replaces that
projection on reconnect. Grace expiry, including after service restart,
releases control to nobody and records the transition without stopping
accepted work. This remains a person-to-client fixture: production
device/session identity and all migrations, deployment, health, and
operational hardening are still deferred. The next narrow action is complete
Plan, Library, and Process workspace coverage behind the persistent activity
shell.

That workspace slice now uses persisted read-only projections: viable future
Plan intent and ordered sequence/window facts, bounded Library chronology and
stable lineage detail, and a stable-asset-ID handoff into a linear Process
session with synchronized preview and checkpoint protection. Workspace reads
and switching do not alter an accepted run. Process Apply, Save, retry,
discard, source switching, worker execution, and production recovery remain
separate mutation and operations slices.

The operational foundation now supplies explicit numbered SQLite migrations,
bounded liveness/readiness/owner-health projections, and a non-activating
origin/control plus cloudflared Compose starter. A protected public fixture is
now live behind Cloudflare Access and Tunnel, with an online SQLite
backup/restore drill completed. The authoritative live record is the
[activation ledger](activation-ledger.md). Recurring backups, health
monitoring, device/session authority, rig adapters, disk monitoring, and
R2/publisher paths remain production-validation work.

Release packaging now includes a pinned Node base Dockerfile, startup
non-secret configuration validation, and SQLite-safe backup/restore-source
preflight. Host image deployment, secret injection, public ingress, and a
one-time backup/restore drill are completed for the fixture. Real rig
validation, scheduled backups, and ongoing operational monitoring remain
unperformed.

## Historical Planning

The completed multi-phase roadmap and Phase 0.5 closeout rationale are in
[the Phase 1 foundation archive](../archive/phase-1-foundation/README.md) and
[the Phase 0.5 archive](../archive/phase-0.5/README.md). They are not active
implementation authority.
