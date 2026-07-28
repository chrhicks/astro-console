# Phase 1 Backend and Infrastructure Readiness Handoff

Status: **active implementation-preparation packet — 2026-07-27**

## Single Next Action

Implement and prove a local filesystem-backed Process `Save` vertical slice.
It must materialize and checksum explicitly selected output files before one
SQLite transaction creates their durable Asset roots, lineage/events, and
idempotent publication-outbox records. A crash may leave removable orphan
files, but it must never leave an Asset that claims bytes which do not exist.

This is deliberately a local-host boundary first. Do not add R2 credentials,
a publisher service, a download endpoint, or a UI control merely to make this
slice appear complete.

## Why This Is Next

The local-web foundation already proves SQLite acceptance, durable outbox
claim/ack/retry, server-derived Access admission, snapshot-first SSE, control
lease recovery, bounded Library reads, and read-only Plan/Observe/Library/
Process projections. The current missing production boundary is durable
artifact bytes: Process `Apply`, `Save`, retry, discard, source switching,
worker execution, local cleanup, R2 publication, and download grants are not
implemented.

Local Save is the narrowest first boundary because it gives later work a real
Asset/file contract:

1. the processing worker can materialize selected outputs safely;
2. the service can atomically publish metadata only after those bytes are
   durable and checksummed;
3. the publisher can claim a correlated outbox record and upload the known
   file to private R2; and
4. retention/cleanup can distinguish permanent sources from retryable scratch
   and removable orphan output.

## Verified Baseline

- `apps/v2-local-web` type checks pass.
- Its SQLite/HTTP/SSE/worker integration suite passes **46/46** tests. Those
  tests cover migrations, atomic acceptance and rollback, Access/JWKS
  admission and revocation, lease recovery, worker claims, bounded Library
  reads, HTTP input bounds, security headers, snapshot-first SSE, and shared
  SQLite projections.
- The repository has a local, consistent SQLite backup primitive using
  `VACUUM INTO`, integrity verification, SHA-256 recording, and a host-managed
  fourteen-day local backup schedule. One online backup/restore drill is
  recorded for the protected fixture.
- The Compose starter has only origin, optional rig worker, and `cloudflared`.
  It intentionally has no processing or publisher service, no R2 secret, and
  no host port.

These are foundation proofs, not evidence that files, R2, off-host recovery,
or long-running production workers currently work.

## Remaining Backend and Infrastructure Boundaries

| Boundary | Current state | Required proof |
| --- | --- | --- |
| Process Save and permanent local output | Contract simulation/read-only projection only | Real temp filesystem + SQLite integration: durable bytes and checksums precede atomic Asset/event/outbox commit; failed writes leave no successful metadata; orphan policy is explicit. |
| Publication worker and private R2 | Not implemented | Claimed outbox work, stable object key/checksum idempotency, provider verification, typed retry/expiry state, and scoped credentials unavailable to browser/processing worker. |
| Downloads | Not implemented | Asset-ID authorization, bounded local stream or short-lived R2 grant, no logged bearer URL, and representation state that does not overclaim object availability. |
| Storage health and cleanup | Policy only | Measured free bytes/inodes/write latency, threshold projection, safe scratch-only cleanup, and capture-safe throttling evidence. |
| Disaster recovery | Local backup only | Independent off-host destination, copy verification, and a restore drill from that destination. Do not call local retention disaster recovery. |
| Device/session presence | Person-to-client fixture | Stable production client/session authority before treating a person's browsers as distinct presence clients. |
| Processing deployment | Compose placeholder absent by design | Separate least-privilege processor/publisher lifecycles, bounded resources, and no rig/tunnel credentials. |

## Implementation Packet: Local Filesystem-backed Save

### Contract

- Accept an owner-authorized, revision- and idempotency-guarded selection of
  Process outputs. Do not accept caller-controlled filesystem paths.
- Resolve every output beneath configured app-owned roots; reject path escape,
  missing source, duplicate Asset identity, incomplete materialization, and
  checksum mismatch before metadata publication.
- Materialize each selected permanent local output through a temporary
  app-owned path and atomically promote it to its final local path only after
  write completion and checksum calculation.
- In one canonical SQLite transaction, create all selected Asset roots,
  provenance/lineage events, the idempotency receipt, and one publication
  outbox record per representation. A repeat idempotency key returns the same
  durable result without duplicating files or outbox work.
- A failure before the transaction may leave only separately recorded/removable
  orphans. A failure in the transaction must not produce a successful Asset.
- Do not delete source assets or scratch during Save. Retention is a later,
  independently auditable worker.

### Tests Required Before Calling It Complete

1. Real temporary-directory filesystem + SQLite success path with two selected
   outputs, checksum verification, Asset/event/receipt/outbox correlation, and
   replay.
2. Mid-materialization write failure: no Asset/event/receipt/outbox success.
3. Commit failure after bytes are durable: no successful metadata; the orphan
   record can be discovered and removed by a later bounded cleanup path.
4. Symlink/path traversal and caller-path attempts fail without reading or
   writing outside configured roots.
5. Duplicate/replayed request does not create a second file, Asset, or outbox
   record.
6. Snapshot/Library detail exposes only safe representation state and stable
   Asset identity—not host paths or storage keys.

No UI work belongs in this slice unless a pre-existing projection needs a
minimal state correction. If any UI changes become necessary, use the required
Designer validation at wide, compact, and 390 px phone widths.

## Sequenced Follow-up

1. **Local Save boundary** — the next implementation slice above.
2. **Publisher/R2 boundary** — add a separate worker and adapter after the
   local Asset/file contract is proven. Use a private bucket, stable keys,
   narrow credentials, verification, and lifecycle state; do not expose bucket
   keys or signed URLs.
3. **Storage and recovery operations** — add measured health thresholds,
   bounded cleanup, a selected independent backup destination, copy checks,
   and restore evidence. This requires an owner decision on the backup
   destination before any external configuration.
4. **Production presence/deployment** — establish device/session authority and
   add isolated processor/publisher Compose services with resource limits and
   operating runbooks.

## Scope and Authority

- The accepted V2 UX, run authority, and service-owned truth remain frozen.
  This packet changes no workspace semantics.
- Solar worker/deployment material is out of scope for this Phase 1
  backend/infra continuation. Its archived handoff is historical evidence, not
  an active physical-run instruction.
- Cloudflare Access remains identity admission. The service still owns durable
  membership, capability, lease, revision, idempotency, safety, and artifact
  authorization checks.
- R2 is a private artifact/delivery store, never canonical run state or the
  sole copy of original evidence.
- Infrastructure work remains documentation and local test work until a later
  explicit owner decision authorizes external configuration or credentials.

## Read First

1. [V2 Start Here](../README.md)
2. [Phase 1 delivery plan](delivery-plan.md)
3. [Storage and artifact delivery](../infra/storage-and-artifacts.md)
4. [Security model](../infra/security.md)
5. [Operations and reliability](../infra/operations.md)
