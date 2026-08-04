# Phase 4 Planning — Library and Frame Review

Status: **complete with deterministic local proof on 2026-08-04**

## Outcome

Phase 4 turns captured evidence into durable, inspectable Library records. The operator can judge each frame, understand the automated assessment, retain a durable review decision without changing the original evidence, compare saved frames, and find the current frame from Observe.

This plan delivers deterministic local proof only. It does not contact a real camera, mount, provider, or storage device, and it does not claim physical capture. Phase 5 Process remains separate.

## Accepted Contract Boundary

The current Library boundary is intentionally smaller than Phase 4: it provides catalog/detail metadata, download availability, and an `Open in Process` handoff. Phase 3 records live-frame facts in the Acquire aggregate, but it does not materialize image bytes as Library assets. The following addition is needed before implementation:

1. A server-owned capture-to-immutable-asset intake port that records original bytes, checksum, capture settings, and run/sequence/acquisition lineage.
2. An inspection projection for preview representations, pixel facts, quality metrics, metric provenance, and the automated acceptance or rejection rationale.
3. A separate durable `AssetReview` record for manual accept, reject, rating, and annotation. It must not mutate original bytes or acquisition evidence.

The Library Asset remains the durable identity and lineage owner. Comparison selection is transient browser presentation state, not a new durable object. Server commands and review state remain revision-guarded and idempotent; the server publishes authoritative SQLite/HTTP/SSE projections.

The owner approved this boundary on 2026-08-04. `packages/v2-contracts`, the
SQLite schema, and runtime behavior may now change within this plan. That
authorization does not establish provider, device, or physical-capture proof.

## Delivery Graph

Continuum Epic: `tkt-jnzkma5n`.

1. `tkt-pqdp54ak` — complete: confirm the asset and review boundary; write the exact implementation packet and obtain owner confirmation.
2. `tkt-kh5n3vax` — complete: materialize immutable captured frames into Library with checksum, lineage, receipts, recovery truth, and projection.
3. `tkt-aeugibuw` — complete: generate deterministic inspection previews and quality facts from persisted originals.
4. `tkt-k31mluvh` — complete: deliver Library inspect, compare, and durable review decisions with owner/viewer/phone capability truth.
5. `tkt-4xqdzp1s` — complete: add compact current-frame review to Observe without duplicating historical Library browsing.
6. `tkt-fnu9x8gb` — complete: prove the full deterministic path, bounded catalog use, restart/reconnect behavior, and responsive evidence.

Each child begins only after its stated blocker completes. UI children require functional route/state evidence and a separate Designer review at wide, compact, and 390 px phone layouts. Phone remains read-only.

## Focused Proof

The final deterministic scenario is:

```text
captured bytes -> immutable asset + lineage -> preview/metrics + rationale
-> durable review -> Library comparison -> Observe live-review handoff
-> reload/restart/reconnect
```

It must prove original immutability, typed failures, idempotency, SQLite persistence, authoritative HTTP/SSE projections, and bounded Library paging. It does not prove a real capture, plate solve, file-system location on a live rig, provider acknowledgement, or physical image quality.

## Closeout Evidence

The deterministic chain, live-frame-library fixture, and responsive Designer
review are complete. Validation passed: contracts **186/186**, server
**79/79**, and web **63/63**, with server and web production builds and
`git diff --check`. Designer passed the available Observe-to-Library handoff at
wide, compact, and 390 px with no P0/P1 findings. This is local deterministic
service and browser proof only; no provider, device, or physical capture was
contacted.
