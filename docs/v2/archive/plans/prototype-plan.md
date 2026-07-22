# V2 Prototype Plan

> Archived discovery plan. Use the
> [current convergence plan](../../current/convergence-plan.md) for active work.

## 1. Purpose

Prototyping is a first-class V2 discovery phase. Its job is not to make an
early version of the final application. Its job is to make consequential
product decisions cheap to test and cheap to discard.

The prototypes should answer three categories of question together:

1. Which interface and workflow models help an operator understand and act?
2. Which canonical entities, states, commands, events, and invariants must the
   backend own to support those workflows honestly?
3. Which technical and operational assumptions fail under realistic data,
   latency, interruption, recovery, and device behavior?

The result is evidence for V2 implementation: selected interaction patterns,
candidate transport contracts, an executable scenario catalog, and an
explicit record of unresolved risks.

The working artifacts are inventoried in the
[V2 prototype hub](../../../../prototype/v2-ui/index.html). The hub is the durable
entry point for interactive comparisons, content-only model studies,
architecture ideas, and relevant earlier prototype reports; individual study
URLs should not become an untracked parallel index.

## 2. Principles

- Prototype questions, not feature lists.
- Compare meaningfully different models before polishing one model.
- Use the same observing scenarios to evaluate UI and domain behavior.
- Prefer deterministic simulated hardware until the question specifically
  requires real equipment.
- Put failures, warnings, delays, stale state, and recovery into prototypes
  from the beginning.
- Use realistic information density and catalog/frame volumes. Empty-state
  mockups hide the hardest design problems.
- Keep device truth, durable run truth, transport state, and client-local UI
  state visibly distinct.
- Record decisions and rejected alternatives. A discarded prototype is useful
  only if its lesson survives.
- Assume prototype code is disposable unless a component is deliberately
  promoted after review.

## 3. Shared Scenario Spine

All prototype tracks should reuse a small set of end-to-end stories. This is
how a visual decision becomes a backend requirement instead of an isolated
mockup choice.

### Scenario A: Plan A Night

The operator compares targets, creates multiple sequences, sees time and
storage constraints, resolves readiness problems, approves the plan, and
starts a run.

Questions include:

- Is planning primarily a timeline, ordered queue, target canvas, table, or a
  hybrid?
- Can the operator understand why a target fits or conflicts?
- What is editable before approval, and what becomes immutable at run start?

### Scenario B: Acquire A Difficult Target

The run slews, captures a solve frame, measures error, applies a bounded
correction, retries, and either reaches tolerance or asks the operator what to
do.

Questions include:

- How should evidence and progress be layered without becoming a telemetry
  dump?
- Which decisions are automatic, which are recommended, and which require
  approval?
- How are attempt history, tolerance, uncertainty, and remaining bounds
  represented?

### Scenario C: Observe While Doing Something Else

Capture continues while the operator moves to Library or Process, then returns
to Observe after a warning appears.

Questions include:

- What must remain globally visible?
- Which warning interrupts the current workspace, and which waits in the
  activity surface?
- What state belongs to the active run versus each browser's navigation?

### Scenario D: Change An Active Plan

The operator edits future exposure settings, reorders a later target, and then
attempts a change that would abort the current exposure and move the mount.

Questions include:

- Can the impact of each change be explained before it is applied?
- What is a revision, what is an immediate command, and what is a new plan?
- How do multiple clients see pending, approved, rejected, or superseded
  changes?

### Scenario E: Failure And Recovery

A device becomes slow or unavailable, the browser disconnects, an exposure is
interrupted, and the observatory service recovers with partial evidence.

Questions include:

- Can the UI distinguish unknown, delayed, failed, and safely stopped?
- What survives browser refresh and service restart?
- What recovery actions are safe, bounded, and understandable?

### Scenario F: Review And Process Evidence

The operator compares accepted and rejected frames, investigates a quality
trend, creates a processing job, inspects intermediates, and reproduces an
output.

Questions include:

- Which metadata deserves persistent visual priority?
- How do originals, decisions, recipes, jobs, and derived assets relate?
- Can processing remain legible without borrowing the live-observing mental
  model?

### Scenario G: Remote And Phone Check-In

A friend views the run remotely on a phone, the owner sees that presence, and
later grants an exclusive control lease from a desktop client.

Questions include:

- What is useful in a genuinely read-only phone view?
- How are latency, stale previews, and connection quality communicated?
- Is control ownership unmistakable on every client?

## 4. Track One: Interaction And UX Prototypes

This track explores alternative information architectures and interaction
models without requiring production backend behavior.

### Fidelity Ladder

1. **Flow sketches** test navigation, sequencing, and decision points.
2. **Low-fidelity clickable prototypes** compare workspace structures and
   interaction models.
