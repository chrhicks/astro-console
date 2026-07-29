# Phase 1 Backend and Infrastructure Readiness Handoff

Status: **active Phase 1 backend/infrastructure handoff — 2026-07-29**

## Single Next Action

With a signed-in, admitted owner browser, request the existing published M13
Asset-ID download and retain the bounded result: the service responds with a
303 grant and the private R2 object downloads successfully. The signed bearer
URL exists only in that redirect, never in a browser JSON projection.

This is the sole remaining Phase 1 host-verification proof. The corrected
download deployment, current rig-worker liveness, and scheduled SSD backup
with restore drill are now verified.

The user accepts NVMe live/recent data plus the SSD backup as current
same-host resilience. Off-host recovery is not current Phase 1 scope.

## Why This Is Next

The local-web foundation already proves SQLite acceptance, durable outbox
claim/ack/retry, server-derived Access admission, snapshot-first SSE, control
lease recovery, bounded Library reads, and read-only Plan/Observe/Library/
Process projections. The host now verifies corrected download deployment,
rig-worker liveness, and same-host backup. The remaining production proof is
an admitted M13 download against private R2. Process
`Apply`, retry, discard, source switching, and worker
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
- Its SQLite/HTTP/SSE/worker/filesystem integration suite passes **62/62**
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
- The disabled manifest processor can now first ingest a host-declared,
  app-owned source into an immutable local original, with truthful comparison
  group/run/solve lineage, checksum, receipt, event, and bounded orphan
  cleanup. A selected output must reference that durable original and exactly
  match its lineage before it receives a `PublishAsset` record. Originals are
  never published by ingest alone. The source-ingest tables are numbered
  SQLite migration 11; idempotency keys reject changed semantic input.
- The publisher worker streams checksum calculation and R2 upload in 64 KiB
  chunks, signs the exact checksum and byte length, then HEAD-verifies the
  provider checksum/bytes before projecting `published`. It preserves durable
  claim/ack/retry and stable private key derivation; object keys and credentials
  never enter Library detail. The local streaming and outbox-isolation tests
  make no R2 network request.
- A production S3-compatible R2 provider adapter and publisher-only service
  are deployed. Cloudflare R2 is enabled and the existing private ENAM Standard
  bucket is `astro-console-artifacts`. A bucket-only read/write credential is
  host-managed and mounted only into the dedicated publisher; it has no public
  endpoint, tunnel, or rig mounts. On 2026-07-28, an isolated processor
  simulated one existing M13 dataset: one real 30-second LIGHT FITS original
  plus an existing Siril 1.4.3 60-frame lights-only linear master. The service
  retained both SSD copies with SHA-256 values matching their staged sources,
  and published the linear master to private R2. Durable outbox `dispatched`,
  publication `published`, and provider HEAD checksum/byte verification were
  observed. This is transport proof for an existing dataset—not fresh hardware
  capture, live image processing, public object access, deployed download
  authorization, or scheduled SSD backup proof.
- The first real master exposed two recovery defects: full-file buffering
  exceeded the former 512 MiB publisher cap, and generic rig-worker lease
  cleanup could expire a different work kind during a long upload. The
  publisher now streams 64 KiB chunks and runs at 512 MiB with zero restarts;
  generic lease recovery is scoped to its own work kind. The M13 outbox
  eventually acknowledged after recoverable attempts, then remained published
  while the restored rig worker stayed idle with no Solar work.
- Migration-only publisher and processor SQLite connections now set a bounded
  five-second busy timeout. The publisher continues only after recognizable
  SQLite busy/locked errors and otherwise fails fast. The prior publisher was
  observed in a lock-triggered restart loop (40 restarts); it was replaced with
  the `35cd3c7-publisher-lockfix` image under the same private mounts and
  resource limits, then observed running with zero restarts and no lock error
  in a short host check. The repository behavior is tested; sustained
  concurrent-worker behavior remains a later operational observation.
- The host has app-owned SSD `processor-sources`, `originals`, and `finals`
  paths. The one-shot processor used only the state volume, read-only
  source/config binds, writable originals/finals binds, and no R2/rig/tunnel
  credential. It accepted the named M13 manifest and is not kept running.
- A prior stale `c9afc65-solar` rig-worker image restarted because its older
  migration set rejected the shared SQLite schema 10 before adapter
  initialization. That historical check is not current rig-worker proof: the
  next host bundle must inspect, repair if needed, and verify the current
  worker restart state. It must not claim Seestar connection, provider
  acknowledgement, Stack evidence, or physical capture.
- On 2026-07-29, the then-current rig worker was confirmed to reject live
  schema 13 and was replaced with the schema-compatible active local-web
  image. It is now running with its prior restricted mounts and records
  durable `alive` / `ready` liveness. A read-only outbox check found no Solar
  work before or after replacement; this is liveness only, not capture or
  device proof.
