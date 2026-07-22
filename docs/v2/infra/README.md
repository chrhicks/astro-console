# V2 Infrastructure Plan

Status: proposed infrastructure direction; no implementation has begun

Captured: July 21, 2026

This plan explains how the accepted V2 product model can run as a durable
personal observatory service. It began after Gate 3 and now incorporates the
infrastructure-facing decisions accepted in Gate 4 without making deployment
mechanics the organizing model of the Process workspace.

For deployment questions, this directory is the current infrastructure
reference. The earlier exploratory topology is retained only in
`docs/v2/archive/architecture/web-architecture.md`.

The recommended starting point is:

- one Windows MiniPC beside the rig, retaining ASCOM Remote, the ASI Mount
  utility, and Windows-only ASCOM drivers;
- one existing Arch Linux gaming desktop on the same LAN, running the Astro
  Console server as a Docker Compose application;
- one service-owned local control plane that remains useful without the public
  internet;
- local metadata and frame storage on that host;
- permanent raw source data and final outputs on the Arch host, disposable
  processing scratch locally, and downloadable copies of processing artifacts
  and finals in a private Cloudflare R2 bucket with lifecycle expiration;
- a Cloudflare Tunnel for outbound-only public ingress;
- Cloudflare Access for public admission and managed identity;
- Astro Console authorization and the exclusive control lease enforced by the
  observatory service;
- Docker Compose for deployment and lifecycle, with Docker supervised by the
  Arch host; and
- private Cloudflare R2 for published downloads, but no hosted database,
  custom control relay, or Kubernetes cluster in the first deployment.

Cloudflare is an ingress and identity boundary, not the observatory's source of
truth or a separate web-app runtime. The Arch host serves the version-matched
web app, API, streams, and assets through the tunnel. Hardware control, run
execution, mutation classification, evidence, storage, and recovery remain on
that host; Windows driver ownership remains on the MiniPC.

The owner has accepted moving authoritative `chicks.dev` DNS from Vercel to
Cloudflare. Keep Vercel as registrar initially because a registrar transfer is
not needed for Tunnel, email, or a future personal website. Recreate every
existing website, mail, and verification record in Cloudflare before changing
nameservers.

## Documents

- [Requirements](requirements.md) records functional, safety, capacity,
  security, and operational requirements plus acceptance scenarios.
- [Service options](service-options.md) compares Cloudflare, Tailscale, a small
  VPS, and a future purpose-built hub.
- [Recommended architecture](architecture.md) defines components, trust
  boundaries, traffic paths, persistence, and deployment phases.
- [Security model](security.md) covers identity, authorization, secrets,
  bounded assets, and the trusted local-LAN path.
- [Operations](operations.md) covers host layout, supervision, updates,
  backups, observability, power, time, and capacity planning.
- [Storage and artifact delivery](storage-and-artifacts.md) defines the local
  raw archive, processing scratch, R2 publication, retention, and download
  model.
- [Decisions and open questions](decisions.md) separates selected direction
  from the choices that still need the owner's input or a measured spike.
- [Research sources](research.md) records the current external documentation
  used for the service comparison.

## Invariants Inherited From Gates 1–4

Infrastructure must preserve the accepted product semantics:

1. The observatory service owns execution, revisions, mutation impact,
   freshness, presence, and the exclusive control lease.
2. Closing a browser, losing a stream, or losing the public tunnel cannot stop
   or transfer an accepted run.
3. Reconnect is snapshot-first. Clients do not replay buffered observing
   commands.
4. Stale run revisions and stale lease revisions fail before hardware action.
5. Public identity admission does not itself grant control.
6. The first phone client is read-only even when its user is the owner.
7. Processing and remote downloads cannot starve capture or rig control.
   Active capture alone is not evidence of contention; throttle or pause only
   for measured CPU, memory, storage, or thermal pressure.
8. Raw hardware, shell, process, database, and filesystem access are never
   exposed through the product ingress.
9. Process keeps one service-owned current edit history with stage-local
   checkpoints. Discard preserves sources; selected outputs become stable
   Library assets.
10. Detailed external-tool diagnostics are owner-safe and sanitized before
    copy, download, or remote display.

## Recommendation Confidence

The topology decision is strong enough to guide contract and deployment
spikes. It is not yet an installation specification. Remaining measurements
include MiniPC addresses and exposed Alpaca devices, container network behavior
for discovery, storage performance, and validation of the proposed retention
windows.