3. **Data-rich browser prototypes** test hierarchy, density, responsive
   behavior, keyboard use, and realistic content.
4. **Instrumented scenario walkthroughs** test whether the operator notices,
   understands, and acts on the right information.

The team should not automatically advance every idea through every level.
Increase fidelity only when lower-fidelity evidence cannot answer the next
question.

### Required Comparisons

- At least two materially different Plan models, such as timeline-first versus
  sequence-table-first.
- At least two Observe models, such as phase-focused guided workflow versus a
  stable activity canvas with contextual detail.
- Alternative global activity and warning treatments while another workspace
  is active.
- Desktop wide, compact laptop, and read-only phone layouts using the same run
  state.
- Quiet, information-dense, warning, failure, and recovery states—not only the
  ideal path.

### Evaluation

For each scenario, record:

- what the operator believes is happening;
- the next action they expect to take;
- whether they can find the evidence behind a recommendation;
- what they overlook or misinterpret;
- how many context switches or panels are required;
- whether critical state remains understandable at field-friendly sizes and
  contrast.

The goal is not to minimize clicks universally. It is to minimize uncertainty,
surprise, and unnecessary navigation around consequential actions.

## 5. Track Two: Domain And Contract Prototypes

This track makes the working product model executable before it becomes the
production architecture. It should use Effect Schema candidates and pure or
deterministic state transitions where practical.

### Models To Exercise

- `Observatory` and device capability/readiness snapshots;
- draft, approved, revision, and active forms of `NightPlan`;
- `Sequence` and per-target acquisition/capture policy;
- `ActiveRun`, its current phase, progress, and durable history;
- `AcquisitionAttempt` with evidence, correction, tolerance, and outcome;
- `Frame`, quality assessment, review decision, and provenance;
- `ProcessingRecipe`, `ProcessingJob`, and derived artifacts;
- `ControlLease`, client presence, and ownership changes;
- warnings, approvals, plan mutations, and recovery decisions.

### Questions To Resolve

- What is canonical backend truth, derived presentation state, or local client
  state?
- Which commands express intent instead of exposing low-level device methods?
- Which events are durable history, transient progress, or replaceable
  snapshots?
- What idempotency, revision, correlation, and stale-client checks are needed?
- What does a reconnecting client need to reconstruct the current experience?
- Which transitions require evidence from an image or device readback before
  they may be called successful?
- Which state survives a service restart, and which work resumes, recovers, or
  terminates?

### Deliverables

- Candidate Effect Schemas for commands, snapshots, events, and errors.
- Executable transition tests for the shared scenarios.
- A command/event trace that can drive the UI prototype without bespoke mocks.
- A state-ownership map showing service-owned, device-reported, derived, and
  client-local state.
- A mutation-impact classifier with examples and approval requirements.
- An explicit list of model questions that remain intentionally unresolved.

The trace is an important boundary artifact: if the UI requires information
that the trace cannot express, either the UI is inventing truth or the domain
model is incomplete.

## 6. Track Three: Operational And Technical Spikes

Some unknowns cannot be resolved with static screens or pure state machines.
Use narrow, time-boxed spikes for these questions.

Priority candidates are:

- rendering and navigating a realistic target catalog without mounting every
  target;
- showing image overlays, solve geometry, polar-alignment vectors, and frame
  comparisons at useful performance and precision;
- streaming run state and previews through disconnect, reconnect, latency, and
  out-of-order delivery;
- handling two browsers with one visible control lease and stale revision
  protection;
- persisting enough active-run history for refresh and service restart;
- scheduling local processing without starving capture or rig control;
- moving thumbnails and previews remotely while keeping raw frames near the
  observatory;
- representing unavailable, partially capable, or lying devices without
  leaking vendor-specific complexity into the UI;
- verifying field usability under dim light, reduced width, gloves or coarse
  pointer input, and intermittent connectivity.

Each spike must start with a question and a stopping rule. Its output is a
measurement, constraint, or architectural decision—not a half-adopted
framework.

## 7. Prototype Harness

Build a deterministic fake observatory as the common substrate for interactive
and contract prototypes. It should replay or generate:

- healthy idle, planning, and active-capture states;
- slow device operations and intermediate progress;
- capability variations and readiness failures;
- solve failures, bounded retries, and correction history;
- marginal and rejected frames with believable metrics;
- warnings of different urgency and acknowledgement behavior;
- browser disconnect, stale client, and reconnect;
- service restart with recoverable and non-recoverable work;
- multiple viewers and control-lease transfer;
- large target, frame, and processing-job collections.

Scenarios should be seedable, clock-controlled, and replayable. The same
scenario should be usable by automated contract tests, browser prototypes, and
later production UI tests. This is the most likely prototype asset to deserve
deliberate promotion into V2 implementation.

