# Run Authority Gate Prototype

Status: accepted and completed on July 21, 2026

The retired run-authority prototype is available only through Git history.

## Gate Question

Can one active run remain understandable and safe while its plan changes, a
browser disconnects, several people watch, and control moves between clients?

This gate tests whether the interface can explain four related truths without
turning into an administration console:

1. which revision the observatory is executing;
2. what a proposed change would affect;
3. whether the visible client is current and allowed to act; and
4. who can issue the next observing mutation.

The service owns all four truths. Browsers render them and express intent, but
they do not classify impact, advance revisions, infer authority, or reconstruct
run state from local component history.

## Working Interaction Hypothesis

Use the accepted Composite shell and Acquire hierarchy rather than introducing
a separate sharing or synchronization workspace.

- The compact global run surface always shows the current run, connection
  freshness, and controller. Protocol revisions remain available only as
  secondary diagnostics.
- Plan changes appear as a proposed diff against the immutable active-run
  snapshot, with service-classified impact and exact consequences.
- Evidence stays left or first: current work, proposed diff, revision history,
  snapshot time, and client presence.
- Assessment and the current decision stay right or next. Urgency may reorder
  content inside this judgment region but never swap the page's spatial model.
- Presence lives in Inspector until it creates a decision. Control requests,
  stale intent, and disruptive approvals enter the judgment or Alerts surface.
- The read-only phone consumes the same snapshot and shows freshness and
  controller identity, but exposes no run, plan, or lease mutations.
- Plan owns active-run editing, including disruptive edits that require
  approval. Observe owns pause, skip, stop, and recovery interventions. The
  service owns execution regardless of which workspace expresses intent.

Another pairwise study is justified only if testing exposes two materially
different authority models. Layout or wording preferences are refined inside
this single prototype.

## First Participant Walkthrough

Historical result: iteration 2 required; Gate 3 remained unaccepted after this
walkthrough.

The first walkthrough preserved the authority model but exposed projection and
attention-hierarchy problems:

- Raw run, source-plan, snapshot, event-cursor, and lease revisions made the
  primary interface read like protocol diagnostics. The operator needs
  semantic truth first: current run, started from Monday plan, current or last
  confirmed, changed elsewhere, and caught up.
- Active-run edits visually appeared in Observe even though they are planning
  work. Future, forecast-changing, disruptive, and stale-edit scenarios now
  live in Plan while the persistent run surface makes clear that M27 continues.
- Reconnect reconstruction was understandable, but an Acknowledge action made
  a completed automatic result look gated. Reconnect now passively summarizes
  the three changes while away and offers run history only as optional detail.
- Owner takeover correctly preserved execution, but Continue observing implied
  that observing had stopped. The result now states that control was restored
  and the run continued uninterrupted, with no required action.
- A fixed Decision Now card overstated informational outcomes such as a stale
  former-controller command. The judgment region is now a priority-sorted list
  of attention items: decisions, passive status, and informational notices can
  coexist without receiving equal urgency.

Iteration 2 retains the successful invariants: service-owned execution and
classification, exact mutation consequences, stale intent reaching no
hardware, explicit exclusive control, controller grace without silent
transfer, and a useful read-only phone. Canonical revisions remain unchanged
in the model and commands; an explicitly secondary diagnostics disclosure is
the only UI surface that exposes them.

## Second Participant Walkthrough

Historical result: iteration 3 required; Gate 3 remained unaccepted after this
walkthrough.

The second walkthrough confirmed the semantic projection and Plan ownership,
then exposed two remaining comprehension problems:

- Decision cards repeated generic controller identity under `Who can act` even
  though the persistent run surface and Inspector already answered that
  question. This displaced the concrete intent the operator was deciding on.
  Iteration 3 replaces it with a scenario-specific action summary. Mutation
  cards repeat the exact plan change and recipe, forecast review repeats its
  schedule consequence, disruptive approval names the exposure loss and
  movement, conflict review names the preserved edit, and control decisions
  name the ownership transition. Authority remains globally visible without
  consuming the decision card's most valuable detail space.
- The stale-controller example was causally ambiguous and could be read as
  Maya originating a new command after becoming a viewer, or as the client
  buffering and automatically retrying on reconnect. The reference scenario
  is now an in-flight race: while Maya still controlled, she explicitly issued
  `Skip remaining M27 frames`; network delay meant the service received it only
  after owner takeover; the superseded lease rejected it before hardware
  action. No client buffers or automatically resends an observing command.

