# Astro Console V2 — Start Here

Status: **Phases 0, 0.5, 1, 2, 3, 4, and 5 are complete with deterministic local proof**

This directory is organized to keep normal working context small. Do not read
the entire V2 tree by default.

## Default Reading Set

Read these in order when starting or resuming V2 work:

1. [UX and design guidance](ux-design-guidance.md) — durable product and design
   rules accepted through Gate 4.
2. [Current handoff](current/handoff.md) — completed evidence and honest
   deferred boundaries.
3. [V2 delivery plan](current/delivery-plan.md) — durable end-to-end V2.0
   scope and phase exit criteria.
4. [Phase 5 planning](current/phase-5-planning.md) — prepared delivery order
   and Process proof boundary.

That is the complete default context. Load another document only when the task
requires its specific detail.

## Load On Demand

| Need                                                     | Read                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace behavior or product entities                   | [Current product specification](current/product-spec.md)                                                                                                                                                                                         |
| Why a completed convergence decision was made            | [Phase 1 foundation archive](archive/phase-1-foundation/README.md)                                                                                                                                                                               |
| Accepted Gate 5 scenarios and ownership                  | [Gate 5 baseline](current/gate-05-scenarios.md)                                                                                                                                                                                                  |
| Accepted Gate 5 consequential actions                    | [Gate 5 action map](current/gate-05-action-map.md)                                                                                                                                                                                               |
| Accepted canonical Gate 5 contract language              | [Gate 5 contract vocabulary](current/gate-05-contract-vocabulary.md)                                                                                                                                                                             |
| Executable Effect Schema candidates and fixtures         | [V2 contracts package](../../packages/v2-contracts/README.md)                                                                                                                                                                                    |
| End-to-end V2.0 scope, phases, and exit criteria         | [V2 delivery plan](current/delivery-plan.md)                                                                                                                                                                                                     |
| Completed Phase 2 execution history                      | [Phase 2 implementation plan archive](archive/plans/phase-2-implementation-plan-2026-08-04.md)                                                                                                                                                  |
| Completed Phase 3 execution history                      | [Phase 3 archive](archive/phase-3/README.md)                                                                                                                                                                                                      |
| Ideas outside V2.0                                       | [Post-V2.0 notes](current/v2-post-v2.0-notes.md)                                                                                                                                                                                                 |
| Production UI visual implementation                      | `apps/web` source and CSS, the owner-corrected [visual style guide](current/visual-style-guide.md), [UI component library](current/ui-component-library.md), [UI build contract](current/ui-build-contract.md), and accepted screenshot evidence |
| Why Phase 0.5 made a specific visual decision            | [Phase 0.5 design-system archive](archive/phase-0.5/README.md) — historical only; do not use for active implementation authority                                                                                                                 |
| Accepted interaction evidence or candidate contracts     | The relevant document under [accepted gates](gates/README.md)                                                                                                                                                                                    |
| Deployment, Cloudflare, storage, security, or operations | [Infrastructure plan](infra/README.md), then only its relevant section                                                                                                                                                                           |
| Historical visual interaction evidence                   | [Accepted prototype references](../../prototype/v2-ui/index.html)                                                                                                                                                                                |
| Why an older option was rejected                         | [Documentation archive](archive/README.md) or [prototype archive](../../prototype/v2-ui/archive/index.html)                                                                                                                                      |

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

Phase 1 is closed: the local-web and host-verification evidence are recorded,
and the branch-wide quality regression has landed its bounded fixes. Phase 2
(Plan and Managed Runs) is also closed with fake-only managed-run evidence.
Production Convergence has promoted that infrastructure and the accepted
Nightbook UI into `apps/server` and `apps/web`. All five sequential Continuum
Epics, `tkt-ezxr1fsb`, `tkt-n9yoieoz`, `tkt-uuom4upo`, `tkt-qffwfa47`, and
`tkt-zcsucxyx`, are complete. The final production architecture serves the
version-matched web bundle from the rig-local server origin and has migrated
the Plan, fake managed-run Observe, Library delivery, and current Process
handoff boundaries while retiring experimental runtime paths.
Phase 3 (Observe, Acquire, and Capture) and Phase 4 (Library and Frame Review)
are complete with deterministic local
proof. Its opt-in Alpaca preflight adapter makes only declared GET reads; its
Acquire and Capture workflows persist server-owned evidence, actions, and
recovery truth. A real rig has not yet been contacted. Phase 4 Library and
Frame Review now provides immutable captured-frame intake, inspection, durable
review, comparison, and Observe handoff with local deterministic proof. Phase 5
Process Workspace implementation is authorized. Work begins with the durable
Library-to-Process session entry slice.

`apps/web` source, CSS, and accepted screenshot evidence are the production
visual authority. `docs/v2-ui-final` and `prototype/v2-ui` are historical Gate
and design evidence, not runtime implementation authority.

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
