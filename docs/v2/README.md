# Astro Console V2 — Start Here

Status: **V2.0 complete; V2.1 Phases 1–4 complete; configured Phase 5 Acquire prepared and simulator-proven; Process execution complete; Item 3.5.1 next**

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

| Need                                                      | Read                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| UI or UX work, beta alignment, or route promotion         | [Current UI and UX direction](current/ui-ux.md), then the external Nightbook demo it names                   |
| Accepted beta real-runtime delivery or Alpaca simulation  | [Nightbook beta real-runtime plan](current/beta-real-runtime-plan.md)                                        |
| Explicit Process workflow and Item 3.5 delivery           | [Item 3.5 Process workflow plan](current/process-workflow-plan.md)                                           |
| Workspace behavior or product entities                    | [Current product specification](current/product-spec.md); use it for domain truth, not visual composition    |
| Accepted Gate 5 scenarios and ownership                   | [Gate 5 baseline](current/gate-05-scenarios.md)                                                              |
| Accepted consequential actions                            | [Gate 5 action map](current/gate-05-action-map.md)                                                           |
| Accepted contract language                                | [Gate 5 contract vocabulary](current/gate-05-contract-vocabulary.md)                                         |
| Executable schemas and fixtures                           | [V2 contracts package](../../packages/v2-contracts/README.md)                                                |
| Accepted interaction or ownership evidence                | One relevant document under [accepted gates](gates/README.md); gate layouts are not current visual authority |
| Deployment, Cloudflare, storage, security, or operations  | [Infrastructure plan](infra/README.md), then only its relevant section                                       |
| Completed plans, former UI authority, or rejected options | [Documentation archive](archive/README.md) or Git history                                                    |
| Ideas outside current delivery                            | [Post-V2.0 notes](current/v2-post-v2.0-notes.md)                                                             |

## Current Position

V2 provides a rig-local service and web workspaces for Plan, Observe, Library,
and Process. V2.0 delivery is complete. V2.1 Phases 1–4 provide one configured
Alpaca rig boundary, bounded camera exposure and abort, immutable original
Library intake, and local solve evidence. Phase 5 now includes a configured
Alpaca target provider and local-solver path behind durable Acquire. The
live-shaped path is proven through the simulator from target slew through
correction, verification, modest capture, and Library handoff. The remaining
Phase 5 work is owner-observed live provider and physical outdoor proof.

The official future presentation is the Nightbook React demo and
`@nightbook/ui` package in the external Nightbook workspace. Astro Console has
an opt-in `?ui=beta` integration for all four workspaces. It remains an
integration and feedback surface until projection alignment and explicit route
promotion are complete. Existing non-beta pages remain the default, but their
local visual system is not current design authority.

## Context Rules

- `current/` contains only live product, delivery, handoff, contract, and UI
  direction.
- `gates/` contains accepted product and ownership evidence. Consult one gate
  at a time; do not use its prototype composition as visual authority.
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
