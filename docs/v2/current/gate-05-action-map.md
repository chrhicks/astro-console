# Gate 5 Consequential-Action Map

Status: **accepted July 22, 2026**

This document maps the accepted Gate 5 scenarios to service-facing intent
contracts. It follows the accepted
[scenario and state-ownership baseline](gate-05-scenarios.md) and does not
define production schemas, transports, database tables, or adapter APIs.

The map answers the same seven questions for every meaningful mutation:

1. Who may request it?
2. When is it eligible?
3. What freshness must the request prove?
4. What one intent does the client express?
5. What deterministic result follows acceptance?
6. What durable evidence records the result?
7. Which typed failures reject it before physical or durable action?

## Contract-Wide Rules

1. **Identity is server context.** Commands never accept a caller-supplied
   person, role, or membership as authority.
2. **Capability is enforced twice.** Snapshots project current eligibility for
   useful UI, and the service rechecks it when handling the command. Hidden or
   disabled controls are not authorization.
3. **Freshness is aggregate-specific.** Run, lease, Acquire, Process, and asset
   publication state do not share one revision counter.
4. **Physical and durable commands are idempotent.** A transport retry with the
   same key returns the recorded result; reuse with different normalized input
   fails.
5. **Acceptance is not physical verification.** A driver accepting movement or
   a worker accepting work records a started result. Later image, tool, or
   storage evidence records the verified outcome.
6. **Rejection is side-effect free.** Authorization, capability, revision,
   eligibility, parameter, and resource checks finish before physical or
   durable mutation.
7. **The server snapshot wins.** Conflict and reconnect results provide enough
   current truth to replace browser state. Clients never replay a rejected or
   disconnected command automatically.
8. **Queries do not masquerade as commands.** Opening Inspector, viewing
   diagnostics, comparing images, and reading provenance may require
   authorization, but do not advance domain revisions.

## Shared Guards

| Guard | Required by | Meaning |
| --- | --- | --- |
| Authenticated membership | Every non-public query and intent | The service maps ingress identity to current local `owner` or `viewer` membership |
| Desktop mutation capability | Every user mutation | The initial phone client and other read-only clients cannot mutate, even for the owner |
| `expectedPlanRevision` | Starting a run from a validated plan | The plan validated by the operator is still the plan being accepted for execution |
| `expectedLeaseRevision` | Run start, observing mutations, Acquire decisions that advance or move hardware | The requesting desktop still holds the exclusive control lease it observed |
| `expectedRunRevision` | Run start preconditions and active-run mutations | The execution contract has not changed since preview or decision |
| `expectedAcquireRevision` | Acquire recovery, correction approval, measurement, and completion decisions | Attempts, evidence, policy evaluation, and budgets are still the state reviewed by the operator |
| `expectedProcessingRevision` | Process preview, Apply, history, retry, save, switch, and discard | The session history, preview input, and lifecycle have not changed |
| `expectedAssetRevision` | Publication, republish, and prepared-download transitions | Availability and representation state have not changed |
| Preview or proposal identity | Applying a run mutation, disruptive approval, applying Process preview | The command is bound to the exact service-produced normalized input and consequences |
| Idempotency key | Every physical or durable mutation | Duplicate delivery cannot duplicate movement, history, assets, or lifecycle changes |

`expectedAcquireRevision` and `expectedAssetRevision` are Gate 5 contract
candidates. Their final storage representation may differ, but the freshness
boundary must exist independently of snapshot and event-stream ordering.

## Shared Accepted And Rejected Results

An accepted command returns a domain-specific result plus:

- command/correlation identity;
- prior and resulting aggregate revisions where a revision advances;
- normalized accepted input;
- actor identity derived from server context;
- durable event or record references;
- current snapshot version or a projection refresh hint; and
- asynchronous operation identity when verification will complete later.

A rejected command returns one typed failure plus current relevant revisions
and a refresh hint. It records no success event, advances no aggregate, and
reaches no device, processing tool, publisher, or storage mutation.

## Plan And Active-Run Actions

