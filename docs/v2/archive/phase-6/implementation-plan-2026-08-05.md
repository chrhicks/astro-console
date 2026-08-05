# Phase 6: Remote Viewing and Shared Control

Status: **complete on August 5, 2026**

## Closeout Evidence

- `observatory.chicks.dev` provides Access-protected read-only viewing;
  `astro.chicks.dev` provides the separately routed desktop lease surface.
- The Arch origin exposes loopback-only remote phone (`18080`), local owner
  (`18081`), and remote desktop (`18082`) listeners. Public unauthenticated
  requests receive `401`; the local owner listener remains control-capable.
- The final desktop Access control fix is
  `sha256:e82d51037037329d7013c2612844541cb60c0372273d4d0dc622f2e89d5171c3`.
  Server validation passed **83/83** and web validation passed **65/65**.
- Owner public evidence confirms the V2 UI on both public hostnames and a
  successful desktop `Take control` action. The owner accepted this as the
  available proxy for a separate viewer identity.
- A brief supervised Tunnel stop left the local owner snapshot available and
  unchanged; restarting the Tunnel restored public Access routing.

No provider, hardware, live capture, or physical-image behavior was exercised.

## Purpose

Finish V2.0 by making the rig-local service available to a small trusted group
without moving observatory authority out of the service. Cloudflare Tunnel and
Access provide public ingress and identity admission. The service continues to
own membership, phone capability, snapshots, run revisions, and the exclusive
control lease.

This plan follows the selected [infrastructure plan](../infra/README.md), its
[security model](../infra/security.md), and the accepted V2
[UX guidance](../ux-design-guidance.md). It uses the existing typed admission
and control seam; it does not replace it with browser presence or identity
provider roles.

## Approval and Entry Conditions

The owner approved this plan on August 4, 2026. The Arch host already has the
`observatory.chicks.dev` Cloudflare Access/Tunnel deployment. On
August 4, 2026, an unauthenticated public request redirected to the Access
login and the Arch `origin`, `tunnel`, publisher, download-grant, and
rig-worker containers were running.

Before Release 1, confirm rather than recreate:

- Google and email one-time-PIN login, with the intended explicit allowlist;
- the deployed Access issuer, audience, JWKS endpoint, and local membership
  bootstrap; and
- two supervised test identities: owner and viewer/friend.

The public tunnel can reach only the Access-protected tunnel listener. The
local owner route remains direct and separately labeled. Neither public
admission nor a membership role grants control by itself.

## Scope and Proof Boundary

Phase 6 covers authenticated remote viewing, the existing exclusive control
lease, the read-only phone projection, bounded previews, and explicit asset
downloads. It tests the public path with the deterministic local observing
fixtures already used by V2.

It does not add provider writes, a real rig command, live-rig capture,
unattended operation, a hosted database, a custom relay, user passwords, or a
new processing integration. Those are outside V2.0.

## Release 1: Remote Read-Only Viewing

### Result

A trusted owner or viewer reaches the version-matched web app at the public
hostname, receives an authoritative snapshot and snapshot-first stream, and
can inspect an active deterministic run. Phone clients have the same current
truth but no mutation controls.

### Work

1. Validate the existing `cloudflared` service and tunnel listener. Keep the
   local owner listener unreachable through the tunnel. Publish only the web
   bundle, admitted API, admitted SSE, bounded previews, and explicit download
   route. Repair the observed Tunnel DNS-refresh error only when it affects
   public-path reliability or verification.
2. Complete the Cloudflare Access admission path: validate JWT signature,
   issuer, audience, expiry, and intended application; resolve the verified
   subject to the local owner/viewer membership; reject missing, invalid, and
   unlisted identities before HTTP or SSE projection.
3. Make the bootstrap, SSE reconnect, asset list/detail, and health projection
   reflect the admitted identity and client capability. Keep phone clients
   read-only even for the owner.
4. Add the remote identity and read-only authority trace to the web shell. It
   must state remote availability, identity/role, current controller or
   available control, and why a viewer or phone cannot act. Do not expose
   token, host, filesystem, driver, or raw diagnostic detail.

