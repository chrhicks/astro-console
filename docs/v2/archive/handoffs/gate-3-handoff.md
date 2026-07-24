# Gate 3 Session Handoff

> Archived historical handoff. Use
> [the current handoff](../../current/handoff.md) for active work.

Status: Gate 3 accepted and completed on July 21, 2026
Next gate: Gate 4 — Process model

This handoff is the durable repository entry point for the V2 work completed
through Gate 3. It summarizes the decisions needed to continue without
reopening accepted interaction models. The detailed evidence and candidate
contracts remain in the linked gate documents.

## Current Position

The seven-gate convergence plan now has three completed gates:

1. Composite V2 convergence is accepted.
2. Acquire evidence workflows are accepted.
3. Run mutation, reconnect, and control ownership are accepted on iteration 3.

Gate 4 is the existing Process model gate: select the recipe, job,
intermediate-artifact, comparison, provenance, and observing-priority
interactions needed for the first processing slice. Its scope comes from the
[prototype plan](../plans/prototype-plan.md) and
[convergence roadmap](../../../../prototype/v2-ui/archive/gate-06/convergence-roadmap.html); this
handoff does not expand it.

## Accepted Context From Gates 1 And 2

Gate 1 selected the Composite shell:

- freely switchable Plan, Observe, Library, and Process workspaces;
- a persistent compact run surface independent of the visible workspace;
- adaptive left navigation and a shared Inspector/Alerts context rail;
- state-driven hierarchy rather than a forced numbered Observe flow;
- stable evidence-left/judgment-right composition on wide screens and
  evidence-first/judgment-next when stacked; and
- an intentionally read-only first phone experience.

Gate 2 selected the Acquire reference inside Observe:

- in-policy centering corrections and bounded solve retries are passive;
- exhausted retries pause for an explicit recovery decision;
- large corrections require approval with exact consequences;
- completion requires a new image and solve, not device command acceptance;
- manual polar guidance uses prominent physical Alt/Az instruction cards; and
- attempt evidence remains durable while the current assessment and decision
  stay in the stable judgment region.

These decisions are context for later gates, not alternatives to re-evaluate.

## Gate 3 Selected Decisions

Gate 3 established one service-owned authority model across plan mutation,
reconnect, presence, and multi-client control:

- The service owns execution, mutation classification, freshness, presence,
  and exclusive control. Browsers project truth and express guarded intent.
- Plan owns active-run edits, including disruptive edits requiring approval.
  Observe owns pause, skip, stop, and recovery interventions. Execution
  continues independently of workspace and browser presence.
- `sourcePlanRevision`, `runRevision`, `snapshotVersion`, `eventCursor`, and
  `leaseRevision` remain distinct canonical contract fields. Primary UI uses
  semantic labels; raw identifiers appear only in secondary diagnostics.
- Mutation impact is a closed service result: non-disruptive, notice,
  disruptive, or ineligible. The service supplies exact physical, evidence,
  schedule, time, and storage consequences.
- Every mutation preview and command is revision-guarded. Stale intent fails
  without partial state or hardware action, and a local edit may remain for
  review against the current run.
- Reconnect is snapshot-first. A stale client disables observing actions; a
  fresh snapshot atomically replaces canonical projection, summarizes durable
  changes while away, and only then admits newer events.
- Presence is not authority. Control is exclusive, explicitly requested and
  granted, visibly retained during a prototype 60-second reconnect grace, and
  explicitly restored by owner takeover. Transfer does not cancel accepted
  work; grace expiry releases to no controller.
- A command issued while a client still controlled may arrive after takeover
  because of network delay. Its superseded lease rejects it before hardware
  action. Clients do not buffer or automatically resend observing commands.
- The judgment region is priority-sorted and may contain decisions, passive
  statuses, and informational notices. Informational rejection does not become
  a blocking decision merely because it concerns authority.
- Action cards name the exact pending change or control transition. Generic
  controller identity remains in the run surface and Inspector.
- The phone consumes the same current snapshot, warnings, presence, and
  controller identity while exposing no plan, run, or control mutations.

The accepted candidate records, commands, durable events, typed failures, and
state-ownership table are in the
[Run Authority gate reference](../../gates/gate-03-run-authority.md). They are inputs to Gate
5 contract work, not production schemas yet.