| ID | Scenarios | Named intent | Authorization and eligibility | Freshness | Deterministic accepted result and durable evidence | Typed failures |
| --- | --- | --- | --- | --- | --- | --- |
| `RUN-A01` | `RUN-01` | `StartRunFromPlan` | Current desktop controller; plan validation is `ready` or explicitly accepted `readyWithLimitations`; rig and safety-critical state are known; no conflicting active run | `expectedPlanRevision`, `expectedLeaseRevision`, start precondition token, idempotency key | Create immutable `RunDefinition`, record `RunStarted`, initialize run revision, and begin Preflight; later device transitions remain separately verified | `ClientReadOnly`, `ControlLeaseRequired`, `ControlLeaseConflict`, `PlanRevisionConflict`, `PlanNotReady`, `ActiveRunConflict`, `CriticalStateUnknown`, `IdempotencyConflict` |
| `RUN-A02` | `RUN-02`–`RUN-05` | `PreviewRunMutation` | Authenticated owner on desktop; proposed change decodes and refers to the active run; holding the lease is not required because preview cannot mutate execution | `expectedRunRevision` | Return expiring `RunMutationPreview` with normalized change, closed impact, exact consequences, eligibility, and approval requirement; preview is canonical ephemeral state, not accepted history | `OwnerRequired`, `ClientReadOnly`, `RunRevisionConflict`, `MutationIneligible`, `ProposedChangeInvalid`, `ReconnectRequired` |
| `RUN-A03` | `RUN-02`, `RUN-03`, `RUN-06` | `ApplyRunMutation` | Current desktop controller; preview is eligible and `nonDisruptive` or reviewed `notice`; disruptive previews cannot use this intent | `expectedRunRevision`, `expectedLeaseRevision`, preview identity/expiry, idempotency key | Apply normalized change exactly once, advance run revision once, record `RunMutationApplied` with consequences, and return refreshed run projection | `ClientReadOnly`, `ControlLeaseRequired`, `ControlLeaseLost`, `RunRevisionConflict`, `MutationPreviewExpired`, `MutationRequiresApproval`, `MutationIneligible`, `IdempotencyConflict` |
| `RUN-A04` | `RUN-04`, `RUN-06` | `ApproveDisruptiveRunMutation` | Current desktop controller; preview remains eligible and disruptive; approval identity is bound to the displayed consequences | Same guards as `RUN-A03` plus approval identity | Record approval and applied mutation atomically, advance run revision once, then start the described abort/move/reacquire effects; durable evidence preserves approved loss and later physical outcomes separately | `ClientReadOnly`, `ControlLeaseRequired`, `ControlLeaseLost`, `RunRevisionConflict`, `MutationPreviewExpired`, `ApprovalMismatch`, `MutationIneligible`, `IdempotencyConflict` |
| `RUN-A05` | Observe intervention | `PauseRun` | Current desktop controller; run is active and not already paused or terminal | `expectedRunRevision`, `expectedLeaseRevision`, idempotency key | Advance run revision once, preserve the resumable phase, record `RunPaused`, and queue pause work without treating browser disconnect as pause | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AlreadyPaused`, `AlreadyTerminal`, `IdempotencyConflict` |
| `RUN-A06` | Observe intervention | `ResumeRun` | Current desktop controller; run is paused with a preserved resumable phase | Same guards as `RUN-A05` | Advance run revision once, restore the preserved phase, record `RunResumed`, and queue resume work | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `NotPaused`, `ResumePhaseUnavailable`, `IdempotencyConflict` |
| `RUN-A07` | Observe intervention | `StopRun` | Current desktop controller; run is not already terminal | Same guards as `RUN-A05` | Advance run revision once, enter terminal stopped state, record `RunStopped`, and queue explicit stop work; stopping is never inferred from navigation or disconnect | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AlreadyTerminal`, `IdempotencyConflict` |

Keeping the current run, cancelling a preview, and abandoning an unsent local
edit issue no domain command. A conflict may leave the edit visible during the
current page lifetime, but refresh discards it.

## Presence And Exclusive-Control Actions

