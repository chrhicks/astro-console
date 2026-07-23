# Infrastructure Requirements

## 1. Scope And Assumptions

The deployment serves one personal observatory and a small allowlist of trusted
friends. The rig's Windows MiniPC continues running ASCOM Remote, the ASI Mount
utility, and Windows-only ASCOM drivers. An existing Arch Linux gaming desktop
on the same home LAN runs the Astro Console server in Docker Compose. A second
public application server is not required.

“Local” means a browser or administrator reaching the Arch host directly over
the home LAN without Cloudflare or Tailscale. “Remote” means a normal browser
reaching `observatory.chicks.dev` through Cloudflare Access and an outbound
tunnel.

The Arch host consumes MiniPC/device capabilities through Alpaca or another
bounded LAN protocol. It does not attempt to move the Windows drivers into
Linux or Docker.

## 2. Safety And Authority Requirements

These are hard requirements.

| ID | Requirement |
| --- | --- |
| SAF-01 | Active observing continues when every browser disconnects. |
| SAF-02 | Loss, restart, or misconfiguration of public ingress cannot directly mutate hardware or stop a run. |
| SAF-03 | Exactly one eligible client holds the service-owned control lease; identity-provider roles cannot bypass it. |
| SAF-04 | Every mutation is authorized and revision-checked at the local service immediately before orchestration. |
| SAF-05 | Clients never buffer and automatically replay observing commands after reconnect. |
| SAF-06 | Restart recovery is fail-closed: load durable intent, inspect real device/evidence state, then resume, recover, or request attention. |
| SAF-07 | Processing has lower CPU, memory, and I/O priority than the observing control plane. |
| SAF-08 | Disk exhaustion is forecast and surfaced before capture; reserve space is protected for metadata, logs, and safe terminalization. |
| SAF-09 | Remote access exposes typed product operations and bounded assets only—not a shell, arbitrary paths, driver endpoints, or the rig LAN. |
| SAF-10 | Time is synchronized and clock health is visible because schedules, leases, evidence, and astronomical calculations depend on it. |

## 3. Local Service Requirements

- Start at boot without an interactive login or open browser.
- Run as an unprivileged dedicated operating-system account.
- Bind the application origin to loopback by default. A separate LAN ingress
  may bind to a private interface only after its authorization policy is
  selected.
- Reach required rig protocols on the local network, including UDP discovery
  where applicable, without exposing those protocols publicly.
- Persist canonical metadata, event history needed for reconstruction, user
  decisions, processing provenance, and active-run recovery state.
- Store original and derived assets outside the database using app-owned paths,
  atomic writes, checksums, and stable identifiers.
- Serve the version-matched web client, API, event stream, previews, and
  explicitly requested downloads from one logical origin.
- Publish separate liveness, readiness, and operational-health signals. A
  process may be alive while the rig, storage, clock, or tunnel is degraded.
- Remain directly accessible and administrable on the home LAN during an
  internet or tunnel outage.
- Permit a LAN-only HTTP origin initially. Add trusted local HTTPS only when a
  selected browser capability requires a secure context.
- Never require the public edge to acknowledge a hardware command.

## 4. Remote Access Requirements

- Use a stable public HTTPS hostname and ordinary modern browsers; trusted
  viewers should not need a VPN client.
- Establish connectivity from the observatory outward, with no home-router
  port forward and no publicly addressable origin.
- Authenticate before serving the application or upgrading its event stream.
- Allowlist named identities. “Any valid email” and public-link access are not
  acceptable policies.
- Translate authenticated identity into service-owned `owner` or `viewer`
  membership. `controller` remains a temporary lease, not an identity role.
- Keep browser application, commands, events, and assets same-origin.
- Support WebSocket or SSE interruption; correctness comes from a fresh
  snapshot and cursor, not from an immortal connection.
- Send metadata, telemetry, thumbnails, and bounded previews by default.
  Every asset class, including original FITS, requires an explicit action and
  authorization check; large local raws may be staged asynchronously to R2.
- Rate-limit authentication failures, expensive queries, asset generation,
  mutation previews, and command attempts independently.
- Report observatory offline when the tunnel or local service disappears; a
  cloud component must not simulate or reconstruct live rig truth.

## 5. Data And Storage Requirements

Separate four data classes:

| Class | Examples | Durability |
| --- | --- | --- |
| Canonical metadata | plans, runs, revisions, leases, decisions, processing sessions, asset registry, events, command receipts, outbox work | Transactional local database; backed up frequently |
| Original evidence | FITS, ImageBytes-derived FITS, camera originals | Permanent Arch filesystem archive; never modified in place; owner cleanup only |
| Derived/rebuildable | previews, thumbnails, metrics, processing intermediates | Local scratch; disposable unless explicitly promoted to private R2 |
| Published artifacts | selected intermediates, finals, previews, staged raw downloads | Private R2 with class/prefix lifecycle expiration; finals also retained permanently on Arch |
| Operational | structured logs, metrics, traces, crash evidence | Bounded local retention; selected alerts/health may leave the site |

The metadata database must live on a bind-mounted local filesystem. If SQLite
WAL is used,
all database readers and writers stay on the same host; SQLite explicitly does
not support WAL over a network filesystem. A NAS may hold exported assets or
backups, not the live WAL database.

