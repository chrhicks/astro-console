# Infrastructure Security Model

## 1. Security Objective

Protect physical equipment, evidence, the rig network, and trusted users while
keeping a personal observatory operable. The goal is not enterprise policy
machinery; it is preventing a web ingress or compromised viewer from becoming
a hardware, shell, or filesystem ingress.

## 2. Assets And Trust Zones

Highest-impact assets are:

- safe physical rig state and exclusive command authority;
- active-run intent, revisions, approvals, and recovery state;
- original astronomical evidence and provenance;
- owner identity, allowlist, tunnel credentials, backup keys, and device
  credentials;
- the Linux host and its access to the rig LAN; and
- private previews, location, schedule, presence, and operational history.

Trust decreases across these zones:

1. device-reported state and local control workflows;
2. app-owned database and filesystem;
3. trusted home-LAN browser and local administration;
4. local HTTP origin;
5. Cloudflare Tunnel and Access edge;
6. authenticated remote browser;
7. all other internet traffic.

An identity can be trusted as “Maya” without being trusted to control the rig.
A controller can issue typed observing intent without receiving a shell or
filesystem capability.

## 3. Identity And Authorization

### Public Path

Cloudflare Access protects the entire application hostname with deny-by-default
policies and an explicit identity allowlist. Do not use `Bypass`, `Everyone`,
or “all valid emails” for product paths.

Access is Cloudflare's authentication/admission proxy; it does not require
friends to create Cloudflare accounts. Configure both Google login and
Cloudflare's email one-time PIN provider, then allowlist the specific email
addresses permitted into Astro Console. New Zero Trust organizations may
offer Cloudflare's own identity provider by default; remove or disable that
login method for this application so the intended choices are Google and OTP.

Cloudflare sends an application JWT in `Cf-Access-Jwt-Assertion`. The origin
must validate its signature, issuer, audience, expiry, and intended application
or use an equivalently strong tunnel-bound validation mechanism. Identity comes
from verified claims, never from a browser body, query, or arbitrary header.

Cloudflare terminates the browser's public TLS session. Treat the provider as a
data processor able to observe public-path application traffic. Default remote
delivery to telemetry and bounded previews, keep originals explicit, and use a
different topology if that trust is unacceptable.

The service maps that external subject to a small local membership record:

- `owner`: manage membership and grant/take control;
- `viewer`: inspect allowed observatory state and assets;
- client capability: phone remains read-only; and
- `controller`: never stored as an identity role, only the current exclusive
  service-owned lease.

Membership changes and lease changes are separate audited operations.

### Local Path

The owner explicitly accepts the home LAN and physical Arch host as the local
administrative boundary. Local access does not need Cloudflare, Tailscale, a
second identity provider, or an elaborate outage credential.

The initial local origin may treat requests from the configured private subnet
as the local owner, provided that:

- the port binds only to the private interface;
- the router does not forward it;
- Docker does not publish it on an unintended interface;
- `cloudflared` cannot route to the LAN-owner listener or bypass Access;
- forwarded identity headers are stripped and recreated by trusted ingress;
- the application labels the session as local-owner context; and
- domain lease/revision/safety checks still apply to every mutation.

This is proportionate to a hobby system and is not a reusable recommendation
for a hostile or shared LAN. A local login/passkey can be added later if the
network trust model changes.

## 4. Command Controls

Every mutation endpoint must enforce, in order:

1. authenticated person and active membership;
2. client capability (including phone read-only);
3. exclusive control-lease eligibility;
4. expected lease revision;
5. expected run revision and preview binding where applicable;
6. idempotency/correlation;
7. operational and safety preconditions; and
8. typed workflow execution.

Rate limiting and CSRF/origin checks are additional controls; neither replaces
domain authorization. A reverse proxy may reduce abuse but cannot determine
whether skipping a frame is physically safe.

## 5. Web And Stream Controls

