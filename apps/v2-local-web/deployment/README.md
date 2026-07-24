# Local-web operations starter

This is a non-activating Compose starter, not a production deployment. The
executable defaults to loopback. `config.example` sets
`ASTRO_LOCAL_WEB_PORT=8080` to match the Compose-internal origin port. Compose
uses `0.0.0.0` only within its private service network so `cloudflared` can
reach the origin; it does not publish a host port. `cloudflared` is the sole
public-ingress component and must be configured to reach the private origin
after Access validation.
The Compose starter publishes no host port. A distinct LAN ingress and its
authorization policy are activation work; do not infer a local-owner bypass
from this file.
Do not add router forwarding, home-directory mounts, device credentials, or
tunnel tokens to this folder.

Before activation: pin reviewed image digests, supply host-managed secrets,
copy `config.example` outside the repository, run the image's startup
migrations against a backed-up local database, and check admitted
`/api/health/ready` plus owner-only `/api/health/operations`. Back up SQLite
through an online/consistent backup procedure and perform a restore drill;
never copy a live WAL file as a backup.

Rig discovery, Access/JWKS rotation, tunnel routing, storage thresholds,
R2 publication, processor/publisher services, and backup restore validation
remain activation work. Do not create placeholder workers that imply those
boundaries are live.