- The repository has a same-host SQLite resilience procedure: it uses `VACUUM
  INTO`, verifies the SSD-side copied bytes and final-name SHA-256 manifest,
  runs a disposable restore drill, and retains fourteen days only in that
  explicit app backup directory. Its bounded evidence contains backup name,
  byte count, SHA-256, restore-drill status, retention, and destination. The
  script and regression checks are repository proof only; the next bundle must
  install it on the host, retain one scheduled-run result, and retain the
  restore-drill result.
- The installed `astro-console-backup.timer` is enabled. Its 2026-07-29
  10:33 host run retained SSD-side checksum evidence and a disposable restore
  drill with `restore_drill=passed`; the timer remains scheduled daily. Two
  earlier manual attempts that day failed while the script was being corrected
  and are not used as backup proof.
- The active origin and private signer were rebuilt from corrected commit
  `d4eed9d` after the failed attachment-disposition override was removed. Both
  are running under their existing production admission, loopback origin, and
  private signer configuration. Origin liveness is verified; an admitted
  browser request and private-R2 GET remain required before download delivery
  is called proven.
- The next streamlined publisher release records each selected output's
  `Content-Disposition: attachment` metadata when it uploads to R2. Downloads
  remain one admitted Asset-ID lookup followed by one five-minute 303 grant;
  there is no persisted grant reservation, replay, rate-limit, or download
  audit. Existing objects need a separate metadata refresh before their
  browser behavior changes.
- The Compose deployment now has an isolated profile-gated publisher alongside
  origin, optional rig worker, and `cloudflared`. The publisher has no public
  host port, tunnel, or rig credential/mount.

These are foundation and one real private-R2 transport proof. They are not
evidence of deployed authorized download, current rig-worker liveness,
scheduled same-host backup, fresh capture, or a general long-running
processing workflow.

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
| Process Save and permanent local output | One-shot manifest processor ingested an existing M13 LIGHT original and distinct Siril linear master into SSD originals/finals with lineage and checksum proof | Keep processor one-shot/least-privilege; later processing workflow needs a separately authorized product slice. |
| Publication worker and private R2 | M13 linear master real PUT plus provider HEAD checksum/byte verification observed; durable projection is `published` | Controlled recovery drill under normal load, then an authorized download boundary. |
| Downloads | Corrected Asset-ID origin and private signer from `d4eed9d` are deployed and origin liveness is verified; next publisher release writes attachment metadata at upload and retains a direct, short-lived 303 grant. | Deploy the metadata release, refresh the existing M13 object metadata, then verify one admitted M13 303 and browser download. |
| Storage health and cleanup | Local filesystem/SQLite vertical slice proven | Host production thresholds, capture-load benchmarking, and operating runbook evidence. |
| Rig-worker liveness | Schema-compatible worker is running and durably `alive` / `ready`; no Solar work was pending. | No further Phase 1 proof. This remains liveness only, never capture proof. |
| Same-host resilience | Enabled SSD backup timer has a successful 2026-07-29 run with checksum and disposable restore-drill evidence. | No further Phase 1 proof. This is the accepted current resilience scope. |
| Off-host recovery | Not current scope | Revisit only if the user changes the current NVMe-plus-SSD resilience decision. |
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

The local publisher test proves durable outbox claim/ack/retry, stable private
key derivation from trusted lineage, streamed checksum/upload, safe projection,
and stale-claim recovery. The deployed adapter additionally proved one real
private R2 PUT plus HEAD checksum/byte verification for the M13 simulation.
It does not prove deployed download authorization, public object access,
object lifecycle policy, scheduled same-host backup, fresh capture, or
image-processing work.

## Deferred Follow-up

Off-host recovery is intentionally deferred. The accepted current plan is
live/recent NVMe data plus a verified SSD same-host backup; do not expand this
Phase 1 bundle into an off-host recovery project.

## Scope and Authority

- The accepted V2 UX, run authority, and service-owned truth remain frozen.
  This packet changes no workspace semantics.
- The rig-worker part of the single next bundle is liveness/restart verification
  only. It is not an active Solar or physical-run instruction.
- Cloudflare Access remains identity admission. The service still owns durable
  membership, capability, lease, revision, idempotency, safety, and artifact
  authorization checks.
- R2 is a private artifact/delivery store, never canonical run state or the
  sole copy of original evidence.
- This handoff authorizes only the documented host-verification bundle. It does
  not authorize off-host recovery work or new browser controls.

## Read First

1. [V2 Start Here](../README.md)
2. [Phase 1 delivery plan](delivery-plan.md)
3. [Storage and artifact delivery](../infra/storage-and-artifacts.md)
4. [Security model](../infra/security.md)
5. [Operations and reliability](../infra/operations.md)
