# Acquire Gate Prototype

Status: accepted and completed on July 21, 2026

Prototype: [Acquire gate](../../prototype/v2-ui/acquire-prototype.html)

## Gate Question

Can one evidence-led surface make the current acquisition assessment and the
single relevant next decision obvious, while preserving enough detail to earn
the operator's trust?

Acquire is a phase of an active `Observe` run, not a workspace or a decorative
stepper. The study covers two related jobs: plate-solve target centering and
plate-solve-assisted polar alignment. It does not connect to a solver or mount.

## Selected Decisions

- Acquire remains a phase inside `Observe`, not a peer workspace.
- In-policy pointing corrections and bounded plate-solve retries are passive
  automatic activity with no operator approval control.
- Exhausting the solve-retry budget pauses Acquire and presents an explicit
  recovery decision.
- Pointing approval appears only when the requested correction is outside the
  automatic bound.
- Acquire completes only after a new image and solve verify that the target is
  inside tolerance; a mount accepting a correction is not completion.
- Manual polar guidance uses prominent Altitude and Azimuth direction cards,
  including in the read-only phone monitor.
- Image evidence remains left of judgment on wide screens and first when the
  layout stacks. Assessment and the current activity or decision remain in a
  stable judgment region.

Acceptance freezes these interaction and model decisions for the next gate.
It does not claim final visual polish or production readiness.

## Scenario Matrix

| Scenario | Evidence | Required decision |
| --- | --- | --- |
| Automatic centering correction | Solved offset is outside 45 arcseconds but within 10 arcminutes, with an attempt remaining | Automatically apply the exact bounded correction, then verify with a new image; no operator action is offered |
| Transient solve failure | Failed frame and solver diagnostics are preserved; offset is unknown; automatic retry budget remains | Automatically start the next solve attempt without moving the mount or asking the operator |
| Solve retries exhausted | Three failed frames and diagnostics are preserved; offset is still unknown | Pause Acquire and choose a longer solve exposure or skip the target, with the consequence of each option explicit |
| Approval required | Solved correction is greater than 10 arcminutes | Approve the exact requested RA/Dec correction and consequence, or revise it |
| Centered and verified | Latest image proves center error at or below 45 arcseconds | Carry evidence into Capture |
| Polar adjustment required | Measured mount axis, celestial pole, Alt/Az components, uncertainty, and progress | Physically adjust the mount and measure again |
| Polar alignment complete | Latest measurement proves axis error at or below 2 arcminutes | Accept the evidence and continue |

Each state changes hierarchy around three things: latest evidence, current
assessment, and one decision. The attempt filmstrip remains available as a
durable history rather than becoming a competing workflow.

## Prototype Policy

- Target-centered tolerance: at most 45 arcseconds.
- Automatic pointing-correction bound: at most 10 arcminutes.
- Automatic pointing-correction attempts: at most two.
- Plate-solve attempts: at most three total (the initial attempt and two
  automatic retries).
- Polar-alignment tolerance: at most 2 arcminutes.
- No plate-solve solution means the pointing offset is unknown.
- A mount accepting a movement command is not proof that acquisition
  succeeded. A subsequent image and solve must verify the result.
- Polar alignment produces physical Alt/Az guidance. Software must not imply
  it can move a non-motorized mount's adjustment controls.

These values are prototype policy, not a claim that every rig or imaging scale
should use the same defaults.

## Candidate Backend Model

The UI suggests the following canonical records:

- `AcquireSession`: target, mode, policy snapshot, status, and ordered attempt
  references, including correction and solve-retry budgets.
- `AcquisitionAttempt`: immutable identity, timestamp, source frame, operation,
  result, diagnostics, and correlation to any preceding correction.
- `SolveEvidence`: solution or explicit no-solution result, confidence,
  uncertainty, coordinates, and solver provenance.
- `SolveAttemptBudget`: maximum attempts, attempts consumed, next automatic
  attempt, and exhausted state.