## Walkthrough Lessons

The first participant walkthrough showed that the operator understood the
physical run and control ownership, but protocol identifiers obscured that
truth. It also revealed that active-run editing belonged visually in Plan,
reconnect and takeover were passive results rather than acknowledgement or
resume decisions, and informational rejection needed to coexist with higher
priority attention instead of occupying a permanent Decision Now slot.

Iteration 2 moved technical identifiers into diagnostics, projected semantic
freshness, placed active-run changes in Plan while the run surface showed M27
continuing, made reconnect and takeover passive, and introduced priority-sorted
attention.

The second walkthrough found that decision cards still spent valuable space
repeating who controlled instead of naming the concrete change. It also found
the former-controller rejection causally ambiguous.

Iteration 3 replaced generic authority blocks with exact action summaries and
resolved the rejection as an in-flight race: Maya issued `Skip remaining M27
frames` while she controlled; network delay delivered it after owner takeover;
the service rejected the superseded lease before hardware action. The user
accepted this iteration.

## Deferred Versus Open

Copy polish is explicitly deferred until final layout and convergence. Small
card-title choices, supporting sentences, the exact wording of `Review against
current run`, and minor duplication are not open interaction semantics and
should not delay Gate 4.

Non-blocking semantic questions remain recorded in the Gate 3 reference: the
final controller-grace policy, control-request audience, summary of several
accepted runtime mutations, and the boundary between reconnect summary and
durable run history. They belong to later contract or final-convergence work
and do not reopen Gate 3 acceptance.

## Durable References

Repository plan and architecture:

- [V2 plan index](../../README.md)
- [Finite prototype plan](../plans/prototype-plan.md)
- [UI and workspace plan](../../current/product-spec.md)
- [Web architecture](../architecture/web-architecture.md)
- [Delivery plan](../../current/delivery-plan.md)

Accepted gate references:

- Gate 1: [Composite prototype](../../../../prototype/v2-ui/composite-prototype.html)
  and [Composite state model](../../../../prototype/v2-ui/composite-prototype.js)
- Gate 2: [Acquire gate document](../../gates/gate-02-acquire.md),
  [Acquire prototype](../../../../prototype/v2-ui/acquire-prototype.html), and
  [Acquire state model](../../../../prototype/v2-ui/acquire-prototype.js)
- Gate 3: [Run Authority gate document](../../gates/gate-03-run-authority.md),
  [Run Authority prototype](../../../../prototype/v2-ui/run-authority-prototype.html),
  and [Run Authority state model](../../../../prototype/v2-ui/run-authority-prototype.js)

Shared prototype navigation and presentation:

- [Prototype hub](../../../../prototype/v2-ui/index.html)
- [Prototype inventory](../../../../prototype/v2-ui/README.md)
- [Convergence roadmap](../../../../prototype/v2-ui/archive/gate-06/convergence-roadmap.html)
- [Shared prototype styles](../../../../prototype/v2-ui/styles.css)

Durable project memory is tracked in Continuum. Task `tkt-2p2bhwgk` is
completed with the scenario matrix, contract decisions, walkthrough evidence,
responsive validation, acceptance decision, and outcome. Continuum memory was
consolidated after closure; use its summary or search when exact prior task
context is needed, while this file remains the human-readable repository
handoff.

Continuum task `tkt-14wqxxlp` is the ready five-step Gate 4 Process-model
prototype ticket. It owns scenario definition, domain and ownership modeling,
the bounded reference prototype, responsive validation, and the Gate 4
decision. Task `tkt-gtlgot1c` is the downstream implementation backlog item for
the post-processing workbench; it does not replace the Gate 4 prototype ticket
and should inherit the accepted Process decisions later.

## Repository State

The Gate 3 docs, prototype, shared-style, hub, roadmap, and handoff changes were
committed together on branch `v2`. The worktree was clean at handoff; preserve
that commit and any user-owned files when continuing.

## Single Next Action

Start `tkt-14wqxxlp` Step 1 by defining the canonical Gate 4 Process scenario
matrix from accepted Gates 1–3 and the existing processing evidence.
