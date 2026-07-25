# Observatory Activation Ledger

Status: **live protected fixture — 2026-07-25**

This is the operational record for the public Phase 1 fixture. It is not a
claim that a browser command controls either physical rig.

## Live boundary

- `observatory.chicks.dev` is protected by a Cloudflare Access self-hosted
  application using email one-time PIN and an explicit four-person allow
  policy. The application is hidden from the launcher and has a 24-hour
  session duration.
- A Cloudflare Tunnel has healthy connectors and routes only that hostname to
  `http://127.0.0.1:18080` on the observatory host. The tunnel requires the
  expected Access team and audience and ends in an explicit 404 catch-all.
- The origin container is loopback-only, non-root, read-only (apart from its
  state volume), and verifies the Access JWT issuer, audience, expiry, RS256
  signature, and bounded JWKS cache before serving protected state.
- The application is currently release `bf8831e`. It contains deterministic
  Plan, Observe, Library, and Process fixture projections. `Run plan` mutates
  service-owned fixture state only; there is no deployed rig worker or Alpaca
  command adapter.

## Recovery evidence

- Both origin and tunnel containers use Docker `unless-stopped` restart
  policy. This was verified live on 2026-07-25.
- The unused firewall exception for private-LAN TCP/8080 was removed from both
  runtime and persistent firewalld configuration. No public or LAN origin
  port is exposed; the active origin remains `127.0.0.1:18080`.
- A consistent SQLite `VACUUM INTO` backup was created, integrity-checked,
  copied to a root-only host backup directory outside the live Docker volume,
  checksum-recorded, restored as a disposable database, and served through a
  disposable local service with `GET /api/snapshot` returning HTTP 200.
- A persistent systemd timer now runs the same verified online backup daily
  with a small randomized delay and retains fourteen days of local
  backup/checksum pairs. Two timer-service executions have passed.

## Still required

- Copy verified backups to independent storage and maintain a repeatable
  restore-runbook. The current schedule is local host protection, not off-host
  disaster recovery.
- Add container health checks or an equivalent monitored liveness/restart
  mechanism. Restart policy alone does not detect a stuck process.
- Make remote client/device authority real. The current deployed desktop
  client context is service-wide, so it must not be described as enforcing
  phone read-only behavior for a remote owner browser.
- Define a prompt revocation procedure. Access sessions last up to 24 hours;
  origin membership enforcement and host-policy update/reload behavior must
  be kept accurate in the runbook.
- Install and prove a rig-owned worker/adapter lifecycle before any physical
  capture, mount, or camera control is represented as live.

## Operator checks

1. Confirm unauthenticated public access redirects to Access, then sign in as
   an allowed member and confirm the activity shell renders.
2. Confirm the tunnel has healthy connectors and the origin responds on its
   loopback health endpoint.
3. Before an image/config change, make and verify a fresh online SQLite
   backup. Exercise the restore drill after material schema or deployment
   changes.
4. For an urgent membership change, update the host-managed membership policy
   and use the documented origin reload/restart procedure; also remove the
   user from the Access policy when immediate Cloudflare-side denial is
   needed.

Do not put Access tokens, tunnel tokens, membership email addresses, image
build credentials, or host-private paths in this ledger.
