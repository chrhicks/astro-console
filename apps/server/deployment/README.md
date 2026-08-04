# Server operations starter

This is a non-activating Compose starter, not a production deployment. The
executable defaults to loopback. `config.example` sets
`ASTRO_SERVER_PORT=8080` to match the Compose-internal origin port. Compose
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
provide the verified Access issuer/audience, HTTPS JWKS/certificate URL,
bounded JWKS cache TTL, bootstrap path, and a server-configured desktop or
phone client context. The bootstrap file is
host-managed JSON, never committed: `[{"email":"...","personId":"...","role":"owner"|"viewer"}]`.
On the first verified Access assertion for one of those emails, the service
durably binds its Access subject to that membership; request bodies, queries,
and headers never choose a role. Provision the confirmed owner and viewers in
that host file. Development fixture admission is loopback-only and refuses a
`0.0.0.0` bind. Each assertion must be RS256 and carry a `kid`; the service
selects that current key from the HTTPS JWKS/certificate document. It caches
only a validated document for the configured bounded TTL, refreshes once for
an unfamiliar `kid`, and rejects an unknown key, malformed document, failed
refresh, or expired cache without falling back to a file or stale key.

Owner authority is the durable membership role, not a magic fixture person ID:
an owner bootstrap entry may use any stable non-empty `personId`. A phone
client context remains read-only even for an owner membership. Bootstrap email
comparison is trimmed and case-normalized, rejects duplicates after
normalization, and is rechecked on every verified request, so removing an
email revokes origin admission even if its prior Access subject remains in
SQLite.

Build from the repository root with `docker build -f
apps/server/deployment/Dockerfile .`; it builds the contracts, web bundle, and
server runtime into one image. The runtime contains only the web `dist` output,
not web source, fixtures, theme-study files, screenshots, or development
dependencies. `ASTRO_WEB_DIST=../web/dist` is the packaged default. Activation
must use a reviewed immutable image digest rather than the starter tag. Before activation: supply
host-managed secrets, copy `config.example` outside the repository, validate
the non-secret runtime configuration at process startup, run the image's
startup migrations against a backed-up local database, and check admitted
`/api/health/ready` plus owner-only `/api/health/operations`. Back up SQLite
through an online/consistent backup procedure and perform a restore drill;
never copy a live WAL file as a backup.

For a repository-side preflight, use `npm run backup:preflight -- backup
<database> <target>`; it uses SQLite `VACUUM INTO` and prints bounded JSON
evidence with integrity, bytes, and SHA-256. Use `verify <backup>` and
`restore-drill <backup> <disposable-target>` to verify an isolated copy without
overwriting the live database.

For the current Docker deployment, `host-backup.sh` plus the adjacent systemd
service/timer are the host-managed daily same-host resilience reference. Install
those files outside the repository, preserve root-only permissions on
`/mnt/storage/astro-console/backups`, and retain the timer's journal as the run
log. The script fails closed unless live SQLite and that SSD destination have
different filesystem IDs; it creates an online snapshot, verifies the copied
SSD-side bytes and SHA-256, runs an isolated restore drill, and retains only
fourteen days of backup/checksum pairs under that explicit application backup
directory. It is not off-host disaster recovery and does not protect against
host loss, fire, or theft.

The Dockerfile pins the verified multi-architecture digest for
`node:22.22.2-bookworm-slim`:
`sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e`.
Recheck it before changing the base with `docker buildx imagetools inspect
node:22.22.2-bookworm-slim`. The root `.dockerignore` deliberately excludes
local state, dependencies, Git history, archives, and unrelated apps from the
release build context.

Rig discovery, live Access/JWKS rotation validation, tunnel routing, storage thresholds,
R2 publication, processor/publisher services, and backup restore validation
remain activation work. Do not create placeholder workers that imply those
boundaries are live.

