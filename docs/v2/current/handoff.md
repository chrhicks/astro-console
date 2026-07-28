# Phase 1 Backend and Infrastructure Readiness Handoff

Status: **active Phase 1 backend/infrastructure handoff — 2026-07-27**

## Single Next Action

Implement and supervise the real private R2 publisher deployment only after
explicit owner authorization. Same-host resilience to the selected SSD backup
destination is repository-proven; do not treat it as off-host disaster
recovery.

Do not add external backup, R2 credentials/configuration, a download endpoint,
or a UI control merely to make this local operations slice appear complete.

## Why This Is Next

The local-web foundation already proves SQLite acceptance, durable outbox
claim/ack/retry, server-derived Access admission, snapshot-first SSE, control
lease recovery, bounded Library reads, and read-only Plan/Observe/Library/
Process projections. The remaining production boundaries are real R2 adapter
deployment, downloads, measured storage health/cleanup, and independent
recovery. Process `Apply`, retry, discard, source switching, and worker
execution remain later processing-workflow slices.

The completed Local Save boundary gives later work a real
Asset/file contract:

1. the processing worker can materialize selected outputs safely;
2. the service can atomically publish metadata only after those bytes are
   durable and checksummed;
3. a publisher can claim a correlated outbox record, reuse a stable key, and
   verify the known file with an R2-shaped provider contract; and
4. retention/cleanup can distinguish permanent sources from retryable scratch
   and removable orphan output.

## Verified Baseline

- `apps/v2-local-web` type checks pass.
- Its SQLite/HTTP/SSE/worker/filesystem integration suite passes **54/54**
  tests. Those
  tests cover migrations, atomic acceptance and rollback, Access/JWKS
  admission and revocation, lease recovery, worker claims, bounded Library
  reads, HTTP input bounds, security headers, snapshot-first SSE, and shared
  SQLite projections, plus durable Process Save materialization, rollback,
  replay, root/symlink rejection, orphan cleanup, safe Library detail, and
  publisher claim/lease/retry/provider-verification behavior.
- Process Save is intentionally a service API only. Configured source IDs
  resolve under app-owned roots; caller paths, traversal, and symlinks fail
  closed. It copies to an app-owned temporary path, SHA-256 checksums bytes,
  atomically promotes each file, then creates Asset detail, lineage/checksum
  events, the idempotency receipt, and `PublishAsset` outbox records in one
  SQLite transaction. Failure cannot create a successful Asset; promoted
  bytes are separately recorded as bounded removable orphans.
- The publisher is a separate local worker module using a fake verified
  provider contract. It persists internal object keys derived from trusted
  Asset lineage, checksums local bytes, verifies provider metadata, and only
  then projects `published`. Retry/restart reuses the stored key; an expired
  claim or stale acknowledgement cannot overwrite later state. Provider or
  checksum failure projects a safe unavailable/failed representation. Object
  keys and credentials never enter Library detail. This proves no real R2
  account, bucket, credential, network call, download grant, or deployment.
- The repository has a same-host SQLite resilience procedure: it uses `VACUUM
  INTO`, fails closed if live SQLite and `/mnt/storage/astro-console/backups`
  are on one filesystem, verifies the SSD-side copied bytes and SHA-256, runs a
  disposable restore drill, and retains fourteen days only in that explicit
  app backup directory. Its bounded evidence contains backup name, byte count,
  SHA-256, restore-drill status, retention, and destination. This is not
  off-host disaster recovery and does not protect against host loss, fire, or
  theft; no real host installation/configuration was performed here.
- The Compose starter has only origin, optional rig worker, and `cloudflared`.
  It intentionally has no processing or publisher service, no R2 secret, and
  no host port.

These are foundation proofs, not evidence that R2, off-host recovery, or
long-running production workers currently work.

- Storage operations now measure app-owned scratch-volume free bytes, free
  inodes, and a bounded write-plus-fsync latency probe. The owner-only
  operations projection reports only the derived measurement/state/capture
  decision, never host paths. Notice, block-new-long-work, and critical
  thresholds are service-owned; block and critical refuse only new long-run
  admission and never alter an accepted run.
- Bounded cleanup removes only recorded Process Save orphans and explicitly
  recorded eligible scratch entries. It globally bounds each pass, rejects
  escaped paths, symlink roots/files, and arbitrary/original/final paths, and
  safely retires missing-file records. This remains local filesystem/SQLite
  proof; it does not configure external backup or R2.

## Remaining Backend and Infrastructure Boundaries

| Boundary | Current state | Required proof |
| --- | --- | --- |
| Process Save and permanent local output | Local SQLite/filesystem vertical slice proven through the service API | Add a real Process worker/output manifest before exposing a command or UI; retain the same root, checksum, idempotency, and orphan invariants. |
| Publication worker and private R2 | Local fake-provider SQLite/filesystem vertical slice proven | Real private R2 adapter, least-privilege secret injection only into a separately deployed publisher, provider metadata semantics, and supervised deployment proof. |
| Downloads | Not implemented | Asset-ID authorization, bounded local stream or short-lived R2 grant, no logged bearer URL, and representation state that does not overclaim object availability. |
| Storage health and cleanup | Local filesystem/SQLite vertical slice proven | Host production thresholds, capture-load benchmarking, and operating runbook evidence. |
| Same-host resilience | Repository-backed SSD procedure proven | Install/supervise it on the host and measure it under capture load; do not call it off-host disaster recovery. |
| Disaster recovery | Not implemented | Independent off-host destination, copy verification, and a restore drill from that destination. |
| Device/session presence | Person-to-client fixture | Stable production client/session authority before treating a person's browsers as distinct presence clients. |
| Processing deployment | Compose placeholder absent by design | Separate least-privilege processor/publisher lifecycles, bounded resources, and no rig/tunnel credentials. |

## Completed Vertical Slices: Local Save and Publisher Contract

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

### Verified Tests

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
6. Library detail exposes only safe representation state and stable
   Asset identity—not host paths or storage keys.

No UI work was added. The service API is the intentionally bounded seam for a
future processing worker; it is not an HTTP command or browser control.

The publisher proves durable outbox claim/ack/retry, stable private-style key
derivation from trusted lineage, local checksum verification, fake-provider
upload/head verification, safe representation projection, and stale-claim
recovery. It does not prove an R2 adapter, credentials, object lifecycle, or
download authorization.

## Sequenced Follow-up

1. **Real publisher/R2 deployment** — after explicit owner authorization,
   implement the private R2 adapter and isolated credential/deployment proof.
   Retain the proven local worker contract; do not add browser-held secrets or
   object-key/signed-URL projection.
2. **Production presence/deployment** — establish device/session authority and
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