| ID | Scenarios | Named intent | Authorization and eligibility | Freshness | Deterministic accepted result and durable evidence | Typed failures |
| --- | --- | --- | --- | --- | --- | --- |
| `LEASE-A01` | `LEASE-01` | `RequestControl` | Authenticated control-capable desktop viewer; requester is not current holder; no active request from the same client | `expectedLeaseRevision`, request idempotency key | Create expiring request without changing the lease; record `ControlRequested`; requester remains viewer | `ClientReadOnly`, `AlreadyController`, `ControlRequestAlreadyPending`, `ControlLeaseConflict`, `IdempotencyConflict` |
| `LEASE-A02` | `LEASE-02` | `GrantControl` | Current owner; named request is pending and target remains control-capable | `expectedLeaseRevision`, request identity/expiry, idempotency key | Advance lease revision once, assign named client, record `ControlGranted`; already accepted run work continues | `OwnerRequired`, `ClientReadOnly`, `ControlLeaseConflict`, `ControlRequestExpired`, `ControlTargetUnavailable`, `IdempotencyConflict` |
| `LEASE-A03` | `LEASE-01` | `DeclineControl` | Current owner; named request is pending | `expectedLeaseRevision`, request identity/expiry, idempotency key | Resolve request without changing holder; record `ControlDeclined` | `OwnerRequired`, `ClientReadOnly`, `ControlLeaseConflict`, `ControlRequestExpired`, `IdempotencyConflict` |
| `LEASE-A04` | Baseline control lifecycle | `ReleaseControl` | Current lease holder on a control-capable desktop | `expectedLeaseRevision`, idempotency key | Advance lease revision once, assign no controller, record `ControlReleased`; run continues | `ClientReadOnly`, `ControlLeaseRequired`, `ControlLeaseLost`, `IdempotencyConflict` |
| `LEASE-A05` | `LEASE-03`, `LEASE-04` | `TakeControl` | Authenticated owner on control-capable desktop; another client holds or is reconnecting, or no holder exists | `expectedLeaseRevision`, idempotency key | Advance lease revision once, assign owner client, resolve incompatible pending requests, and record `OwnerTookControl`; accepted work is not cancelled | `OwnerRequired`, `ClientReadOnly`, `ControlLeaseConflict`, `IdempotencyConflict` |

Controller disconnect and grace expiry are service transitions, not client
commands. Disconnect marks the lease reconnecting without advancing ownership;
expiry advances the lease to no controller and records `ControlLeaseExpired`.
Every lease-guarded intent received after transfer fails `ControlLeaseLost`
before domain or hardware action, covering `LEASE-05` and `LEASE-06`.

## Acquire Actions

