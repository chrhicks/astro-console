# Astro Console V2 Delivery Plan

Status: **durable V2 completion roadmap — Phases 0, 0.5, 1, and 2 and Production Convergence complete; Phase 3 preflight is prepared, not accepted or implemented**

## Keep This Plan

This is the long-term, end-to-end plan for completing V2. It is an active
authority, **not** a handoff to replace, archive, or delete during routine
documentation cleanup. As work finishes, check off the relevant outcomes and
record its evidence in place; preserve the remaining phases and their exit
criteria.

Complete V2 with the smallest coherent implementation that delivers the
operator outcome. Do not add security theater, generalized hardening, or work
for unconfirmed possibilities. Record genuinely new ideas or concerns in the
[post-V2.0 notes](v2-post-v2.0-notes.md), then return to this plan. Work there
is not V2.0 scope unless this plan is explicitly amended.

## Delivery Strategy

V2 is built from the accepted product model outward, rather than reproducing
the Electron screen in a browser. Each phase is delivered as small vertical
slices, but every slice must advance a named outcome and exit criterion below.
UX and design are part of completion: follow the accepted UX guidance, preserve
semantic truth and service ownership, and validate wide desktop, compact
desktop, and the read-only phone projection for UI changes.

## Phase 0: Product, Prototype, and Contract Definition — Complete

Accepted gates established the workspace/run model, canonical ownership,
snapshot/event/error contracts, deterministic scenarios, and the frozen V2
reference. The authoritative design rules remain in
[UX and design guidance](../ux-design-guidance.md).

## Phase 0.5: Design-System Finalization — Complete

Phase 0.5 records remain historical semantic evidence. The active implementation
visual language and responsive/accessibility bar are the current visual guide,
component library, build contract, `apps/web` source and CSS, and accepted
screenshot evidence.

## Phase 1: Local Web Foundation — Complete

The local service/web foundation, durable SQLite state, snapshot-first SSE,
workspace projections, Process Save, private artifact delivery, same-host
backup/restore evidence, and rig-worker liveness are complete. The detailed
evidence and explicit proof boundaries are in the [current handoff](handoff.md).

## Phase 2: Plan and Managed Runs — Complete

### Outcomes

- Build multi-sequence observing plans.
- Show observing windows, altitude, horizon clearance, usable time, and storage
  forecast.
- Validate capability and readiness requirements.
- Start an immutable `RunDefinition` from an approved plan.
- Execute a bounded sequence state machine.
- Support pause, stop, skip, retry, and park policies.
- Classify active-run edits by operational impact and explain consequences.

### Exit Criteria

- A multi-target fake plan executes from preflight through completion.
- Non-disruptive future edits do not alter active work unexpectedly.
- Disruptive edits require explicit consequence-aware approval.
- Refreshing or changing workspaces does not affect execution.

Phase 2 is complete with deterministic fake-run evidence only. It does not
prove provider-backed preflight, acquisition, capture, recovery, stopping, or
parking; those remain Phase 3 work.

## Production Convergence — Complete

Production Convergence turns the completed V2 infrastructure, contract, and UI
learning into the real implementation target before new Phase 3 behavior is
added. It splits source responsibilities without splitting deployment or
authority: `apps/web` becomes the Nightbook browser client, `apps/server`
becomes the promoted rig-local authority, and the server continues to ship the
version-matched web bundle from one logical origin.

### Outcomes

- Promote the proven server implementation to `apps/server` without changing its
  proven domain behavior, persistence, worker, deployment, or proof boundaries.
- Create `apps/web` from the accepted Nightbook presentation while excluding
  prototype fixture ownership and browser-local durable substitutes.
- Establish shared decoded snapshot, SSE, capability, command, and typed-failure
  boundaries between web and server.
- Build and serve the web bundle from the same release image and origin as the
  authoritative service.
- Migrate the proven Plan, managed-run Observe, Library, and current Process
  boundaries into the production applications before retiring experimental
  runtime paths.

### Exit Criteria

- Existing contract and server integration evidence remains green after the
  server promotion.
- The Nightbook shell loads from a real authoritative snapshot, handles
  snapshot-first reconnect without command replay, and uses server-owned client
  capability.
- One versioned image serves matching web assets, API routes, streams, health,
  and authorized downloads through the selected Compose/Cloudflare topology.
- Plan and fake managed-run behavior, Library delivery, and current Process
  truth are available through `apps/web` and `apps/server` with wide, compact,
  and read-only phone validation.
- Experimental paths and UI prototypes are no longer active implementation
  targets. Phase 3 work proceeds only in the production applications.

