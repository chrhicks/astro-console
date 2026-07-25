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

Production admission is fail-closed: set `ASTRO_ADMISSION_MODE=production`,
provide the verified Access issuer/audience, public-key path, bootstrap path,
and a server-configured desktop or phone client context. The bootstrap file is
host-managed JSON, never committed: `[{"email":"...","personId":"...","role":"owner"|"viewer"}]`.
On the first verified Access assertion for one of those emails, the service
durably binds its Access subject to that membership; request bodies, queries,
and headers never choose a role. Provision the confirmed owner and viewers in
that host file. Development fixture admission is loopback-only and refuses a
`0.0.0.0` bind.

Owner authority is the durable membership role, not a magic fixture person ID:
an owner bootstrap entry may use any stable non-empty `personId`. A phone
client context remains read-only even for an owner membership. Bootstrap email
comparison is trimmed and case-normalized, rejects duplicates after
normalization, and is rechecked on every verified request, so removing an
email revokes origin admission even if its prior Access subject remains in
SQLite.

Build from the repository root with `docker build -f
apps/v2-local-web/deployment/Dockerfile .`; activation must use a reviewed
immutable image digest rather than the starter tag. Before activation: supply
host-managed secrets, copy `config.example` outside the repository, validate
the non-secret runtime configuration at process startup, run the image's
startup migrations against a backed-up local database, and check admitted
`/api/health/ready` plus owner-only `/api/health/operations`. Back up SQLite
through an online/consistent backup procedure and perform a restore drill;
never copy a live WAL file as a backup.

For a repository-side preflight, use `npm run backup:preflight -- backup
<database> <target>`; it uses SQLite `VACUUM INTO` and verifies integrity. Use
`npm run backup:preflight -- verify <backup>` before a restore drill. This
does not perform a host restore.

The Dockerfile pins the verified multi-architecture digest for
`node:22.22.2-bookworm-slim`:
`sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e`.
Recheck it before changing the base with `docker buildx imagetools inspect
node:22.22.2-bookworm-slim`. The root `.dockerignore` deliberately excludes
local state, dependencies, Git history, archives, and unrelated apps from the
release build context.

Rig discovery, Access/JWKS rotation, tunnel routing, storage thresholds,
R2 publication, processor/publisher services, and backup restore validation
remain activation work. Do not create placeholder workers that imply those
boundaries are live.
