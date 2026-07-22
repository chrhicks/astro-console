# Operations And Reliability

## 1. Host Baseline

The host was inspected read-only over Tailscale on July 21, 2026:

| Item | Measured state |
| --- | --- |
| Host/OS | `chicks-arch`, Arch Linux, kernel `7.1.3-arch2-2` |
| CPU | AMD Ryzen 7 3800X, 8 cores/16 threads |
| Memory | 62 GiB RAM, 4 GiB swap |
| System disk | Samsung 980 PRO 1 TB, Btrfs, about 875 GiB free |
| Data disk | Samsung 860 EVO 2 TB, ext4 at `/mnt/storage`, about 1.7 TiB free |
| LAN | Wi-Fi `192.168.7.235/22`; wired `eno1` was down during inspection and is the deployment target after basement relocation |
| Docker | Engine `29.6.2`, enabled and active |
| Compose | Plugin did not return a version; install/verify before deployment |

Remaining inventory/decisions:

- GPU/accelerator needs and installed processing tools;
- NVMe/SSD health, endurance, and simultaneous-I/O performance;
- backup target and realistic link speed;
- wired interfaces, rig VLAN/subnet, multicast/broadcast discovery, and DNS;
- USB or serial devices that must be local to the host;
- the Windows MiniPC address, ASCOM Remote port/devices, ASI utility, and
  Windows-driver boundary;
- firmware/BIOS behavior after power loss; and
- secure-boot, disk-encryption, and unattended-boot tradeoffs.

Keep Arch, Docker Engine/Compose, time synchronization, and SMART/NVMe
monitoring current through ordinary owner maintenance. There is no need to
turn the hobby host into an appliance distribution before deployment.

Continuum records a previously validated ASCOM Remote endpoint at
`192.168.4.104:11111`, with Telescope 0 “ASI Mount” and Camera 0 “Sony
Mirrorless Camera.” A July 21 check from Arch could not resolve `ASTROPC` or
reach that endpoint, likely because the MiniPC/service was off. Treat these as
bootstrap hints and repeat UDP discovery plus `/management/v1/configureddevices`
when the rig is powered before freezing deployment configuration.

## 2. Compose Services

Keep lifecycles separate:

| Service | Responsibility | Restart relationship |
| --- | --- | --- |
| Astro Console origin/control | API, canonical state, rig workflows, storage | Highest priority; restart reconciles honestly |
| Processing worker | CPU/I/O-heavy jobs and external tools | May restart or stop without control-plane restart |
| Artifact publisher | Upload/verify promoted outputs using narrow R2 credentials | May retry without control-plane restart |
| `cloudflared` | Public ingress only | May restart without any Astro Console restart |
| Local/tunnel ingress routes | Separate LAN-owner and Access-authenticated paths | May restart without control-plane restart |
| Backup job | Consistent snapshots and optional copy | Defers/throttles around critical capture I/O |

Configure bounded restart backoff. A repeatedly crashing service must not spin,
fill logs, or oscillate hardware. “Restart always” is not a recovery policy for
an uncertain physical operation.

Give processing Compose CPU/memory limits, bounded concurrency, and lower host
I/O priority where practical. Measure under capture load; Docker CPU limits do
not alone prevent storage starvation.

## 3. Release And Update Procedure

Use immutable, versioned container images and a reviewed Compose file:

1. Build and test a versioned artifact away from the observatory.
2. Pin the image digest or immutable version and pull it on the host.
3. Stage the Compose change without changing the running stack.
4. Refuse routine activation while a run/recovery/critical write is active.
5. Create a consistent metadata backup.
6. Validate configuration and migration compatibility.
7. Stop accepting new mutations, drain bounded work, and stop cleanly.
8. Recreate only the services whose image/configuration changed.
9. Run local readiness, snapshot, database, storage, rig-discovery, and fake
   contract smoke checks.
10. Roll back to the previous image/Compose revision and restore/migrate data
    only through a tested compatibility path.

Frontend assets and server contracts ship in the same Astro Console image.
`cloudflared` has an independent image lifecycle and must not restart Astro
Console.

## 4. Backup And Restore

### What To Back Up

- consistent metadata database snapshots;
- configuration excluding re-creatable package files;
- encryption keys, owner recovery material, and tunnel/bootstrap procedure in
  an owner-controlled secure store;
- original evidence according to the selected retention policy;
- promoted derived assets that cannot be cheaply regenerated; and
- release manifests and migration history.

Do not back up live SQLite by blindly copying the main file. Use the online
backup API, `VACUUM INTO`, or a tested database-aware equivalent, then back up
the consistent result.

### Schedule

Proportionate starting policy:

- metadata snapshot before upgrades and periodically while the service is in
  active use;
- originals copied elsewhere only if the owner wants another copy;
- secondary backup of permanent raws/finals deferred to a future task;
- optional off-site replication only if later desired;
- derived cache excluded unless promoted; and
- one sample restore before trusting the procedure, then after material
  schema/backup changes.

Backup jobs must yield to capture I/O. A “successful” backup records the source
snapshot, destination, bytes, checks, duration, and a subsequent restore-test
status.