- Secure, HttpOnly, SameSite cookies where cookies are used.
- A restrictive Content Security Policy with no production dev origins.
- Exact allowed host/origin checks; no wildcard CORS.
- Authentication before SSE/WebSocket upgrade and revalidation on reconnect.
- Bounded message size, query complexity, stream count, preview generation,
  and download concurrency.
- Snapshot and event decoding in the browser with Effect Schema.
- No secret, filesystem path, device credential, or raw driver error in public
  responses.
- Security headers and cache policy appropriate to private observatory data.

## 6. Asset Controls

- Address assets by opaque or scoped IDs, not caller paths.
- Resolve and canonicalize under configured roots before access.
- Originals are immutable; annotations and decisions are separate metadata.
- Preview generation writes to app-owned temporary paths and atomically
  promotes completed output.
- Remote original download is explicit, authorized, concurrency-limited, and
  `private, no-store` by default.
- Keep R2 private. Resolve authorized asset IDs to object keys and issue
  short-lived presigned downloads; signed URLs are bearer credentials and must
  not appear in logs.
- Mount the least-privilege R2 token only into the publisher; the browser and
  processing tools never receive bucket credentials.
- No arbitrary upload/execution feature in the initial product.
- Processing tools receive allowlisted executables and structured arguments,
  never interpolated shell commands.

## 7. Host And Secret Controls

- Dedicated containers and non-root container users for origin/control,
  processing, and tunnel where practical.
- Root-owned Compose configuration; credentials supplied through Docker
  secrets or equivalently restricted host files, never committed `.env` files.
- Minimal filesystem read/write paths and no unnecessary home directory.
- read-only container filesystems, dropped Linux capabilities,
  `no-new-privileges`, private temporary filesystems, and narrow bind mounts
  where compatible with device integrations.
- Processing worker has no tunnel token, owner credential, or rig credentials.
- Owner LAN/SSH administration is not a product user credential.
- Automatic security updates may stage, but application/kernel reboots wait for
  an observing-safe maintenance window unless an urgent owner decision says
  otherwise.

## 8. Threats And Required Responses

| Threat | Primary controls | Honest failure |
| --- | --- | --- |
| Public scanning/credential stuffing | Tunnel hides origin; Access allowlist/MFA/rate limits | No origin request or generic denial |
| Stolen viewer session | Short sessions, revocation, service membership, phone/client capability | Viewing ends; no control lease gained |
| Forged edge identity header | JWT signature/issuer/audience validation; loopback origin | Request rejected |
| CSRF or malicious site | SameSite/CSRF/origin validation plus revision/lease guards | Typed unauthorized/conflict; no hardware action |
| Delayed/replayed command | idempotency, expected run and lease revisions | Typed stale/lost result; no hardware action |
| Tunnel takeover/misroute | least-privilege token, origin bound to loopback, Access on whole hostname | Public path unavailable; local run continues |
| Processing-tool compromise | separate user/process, bounded files/resources, no rig credentials | Job fails; observing continues |
| Path traversal/ID guessing | stable IDs, authorization, canonical root containment | Not found/forbidden without path disclosure |
| Disk exhaustion | forecasts, quotas/reserve, bounded logs/cache | stop/degrade per policy; preserve terminalization |
| Host compromise | patching, least privilege, backups, admin separation | Treat rig and secrets compromised; isolate and restore |

## 9. Security Validation Before Remote Control

- Access policy and token-validation tests, including wrong issuer/audience and
  expired tokens.
- Owner/viewer/phone authorization matrix for every command family.
- Stale lease, stale run, duplicate idempotency, reconnect, and delayed request
  scenarios.
- CSRF/origin, stream-upgrade, rate-limit, oversized input, and schema-fuzz
  tests.
- Asset ID authorization, range handling, symlink and path-traversal tests.
- Confirm no driver, database, health-detail, metrics, debug, or admin endpoint
  is reachable through the public hostname.
- Revoke a real Access identity during a supervised test.
- Internet outage with successful direct-LAN owner access.