Execution is tracked by five sequential Continuum Epics:
`tkt-ezxr1fsb`, `tkt-n9yoieoz`, `tkt-uuom4upo`, `tkt-qffwfa47`, and
`tkt-zcsucxyx`. This milestone authorizes convergence of already accepted and
proven behavior only. It does not authorize provider-backed preflight, a device
command, physical capture, processing workflow, or other deferred Phase 3–6
behavior.

All five Epics are complete. `apps/web` is the canonical Nightbook client and
`apps/server` is the canonical rig-local authority. The final architecture
serves the version-matched web bundle from one pinned image through the Effect
WebHost and scoped OriginListener. Its canonical boundary is bootstrap, SSE,
typed control, Plan, fake managed-run Observe, Library/download, and Process
handoff; direct legacy routes are retired. The production bundle contains no
fixture adapter, theme-study runtime, or prototype runtime.

The completed exit criteria are evidenced by **184/184** contract,
**62/62** server, and **57/57** web tests; Compose base/download, rig, and
publisher renders; and Designer PASS at wide, compact, and 390 px for owner,
friend, and phone projections. Final image:
`sha256:10c3f8ccbcf9530b24a595e90242ad497720d177b8ffdaae95104cf62b18835e`.
`ASTRO_SERVER` is the canonical environment configuration, with bounded
deployed legacy aliases only. No provider, device, Solar, physical, or capture
work was performed or authorized.

The typed control request/grant/decline/release/take seam remains preserved,
but user-facing presence and control UI is deferred to Phase 6; reconnect and
presence lifecycle are not claimed. Interactive Process is deferred to Phase 5.
Phase 3 remains separately authorized only by accepted bounded slices; its
prepared read-only preflight packet is not accepted or implemented.

## Phase 3: Observe, Acquire, and Capture — After Production Convergence

### Outcomes

- Add decision-grade preflight.
- Add guided polar-alignment measurement and frame overlay.
- Add plate-solve-driven deep-sky slew and center, with a separate lunar path.
- Verify mount corrections from successive images.
- Show live capture progress, storage, drift, quality, and available actions.
- Add bounded recovery and rollback behavior.

### Exit Criteria

- Acquire exposes the correction, evidence, remaining bound, and abort path.
- Driver acceptance is not reported as physical success until image evidence
  confirms it.
- Capture answers whether useful evidence is accumulating.
- Recovery remains visible across workspace and responsive layouts.

## Phase 4: Library and Frame Review

### Outcomes

- Persist image bytes and FITS with durable metadata.
- Generate debayered and stretched previews.
- Organize frames by night, target, run, sequence, and derivation.
- Expose clipping, framing, sharpness, shape, and drift metrics.
- Explain automated acceptance or rejection.
- Support compare, accept, reject, annotate, reveal, download, and a compact
  live-review surface in Observe.

### Exit Criteria

- Every captured frame is inspectable and traceable.
- Review decisions are durable and do not mutate original evidence.
- Library stays usable with a large asset catalog.

## Phase 5: Process Workspace

### Outcomes

- Start a service-owned processing session from saved FITS inputs.
- Separate Build operations from Develop operations, retaining a durable linear
  master between them.
- Provide preview, apply, undo, redo, stage-local retry, discard, and safe
  source switching.
- Keep the image canvas visible while parameters or comparisons change.
- Integrate only compatible operation-specific adapters, record provenance and
  diagnostics, and save selected results to Library.
- Throttle only for measured host pressure that threatens observing.

### Exit Criteria

- A result is reproducible from sources, ordered operations, parameters, and
  tool facts.
- Undo, redo, reset-preview, and retry restore the expected image/control
  state.
- Saved derived assets preserve originals; discard cannot remove sources or
  saved artifacts.
- Processing failure cannot affect active rig control.

## Phase 6: Remote Viewing and Shared Control

### Outcomes

- Publish the web entry point through the Linux service and private outbound
  tunnel.
- Add managed authentication and viewer, controller, and owner behavior.
- Ship the read-only phone experience.
- Add control request, grant, release, and owner takeover.
- Bound remote preview bandwidth and make original downloads explicit.

### Exit Criteria

- A trusted remote viewer can inspect an active run at the public URL.
- A trusted friend can request and receive exclusive control.
- Every client can see who controls the observatory.
- Losing public connectivity does not interrupt local work.
- Astro Console stores no user password.

## V2.0 Completion Rule

V2.0 completes when the phases above meet their exit criteria with the stated
proof boundaries. Do not turn completion into a prerequisite for V2.1, V2.5,
or V3 ideas. New versions may revisit intentionally deferred work after V2.0.