| ID | Scenarios | Named intent | Authorization and eligibility | Freshness | Deterministic accepted result and durable evidence | Typed failures |
| --- | --- | --- | --- | --- | --- | --- |
| `ACQ-A01` | `ACQ-03` | `RetryPlateSolveWithParameters` | Current desktop controller; Acquire is paused after exhausted or immediately non-retryable failure; changed parameters are valid and materially different when opening a new recovery series | `expectedRunRevision`, `expectedAcquireRevision`, `expectedLeaseRevision`, idempotency key | Snapshot changed parameters, open one new bounded recovery series, append the next attempt, record `AcquireRecoveryStarted`; no movement occurs until valid solve evidence exists | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AcquireRevisionConflict`, `AcquireNotPaused`, `RecoveryParametersInvalid`, `RecoveryBudgetUnavailable`, `IdempotencyConflict` |
| `ACQ-A02` | `ACQ-03` | `SkipAcquireTarget` | Current desktop controller; Acquire is paused and run policy permits skip | Same revisions and idempotency guard as `ACQ-A01` | Record skipped target and evidence/reason, advance run workflow to the policy-selected next work, and record `AcquireTargetSkipped`; any resulting movement is separately executed and verified | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AcquireRevisionConflict`, `SkipIneligible`, `NoFallbackWork`, `IdempotencyConflict` |
| `ACQ-A03` | `ACQ-04` | `ApprovePointingCorrection` | Current desktop controller; exact service proposal is valid, outside automatic bound, within hard safety/policy bounds, and has an attempt remaining | Run, Acquire, and lease revisions; proposal identity/expiry; idempotency key | Record `CorrectionApproved`, start the exact movement, then require a new capture/solve attempt; mount acknowledgement records start, never completion | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AcquireRevisionConflict`, `CorrectionProposalExpired`, `CorrectionProposalMismatch`, `CorrectionIneligible`, `IdempotencyConflict` |
| `ACQ-A04` | `ACQ-04` | `RevisePointingCorrection` | Current desktop controller; proposal is still current; revised bounded values decode and remain safe | Run, Acquire, and lease revisions; proposal identity | Return a new service-evaluated proposal and consequences; do not move or consume a correction attempt | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AcquireRevisionConflict`, `CorrectionProposalExpired`, `CorrectionParametersInvalid`, `CorrectionIneligible` |
| `ACQ-A05` | `ACQ-06` | `CapturePolarAlignmentMeasurement` | Current desktop controller; polar workflow is waiting for measurement; rig is in the required safe orientation and capture/solver capabilities are available | Run, Acquire, and lease revisions; idempotency key | Append measurement attempt, capture and solve asynchronously, record `PolarMeasurementRecorded` or typed attempt failure, and project manual Alt/Az guidance when solved | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AcquireRevisionConflict`, `PolarMeasurementIneligible`, `RigStateUnsafe`, `CapabilityUnavailable`, `IdempotencyConflict` |
| `ACQ-A06` | `ACQ-07` | `AcceptPolarAlignmentEvidence` | Current desktop controller; latest measurement is solved, current, and within policy tolerance; no newer attempt is pending | Run, Acquire, and lease revisions; measurement identity; idempotency key | Record operator acceptance and `PolarAlignmentCompleted`, then allow the active run to continue | `ClientReadOnly`, `ControlLeaseLost`, `RunRevisionConflict`, `AcquireRevisionConflict`, `MeasurementSuperseded`, `PolarToleranceNotMet`, `IdempotencyConflict` |

### Acquire Service Transitions

These visible transitions are deterministic service behavior, not browser
intents:

| Transition | Scenarios | Preconditions | Result and evidence | Failure behavior |
| --- | --- | --- | --- | --- |
| `EvaluateSolveAttempt` | `ACQ-01`–`ACQ-05` | Newly completed immutable solve attempt and policy snapshot | Produce explicit solution or no-solution evidence and advance Acquire revision exactly once | Invalid solver output becomes typed no-solution/diagnostic evidence, never a fabricated offset |
| `ScheduleBoundedSolveRetry` | `ACQ-02` | No solution, retryable failure, budget remains | Consume exactly one attempt slot, append `SolveRetryScheduled`, and start next attempt without movement | Exhaustion or non-retryable category pauses Acquire instead of scheduling |
| `StartAutomaticPointingCorrection` | `ACQ-01` | Valid solve, outside tolerance, inside automatic bound, attempt remains, rig safe | Record proposal evaluation and start exact correction; append attempt correlation | Any failed precondition pauses or re-evaluates without movement |
| `VerifyPointingCorrection` | `ACQ-05` | Movement was acknowledged and subsequent solved frame exists | Record `CorrectionVerified`; if within tolerance, complete target Acquire and continue to Capture; otherwise re-evaluate policy | Driver acknowledgement alone never completes Acquire |
| `PauseAcquireForRecovery` | `ACQ-03` | Budget exhausted or failure cannot improve by identical retry | Record `AcquirePaused`, preserve every attempt, and project only eligible recovery choices | It never converts a target failure into a whole-observatory failure by default |

The ordinary centered-and-verified path advances to Capture automatically. It
does not require a confirmation after every target. Polar completion remains
explicit because the operator performed the physical adjustment.

## Process Actions

| ID | Scenarios | Named intent | Authorization and eligibility | Freshness | Deterministic accepted result and durable evidence | Typed failures |
| --- | --- | --- | --- | --- | --- | --- |
| `PROC-A01` | `PROC-01`, `PROC-02`, `LIB-04` | `StartProcessingSession` | Owner on desktop; every source asset is authorized, available, compatible, and has stable identity; no caller path is accepted | Source asset revisions/facts, idempotency key | Create durable resumable session with source lineage; raws start in Build, valid linear master starts in Develop; record `ProcessingSessionStarted` | `OwnerRequired`, `ClientReadOnly`, `SourceAssetUnavailable`, `SourceSelectionInvalid`, `SourceRoleUnsupported`, `ProcessingServiceUnavailable`, `StorageReserveProtected`, `IdempotencyConflict` |
| `PROC-A02` | `PROC-11`, `PROC-12` | `ResumeProcessingSession` | Owner on desktop; session exists, is unfinished, and sources/checkpoints remain resolvable | `expectedProcessingRevision` | Select the existing session as current and return its authoritative snapshot; no edit-history event is invented | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionUnavailable`, `ProcessingSessionRevisionConflict`, `SourceAssetUnavailable` |
| `PROC-A03` | `PROC-03` | `SyncProcessingPreview` | Owner on desktop; selected operation and installed tool are compatible; complete debounced parameters validate; session is editable | `expectedProcessingRevision`; base operation/history identity; client preview sequence for response ordering | Store latest accepted temporary preview specification, supersede older preview work, advance processing revision without changing applied history, start or reuse preview computation, and return preview identity/progress | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `ProcessingStepIneligible`, `ToolUnavailable`, `ToolParameterInvalid`, `PreviewInputSuperseded`, `ProcessingServiceUnavailable`, `StorageReserveProtected` |
| `PROC-A04` | `PROC-04`, `PROC-06` | `ApplyProcessingPreview` | Owner on desktop; preview completed successfully and still targets the current history position/input | `expectedProcessingRevision`, preview identity, idempotency key | Append one applied operation/provenance record and full-resolution attempt, replace the redo path after undo, advance processing revision once, record `ProcessingStepApplyStarted`, and retain the last valid image until completion | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `PreviewUnavailable`, `PreviewSuperseded`, `PreviewFailed`, `ToolUnavailable`, `StorageReserveProtected`, `IdempotencyConflict` |
| `PROC-A05` | `PROC-05` | `UndoProcessingStep` | Owner on desktop; applied history has a prior position and no incompatible lifecycle transition is active | `expectedProcessingRevision`, idempotency key | Move history position back once, select corresponding valid output, advance processing revision, record `ProcessingHistoryMoved` | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `UndoUnavailable`, `ProcessingTransitionBusy`, `IdempotencyConflict` |
| `PROC-A06` | `PROC-05` | `RedoProcessingStep` | Same as Undo, with a retained redo position | Same as Undo | Move history position forward once, select corresponding valid output, advance revision, record `ProcessingHistoryMoved` | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `RedoUnavailable`, `ProcessingTransitionBusy`, `IdempotencyConflict` |
| `PROC-A07` | `PROC-07` | `PreviewAssistantSuggestion` | Owner on desktop; finding remains valid for current image/operation and includes explicit proposed values | `expectedProcessingRevision`, finding identity/version | Delegate to `SyncProcessingPreview` with suggestion correlation; store visible before/after values; finding never applies by itself | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `AssistantFindingSuperseded`, `ToolParameterInvalid`, plus preview failures from `PROC-A03` |
| `PROC-A08` | Assistant notification behavior | `MarkAssistantFindingViewed` | Authenticated desktop owner; finding is visible to that person/session | Finding identity/version | Record per-person viewed state without changing image or processing revision | `OwnerRequired`, `AssistantFindingUnavailable`, `AssistantFindingSuperseded` |
| `PROC-A09` | `PROC-08` | `RetryProcessingStep` | Owner on desktop; step failed; named checkpoint remains eligible; no input changed; tool/capacity are available | `expectedProcessingRevision`, failed attempt and checkpoint identities, idempotency key | Append a new attempt for only the failed stage, preserve unaffected outputs, record `ProcessingStepRetryStarted`; completion/failure is later evidence | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `ProcessingStepNotFailed`, `CheckpointIneligible`, `RetryInputChanged`, `ToolUnavailable`, `ProcessingServiceUnavailable`, `StorageReserveProtected`, `IdempotencyConflict` |
| `PROC-A10` | `PROC-12` | `SwitchProcessingContext` | Owner on desktop; destination sources/session are authorized and compatible; current-session disposition is explicit | Current `expectedProcessingRevision`; destination revision/facts; idempotency key | Closed disposition: `leaveUnfinished` retains resumable state; `saveAndSwitch` completes selected saves before switching; `discardAndSwitch` deletes eligible work before switching. Failure before disposition completion leaves current session selected and intact | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `DestinationUnavailable`, `DispositionRequired`, save failures from `PROC-A11`, discard failures from `PROC-A12`, `IdempotencyConflict` |
| `PROC-A11` | `PROC-13` | `SaveProcessingArtifacts` | Owner on desktop; selected formats/outputs are valid and complete; permanent storage reserve permits save | `expectedProcessingRevision`, selected output/checkpoint identities, idempotency key | Create all selected Library asset records and permanent bytes as one logical save outcome, link lineage/provenance, record `ProcessingArtifactsSaved`; session remains a working resource | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `SaveSelectionInvalid`, `ProcessingOutputUnavailable`, `StorageReserveProtected`, `ArtifactWriteFailed`, `IdempotencyConflict` |
| `PROC-A12` | `PROC-14` | `DiscardProcessingSession` | Owner on desktop; exact destructive scope was presented; session is not already discarded; saved assets and original sources are excluded | `expectedProcessingRevision`, discard confirmation identity, idempotency key | Atomically mark session discarded and inaccessible as working state, retain source and saved asset identities, record `ProcessingSessionDiscarded`, then schedule eligible scratch cleanup | `OwnerRequired`, `ClientReadOnly`, `ProcessingSessionRevisionConflict`, `DiscardConfirmationMismatch`, `ProcessingTransitionBusy`, `IdempotencyConflict` |