- `PointingOffset`: desired center, solved center, measured vector, requested
  RA/Dec or image-axis correction (the inverse vector), magnitude, coordinate
  convention, and units.
- `CorrectionProposal`: exact requested movement, policy evaluation, attempt
  number, approval state, and expected consequence.
- `PolarAlignmentMeasurement`: desired pole, measured mount axis, Alt/Az
  components, total error, uncertainty, and progress against prior evidence.
- `ManualAdjustmentInstruction`: physical direction and magnitude, clearly
  distinguished from a device command.
- `AcquireDecision`: derived automatic activity, operator recovery decision,
  or completion recommendation and the evidence/policy version that produced
  it.

Candidate intent-level commands are `RetryPlateSolve`,
`ApprovePointingCorrection`, `RevisePointingCorrection`,
`RetryPlateSolveWithLongerExposure`, `SkipAcquireTarget`,
`CapturePolarAlignmentMeasurement`, `AcceptAcquireEvidence`, and
`ContinueToCapture`. Candidate events include `SolveSucceeded`, `SolveFailed`,
`SolveRetryScheduled`, `SolveRetriesExhausted`, `AcquirePaused`,
`CorrectionProposed`, `CorrectionStarted`, `CorrectionApproved`,
`CorrectionCommandAccepted`, `CorrectionVerified`,
`PolarMeasurementRecorded`, and `AcquireCompleted`.

The service, not a browser component, should own the authoritative policy
decision and attempt lineage. A client can project overlays and explanatory
copy from that model.

## Model Invariants

1. A no-solution result never exposes a calculated offset or enabled
   correction.
2. Attempt evidence is append-only; retries do not replace failed frames.
3. A failed solve automatically retries while its bounded budget remains; it
   does not become an operator decision or critical run failure until the
   budget is exhausted.
4. Every solve failure consumes exactly one attempt, and an exhausted budget
   cannot schedule another automatic solve.
5. Automatic correction is eligible only when the solve is valid, the target
   is not already centered, the magnitude is within policy, and an attempt
   remains.
6. An eligible automatic correction is activity, not an approval action.
7. Correction acceptance and correction verification are distinct events.
8. Acquire completes only from image-derived evidence inside tolerance.
9. Polar guidance is a manual instruction unless the rig explicitly declares
   motorized Alt/Az capability.
10. Altitude and azimuth guidance direction and magnitude are derived from the
    same measurement used by the overlay and remain visible on the phone.
11. A read-only phone projection exposes no mutation commands.

## Exit Criteria

Promote this gate into the V2 interaction specification when:

- each scenario has exactly one clear next decision;
- automatic retry, exhausted recovery, approval, and completion states cannot
  be mistaken for one another;
- operators can explain why automation is eligible or blocked from the
  visible evidence and policy;
- the overlay remains legible for small and large errors without falsifying
  magnitude or direction;
- manual polar guidance is physically intelligible and never reads like a
  software-controlled adjustment;
- selecting an attempt reveals its durable evidence while leaving the current
  run state intact; and
- the phone layout communicates status, latest evidence, recommendation, and
  history without actionable controls.

## Open Questions

- Should default tolerances be derived from image scale, target framing, and
  mount characteristics instead of fixed rig policy?
- Which coordinate convention should lead in the UI: RA/Dec correction,
  image-axis correction, or both with an explicit transform?
- What solver diagnostics are useful to a person after a no-solution result?
- Should longer-exposure recovery restart the three-attempt budget, or consume
  a separate bounded recovery budget?
- Which solve failures are truly retryable, and which should pause immediately
  because another identical attempt cannot help?
- How should backlash and correction settling influence the automatic-attempt
  count?
- Is a polar-alignment progress vector enough, or should the operator also see
  a short history plot and adjustment overshoot?
- Which evidence must be retained permanently versus only for the run?
