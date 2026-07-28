# Observatory Activation Ledger

Status: **live protected fixture and deployed Solar worker; physical trace unproven — 2026-07-27**

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
- `astro-console-origin` is verified running image
  `astro-console-v2-local-web:c9afc65-solar`, healthy on loopback. Its visible
  release label is stale; do not restart a healthy origin merely to change that
  label. `Run plan` continues to mutate service-owned fixture state only.
- `astro-console-rig-worker` is verified deployed and running with
  `unless-stopped`, read-only root, no host port, canonical state volume, and
  a read-only host-managed PEM mount. It is configured in `seestar` mode for
  native host `192.168.4.63`.
- Deployment verification does not establish physical control evidence: no
  Solar intent has been submitted, no physical command has been issued, and no
  provider acknowledgement, Stack evidence, stop trace, or restart recovery
  has yet been observed.
- `chicks-arch` is reachable for host administration directly over the Eero LAN
  by SSH at `192.168.7.235`. This is the deployment path for rig-local checks;
  do not infer a Tailscale route or public port is needed for the Seestar.

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
- Execute and record one physically supervised Solar run before any physical
  capture, mount, or camera control is represented as live. Deployment is
  verified; the provider/Stack/stop/restart evidence is not.

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
5. Before submitting a Solar intent, connect directly to `192.168.7.235` and
   verify the running worker's pinned image, host-managed PEM mount, canonical
   volume, `seestar` mode, and no-port boundary. Do not restart the healthy
   origin merely because its visible release label is stale.

Do not put Access tokens, tunnel tokens, membership email addresses, image
build credentials, or host-private paths in this ledger.