`Reset preview`, selecting a processing step/tool before the debounced sync,
opening a context tab, holding comparison, cancelling a switch modal, and
viewing sanitized diagnostics are not durable mutation commands. Resetting a
server-accepted preview may use `SyncProcessingPreview` with the current
applied parameters; it does not need a second preview model.

### Process Service Transitions

| Transition | Scenarios | Preconditions | Result and evidence | Failure behavior |
| --- | --- | --- | --- | --- |
| `CompleteProcessingPreview` | `PROC-03`, `PROC-07` | Preview computation corresponds to latest accepted preview identity | Publish temporary preview output/progress and retain prior valid canvas until ready | Older completion is ignored as superseded; failure preserves prior valid image |
| `CompleteProcessingAttempt` | `PROC-04`, `PROC-08` | Worker result decodes and matches attempt/tool/input identities | Success records exact tool/version/parameters, output/checkpoint, advances the current valid image, and emits `ProcessingStepCompleted`; failure records diagnostics and `ProcessingStepFailed` while preserving the previous valid image | Unknown output fails at the adapter boundary and cannot become a valid checkpoint |
| `EvaluateProcessingPressure` | `PROC-09`, `PROC-10` | Timestamped host measurements cross policy | Continue, throttle, or exceptionally pause with measured reason and recovery threshold | Active capture by itself cannot produce a throttle decision |
| `ResumeProcessingAfterPressure` | `PROC-10` | Measured condition clears for configured stability window | Resume eligible queued/running work and clear the pressure reason | Observatory and publication health remain separately projected |
| `CleanupDiscardedSession` | `PROC-14` | Session is durably discarded and scratch references are no longer reachable as working state | Remove eligible preview/cache/checkpoint bytes under retention policy | Cleanup failure records retryable diagnostics and storage pressure; it does not resurrect the session or turn a successful Discard into a rejected command |

