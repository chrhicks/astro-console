# Astro Console V2 — Start Here

Status: **V2.0 complete; V2.1 Phases 1–4 complete; configured Phase 5 Acquire prepared and simulator-proven; Nightbook routes promoted locally; Processing Project lifecycle, shared protocol, origin runtime, and Nightbook workspace runtime refactors complete locally**

Keep normal working context small. Do not read the complete V2 tree.

## Default Reading Set

Read these in order when starting or resuming V2 work:

1. [Current handoff](current/handoff.md) — current status, proof boundary, and
   next owner action.
2. [Current delivery plan](current/delivery-plan.md) — accepted V2.1 work and
   remaining phase boundary.

That is the default context. Load another document only when the task needs its
specific detail.

## Load On Demand

| Need                                                      | Read                                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI or UX work, beta alignment, or route promotion         | [Current UI and UX direction](current/ui-ux.md), then the local web routes and states it names                                                            |
| Accepted beta real-runtime delivery or Alpaca simulation  | [Nightbook beta real-runtime plan](current/beta-real-runtime-plan.md)                                                                                     |
| Explicit Process workflow and Item 3.5 delivery           | [Item 3.5 Process workflow plan](current/process-workflow-plan.md)                                                                                        |
| Workspace behavior or product entities                    | [Current product specification](current/product-spec.md); use it for domain truth, not visual composition                                                 |
| Accepted Gate 5 scenarios and ownership                   | [Gate 5 baseline](current/gate-05-scenarios.md)                                                                                                           |
| Accepted non-Process consequential actions                | [Gate 5 action map](current/gate-05-action-map.md); its Process rows are a superseded historical baseline                                                 |
| Accepted non-Process contract language                    | [Gate 5 contract vocabulary](current/gate-05-contract-vocabulary.md); use the current Process documents above                                             |
| HTTP and SSE wire schemas                                 | [Shared protocol module](../../packages/protocol/README.md)                                                                                               |
| Accepted interaction or ownership evidence                | One relevant document under [accepted gates](gates/README.md); gate documents are product/domain evidence, not current implementation or visual authority |
| Deployment, Cloudflare, storage, security, or operations  | [Infrastructure plan](infra/README.md), then only its relevant section                                                                                    |
| Completed plans, former UI authority, or rejected options | [Documentation archive](archive/README.md) or Git history                                                                                                 |
| Ideas outside current delivery                            | [Post-V2.0 notes](current/v2-post-v2.0-notes.md)                                                                                                          |

## Current Position

V2 provides a rig-local service and web workspaces for Plan, Observe, Library,
and Process. V2.0 delivery is complete. V2.1 Phases 1–4 provide one configured
Alpaca rig boundary, bounded camera exposure and abort, immutable original
Library intake, and local solve evidence. Phase 5 now includes a configured
Alpaca target provider and local-solver path behind durable Acquire. The
live-shaped path is proven through the simulator from target slew through
correction, verification, modest capture, and Library handoff. The remaining
Phase 5 work is owner-observed live provider and physical outdoor proof.

The official presentation is the app-private UI implementation under
`apps/web/src/components/ui` and its composition in the Plan, Observe, Library,
and Process workspaces. The former presentation and borrowed `@nightbook/ui`
package seam have been removed. Normal workspace routes render this local
presentation directly.

Process now has one explicit, project-ID-addressed Processing Project
lifecycle. Its deep service interface owns Project authority, revisions,
semantic intent receipts, drafts, immutable attempts, Current Result history,
work claims, settlement, evidence, and Library save lineage. The former
Processing Session contracts, projections, tables, APIs, and test data are
retired. Current proof uses the deterministic local materializer; a real
processing library adapter remains intentionally deferred.

## Context Rules

- `current/` contains only live product, delivery, handoff, contract, and UI
  direction.
- `gates/` contains accepted product and ownership evidence. Consult one gate
  at a time; do not use its former harness structure as current implementation
  authority or its prototype composition as visual authority.
- `infra/` is loaded only for work that crosses that boundary.
- `archive/` preserves superseded plans, handoffs, visual systems, UX catalogs,
  and explorations. It is historical and non-authoritative.
- Product and service invariants still apply to the new UI. Old Astro Console
  visual rules, component grammar, and screenshots do not.

## Product Thesis

V2 is a web-first personal observatory workspace over a durable rig-local
service. It helps an operator decide what to observe, acquire it, evaluate the
evidence, and develop the result. The interface should answer:

1. What is the observatory doing, and is it healthy?
2. What decision or intervention is useful now?
3. What evidence explains that recommendation?