The expert resolution keeps the stale-controller result informational and
nonblocking. It explains issuance, delay, takeover, and rejection in causal
order rather than relying on ambiguous words such as old or stale. Diagnostics,
priority sorting, passive reconnect and takeover, Plan-owned active-run edits,
and the read-only phone remain unchanged.

## Acceptance Decision

The user accepted iteration 3 on July 21, 2026 and explicitly deferred further
copy nitpicks until final layout and convergence. Gate 3 selects these
interaction and domain decisions:

- The service owns execution, mutation classification, freshness, presence,
  and exclusive control. Clients project that truth and express guarded intent.
- Plan owns active-run edits; Observe owns pause, skip, stop, and recovery
  interventions. The persistent run surface shows execution across workspaces.
- Primary UI uses semantic language such as current run, changed elsewhere,
  last confirmed, and caught up. Canonical revision and cursor identifiers
  remain in contracts and an explicitly secondary diagnostics disclosure.
- Non-disruptive, notice, disruptive, and ineligible mutations use proportional
  interactions with exact physical, evidence, time, schedule, and storage
  consequences supplied by the service.
- Reconnect is snapshot-first and passive: replace canonical projection,
  summarize durable changes while away, then consume newer events.
- The judgment region is a priority-sorted set of decisions, passive statuses,
  and informational notices rather than a permanent Decision Now slot.
- Control request, explicit grant, visible reconnect grace, owner takeover, and
  grace expiry never silently transfer control or interrupt accepted work.
- Superseded authority rejects stale run intent and network-delayed in-flight
  control intent before hardware action. Clients do not buffer or automatically
  resend observing commands.
- The first phone projection consumes the same canonical truth but remains
  read-only with no run, plan, or control mutations.

Acceptance freezes these interaction and authority-model decisions for the
remaining convergence gates. It does not claim final copy, final visual polish,
production schemas, or implementation readiness.

## Canonical Revision Model

`sourcePlanRevision` identifies the approved `ObservingPlan` revision used to start
the run. It never changes for that run.

`runRevision` identifies the current service-owned execution contract. It
starts with the immutable approved snapshot and increases exactly once for
every accepted runtime mutation. A runtime mutation does not rewrite the
source plan.

Every mutation preview and command includes `expectedRunRevision`. The service
classifies the proposed change against that exact revision. An accepted change
advances `runRevision`; a stale command produces a typed conflict and no
physical action.

`snapshotVersion` orders complete client projections. `eventCursor` begins the
incremental stream after the snapshot. Neither value substitutes for
`runRevision`: presentation can change without changing the execution contract.

`leaseRevision` orders control ownership independently. Control transfer must
not advance the run revision or silently cancel an already accepted operation.

## Scenario Matrix

All scenarios use one M27 capture run started from plan revision 7. The owner
desktop begins at run revision 12, frame 14 of 24, while a remote friend and a
phone are viewers.

| Scenario | Canonical truth and evidence | Decision or automatic result | Invariant under test |
| --- | --- | --- | --- |
| Baseline | Owner desktop is online and holds lease 4; friend and phone are viewers; snapshot and preview timestamps are current | Continue the approved sequence | Every client can identify freshness, run revision, and controller without opening settings |
| Future edit | Add six NGC 7000 exposures after the active M27 sequence; +18 minutes and +2.1 GB; based on run revision 12 | Apply directly as non-disruptive run revision 13, then announce it in history | A deliberate apply action needs no urgent confirmation when current work is untouched |
| Forecast-changing edit | Reorder two later targets; expected completion moves 27 minutes and one target loses 14 minutes of useful altitude | Review the forecast consequence, then apply or revise | Notice is proportional to impact and appears before application |
| Disruptive edit | Switch to M31 now; abort 112 seconds of the current 180-second exposure, discard the incomplete frame, slew, and reacquire for about six minutes | Explicitly approve the exact consequences or keep the current run | High urgency explains physical and evidence loss rather than asking a generic confirmation question |
| Concurrent revision | Another client applies a future edit first, advancing the run from revision 12 to 13 | Reject the revision-12 command, refresh canonical truth, and preserve the unsubmitted local edit for review or rebase | Stale intent performs no partial mutation and never reaches hardware |
| Temporary disconnect | The owner browser loses its stream during an exposure | Show reconnecting, last-confirmed time, stale preview age, disabled mutation controls, and that the service-run continues | Unknown client state is not presented as live truth and browser loss does not affect the run |
| Reconstructed reconnect | A fresh snapshot arrives at run revision 14 with three durable changes since the client's event cursor | Replace the projection atomically, then summarize what changed while away before consuming newer events | A snapshot precedes incremental events; client-local navigation may survive but canonical state is replaced |
| Control request | Remote friend requests control while the owner holds lease 4 | Owner may grant the named client; all clients then show the friend as controller at lease 5 | Requesting control grants no authority; one explicit grant changes future mutation eligibility |
| Controller grace | The remote controller disconnects | Mark the controller reconnecting for a 60-second grace period; run continues; owner may take over immediately; expiry releases to no controller | Disconnect never stops the run or silently transfers control |
| Owner takeover | Owner takes control while the friend holds or is reconnecting on lease 5 | Advance to lease 6 and authorize the owner for future commands; do not cancel already accepted work | Takeover is explicit, globally visible, and separate from stop or recovery |
| Superseded controller | While Maya holds control, she issues `Skip remaining M27 frames`; network delay means the service receives that in-flight lease-5 command only after owner takeover advances control | Reject with `ControlLeaseLost`, show that control returned to the owner, and perform no physical action | Lease revision protects an in-flight command race without permitting a viewer command, client buffering, or automatic resend |
| Read-only phone | Phone receives the same current snapshot during every scenario | Show run, warnings, freshness, viewers, and controller; offer no mutation or control-request actions | Responsive projection changes capability, not canonical truth |

