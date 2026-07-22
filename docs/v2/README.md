# V2 Product And UI Plan

Status: proposed direction, not current behavior  
Captured: July 20, 2026

V2 rethinks Astro Console from first principles. The current Electron
application is a useful hardware and workflow proving ground, but its single
three-column view no longer fits the product that is emerging. V2 is a
web-first personal observatory service with freely switchable workspaces over
a durable observing engine.

These documents intentionally live outside the current product and
architecture documentation. Nothing under `docs/v2/` should be read as a
claim about the current application.

## Plan Set

- [Interactive prototype hub](../../prototype/v2-ui/index.html) is the entry
  point for competing Plan and Observe interfaces, domain-model studies,
  architecture studies, and prior prototype evidence. See its
  [local serve instructions](../../prototype/v2-ui/README.md).
- [Acquire gate study](acquire-gate.md) defines the evidence, policy,
  backend-facing model, and exit criteria tested by the standalone target
  centering and polar-alignment prototype.
- [Run authority gate study](run-authority-gate.md) is the accepted reference
  for revision-aware plan mutation, reconnect reconstruction, presence,
  exclusive control, and read-only phone behavior.
- [Process gate study](process-gate.md) is the accepted Gate 4 iteration 3
  reference for
  a visual Build/Develop workspace, one linear edit history, tool-specific
  controls, reference comparison, stage-local recovery, and saving related
  artifacts to Library.
- [UX and design guidance](ux-design-guidance.md) is the concise accepted
  Gates 1–4 authority for workspace boundaries, hierarchy, language, state,
  responsive behavior, and prototype quality.
- [Gate 3 session handoff](gate-3-handoff.md) is the durable continuation point
  for accepted Gates 1–3 decisions, walkthrough lessons, repository state, and
  the single next action.
- [Gate 4 session handoff](gate-4-handoff.md) is the durable continuation point
  for the accepted Process model and the bounded Gate 5 contract-harness start.
- [UI and workspace plan](ui-plan.md) defines the product model, global shell,
  workspaces, observing phases, responsive behavior, and interaction rules.
- [Web architecture](web-architecture.md) defines the proposed local service,
  browser clients, remote sharing topology, authentication, and Electron
  migration boundary.
- [Infrastructure plan](infra/README.md) turns that topology into deployable
  requirements, evaluates managed ingress options, and recommends an
  operations and security baseline for the rig-local Linux host.
- [Prototype plan](prototype-plan.md) defines how V2 will test competing UX
  ideas, converge on canonical frontend/backend models, and retire technical
  and operational unknowns before implementation hardens them.
- [Delivery plan](delivery-plan.md) turns the direction into staged work and
  maps the existing P50 backlog into the V2 model.

## Confirmed Direction

- Start the V2 UI over rather than incrementally adapting the current shell.
- Replace Electron as the product architecture with a web application served
  by an Astro Console service near the equipment.
- Preserve proven rig adapters, Effect workflows, capture behavior, storage,
  and domain logic when their boundaries remain useful.
- Organize the application around `Plan`, `Observe`, `Library`, and `Process`
  workspaces.
- Treat `Preflight`, `Acquire`, `Capture`, `Verify`, `Recover`, and `Complete`
  as phases of an active run, not as peer navigation destinations.
- Allow workspace changes at any time. Observing continues independently of
  the visible page, browser, or client.
- Make the active run globally visible through a compact activity surface.
- Support future remote sharing through a rig-local service and a remotely
  reachable web entry point.
- Make the first phone experience read-only and optimized for checking status.
- Use a managed identity provider for social, passwordless, or passkey login;
  do not build or store a local password system.
- Keep security proportionate to a personal project shared with a few trusted
  people.
- Defer product naming until the ideation phase has settled the product
  identity. `Astro Console` is a working name in these documents, not a V2
  naming decision.
- Use prototypes as decision tools before committing the V2 implementation.
  Prototype interaction, domain ownership, and operational behavior together;
  do not treat static mockups as sufficient validation.

## Product Thesis

V2 is not primarily a device control panel. It is a personal observatory
workspace that helps an operator decide what to observe, safely acquire it,
collect evidence, judge the result, and improve it through reproducible
processing.

The interface should answer three questions in order:

1. What is the observatory doing, and is it healthy?
2. What decision or intervention is useful now?
3. What evidence explains that recommendation?

Information density is expected. Equal visual weight is not.

## Non-Goals

- Preserve the current pane layout for familiarity.
- Preserve Electron-specific IPC or preload contracts.
- Build a commercial multi-tenant observatory platform.
- Add enterprise roles, policy systems, or compliance infrastructure.
- Give the initial phone layout full control capability.
- Claim automatic mechanical polar-axis adjustment when the mount lacks
  motorized altitude and azimuth adjustment.
- Select a final product name during UI planning.