## 5. Storage Policy

Use at least three thresholds, expressed in both bytes and estimated observing
time:

- **notice:** retention cleanup or archive is approaching;
- **block new long work:** do not start a sequence that cannot finish with
  reserve;
- **critical reserve:** stop optional derived writes/processing and preserve
  space for metadata, current frame finalization, recovery, and logs.

Never delete originals automatically merely because the disk is low. Automated
cleanup may remove reproducible cache/intermediates under an explicit policy.
Original retention/archive decisions remain visible and auditable.

Start with permanent originals under `/mnt/storage/astro-console/originals`
and permanent finals under `/mnt/storage/astro-console/finals`. Keep SQLite and
bounded scratch on NVMe. Publish selected artifacts to private R2 only after
checksum/metadata capture; retain previews/intermediates for 30 days, finals
for 90 days, and staged raws for 48 hours. Delete successful local scratch
after a seven-day retry window.

Benchmark sustained simultaneous frame write, preview read, database commit,
backup read, and processing scratch I/O. Capacity alone does not establish a
safe storage system.

### Measured Sample

The inspected three-target tree is about 140 GiB:

| Target | Raw | Process | Other/result | Total approximation |
| --- | ---: | ---: | ---: | ---: |
| M13 | 2.7 GiB | 33 GiB | 0.6 GiB | 36 GiB |
| M101 | 3.6 GiB | 30 GiB | 0.9 GiB | 35 GiB |
| M8 | 17.7 GiB | 50 GiB | 2.6 GiB | 70 GiB |

Ordinary raw FITS frames are roughly 46–48 MiB. The sample shows that keeping
multiple Siril/RCAstro processing passes dominates space. Design separate
retention for immutable originals, promoted results, and disposable scratch;
otherwise a 1 TB disk can fill after only several similarly exploratory target
sets.

## 6. Observability

### Health Signals

- process liveness and event-loop delay;
- release/config/schema versions;
- snapshot age and active-run phase;
- rig/device connectivity and last trusted telemetry;
- command latency and typed failure counts;
- database transaction/checkpoint health;
- free bytes, inode reserve, write latency, and SMART/NVMe health;
- processing queue, resource use, and failures;
- clock offset/synchronization;
- tunnel connector state and last public probe; and
- last successful backup and restore drill.

### Logs And Audit

Emit structured logs to container stdout/stderr and configure Docker's local or
journald logging driver with bounded rotation. Correlate request, command,
workflow, device operation, durable event, and client result. Audit owner
membership, control requests/grants/releases/takeovers, disruptive approvals,
update/migration, restore, and credential rotation.

Do not send raw FITS, previews, secrets, observer coordinates, or high-volume
telemetry to a third-party log service by default.

### Alert Classes

- **Action:** rig uncertainty, critical disk, or repeated service crash. Show a
  persistent product warning; morning intervention is acceptable.
- **Degraded observing:** device loss, time drift, slow writes, backup competing
  with capture. Visible in product and local logs.
- **Remote-only:** Tunnel/Access/public probe failure while local service is
  healthy. Notify without implying the run stopped.
- **Maintenance:** old backup, SMART wear, update available, certificate or
  credential rotation due.

A cloud probe can prove the public URL failed; a local probe is required to
distinguish tunnel failure from service/host failure.

## 7. Power, Time, And Network Failure

### Power

- No high-availability or automated overnight response is required.
- After abrupt power loss, restart reconciliation must not assume that the
  MiniPC, mount, or camera retained state. The owner can resolve uncertainty in
  the morning.

### Time

- Use multiple NTP sources and expose synchronization/offset.
- Persist timestamps in UTC with monotonic durations for timeouts.
- A large wall-clock step must not expire/extend a control lease or operation
  timeout incorrectly.

### Network

- Wired Ethernet for the basement Arch host and fixed infrastructure.
- Stable device addressing through reservations or explicit discovery.
- Losing WAN changes only public availability.
- Losing the rig LAN causes local workflows to enter their typed bounded
  recovery; Cloudflare cannot repair it.

## 8. Capacity Measurements Before Purchase

Record a representative observing trace containing:

- largest and typical frame byte sizes;
- shortest normal cadence and burst behavior;
- preview generation CPU/memory/time;
- simultaneous viewers and preview refresh rate;
- database/event write rate;
- processing peak/steady CPU, RAM, scratch, and output amplification;
- remote upstream bandwidth and latency; and
- nightly/weekly retained bytes.

Use its p95/p99 measurements to size the host with headroom. A sensible target
is to keep observing control and frame persistence healthy with processing at
its configured maximum and the public tunnel transferring a preview/download.

## 9. Runbooks Required Before Unattended Use

- service crash during exposure;
- database recovery or migration failure;
- low and critical disk;
- rig LAN/device unreachable;
- WAN/tunnel/Access outage;
- abrupt host or MiniPC power loss and next-morning reconciliation;
- compromised/revoked user or tunnel token;
- processing tool runaway;
- failed update and rollback; and
- full restore to replacement hardware.
