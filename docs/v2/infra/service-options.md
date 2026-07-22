# Remote Access Service Options

## 1. Decision Summary

Use **Cloudflare Tunnel + Cloudflare Access** for the first friend-facing
remote deployment. Use the home LAN and physical Arch host for owner
administration; Tailscale is unnecessary. Do not build a VPS relay or custom
hub until measured limitations justify one.

This is a reversible choice because the observatory service exposes one
same-origin HTTP/streaming application and remains authoritative. The tunnel
must not leak Cloudflare-specific decisions into rig workflows or canonical
contracts.

## 2. Comparison

| Option | Browser experience | Identity | Origin exposure | Long streams | Large assets | Operational load | Fit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare Tunnel + Access | Stable custom HTTPS URL; no client install | Managed Access policy over IdP/OTP; app still owns roles | Outbound-only tunnel; no router port | WebSockets supported but reconnects are expected | Responses are not capped by the documented request-body limit; cacheability and uploads have plan limits | Low | **Recommended first public path** |
| Tailscale Serve + device sharing | Requires Tailscale client/account | Tailnet identity and ACLs | Private mesh, no public origin | Good private path | Suitable for remote admin | Low | Not needed while owner uses home LAN/local console |
| Tailscale Funnel | Public `ts.net` URL; no visitor client | Funnel itself is public; application must add auth | Outbound relay | Supported TCP proxy | Non-configurable bandwidth limits | Low | Useful for demos, not preferred product ingress |
| Small VPS + WireGuard/SSH reverse tunnel + Caddy | Stable custom HTTPS URL | Must deploy and operate OIDC/auth proxy | Outbound tunnel from rig, public VPS | Fully configurable | Fully configurable; VPS bandwidth/storage costs | Medium/high | Strong fallback when edge limits or policy become unacceptable |
| Custom cloud hub | Best tailored UX | Fully application-owned | Outbound typed connection | Designed for snapshots/events | Can split metadata/previews/assets intentionally | High | Later only for multiple observatories, offline presence, or durable cloud features |

## 3. Why Cloudflare First

Cloudflare Tunnel maps a public hostname to a local HTTP service through
outbound-only `cloudflared` connections. Cloudflare documents four persistent
connections across two data centers for a tunnel and supports additional
replicas. That removes inbound NAT/firewall work without inventing a bridge
protocol.

Cloudflare Access can protect the whole self-hosted hostname and allowlist
specific identities before traffic reaches the origin. The service must still:

- validate or cryptographically trust the Access application token;
- map the stable identity claim to an Astro Console member;
- distinguish `owner` and `viewer` membership;
- enforce phone read-only capability;
- enforce the exclusive control lease and expected revisions; and
- authorize each asset and command.

Access is admission, not domain authorization.

Friends do not need Cloudflare accounts. The selected application login
methods are Google and email OTP, restricted to explicitly allowlisted email
addresses. Disable the default Cloudflare-account IdP for this application.

The accepted snapshot-first reconnect model is a good fit for Tunnel. Cloudflare
notes that proxied long-lived connections can be interrupted when a tunnel
reconnects. V2 must already survive exactly that condition.

### Cloudflare Constraints To Design Around

- The owner accepted moving `chicks.dev` authoritative DNS to Cloudflare.
  Cloudflare Free/Pro
  supports proxying only with a full zone setup; partial CNAME setup that keeps
  Vercel authoritative requires Business or Enterprise.
- The practical hobby configuration is to keep Vercel as registrar, set the
  domain's custom nameservers to Cloudflare, and recreate all Vercel site,
  mail, verification, and other records in Cloudflare before cutover.
- A Vercel-DNS CNAME directly to `<UUID>.cfargotunnel.com` is not a supported
  shortcut: Cloudflare documents that a tunnel hostname proxies only for DNS
  records in the same Cloudflare account.

- Free and Pro zones document a 100 MB maximum **request** body. This matters
  for future uploads but is not a documented response-size cap. Do not design
  multi-hundred-megabyte uploads as one request.
- Free/Pro/Business cacheable files are limited to 512 MB. Original evidence
  should default to `Cache-Control: private, no-store`; downloads are explicit,
  authorized, range-capable where practical, and not dependent on CDN caching.
- Edge identity is unavailable on a direct LAN hostname. Local outage access
  therefore needs a separate, intentionally designed owner authentication
  path rather than a header bypass.
- Public HTTPS terminates at Cloudflare before traffic is proxied through the
  tunnel. Cloudflare can process public-path metadata, previews, and downloads;
  this privacy/vendor-trust tradeoff needs explicit owner acceptance.
- Edge logs on the free tier may be short-lived. Security/audit truth needed by
  the product remains local.
- The product depends on Cloudflare for public reachability, DNS, and login;
  it does not depend on it for local execution.

### Services Not Needed Initially

- **D1/KV/Durable Objects:** canonical observatory state remains local. A cloud
  copy creates split-brain and offline reconciliation problems.
- **Workers/Pages hosting:** the local service can serve the small,
  version-matched frontend and API. R2 carries bulk artifact delivery, so the
  Arch web origin is not the long-term download host.
- **R2 is selected:** use one private Standard-class bucket for explicitly
  published previews, intermediates, finals, and temporary staged raws.
  Lifecycle expiration and short-lived presigned URLs keep it outside live
  control and canonical evidence paths.
- **Load Balancer:** two cloudflared connectors on one physical host do not make
  the observatory highly available. Add only if a second host/path exists.

## 4. Why Tailscale Is Not In The Initial Deployment

Tailscale Serve remains a reasonable future private owner path for SSH or
diagnostics away from home. It is not needed for the stated workflow: the Arch
box is in the owner's house, available over the LAN and by physical access.
Adding Tailscale now would create another identity, network, and update surface
without solving a requirement.

Funnel is less suitable here because its URL is reachable by anyone and its
traffic has non-configurable bandwidth limits. Adding application auth would
duplicate the problem Access already solves. Tailscale documents that Funnel's
relay cannot decrypt the tunneled payload, which is a privacy advantage, but it
does not supply the desired named-user browser admission by itself.

If remote administration is added later, Tailscale must not grant ordinary
viewers access to raw Alpaca/Seestar endpoints or the rig LAN. Administrative
ACLs remain separate from product membership.

## 5. When To Move To A VPS Or Hub

Revisit the decision only after measuring one or more of these:

- persistent stream churn materially harms usability despite correct
  snapshot reconnect;
- original-frame delivery is too slow or expensive;
- Cloudflare policy, pricing, identity, or privacy is unacceptable;
- the application needs a useful offline public status page;
- more than one observatory must appear under one account;
- remote notifications or durable cloud history must work while the rig is
  offline; or
- the public service needs server-originated workflows independent of a
  connected observatory.

A VPS reverse proxy is the next smallest step. A custom typed hub is justified
only after the VPS/tunnel path proves the missing behavior is application
semantics rather than networking.