## Mutation Impact Classifier

The service returns one closed impact variant. Renderer labels and action
eligibility consume this result; they do not reproduce the classifier from
button names or the active phase.

| Impact | Meaning | Interaction |
| --- | --- | --- |
| `nonDisruptive` | Current operation and its evidence are untouched; only future execution changes | Show exact diff and forecast, then apply without an urgent confirmation dialog |
| `notice` | Current work is safe, but timing, viability, stop conditions, or queued work change materially | Require a consequence review before apply |
| `disruptive` | Current physical work, evidence, target, acquisition contract, or safety constraint changes | Require high-urgency approval bound to the previewed revision and consequences |
| `ineligible` | The change cannot safely or truthfully apply in the current state | Explain the blocking invariant and expose only valid alternatives |

The classifier returns concrete consequences such as aborted elapsed exposure,
discarded provisional evidence, expected movement, reacquisition time, storage
delta, schedule delta, and affected sequences. Severity is derived from those
domain facts, not independently stored by the client.

## Reconnect And Freshness Model

A connected client is `current` only after it has decoded a complete snapshot
and begun consuming events after that snapshot's `eventCursor`.

During loss of the stream:

- canonical mutation controls are disabled;
- the last-confirmed timestamp and preview age remain visible;
- the UI says the observatory service continues the run, not that the browser
  knows the current physical state;
- client-local workspace, selection, and unsubmitted draft text may remain;
- no buffered observing command is automatically sent after reconnect.

On reconnect, the client atomically replaces service-owned, device-reported,
and derived projection state from the fresh snapshot. It may then summarize
durable changes since its previous cursor. Incremental events are accepted only
after the snapshot version they follow; older or duplicate delivery cannot
rewind the projection.

## Presence And Control-Lease Policy

Presence describes authenticated viewing clients and is ephemeral. It is not
authority. Each presence record has a stable client identity for the session,
person identity, device label, connection quality, last-seen time, and
capability (`viewer` or control-capable desktop).

The control lease is service-owned and exclusive:

1. only its current holder may issue observing mutations;
2. a viewer may request control but remains a viewer until granted;
3. an owner may grant, decline, or take control;
4. every grant, release, expiry, and takeover advances `leaseRevision`;
5. already accepted work is not implicitly cancelled by lease transfer;
6. a disconnected controller retains a visibly reconnecting lease for 60
   seconds, during which the owner may take over immediately;
7. grace expiry releases the lease to no controller rather than silently
   assigning authority; and
8. the first phone client is always read-only and cannot request or hold the
   lease.

The 60-second grace period is a prototype policy to test, not a universal
security constant.

## Candidate Backend Contract

### Canonical records

- `ActiveRunSnapshot`: run identity, source plan revision, run revision,
  current execution, warnings, approvals, latest trusted device state,
  evidence references, and mutation history summary.
- `RunMutationPreview`: identity, expected run revision, normalized proposed
  change, impact variant, exact consequences, eligibility, expiry, and approval
  requirement.
- `AppliedRunMutation`: preview identity, prior and resulting run revisions,
  actor, decision, normalized change, consequences, and correlation.
- `ClientPresence`: person, client session, device, connection freshness,
  capability, and last-seen time.
- `ControlLease`: holder, lease revision, granted by, granted time, connection
  state, grace deadline, and capability.
- `ObservatorySnapshot`: snapshot version, event cursor, server time, active run,
  presence, lease, and current client eligibility.