Physical-rig validation remains valuable, but only after a prototype question
cannot be answered truthfully by the harness. Hardware sessions should be
bounded and designed to validate one assumption at a time.

## 8. Decision And Promotion Rules

Every prototype should have a short record containing:

- question and competing hypotheses;
- scenario and representative data;
- artifact or commit used;
- observations and failure cases;
- decision, confidence, and remaining uncertainty;
- affected UI rules, domain contracts, or architecture decisions;
- whether the artifact is discarded, retained as reference, or proposed for
  promotion.

Prototype code is promoted only when it has a clear owner, matches the selected
architecture, follows production standards, and has appropriate tests. Visual
components, fake scenarios, and schemas may mature at different rates; none
should enter production merely because it looks finished.

## 9. Phase Exit Criteria

Prototype discovery is sufficient to begin the local web foundation when:

- Plan and Observe have each been tested through competing interaction models;
- the selected workspace shell works across desktop and read-only phone
  scenarios while a run continues independently;
- the shared scenarios can be represented by candidate entities, commands,
  events, and errors without UI-only invented state;
- active-plan mutation, warning escalation, reconnect, recovery, and control
  ownership have executable model examples;
- realistic catalogs, frame sets, telemetry, and warnings have been used to
  test information density and performance;
- high-risk technical assumptions are either measured and accepted, rejected,
  or explicitly deferred with a validation point;
- the decision log explains why the selected models won and what remains open.

This is not a requirement to finish the entire product on paper. It is a
requirement to stop treating its most consequential unknowns as implementation
details.

## 10. Finite Convergence Roadmap

Prototype discovery has a defined end. Its final artifact is **one validated
V2 interaction specification plus one backend-facing domain and contract
model**. It is not an indefinitely growing gallery of studies.

The seven convergence gates are finite and ordered. Gates 1 through 4 are
complete; Gate 5 is next:

1. **Composite V2 convergence — complete.** The reference interaction model
   now covers Plan, Observe, Library, global run context, warnings, the
   contextual rail, responsive desktop behavior, and the read-only phone
   monitor.
2. **Acquire evidence workflows — complete July 21, 2026.** The accepted
   reference covers plate-solve acquisition, bounded automatic corrections
   and retries, exhausted recovery, polar-alignment measurement and overlay,
   uncertainty, tolerance, and image-verified completion.
3. **Run mutation, reconnect, and control ownership — complete July 21,
   2026.** The accepted reference covers proportional active-run changes,
   semantic freshness and revision projection, snapshot-first reconnect,
   priority-sorted attention, multiple viewers, exclusive control, owner
   takeover, stale intent rejection, and a read-only phone.
4. **Process model — complete July 21, 2026.** The accepted reference covers
   Build and Develop phases, one current edit history, a dominant image canvas,
   compatible tool choice, optional assistance, stage-local recovery and
   diagnostics, protected source switching, and saving related artifacts to
   Library without a first-class recipe or branch model.
5. **Executable domain contract harness — next.** Express the reference scenarios as
   canonical entities, Effect Schema command/snapshot/event/error candidates,
   deterministic transitions, and UI-driving traces.
6. **Three bounded technical spikes only.** Measure catalog scale and bounded
   rendering; image overlays and solve geometry; and streamed state/preview
   reconnect behavior. Each spike ends with a recorded constraint or decision.
7. **Final reference walkthrough and decision log.** Run the shared scenarios
   through desktop, compact desktop, and read-only phone; reconcile every UI
   claim with the contract trace; record selected, rejected, and deferred
   choices; then freeze the V2 reference specification.

Pairwise studies are not a default gate. Use one only when two or more
materially different interaction models remain unresolved and a focused choice
can change the reference specification. Do not create pairwise studies for
polish, wording, or variations that can be judged inside the composite.

### Stop And Exit Criteria

Prototype work stops when:

- one reference walkthrough covers planning, acquisition, capture, warning,
  recovery, workspace switching, review, processing, reconnect, and ownership;
- desktop and read-only phone presentations consume the same canonical truth
  without granting the phone control;
- every visible consequential action maps to a named command, eligibility rule,
  approval rule, result, and typed failure;
- the executable traces cover healthy, delayed, warning, failure, recovery,
  reconnect, stale-client, and control-transfer behavior;
- the three technical spikes have measurements and stopping decisions;
- the decision log records remaining deferrals with an owner and later
  validation point; and
- no unresolved choice can materially change the first local-web foundation
  slice.

At exit, promote the interaction specification, domain/contract schemas,
scenario traces, state-ownership rules, and deliberately reusable fake
observatory fixtures. Retain selected prototypes as reference evidence. Discard
or archive alternative layouts and prototype-only interaction code; visual
polish and duplicated static data are not production assets.