The optional `compose.publisher.yaml` profile add-on deploys the isolated
private-R2 publisher service. It is deliberately absent from the base
origin/download Compose file, so inactive publisher mounts and its environment
file do not block an origin/download render. Select it only when its
host-managed publisher values are available. M13 publisher PUT and provider
HEAD checksum/byte verification have been observed; this structure does not
claim a general processing workflow or a new publication run.
It alone receives a host-managed bucket-only object read/write credential;
origin, cloudflared, and browsers do not receive it. It has only
the state volume, read-only promoted-output bind, and read-only secret bind,
with a read-only root, dropped capabilities, and CPU/memory limits. The
private Standard bucket is `astro-console-artifacts` in ENAM. Authenticated
missing-object HEAD behavior is verified; a later supervised promoted asset
must prove PUT, HEAD checksum/bytes verification, retry/restart recovery, and
honest projection before publication is called operational.

The publisher uses SQLite WAL with a bounded five-second busy timeout when
opening its migration-only database connection. It treats only recognized
SQLite busy/locked failures as transient and continues its bounded pass loop;
other errors remain terminal. Confirm this behavior from publisher logs during
the next supervised host run.

## One-shot processor evidence utility

The manifest processor is retained only as the one-shot utility that produced
the M13 source/output/publication evidence. It is not an origin environment,
Compose service, HTTP command, browser control, or ongoing processing
workflow. For a separately authorized evidence run, copy
`processor.config.example` outside the repository and run the immutable image
once with `node --experimental-strip-types src/workers/processor-service.ts`.

Mount only the canonical state volume at `/var/lib/astro-console`, an
app-owned `processor-sources` bind read-only at the same path, writable
app-owned `originals` and `outputs` binds at their configured paths, and one
read-only manifest bind at `/run/config/process-output-manifest.json`. The
manifest names only relative source paths; it can materialize an immutable
original with truthful lineage, then delegates containment, symlink, checksum,
idempotency, and publication-outbox rules to Process Save. Originals are not
published by ingest alone, and the utility neither deletes nor renames its host
manifest. Inspect the one JSON result and exit; do not keep the container
running.

## Authorized downloads

The deployed M13 path is verified: the authenticated origin issued a
five-minute redirect and the browser downloaded the private-R2 FITS with its
stored attachment metadata. Keep the two host-managed service files outside
the repository: an origin `config.env` copied from `config.example` and a
signer `download-grant.env` copied from `download-grant.config.example`.
Copy `compose.env.example` as the base Compose interpolation file; it contains
only origin/download values. Optional publisher values live in
`compose.publisher.env.example` and are required only with
`compose.publisher.yaml`. Compose resolves
interpolation before reading service `env_file`, so do not duplicate bind
values in service files.

Mount the same randomly generated secret of at least 32 characters into origin
and signer at the paths shown. Create a separate R2 credential scoped only to
read objects in this bucket; its JSON must contain exactly `accessKeyId` and
`secretAccessKey`. It is not the publisher credential and must not contain a
session token. The signer has no host port: `expose: 8791` makes it reachable
only by the Compose origin service.

After staging the immutable release, taking a consistent SQLite backup, and
confirming migration and restore-drill evidence, activate only the intended
services with:

`docker compose --env-file /secure/astro-console/compose.env --profile download up -d origin download-grant`

For the private publisher, use both `--env-file
/secure/astro-console/compose.env --env-file
/secure/astro-console/compose.publisher.env -f compose.publisher.yaml
--profile publisher`; it requires
`ASTRO_PUBLISHER_ENV_FILE`, `ASTRO_PUBLISHER_OUTPUTS_HOST_PATH`, and
`R2_CREDENTIALS_HOST_PATH`. The completed M13 evidence is limited to its
published artifact and authorized download; neither add-on establishes a
general processing workflow.

Then verify an admitted published Asset-ID request receives a 303 redirect,
while its URL/object key appear in neither SQLite audit rows nor browser JSON.
The current M13 artifact has that supervised production evidence. Future
publications and operational monitoring remain separate evidence boundaries.
