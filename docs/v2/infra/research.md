# Infrastructure Research Sources

Checked July 21, 2026. Service capabilities, limits, and prices can change;
re-check these sources before deployment or purchase.

## Cloudflare

- [Cloudflare Tunnel overview](https://developers.cloudflare.com/tunnel/):
  outbound-only connector, public hostname routing, supported protocols, and
  connector redundancy.
- [Cloudflare connection-method comparison](https://developers.cloudflare.com/learning-paths/replace-vpn/connect-private-network/connection-methods/):
  Tunnel is an L7 proxy and long-lived proxied connections may be interrupted
  when `cloudflared` reconnects.
- [Cloudflare Access self-hosted web applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/):
  identity-aware proxy behavior for public and private applications.
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/):
  allow/block/service-auth behavior and warnings about bypass/everyone rules.
- [Validate Cloudflare Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/):
  `Cf-Access-Jwt-Assertion`, issuer, and rotating signing keys.
- [Cloudflare cache and upload limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/):
  plan-specific request-body and cacheable-file limits.
- [Cloudflare Tunnel configuration](https://developers.cloudflare.com/tunnel/configuration/):
  required outbound ports and Access validation connectivity.
- [Cloudflare Tunnel troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/):
  WebSocket and origin TLS failure modes.
- [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/):
  tunnel CNAME records and the requirement that proxying records belong to the
  same Cloudflare account.
- [Cloudflare DNS zone setups](https://developers.cloudflare.com/dns/zone-setups/):
  Free/Pro full authoritative setup versus paid partial CNAME setup.
- [Cloudflare partial CNAME setup](https://developers.cloudflare.com/dns/zone-setups/partial-setup/):
  keeping another authoritative DNS provider requires Business or Enterprise.
- [Cloudflare Access Google identity provider](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/):
  Google login works without requiring Google Workspace; policy still controls
  which Google identities are admitted.
- [Cloudflare Access email one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/):
  emailed codes can coexist with other identity providers and must be paired
  with an explicit allow policy.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/): Standard storage,
  operation classes, free tier, and no internet egress charge.
- [R2 object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/):
  prefix-based asynchronous expiration.
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/):
  private S3 API operations with time-limited bearer URLs.
- [R2 limits](https://developers.cloudflare.com/r2/platform/limits/): object,
  multipart, bucket, and account limits.
- [R2 bindings in Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/):
  optional future authenticated custom-hostname download gateway.

## Vercel Domains

- [Vercel nameserver management](https://vercel.com/docs/domains/working-with-nameservers):
  Vercel-registered domains support custom nameservers, allowing Cloudflare to
  become authoritative while Vercel remains registrar.
- [Vercel custom-domain configuration](https://vercel.com/docs/domains/working-with-domains/add-a-domain):
  Vercel-hosted projects can use externally managed DNS records.

## Tailscale

- [Tailscale Funnel versus device sharing](https://tailscale.com/docs/reference/funnel-vs-sharing):
  public resource versus named-user device sharing.
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel):
  public URL behavior, allowed ports, beta status, and non-configurable
  bandwidth limits.
- [Tailscale Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel):
  reverse-proxy behavior and relationship to private Serve.

## Local Persistence

- [SQLite write-ahead logging](https://sqlite.org/wal.html): concurrency,
  checkpointing, WAL recovery, and the same-host/no-network-filesystem rule.
- [SQLite Online Backup API](https://sqlite.org/backup.html): consistent live
  database snapshots without a naive file copy.

## Docker Compose

- [Docker Compose networking](https://docs.docker.com/compose/how-tos/networking/):
  bridge isolation, service discovery, explicit networks, and the broad access
  granted by host networking.
- [Docker Compose service reference](https://docs.docker.com/reference/compose-file/services/):
  port-binding behavior, health checks, resource fields, and secret mounts.
- [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/):
  daemon restart behavior and the warning against conflicting supervisors.
- [Docker Compose secrets](https://docs.docker.com/reference/compose-file/secrets/):
  granting file- or environment-backed secrets only to selected services.

## Sources To Add After Owner Decisions

After the remaining owner choices, add primary documentation for:

- the selected Arch/Docker installation and update procedure;
- the chosen backup tool and repository target;
- filesystem/RAID/snapshot behavior;
- the Arch Docker Compose plugin installation path; and
- any Windows ASCOM Remote/Alpaca bridge that remains in the rig path.