### Intent commands

- `PreviewRunMutation(expectedRunRevision, proposedChange)`
- `ApplyRunMutation(expectedRunRevision, previewId, idempotencyKey)`
- `ApproveDisruptiveRunMutation(expectedRunRevision, previewId, approvalId,
  idempotencyKey)`
- `RequestControl(expectedLeaseRevision)`
- `GrantControl(expectedLeaseRevision, requestId)`
- `DeclineControl(expectedLeaseRevision, requestId)`
- `ReleaseControl(expectedLeaseRevision)`
- `TakeControl(expectedLeaseRevision)`

Identity and role come from authenticated server context, never caller-supplied
person fields. Observing commands also carry the expected lease revision or an
equivalent lease token in addition to any run-revision guard.

### Durable events

- `RunMutationApplied`
- `RunMutationRejected`
- `RunRevisionAdvanced`
- `DisruptiveMutationApproved`
- `ControlRequested`
- `ControlGranted`
- `ControlDeclined`
- `ControlReleased`
- `ControlLeaseExpired`
- `OwnerTookControl`

Presence heartbeats, connection quality, exposure countdown, and preview age
are transient or replaceable state rather than durable history events.

### Typed failures

- `RunRevisionConflict(currentRevision, expectedRevision, snapshotVersion)`
- `MutationPreviewExpired(currentRevision, previewId)`
- `MutationRequiresApproval(previewId, consequences)`
- `MutationIneligible(reasons)`
- `ControlLeaseRequired(currentHolder, leaseRevision)`
- `ControlLeaseConflict(currentHolder, currentRevision, expectedRevision)`
- `ControlLeaseLost(currentHolder, currentRevision)`
- `ControlRequestExpired(requestId)`
- `ClientReadOnly(capability)`
- `ReconnectRequired(snapshotVersion)`

These are Effect Schema candidate contracts for Gate 5. Gate 3 tests whether
their meaning is sufficient and visible; it does not promote static prototype
objects into production schemas.

## State Ownership

| State | Owner | Client behavior |
| --- | --- | --- |
| Source plan and run revisions | Observatory service | Project semantic labels; include expected revision with intent and expose raw IDs only in diagnostics |
| Mutation classification and consequences | Observatory service | Explain the returned decision; never recreate it |
| Active physical and workflow state | Service reconciled with device and evidence | Render snapshot and streamed updates |
| Snapshot version and event cursor | Observatory service | Replace atomically, then accept subsequent events |
| Presence and connection quality | Service or remote hub | Show as ephemeral status |
| Control lease and current eligibility | Observatory service | Gate controls from explicit eligibility projection |
| Workspace, selected row, open Inspector, unsent edit | Client | Preserve when useful without treating it as canonical |

## User Research Protocol

Do not explain the intended model before each walkthrough. For every scenario,
ask the operator to narrate:

1. what the observatory is doing now;
2. whether the visible information is current;
3. what will happen if they take the primary action;
4. who can act and why;
5. what evidence supports that belief; and
6. what they would do next.

Record misunderstandings before asking for preference. A visually preferred
state does not pass if the operator misidentifies current work, consequence,
freshness, or authority. After comprehension, ask what feels noisy, missing,
or disproportionately alarming.

## Exit Criteria

Promote this gate when:

- the operator distinguishes the plan that started the run, the current active
  run, and a client-local draft without needing implementation terminology;
- non-disruptive, notice, disruptive, and ineligible changes have visibly
  proportional interactions;
- disruptive approval communicates exact physical, time, and evidence impact;
- stale run or lease intent visibly fails without partial action;
- reconnecting and current states cannot be mistaken for one another;
- a fresh snapshot reconstructs every canonical claim in the UI;
- every client identifies the controller and owner-takeover consequence;
- controller disconnect does not imply run interruption or invisible transfer;
- phone status remains useful with no mutation controls; and
- each consequential action maps to a candidate command, eligibility rule,
  result, and typed failure.

## Deferred Polish And Remaining Questions

Deferred copy polish is not an open semantic issue. Exact card titles,
supporting sentences, `Review against current run` wording, and small
duplications may be refined when the final layout converges, without reopening
the selected authority or interaction model.

The following non-blocking semantic questions remain for later contract work
or final convergence:

- Should the prototype's 60-second controller reconnect grace become a fixed
  policy, rig setting, or service configuration?
- Should every viewer see a control request, or only the owner and requester?
- Which semantic summary should represent several accepted runtime mutations
  without exposing protocol revision identifiers?
- How much reconnect history belongs in the current projection versus durable
  run history?