## Library And Delivery Actions

| ID | Scenarios | Named intent | Authorization and eligibility | Freshness | Deterministic accepted result and durable evidence | Typed failures |
| --- | --- | --- | --- | --- | --- | --- |
| `LIB-A01` | `LIB-02` | `RequestAssetDownload` | Authenticated authorized member; stable asset and requested representation are downloadable; request path is classified LAN or remote by trusted server context | Current asset/representation facts; request idempotency key for staging | LAN: authorize bounded direct stream from Arch. Remote with valid stage: issue short-lived R2 grant. Remote without stage: create/reuse staging operation, set `preparing`, and return operation identity; record audited request without exposing path/key | `AssetNotFound`, `AssetAccessDenied`, `AssetRepresentationUnavailable`, `LocalOriginalUnavailable`, `DownloadConcurrencyLimited`, `PublisherUnavailable`, `R2Unavailable`, `IdempotencyConflict` |
| `LIB-A02` | `LIB-03` | `RepublishAssetRepresentation` | Owner on desktop; permanent local source exists; requested class may be published; no equivalent valid publication already exists | `expectedAssetRevision`, source checksum, idempotency key | Create/reuse publication operation, mark representation `republishing`, upload/verify asynchronously, and preserve stable asset identity; record `AssetRepublicationStarted` | `OwnerRequired`, `ClientReadOnly`, `AssetRevisionConflict`, `LocalSourceUnavailable`, `RepresentationAlreadyPublished`, `PublisherUnavailable`, `StorageRepresentationIneligible`, `IdempotencyConflict` |
| `LIB-A03` | `LIB-04`, `PROC-01`, `PROC-02` | `OpenAssetInProcess` | Owner on desktop; asset role is valid Process input and source is locally resolvable | Current asset facts; optional unfinished-session identity | Resolve to `ResumeProcessingSession` when an unfinished matching session is selected, otherwise `StartProcessingSession`; never pass a path or R2 key | `OwnerRequired`, `ClientReadOnly`, `AssetNotFound`, `SourceAssetUnavailable`, `SourceRoleUnsupported`, plus Process start/resume failures |