Storage planning must define:

- peak source-frame size and cadence for every supported camera path;
- expected observing hours per night and nights retained locally;
- preview/intermediate amplification;
- minimum free-space reserve and stop thresholds;
- which originals are irreplaceable and which data can be regenerated; and
- backup bandwidth and recovery time.

A useful sizing formula is:

`nightly bytes = source bytes/frame × frames/night × replication factor + derived bytes`

The current sample at `/Users/chicks/dev/personal/astronomy/codex/astro/data`
provides an initial capacity baseline:

| Target | Raw files | Raw bytes | Typical frame |
| --- | ---: | ---: | ---: |
| M13 | 60 FITS | 2.7 GiB | 46.2 MiB |
| M101 | 80 FITS | 3.6 GiB | 46.2 MiB |
| M8 | 374 raw-tree files | 17.7 GiB | roughly 48 MiB for ordinary frames |

The entire three-target tree is about 140 GiB. Processing directories alone
consume about 113 GiB, and complete target trees are roughly 4–13 times their
raw capture size. Scratch and reproducible processing outputs therefore drive
capacity more strongly than capture. The inspected Arch host has about 1.7 TiB
free at `/mnt/storage` and about 875 GiB free on its NVMe filesystem. The SATA
volume is a plausible raw archive and NVMe a plausible bounded scratch/state
volume, subject to simultaneous capture/processing benchmarks.

All asset classes may be downloaded by authorized members. Requests use stable
asset IDs, never arbitrary paths or R2 keys. R2 objects are delivered with
short-lived grants. Local-only originals stream directly from Arch on the LAN;
remote requests reuse or create a temporary private R2 staging copy for
resilient direct delivery from R2.

## 6. Availability And Recovery Requirements

- A single Arch host and single MiniPC are intentional. There is no
  high-availability, business-continuity, or overnight-response requirement.
- UPS automation, redundant storage, and automated failover are optional hobby
  improvements, not launch gates.
- Restore service after reboot without requiring a GUI login.
- Back up metadata/configuration before upgrades and periodically according to
  convenience. Original evidence backup/retention is an owner preference, not
  a formal recovery objective. Derived cache has no recovery guarantee.
- One local copy of raws and finals is acceptable initially. A secondary
  off-host copy is explicitly deferred to a future backup task.
- Test at least one sample restore before trusting the backup procedure.
- Retain the previous working application release and schema-compatible backup
  for rollback.
- Defer an update while an active run or safety recovery is in progress.

## 7. Security And Privacy Requirements

- Managed identity for the public path; no application password database.
- Server-side authorization on every command and asset request.
- Short, bounded sessions for control-capable desktop use; explicit revocation
  and allowlist removal procedures.
- TLS at the public edge and protected origin connectivity through the tunnel.
- Validate edge identity assertions or otherwise cryptographically bind the
  origin to the Access application; never trust a caller-supplied email header.
- Store tunnel credentials, signing configuration, API tokens, and backup keys
  outside the repository with least-readable permissions.
- Use separate product credentials and owner/admin network credentials.
- Log security-relevant decisions without logging secrets, image payloads, or
  excessive personal identity data.
- Treat third-party processing executables and user-supplied processing
  configurations as untrusted workloads with bounded arguments, directories,
  resources, and outputs.
- Decide explicitly whether allowing Cloudflare to terminate public TLS and
  transit private observatory data is acceptable; do not imply the tunnel is
  end-to-end encrypted from browser to the local application process.

## 8. Operability Requirements

- One command or dashboard should answer: service alive, current release,
  active run, rig connectivity, disk reserve, database health, clock health,
  backup age, processing queue, and tunnel state.
- Structured logs include correlation, actor, client, run revision, lease
  revision, operation, result, and typed failure without duplicating secrets.
- Alerts distinguish “remote view unavailable” from “local observing at risk.”
- Configuration has a checked schema and startup validation.
- Migrations are explicit, backed up, and rollback-aware.
- Release artifacts are reproducible and checksummed.
- Routine operation requires no public remote shell. Administration is direct
  on the home LAN or physically at the Arch host.

## 9. Infrastructure Acceptance Scenarios

Infrastructure is ready for production-like V2 slices only after these are
demonstrated:

1. Start a fake run, close every browser, and confirm execution continues.
2. Cut public internet during a fake run; local execution continues, remote
   shows offline, and local owner recovery remains possible.
3. Restore the tunnel; all clients receive a fresh snapshot before new events
   and no command is replayed.
4. Transfer control, delay an old command across the transfer, and confirm the
   local service rejects it before hardware.
5. Saturate a processing worker and prove control/event latency and capture
   writes remain within measured bounds.
6. Cross warning and critical disk thresholds and prove capture degrades or
   stops according to policy while metadata can still terminalize safely.
7. Reboot during representative workflow phases and prove honest reconcile,
   resume/recovery, or operator-attention results.
8. Restore metadata and a sample asset set onto a clean host.
9. Revoke a remote viewer and prove new HTTP, stream, and asset access fails.
10. Attempt path traversal, direct driver access, unauthorized asset IDs, and
    oversized/expensive requests; none escape typed bounded interfaces.
