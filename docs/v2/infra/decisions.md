# Infrastructure Decisions And Open Questions

## 1. Selected Direction

These decisions are proposed strongly enough to guide the next infrastructure
spikes. They do not authorize implementation.

| Decision | Direction | Reason |
| --- | --- | --- |
| Device/driver appliance | Windows MiniPC beside rig | Retain ASCOM Remote, ASI Mount utility, and Windows-only ASCOM drivers |
| Application authority | Arch Linux gaming desktop on home LAN | Durable web/control service without moving Windows drivers |
| Public ingress | Cloudflare Tunnel | Outbound-only, ordinary browser, stable same-origin HTTPS |
| Public admission | Cloudflare Access with Google + email OTP and named allowlist | Friends need no Cloudflare account; no app password database |
| Domain authorization | Astro Console service | Owner/viewer, phone capability, lease, revisions, and safety are product semantics |
| Owner administration | Direct home LAN and physical host | No external administration service is required |
| Public name | `observatory.chicks.dev` | Stable friend-facing product URL |
| DNS/registration | Move authoritative DNS to Cloudflare; keep Vercel registration initially | Nameserver change is sufficient for Tunnel and does not prevent email or a personal website |
| Metadata store | Local SQLite initially | One site and one canonical service do not justify a database server |
| Long-term asset store | Arch `/mnt/storage` filesystem | Permanent originals and compact final outputs stay local and immutable |
| Published artifact store | Private Cloudflare R2 Standard | Fast direct downloads and lifecycle expiry for promoted outputs |
| Deployment | Docker Compose on Arch | Preferred owner maintenance and dependency isolation model |
| Processing isolation | Separate lower-priority worker | Processing failure or load cannot own or starve observing |
| Processing resource policy | Measure contention; do not pause merely for active capture | Ordinary capture is mostly waiting plus bounded LAN transfers; the UI must name the actual pressure |
| Public compute/state | R2 bytes only initially | Avoid split-brain and version skew; the Arch service remains authoritative |
| Availability posture | Best-effort hobby service | Downtime has no business/monetary impact; morning recovery is acceptable |

## 2. Confirmed Owner Inputs

- The Windows MiniPC is the rig-facing appliance and runs ASCOM Remote, the ASI
  Mount utility, and ASCOM drivers.
- The Astro Console server runs on an existing older gaming desktop with Arch
  Linux on the same home LAN.
- Local recovery and administration happen directly over the LAN or at the
  machine; Cloudflare/Tailscale are not required for owner access.
- `chicks.dev` is registered and currently served by Vercel Domains/DNS.
- Representative data lives under
  `/Users/chicks/dev/personal/astronomy/codex/astro/data`; the inspected sample
  is 140 GiB and processing is the dominant storage multiplier.
- This is a best-effort hobby service for friends. Overnight or total outages
  have no business impact and may wait until morning.
- Docker Compose is the preferred deployment and maintenance model.
- Moving authoritative `chicks.dev` DNS to Cloudflare is accepted.
- Friends may authenticate with Google or email OTP and should not need a
  Cloudflare account.
- Raw originals remain on Arch. Processing scratch is disposable; selected
  intermediates, previews, and finals publish to R2 and expire periodically.
- Final outputs also remain permanently on Arch after their R2 copies expire
  at 90 days.
- Authorized friends may download originals/FITS, intermediates, finals, and
  previews. Local-only originals stream directly on the LAN; remote requests
  reuse or create temporary private R2 staging copies.
- The MiniPC has a fixed DHCP reservation and is also expected to advertise as
  `ASTROPC` over mDNS. The fixed address should be the initial container config.
- `chicks-arch` has a Ryzen 7 3800X, 62 GiB RAM, about 875 GiB free NVMe, and
  an almost empty 2 TB SSD mounted at `/mnt/storage` with about 1.7 TiB free.
- Docker Engine 29.6.2 is enabled and active; the Compose plugin remains to be
  installed or verified.
- Initial retention is accepted: successful local scratch 7 days, R2
  previews/intermediates 30 days, R2 finals 90 days, and staged raws 48 hours.
- The version-matched web frontend will be served by Astro Console on Arch;
  separate Pages/Workers hosting is not required initially.
- Keep Vercel as registrar for now and move only authoritative DNS. Cloudflare
  DNS can hold future mail and personal-website records.
- Relocate Arch to the cooler basement and use wired Ethernet for deployment.
- One local copy of permanent raws and finals on `/mnt/storage` is accepted for
  the initial hobby deployment. A secondary backup is a future task, not a
  launch requirement.
- Continuum records a previously validated ASCOM Remote endpoint at
  `192.168.4.104:11111`, exposing Telescope 0 “ASI Mount” and Camera 0 “Sony
  Mirrorless Camera.” It was unreachable during the July 21 check and must be
  rediscovered when the MiniPC is powered.
- Gate 4 accepts one current service-owned processing history, stage-local
  retry checkpoints, source-preserving discard, multi-artifact Save to Library,
  and sanitized owner diagnostics. Infrastructure must persist those facts
  without exposing jobs or storage mechanics as the primary editing UX.

## 3. Remaining Owner Choices

1. When the MiniPC is next powered, does discovery still report
   `192.168.4.104:11111`, Telescope 0, and Camera 0, or has its reserved address
   or configured device inventory changed?

## 4. Measured Spikes Before Finalizing

- Verify every required MiniPC/ASCOM Remote endpoint from a Compose container,
  including whether broadcast discovery is necessary.
- Benchmark the existing Arch storage under capture plus processing; the
  representative capacity sample is already recorded.
- Test Cloudflare Access with the chosen event transport, identity claims,
  revocation, and a large explicit download.
- Cut WAN and tunnel independently; confirm local operation and honest remote
  status.
- Saturate processing under fake capture and tune Compose/cgroup limits.
- Test consistent SQLite backup/restore and a sample asset restore.

## 5. Deferred Until Evidence Demands It

- custom cloud relay or durable cloud observatory twin;
- hosted PostgreSQL or replicated database;
- Cloudflare Workers, D1, Durable Objects, or Pages in the live control path;
- Kubernetes, Nomad, or multi-host orchestration;
- automatic public serving of original evidence;
- active-active observatory service;
- multiple observatories per owner; and
- full phone control.
- secondary off-host backup of permanent raws and finals.