### Library And Publisher Transitions

| Transition | Scenarios | Preconditions | Result and evidence | Failure behavior |
| --- | --- | --- | --- | --- |
| `CompleteStagedDownload` | `LIB-02` | Upload matches stable asset/checksum and active staging operation | Verify R2 object, mark representation ready with expiry, then allow short-lived grant issuance | Failure records `failedPublication`; local original and asset identity remain available |
| `CompleteRepublication` | `LIB-03` | Upload and verification match requested representation | Mark published representation ready and record expiry/checksum | Failure leaves permanent local source unchanged and republish retryable |
| `ExpirePublishedRepresentation` | `LIB-03` | Lifecycle observation confirms expiry or object absence | Mark only the representation expired; retain asset, provenance, and permanent local facts | Metadata never claims ready solely because an old row exists |

Library review, saved-artifact comparison, opening provenance, and selecting
representations are authorized queries or client-transient selection. They do
not modify an asset.

## Typed Failure Catalog

The map uses domain-specific failures rather than one generic conflict or bad
request. Production schemas may group common fields, but these meanings remain
closed and distinguishable.

| Family | Candidate failures | Required UI meaning |
| --- | --- | --- |
| Identity/capability | `Unauthenticated`, `MembershipRequired`, `OwnerRequired`, `ClientReadOnly`, `AssetAccessDenied` | Who may act and which safe alternatives remain |
| Lease | `ControlLeaseRequired`, `ControlLeaseConflict`, `ControlLeaseLost`, `ControlRequestExpired` | Current controller, observed/current lease revisions, and that no observing action occurred |
| Freshness | `PlanRevisionConflict`, `RunRevisionConflict`, `AcquireRevisionConflict`, `ProcessingSessionRevisionConflict`, `AssetRevisionConflict`, `ReconnectRequired` | Current revision/snapshot hint and whether an in-page unsent edit may be reviewed |
| Preview/proposal | `MutationPreviewExpired`, `MutationRequiresApproval`, `ApprovalMismatch`, `CorrectionProposalExpired`, `CorrectionProposalMismatch`, `PreviewUnavailable`, `PreviewSuperseded`, `PreviewInputSuperseded` | Exact preview or consequence that is no longer applicable |
| Eligibility/policy | `PlanNotReady`, `MutationIneligible`, `AcquireNotPaused`, `SkipIneligible`, `CorrectionIneligible`, `PolarToleranceNotMet`, `CheckpointIneligible`, `UndoUnavailable`, `RedoUnavailable`, `DispositionRequired` | Blocking invariant and only valid next actions |
| Boundary/parameters | `ProposedChangeInvalid`, `RecoveryParametersInvalid`, `CorrectionParametersInvalid`, `ToolParameterInvalid`, `SourceSelectionInvalid`, `SaveSelectionInvalid` | Which bounded input failed validation without exposing internal decoder detail |
| Capability/availability | `CapabilityUnavailable`, `ToolUnavailable`, `ProcessingServiceUnavailable`, `PublisherUnavailable`, `R2Unavailable`, `SourceAssetUnavailable`, `LocalOriginalUnavailable` | Affected subsystem and whether retry, alternate tool, LAN access, or later action is valid |
| Resource protection | `StorageReserveProtected`, `DownloadConcurrencyLimited`, `ProcessingTransitionBusy` | Measured protection reason and recovery condition; never generic observatory failure |
| Execution/evidence | `ProcessingStepFailure`, `ArtifactWriteFailed`, `ScratchCleanupFailed`, `RigStateUnsafe`, `LocalSourceUnavailable` | Surviving evidence/checkpoints and exact retry or cleanup scope; an asynchronous cleanup failure may follow an already accepted lifecycle command |
| Idempotency | `IdempotencyConflict` | The key was reused with different normalized input; no second action was accepted |

