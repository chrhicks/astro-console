# Astro Console V2 — Start Here

Status: **Gate 7 and Phase 0.5 accepted; Phase 1 local-web and host-verification bundle complete; complexity audit next**

This directory is organized to keep normal working context small. Do not read
the entire V2 tree by default.

## Default Reading Set

Read these in order when starting or resuming V2 work:

1. [UX and design guidance](ux-design-guidance.md) — durable product and design
   rules accepted through Gate 4.
2. [Current handoff](current/handoff.md) — completed evidence and honest
   deferred boundaries.
3. [Phase 1 complexity audit](current/phase-1-complexity-audit.md) — the
   bounded next review, before any further implementation.

That is the complete default context. Load another document only when the task
requires its specific detail.

## Load On Demand

| Need | Read |
| --- | --- |
| Workspace behavior or product entities | [Current product specification](current/product-spec.md) |
| Why a completed convergence decision was made | [Phase 1 foundation archive](archive/phase-1-foundation/README.md) |
| Accepted Gate 5 scenarios and ownership | [Gate 5 baseline](current/gate-05-scenarios.md) |
| Accepted Gate 5 consequential actions | [Gate 5 action map](current/gate-05-action-map.md) |
| Accepted canonical Gate 5 contract language | [Gate 5 contract vocabulary](current/gate-05-contract-vocabulary.md) |
| Executable Effect Schema candidates and fixtures | [V2 contracts package](../../packages/v2-contracts/README.md) |
| Phase 1 implementation scope and exit criteria | [Phase 1 closeout](current/delivery-plan.md); detailed narrative is archived |
| Phase 1 production UI implementation | Accepted [visual style guide](current/visual-style-guide.md), [UI component library](current/ui-component-library.md), and [UI build contract](current/ui-build-contract.md) |
| Why Phase 0.5 made a specific visual decision | [Phase 0.5 design-system archive](archive/phase-0.5/README.md) — historical only; do not use for active implementation authority |
| Accepted interaction evidence or candidate contracts | The relevant document under [accepted gates](gates/README.md) |
| Deployment, Cloudflare, storage, security, or operations | [Infrastructure plan](infra/README.md), then only its relevant section |
| Visual interaction evidence | [Accepted prototype references](../../prototype/v2-ui/index.html) |
| Why an older option was rejected | [Documentation archive](archive/README.md) or [prototype archive](../../prototype/v2-ui/archive/index.html) |

## Current Position

Gates 1–5 are accepted, Gate 6 technical spikes are complete, Gate 7 has
frozen the V2 reference, and Phase 0.5 has issued the accepted Phase 1 visual
implementation authorities:

1. Composite workspace model.
2. Acquire evidence workflows.
3. Run mutation, reconnect, and control ownership.
4. Process workspace.
5. Contract harness and deterministic future-server proofs.

Gate 5 was reopened and hardened after a future-server walkthrough found that
several passing fixtures proved only schema shape or a partial workflow. The
completed regrade is recorded in the
[server-perspective audit](current/gate-05-server-audit.md). The accepted
[Gate 7 walkthrough and decision log](archive/phase-1-foundation/gate-07-walkthrough.md) freezes
the selected V2 reference.

Phase 1 now has its local-web and host-verification evidence recorded. The
next activity is a deletion-oriented complexity audit; it does not reopen the
accepted product model or authorize new features.

## Context Rules

- `current/` contains active product, delivery, handoff, contract, and visual
  implementation material.
- `gates/` contains accepted decision evidence. Consult one gate at a time.
- `infra/` is the current infrastructure reference, but infrastructure is
  loaded only for decisions that cross that boundary.
- `archive/` preserves superseded plans, handoffs, and explorations. Archived
  material is non-authoritative and never part of broad default context.
- `prototype/v2-ui/` exposes accepted visual references. Its `archive/`
  contains rejected alternatives and earlier studies.
- Accepted gate decisions may be revisited only when new evidence conflicts
  with a product invariant—not for copy polish or implementation convenience.

## Product Thesis

V2 is a web-first personal observatory workspace over a durable rig-local
service. It helps an operator decide what to observe, acquire it safely,
evaluate the evidence, and develop the result. The interface answers:

1. What is the observatory doing, and is it healthy?
2. What decision or intervention is useful now?
3. What evidence explains that recommendation?

Information density is expected. Equal visual weight is not.