### Proof

- Contract and server tests cover valid/invalid/expired/wrong-audience Access
  tokens, allowlisted/unlisted membership, HTTP/SSE admission, and phone
  denial for every mutation family.
- Browser evidence at wide, compact, and 390 px shows the public read-only
  projection, reconnect snapshot behavior, keyboard access, and no horizontal
  overflow. Designer review has no P0/P1 issue.
- A supervised owner and viewer use the real public hostname. An unauthenticated
  browser cannot reach product data. This proves ingress and admission, not
  hardware behavior.

## Release 2: Shared Control

### Result

An eligible desktop friend can request control; an owner can grant or decline;
the service projects one controller to every client; the controller can release;
and the owner can take control. Disconnect and reconnect are visible service
states, not browser guesses.

### Work

1. Finish the durable client-presence lifecycle that feeds the existing control
   lease: current, reconnecting with a bounded grace deadline, disconnected,
   and snapshot-first reconnect. Presence updates do not turn a viewer into a
   controller and do not replay commands.
2. Project pending requests, current controller, lease revision, freshness, and
   typed reasons for unavailable/stale actions. Keep controller identity
   distinct from owner/viewer membership.
3. Add request, grant, decline, release, and owner-take actions to the desktop
   authority surface. Require an explicit owner choice for grant, decline, and
   takeover. Phone clients display this state but expose no control action.
4. Route only existing supported observing mutations through the admitted
   client, capability, lease revision, run revision, and idempotency checks.
   A lost, stale, or replaced lease fails locally before workflow execution.

### Proof

- Contract/server scenarios prove competing requests, one holder, duplicate
  request identity, stale lease/run revision, release, owner takeover,
  disconnect grace, reconnect, expiry, and restart recovery.
- Functional browser evidence proves the complete owner/friend workflow and
  the same controller state on a separate viewer and phone client.
- A supervised public-path test controls only the deterministic fixture run.
  It proves authorization and lease enforcement at the local service; it does
  not prove a provider or hardware action.

## Release 3: Remote Evidence, Assets, and Closeout

### Result

Remote viewers receive bounded previews and deliberate downloads without
starving the service. An outage of Tunnel or Access changes remote availability
only; the local service and its active deterministic run continue.

### Work

1. Set and expose measured preview size, refresh, concurrent-stream, and
   download limits. Generate or serve the existing preview representation; do
   not send original bytes as routine viewing data.
2. Keep original download deliberate and authorized. Reuse the existing asset
   grant path: resolve an allowed asset ID, stage/publish only when needed, and
   return a short-lived private download without exposing bucket credentials or
   object keys.
3. Add clear remote-only health: Access/Tunnel/public probe failure is visible
   as remote unavailable and never as a stopped run. Keep the local route
   available for owner inspection.
4. Record the deployment configuration, test identities (without secrets),
   bandwidth measurements, outage drill, V2 completion evidence, and remaining
   physical/provider limits. Archive detailed Phase 6 execution material and
   leave a short V2.0 completion handoff.

### Proof

- Focused tests prove preview/download authorization, no-store/private cache
  behavior, explicit original intent, bounded concurrency, unavailable staging,
  and no public debug/admin/driver/filesystem endpoint.
- Measure a representative telemetry/preview/download session with two
  admitted viewers. Confirm the configured limits and that the deterministic
  active run remains healthy.
- During a supervised Tunnel/Access outage, confirm the public client reports
  remote unavailability while a direct local-owner client still reads the run
  and the run completes unchanged.
- Re-run production builds, the complete focused test suites, public-path
  browser walkthroughs, and Designer review at wide, compact, and 390 px.

## V2.0 Closeout

After all three releases pass, mark Phase 6 and V2.0 complete in the delivery
plan, replace the current handoff with the V2.0 completion brief, archive this
detailed execution plan and its evidence, and append the final proof boundary
to Continuum memory. Leave post-V2 ideas in
[post-V2.0 notes](v2-post-v2.0-notes.md); do not expand this phase to pursue
them.
