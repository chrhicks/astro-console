# Astro Console V2 — Start Here

Status: **accepted product direction through Gate 4; not current application behavior**

This directory is organized to keep normal working context small. Do not read
the entire V2 tree by default.

## Default Reading Set

Read these in order when starting or resuming V2 work:

1. [UX and design guidance](ux-design-guidance.md) — durable product and design
   rules accepted through Gate 4.
2. [Current handoff](current/handoff.md) — current position, deferred choices,
   and the single next action.

That is the complete default context. Load another document only when the task
requires its specific detail.

## Load On Demand

| Need | Read |
| --- | --- |
| Workspace behavior or product entities | [Current product specification](current/product-spec.md) |
| Remaining prototype gates and stopping rules | [Current convergence plan](current/convergence-plan.md) |
| Implementation phases and backlog mapping | [Current delivery plan](current/delivery-plan.md) |
| Accepted interaction evidence or candidate contracts | The relevant document under [accepted gates](gates/README.md) |
| Deployment, Cloudflare, storage, security, or operations | [Infrastructure plan](infra/README.md), then only its relevant section |
| Visual interaction evidence | [Accepted prototype references](../../prototype/v2-ui/index.html) |
| Why an older option was rejected | [Documentation archive](archive/README.md) or [prototype archive](../../prototype/v2-ui/archive/index.html) |

## Current Position

Gates 1–4 are accepted:

1. Composite workspace model.
2. Acquire evidence workflows.
3. Run mutation, reconnect, and control ownership.
4. Process workspace.

Gate 5 is next: express accepted scenarios as canonical entities, Effect
Schema contract candidates, deterministic transitions, typed failures, and
UI-driving traces. Gate 5 should not redesign accepted workspace semantics.

## Context Rules

- `current/` contains active product, convergence, delivery, and handoff
  material.
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
