# Observatory Activation Closeout

Status: **historical evidence — closed 2026-07-29**

This compact deployment summary is retained for historical lookup. Use the
[current handoff](../../current/handoff.md) for active proof boundaries.

The interim July 27 ledger is archived in
[the historical activation record](activation-ledger-2026-07-27.md).

## Verified Deployment Evidence

- The Access-protected origin, private download signer, publisher, and tunnel
  are running in their separate roles. The origin is loopback-bound and the
  signer is private to its service network.
- Origin and publisher run the streamlined `eceab25` release. A publisher
  upload writes R2 attachment metadata; the origin performs an admitted
  Asset-ID lookup and redirects once to a five-minute private-R2 URL.
- The published M13 linear-master FITS was refreshed with that attachment
  metadata. R2 copy and HEAD verification retained its checksum, and the owner
  confirmed that a fresh private-R2 URL downloaded the FITS in a browser.
- The rig worker is running and durably reports `alive` / `ready`. No Solar
  work was pending during its schema-compatible replacement.
- The enabled same-host SQLite backup timer has a successful checksum-backed
  run and disposable restore drill. Fourteen-day same-host retention is the
  accepted current resilience scope.

## Boundaries Still Honest

- Deployment and worker liveness are not physical Solar capture, provider
  acknowledgement, Stack evidence, stop, or restart-recovery proof.
- The backup is same-host resilience, not off-host disaster recovery.
- The M13 result proves one published artifact download; it does not prove a
  general processing workflow or sustained operations under capture load.

## Operator Reference

Use the [current handoff](../../current/handoff.md) for proven details and
deferred work. The next code activity is the
[complexity audit](../../current/phase-1-complexity-audit.md).
