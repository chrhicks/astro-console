# V2 Delivery Plan

Status: **current staged delivery direction**

This is an implementation-planning reference, not default V2 context. Begin at
[Start Here](../README.md).

## 1. Delivery Strategy

V2 should be built from the product model outward, not by reproducing the
current Electron screen in a browser.

The first implementation slices should establish:

1. prototype evidence for the product's riskiest interaction and state-model
   decisions;
2. canonical product entities and ownership;
3. a durable observatory service;
4. an official visual and interaction-design authority derived from the frozen
   reference;
5. a freely switchable workspace shell;
6. one honest end-to-end observing path;
7. evidence-driven review and processing;
8. remote sharing only after the local service model is proven.

The current application remains a source of validated hardware and workflow
behavior during migration. It is not the visual template for V2.

## 2. Phase 0: Product, Prototype, And Contract Definition — Complete

Gates 1–7 completed this phase. The accepted product, contract, technical
constraints, walkthrough, and frozen references are the input to Phase 0.5;
they are not reopened for implementation convenience or visual polish.

### Outcomes

- Confirm the workspace and run-phase model.
- Run the scenario-based interaction, domain-model, and operational prototype
  tracks in [the convergence plan](convergence-plan.md).
- Define `Observatory`, `ObservingPlan`, `Sequence`, `ActiveRun`,
  `AcquisitionAttempt`, `Frame`, `ProcessingSession`, and `ControlLease`
  ownership.
- Decide what active-run state must persist across service restart.
- Define command, snapshot, event, and error contracts with Effect Schema.
- Separate domain decisions from transport-safe state and client-local
  presentation state.
- Create low-fidelity desktop and phone shell wireframes.
- Maintain [V2 UX and design guidance](../ux-design-guidance.md) as the concise
  authority derived from accepted interaction gates.
- Compare materially different Plan and Observe interaction models rather than
  polishing the first plausible layout.
- Exercise prototypes against deterministic healthy, warning, failure,
  recovery, long-running, and reconnect states.
- Establish typography, control-size, warning, and responsive baselines.

### Exit Criteria

- Every stateful decision has one canonical owner.
- Workspace navigation cannot own or interrupt a run.
- The active-plan mutation impact model is defined.
- The preferred workspace and run interactions are supported by scenario
  walkthrough evidence, not taste alone.
- Backend-relevant prototype state has been converted into named entities,
  commands, events, invariants, and Effect Schema contract candidates.
- The highest-risk operational unknowns have been retired, bounded, or carried
  forward explicitly with an owner and later validation point.
- The V2 shell can be evaluated without inheriting the current three-column
  layout.

## 3. Phase 0.5: Design-System Finalization

Follow the [Phase 0.5 design-system brief](phase-0.5-design-system-brief.md)
for its bounded review method, official-guide deliverable, and acceptance
criteria.

### Outcomes

- Run one final design review of the accepted prototype references and their
  healthy, warning, recovery, reconnect, and read-only-phone states.
- Publish a concise official V2 style and design guide that complements—not
  duplicates—the product/UX guidance and contract documents.
- Establish the implementation visual language: typography, spacing, layout
  hierarchy, semantic color and status treatment, controls, surfaces, focus,
  motion, and data-density rules.
- Define responsive composition for wide desktop, compact desktop, and the
  deliberately read-only phone projection.
- Capture component and state patterns from real V2 objects—active run,
  evidence, decision, warning, processing canvas, context rail, and Library
  item—rather than inventing a generic component catalog.
- Define an implementation drift check: a feature is reviewed against the
  frozen references, the style guide, semantic state, and real domain evidence.

### Exit Criteria

- The official guide names the visual and interaction rules an implementation
  team needs without treating a screenshot as the API.
- Each reusable pattern has a product role, state variants, accessibility
  behavior, and responsive treatment.
- Semantic states remain legible without color and controls retain visible
  focus and named keyboard paths.
- The guide makes it easy to identify generic or unrelated-product UI drift.
- The user accepts the guide as the visual implementation authority; later
  Phase 1 work may extend it only when a real product need exposes a gap.

## 4. Phase 1: Local Web Foundation

### Outcomes

- Run the existing reusable backend behavior in a service independent of
  Electron.
- Serve the web client and typed API locally.
- Stream current observatory and run snapshots.
- Reconnect a browser without losing run state.
- Add Plan, Observe, Library, and Process workspace navigation.
- Add the persistent activity surface.
- Provide deterministic fake observatory states for UI development.

### Exit Criteria

- Closing and reopening the browser does not alter service activity.
- Two local browsers observe the same state.
- Only the control lease holder may mutate observing state.
- The current catalog is queried through a bounded server query/pagination
  boundary and rendered through a virtualized viewport.

## 5. Phase 2: Plan And Managed Runs

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

- A multi-target fake plan can execute from preflight through completion.
- Non-disruptive future edits do not alter active work unexpectedly.
- Disruptive edits require explicit consequence-aware approval.
- Refreshing or changing workspaces does not affect execution.

## 6. Phase 3: Observe, Acquire, And Capture

### Outcomes

- Add decision-grade preflight.
- Add guided polar-alignment measurement and frame overlay.
- Add plate-solve-driven deep-sky slew and center.
- Add a separate lunar centering path.
- Verify mount corrections from successive images.
- Show live capture progress, storage, drift, quality, and available actions.
- Add bounded recovery and rollback behavior.

### Exit Criteria

- Acquire exposes the current correction, evidence, remaining bound, and abort
  path.
