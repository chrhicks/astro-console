# Phase 1 Backend and Infrastructure Readiness Handoff

Status: **Phase 1 host-verification bundle complete — 2026-07-29**

## Completed Host-Verification Bundle

The published M13 linear-master FITS was refreshed with R2 attachment metadata,
then downloaded successfully through a fresh five-minute private-R2 link. The
browser saved the FITS instead of rendering its raw bytes. The signed bearer
URL exists only in the redirect, never in a browser JSON projection.

Corrected download deployment, current rig-worker liveness, and scheduled SSD
backup with restore drill are all verified. No Solar capture or device command
was issued during this bundle.

## Next: Complexity Audit

The next bounded activity is the
[Phase 1 complexity audit](phase-1-complexity-audit.md). It is a
deletion-oriented review of code, deployment, tests, and active documentation;
it does not reopen accepted V2 product semantics or authorize new features.

The user accepts NVMe live/recent data plus the SSD backup as current
same-host resilience. Off-host recovery is not current Phase 1 scope.

## Verified Baseline

- `apps/v2-local-web` type checks and its SQLite/HTTP/SSE/worker/filesystem
  integration suite pass **58/58**. The suite covers the retained local-web
  foundation, Process Save/publisher boundary, and the deterministic M27
  fixture without creating generic hardware work.
- Process Save is a service API only: app-owned source IDs resolve under
  configured roots, selected bytes are checksummed and atomically promoted,
  and Asset/provenance/receipt/`PublishAsset` records commit together. Recorded
  promoted-output orphans are bounded cleanup candidates; disk operations
  otherwise remain `unknown` and no storage-health workflow is deployed.
- The one-shot manifest processor is separate evidence tooling, not origin
  configuration or an active workflow. It proved one existing M13 source and
  linear master can become checksum- and lineage-backed SSD originals/finals.
- The publisher streams and checksum-verifies the known file, projects only
  provider-verified R2 publication, and is isolated from public, tunnel, and
  rig credentials. The M13 simulation proved one real private-R2 upload and
  HEAD verification; it was not fresh capture or live image processing.
- Origin and publisher run `eceab25`: an admitted published Asset ID produces
  one five-minute private-R2 redirect, whose attachment metadata made the
  owner's M13 browser request download rather than render the FITS. The signed
  URL is not projected or persisted.
- The schema-compatible rig worker durably reports `alive` / `ready`, with no
  Solar work pending. The enabled backup timer has one checksum-backed SSD run
  and disposable restore drill. These prove liveness and same-host resilience,
  never physical capture or off-host recovery.

The [host-verification record](../archive/handoffs/phase-1-host-verification-2026-07-29.md)
preserves the completed chronology and detailed test evidence. It is historical;
this handoff is the active authority.

## Remaining Backend and Infrastructure Boundaries

| Boundary | Current state | Required proof |
| --- | --- | --- |
| Process Save and permanent local output | One-shot manifest processor ingested an existing M13 LIGHT original and distinct Siril linear master into SSD originals/finals with lineage and checksum proof | Keep processor one-shot/least-privilege; later processing workflow needs a separately authorized product slice. |
| Publication worker and private R2 | M13 linear master real PUT plus provider HEAD checksum/byte verification observed; durable projection is `published` | Controlled recovery drill under normal load. |
| Downloads | Streamlined origin and publisher from `eceab25` are deployed. The M13 object has verified attachment metadata and its fresh private-R2 URL downloaded successfully in the browser. | No further Phase 1 proof. Future outputs receive attachment metadata at publication. |
| Storage health and cleanup | Process Save containment and recorded-orphan cleanup are locally proven; operations disk is `unknown` | Authorize a separate storage-health workflow before adding thresholds, capture admission, or scratch cleanup. |
| Rig-worker liveness | Schema-compatible worker is running and durably `alive` / `ready`; no Solar work was pending. | No further Phase 1 proof. This remains liveness only, never capture proof. |
| Same-host resilience | Enabled SSD backup timer has a successful 2026-07-29 run with checksum and disposable restore-drill evidence. | No further Phase 1 proof. This is the accepted current resilience scope. |
| Off-host recovery | Not current scope | Revisit only if the user changes the current NVMe-plus-SSD resilience decision. |
| Device/session presence | Person-to-client fixture | Stable production client/session authority before treating a person's browsers as distinct presence clients. |
| Processing deployment | Compose placeholder absent by design | Separate least-privilege processor/publisher lifecycles, bounded resources, and no rig/tunnel credentials. |

## Scope and Authority

- The accepted V2 UX, run authority, and service-owned truth remain frozen.
  This packet changes no workspace semantics.
- Rig-worker liveness is not an active Solar or physical-run instruction.
- Cloudflare Access remains identity admission. The service still owns durable
  membership, capability, lease, revision, idempotency, safety, and artifact
  authorization checks.
- R2 is a private artifact/delivery store, never canonical run state or the
  sole copy of original evidence.
- This handoff authorizes no off-host recovery work, new browser controls, or
  processing-workflow implementation.

## Read First

1. [V2 Start Here](../README.md)
2. [Phase 1 closeout](delivery-plan.md)
3. [Infrastructure plan](../infra/README.md)
