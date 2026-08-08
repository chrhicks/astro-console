# V2 Current Handoff

Status: **V2.0 complete; V2.1 Phase 4 complete; Nightbook UI migration is the next product-facing preparation**

## Current Position

Astro Console provides a rig-local service and web workspaces for Plan,
Observe, Library, and Process. V2.0 includes remote viewing, bounded shared
desktop control, durable service-owned state, and reconnect behavior. V2.1
Phases 1–4 add one configured Alpaca rig boundary, bounded camera exposure and
abort, immutable original intake, and local solve evidence.

The existing workspace presentation remains the default route. It is retained
only until the newer beta presentation is ready to replace it; its local visual
system and component grammar are no longer UI authority.

## UI Direction

The official UI and UX reference is the composed React demo in:

`/Users/chicks/dev/personal/kimi_workspace/nightbook-prototype/apps/nightbook-demo`

The same workspace owns the `@nightbook/ui` source, component Gallery, and
package verification. Astro Console's `?ui=beta` workspaces are a high-level
integration pass that validated the package and supplied feedback. They are not
the source design authority.

The desired outcome is to align the beta with real Astro Console projections
and then promote it as the main UI. Follow the lightweight
[UI and UX direction](ui-ux.md). Former Astro Console visual guides, UX
catalogs, component grammar, and Phase 0.5 material are archived.

## Known Beta Alignment Gaps

1. Process needs service-owned per-action eligibility and typed denial reasons.
2. Process-created Library outputs need complete asset-detail projections.
3. Unfinished Process sessions need a deterministic restart-to-resume journey.

Do not hide these gaps with client fixtures, inferred eligibility, or
Astro Console-specific logic inside `@nightbook/ui`.

## Proof Boundary

Completed evidence covers local contracts, service behavior, SQLite/HTTP/SSE,
browser presentation, the opt-in beta integration, remote ingress and control,
one isolated real camera-original intake, and local solve-only evidence. It does
not prove beta route promotion, production deployment of the beta, mount
movement, production processing tools, or physical image quality.

## Next Action

Use one exact Nightbook demo workflow at a time to prepare the projection and
integration plan. Start with the three known alignment gaps, then compare every
workspace against the current demo before requesting main-route promotion.

Completed chronology and former authority are indexed in the
[documentation archive](../archive/README.md).