- Accepted driver writes are not reported as successful physical outcomes
  until image evidence confirms them.
- Capture answers whether useful evidence is accumulating.
- A recovery path cannot be hidden by workspace navigation or responsive
  layout.

## 7. Phase 4: Library And Frame Review

### Outcomes

- Persist ImageBytes and FITS with durable metadata.
- Generate debayered and stretched previews.
- Organize frames by night, target, run, sequence, and derivation.
- Expose clipping, framing, sharpness, shape, and drift metrics.
- Explain automated acceptance or rejection.
- Support compare, accept, reject, annotate, reveal, and download.
- Add a compact live-review surface to Observe.

### Exit Criteria

- Every captured frame is inspectable and traceable.
- Review decisions are durable and do not mutate original evidence.
- Library remains usable with a large number of assets.

## 8. Phase 5: Process Workspace

### Outcomes

- Start a service-owned processing session from saved FITS inputs.
- Separate Build image operations from visual Develop image operations, with a
  durable linear master between them.
- Maintain one current linear edit history with preview, apply, undo, redo,
  stage-local retry, and discard behavior.
- Keep the image canvas visible while the operator adjusts parameters or
  compares the current result against the linear reference.
- Consolidate Operation, optional Assistant findings, and Inspector evidence
  in one contextual rail that does not steal canvas space or focus.
- Add compatible per-operation adapters for Siril and selected external tools;
  expose only tools that actually implement the selected operation.
- Record checkpoints, attempts, parameters, tool versions, and provenance
  underneath the editing workflow.
- Expose sanitized raw tool diagnostics and exact stage-local retry scope when
  an operation fails.
- Protect unsaved work while switching among raw sessions, unfinished Process
  sessions, existing linear stacks, and Library sources.
- Save selected processed FITS and display artifacts into Library.
- Throttle processing only for measured host pressure that could threaten
  observing, rather than treating active capture as an automatic pause.

### Exit Criteria

- A processing result can be reproduced from its recorded sources, ordered
  operations, parameters, and tool facts.
- Undo, redo, reset-preview, and stage-local retry visibly restore the expected
  image and control state.
- Selected derived assets appear in Library without obscuring their originals;
  discarding unsaved work cannot remove source frames or saved artifacts.
- Processing failure cannot affect active rig control.

## 9. Phase 6: Remote Viewing And Shared Control

### Outcomes

- Publish the web entry point through the Linux server and a private outbound
  tunnel from the observatory.
- Add managed social, passwordless, or passkey authentication.
- Implement viewer, controller, and owner behavior.
- Ship the read-only phone experience.
- Add control request, grant, release, and owner takeover.
- Bound remote preview bandwidth and explicit original-frame downloads.

### Exit Criteria

- A trusted remote viewer can inspect an active run from the public URL.
- A trusted friend can request and receive exclusive control.
- The owner and all clients can see who controls the observatory.
- Losing the public connection does not interrupt local work.
- No user password is stored by Astro Console.

## 10. Existing P50 Backlog Mapping

| Existing task | V2 destination |
| --- | --- |
| Add observing readiness checks | Plan validation and Observe preflight |
| Add managed capture sequences | Night plans, active runs, and Capture |
| Add closed-loop slew and center | Target-level Acquire |
| Verify mount corrections from images | Acquire Verify and Recover |
| Build first-class frame feedback | Capture and Library |
| Create post-processing workbench | Process |
| Design supervised observatory MCP | Later agent interface over the same high-level plans, runs, evidence, approvals, and control lease |

These tasks remain valuable product requirements. V2 changes where they belong
and prevents them from becoming additional panels in the current shell.

## 11. Deferred Decisions

The following choices should remain open until their surrounding product model
is sufficiently concrete:

- final product and repository name;
- web framework and HTTP server library;
- hosted identity provider;
- reverse-tunnel implementation;
- whether a custom remote hub is ever necessary;
- exact service installation and update mechanism;
- processing adapter order and RCAstro integration boundary;
- later phone control scope;
- active controller disconnect timeout;
- how much active-run state survives a service restart.

Product naming should happen after the ideation phase. Candidate names should
fit a personal observatory service spanning planning, observing, review,
processing, remote access, and future agent assistance rather than implying a
single desktop console.

## 12. Explicitly Deferred Scope

- Enterprise multi-tenancy or organization administration.
- Broad commercial driver certification.
- Full phone control in the first mobile experience.
- Public unauthenticated access.
- Automatic physical polar adjustment without supporting hardware.
- A custom cloud relay before a reverse-tunnel deployment proves insufficient.
- Solar automation without dedicated safety interlocks.
- Arbitrary remote shell, process, or filesystem access.

## 13. Planning Artifacts Before Implementation

Before V2 implementation begins, create and review:

- a workspace-level navigation map;
- at least two competing desktop interaction prototypes for the most important
  Plan and Observe workflows;
- a read-only phone status prototype;
- an active-run state and mutation-impact model;
- an executable fake-observatory scenario catalog covering success, warning,
  failure, recovery, disconnect, and stale-client behavior;
- a prototype decision log recording what was tested, what changed, and what
  remains uncertain;
- the canonical V2 API contract outline;
- the local and remote deployment diagrams;
- a migration inventory classifying current modules as preserve, replace, or
  re-evaluate.

The Gate 7 walkthrough and decision log now satisfies the prototype decision
log requirement. Phase 0.5 adds the official V2 style and design guide before
Phase 1 begins.

Implementation should begin only after those artifacts tell one consistent
story. The goal is to avoid rediscovering the overall UX one feature panel at a
time.