## Scenario Coverage

| Scenarios | Covered by |
| --- | --- |
| `SHELL-01`, `SHELL-02` | Client navigation/attention routing plus owning-domain actions; no shell mutation command |
| `CLIENT-01`–`CLIENT-03` | Snapshot/stream protocol rules; no replay command |
| `PHONE-01` | Server-enforced `ClientReadOnly` across every mutation family |
| `RUN-01`–`RUN-06` | `RUN-A01`–`RUN-A04` and snapshot refresh after conflict |
| `LEASE-01`–`LEASE-06` | `LEASE-A01`–`LEASE-A05`, grace transitions, and shared lease guards |
| `ACQ-01`–`ACQ-07` | `ACQ-A01`–`ACQ-A06` plus Acquire service transitions |
| `PROC-01`–`PROC-14` | `PROC-A01`–`PROC-A12` plus Process service transitions |
| `LIB-01`–`LIB-04` | Authorized queries, `LIB-A01`–`LIB-A03`, and publisher transitions |

All 43 accepted scenarios have an intent, deterministic service transition, or
explicit classification as non-domain client/projection behavior. No action
depends on browser-owned observatory truth.

## Accepted Review Decisions

1. Centered target acquisition advances automatically to Capture after image
   verification; only the manual polar workflow waits for explicit acceptance.
2. Process switching is one guarded intent with a closed disposition so save
   or discard cannot partially complete and then silently switch:

   - `leaveUnfinished` retains the synchronized session and switches;
   - `saveAndSwitch` switches only after every selected artifact saves; a save
     failure leaves the current session intact and selected;
   - `discardAndSwitch` switches after the service durably marks the session
     discarded; later scratch-cleanup failure produces a warning/retry but
     cannot resurrect the session or require `Discard anyway`; and
   - stale revisions or incompatible active transitions reject before any
     disposition, refresh current truth, and do not offer a force-through
     safety bypass.
3. Assistant suggestion preview reuses the normal preview synchronization path
   with suggestion correlation; it is not a privileged mutation route.
4. Viewing diagnostics, comparison, provenance, and ordinary navigation remain
   queries or client-transient state rather than revision-advancing commands.
5. Each independently changing area gets its own version check. For example,
   a new plate-solve attempt can make an Acquire decision stale without
   changing the run plan, while an R2 upload or expiry can change download
   availability without changing the underlying asset. The service checks the
   version relevant to the action instead of using one global counter. This is
   an internal safety mechanism and adds no revision terminology to the normal
   UI.
