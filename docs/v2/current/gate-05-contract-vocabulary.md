# Gate 5 Canonical Contract Vocabulary

Status: **accepted July 22, 2026**

> **Current Process authority:** The Process names in this Gate 5 baseline are
> historical. `ProcessingSession` and its global snapshot are retired. Use the
> current [product specification](product-spec.md) and
> [Process workflow](process-workflow-plan.md) for the Processing Project
> lifecycle. Do not implement the retired Process vocabulary from this file.

This document gives the accepted Gate 5 scenarios and actions one shared
language before Effect Schemas, persistence records, HTTP routes, or event-bus
messages are designed. It is the compact implementation reference for what a
name means. The detailed rationale remains in the
[scenario baseline](gate-05-scenarios.md) and
[consequential-action map](gate-05-action-map.md).

## The Short Version

The service owns the observatory. A client receives one `AppSnapshot`, sends a
typed command with the relevant expected revision, and then replaces or
advances its projection only from accepted service results and subsequent
events.

Five independently changing domains matter:

| Domain | Aggregate boundary | Freshness token | Primary projection |
| --- | --- | --- | --- |
| Plan and execution | `ObservingPlan`, `ActiveRun` | `PlanRevision`, `RunRevision` | `PlanSnapshot`, `RunSnapshot` |
| Control | `ControlLease` | `LeaseRevision` | `ControlSnapshot` |
| Acquire | `ActiveRun`; `AcquireState` is embedded | `AcquireRevision` | `AcquireSnapshot` |
| Process | `ProcessingSession` | `ProcessingRevision` | `ProcessingSessionSnapshot` |
| Library and delivery | `Asset` | `AssetRevision` | `AssetSnapshot` |

`SnapshotVersion` orders complete client projections. `EventCursor` orders the
delivery stream. Neither replaces a domain revision.

## Model Discipline

This vocabulary does not imply one model, table, class, service, or endpoint
per named noun. It uses five kinds of contract concept:

| Kind | Implementation expectation |
| --- | --- |
| **Aggregate root** | Independently loaded and revised domain state with its own lifecycle |
| **Embedded record** | Durable detail owned by one aggregate; not independently mutated |
| **Operation state** | Bounded coordination for preview, attempt, publication, or delivery work |
| **Projection** | Read shape assembled for a client; not a writable or separately persisted domain model |
| **Boundary fact** | Decoded and timestamped observation or value from a device, tool, host, or provider |

Only the explicitly marked aggregate roots below are expected to become
first-class domain models. Commands, snapshots, events, failures, and service
transitions are tagged contract variants around those models.

## Naming Rules

- **Entity names are nouns:** `ProcessingSession`, `Asset`, `ControlLease`.
- **Commands are imperative user intent:** `ApplyProcessingPreview`,
  `RequestControl`.
- **Durable events are past-tense facts:** `RunStarted`,
  `ProcessingSessionDiscarded`.
- **Service transitions are verbs:** `CompleteProcessingAttempt`,
  `EvaluateSolveAttempt`. They are internal behavior, not browser commands.
- **Snapshots describe current truth:** `AcquireSnapshot`. They are projections,
  not event logs or writable client models.
- **Failures name the violated contract:** `RunRevisionConflict`, not
  `BadRequest` or `SomethingWentWrong`.
- IDs, revisions, cursors, checksums, and operation tokens are distinct branded
  values in schemas. They are never interchangeable strings or numbers.
- Filesystem paths, R2 keys, driver handles, and CLI process IDs stay behind
  service boundaries. Contracts use stable IDs and sanitized diagnostics.

## Common Contract Primitives

| Name | Meaning |
| --- | --- |
| `PersonId` | Stable local identity derived by the service from authenticated ingress context |
| `ClientId` | One connected browser/client installation; useful for presence and lease ownership, never identity authority |
| `MembershipRole` | Local `owner` or `viewer` authorization value assigned through a `Membership` record |
| `ClientCapability` | Server-returned capability such as `readOnly` or `controlCapable`; initial phone clients are read-only |
| `CommandId` | Correlation identity for one received intent |
| `IdempotencyKey` | Caller-generated identity preventing duplicate physical or durable acceptance |
| `OperationId` | Identity of asynchronous work such as a solve, processing attempt, publication, or download stage |
| `OccurredAt` | Service timestamp on a durable fact |
| `ObservedAt` | Timestamp attached to an external observation; required when freshness can decay |
| `SnapshotVersion` | Ordering token for complete client projections |
| `EventCursor` | Resume position for the incremental event stream |
| `Revision` | Aggregate-specific optimistic concurrency token; represented by branded plan, run, lease, Acquire, processing, and asset variants |
| `ActionAvailability` | Service-computed `available`, `unavailable`, or `requiresApproval` result with a typed reason and safe next actions |
| `DiagnosticRef` | Authorized reference to sanitized diagnostics; never raw secrets or internal storage identity |

Identity, membership, capability, access-path classification, and actor facts
come from service context. A command never supplies them as trusted fields.

## Domain Vocabulary

### Observatory And Rig Facts

| Concept | Kind | Meaning and boundary |
| --- | --- | --- |
| `Observatory` | Aggregate root | Stable site, horizon, configured rigs, service association, and policy references |
| `Rig` | Embedded record | Configured device identities and intended capabilities; not current connectivity |
| `RigCapability` | Boundary fact | Normalized callable capability and current limitation returned by an adapter boundary |
| `ExternalObservation` | Boundary fact | Timestamped decoded device, tool, host, tunnel, or storage fact with freshness/uncertainty |
| `ResourcePressure` | Projection fact | Measured host condition, affected subsystem, policy threshold, and recovery threshold |

Current rig connectivity, processing availability, publication availability,
storage pressure, and tunnel status remain separate facts. No single
`observatoryStatus` enum collapses them.

### Plan And Active Run

| Concept | Kind | Meaning and boundary |
| --- | --- | --- |
| `ObservingPlan` | Aggregate root | Mutable ordered proposal for one site, rig, and observing window; it may describe nighttime, solar, lunar, or other supported work |
| `Sequence` | Embedded record | One target's acquisition settings, stop conditions, and failure policy inside a plan |
| `PlanValidation` | Projection | Service evaluation of one exact plan revision, including readiness, limitations, and expiring start preconditions |
| `ActiveRun` | Aggregate root | Current execution of accepted plan content, explicit runtime mutations, and workflow state |
| `RunDefinition` | Embedded record | Immutable plan content accepted when a run starts; later draft edits cannot change it |
| `RunMutationPreview` | Operation state | Expiring service-evaluated proposal with normalized change, impact, consequences, eligibility, and approval requirement |
| `AppliedRunMutation` | Embedded record | Durable accepted change tied to the previewed consequences and actor |

`RunDefinition` replaces the ambiguous phrase “immutable run snapshot.” A
`RunSnapshot` below is the current read projection of the evolving run.

### Presence And Control

| Concept | Kind | Meaning and boundary |
| --- | --- | --- |
| `Membership` | Aggregate root | Durable mapping from authenticated person identity to local `owner` or `viewer` role |
| `ControlLease` | Aggregate root | Exclusive service-owned authorization for one control-capable client, including holder, state, revision, and grace expiry |
| `ControlRequest` | Embedded operation state | Expiring request attached to control coordination; it grants no authority |
| `ClientPresence` | Projection | Connected/reconnecting client, person, device class, freshness, and capability |

`controller` is never a membership value. Losing the lease rejects future
observing commands but does not cancel already accepted work.

### Acquire

Acquire is part of `ActiveRun`, not another aggregate root.

| Concept | Kind | Meaning and boundary |
| --- | --- | --- |
| `AcquireState` | Embedded state | Current target/session workflow, policy snapshot, phase, revision, and eligible recovery |
| `RecoverySeries` | Embedded record | One bounded group of solve attempts under one parameter set and attempt budget |
| `AcquisitionAttempt` | Embedded record | Append-only correlation of capture, solve, correction, and verification evidence |
| `CapturedFrameEvidence` | Embedded evidence | Stable frame/asset reference and capture facts used for evaluation |
| `SolveEvidence` | Embedded evidence | Explicit solved geometry or typed no-solution evidence; unknown offsets remain unknown |
| `PointingCorrectionProposal` | Operation state | Expiring exact movement plus bounds, consequences, and approval eligibility |
| `PointingCorrectionAttempt` | Embedded record | Acknowledged movement correlated with later image verification |
| `PolarMeasurement` | Embedded evidence | Solved geometry and manual Alt/Az guidance from one measurement attempt |

An attempt and its evidence are never overwritten by a retry. Driver
acknowledgement is provisional; subsequent image evidence verifies pointing.

### Process

| Concept | Kind | Meaning and boundary |
| --- | --- | --- |
| `ProcessingSession` | Aggregate root | Durable, resumable Build/Develop work with source lineage, linear history, current position, and lifecycle |
| `ProcessingSource` | Embedded record | Stable asset reference with a role such as raw source or linear master; never a path |
| `ProcessingOperation` | Embedded record | Normalized operation kind, tool choice, parameters, input, and provenance |
| `AppliedProcessingStep` | Embedded record | Accepted history position with execution status and valid output only after successful completion |
| `ProcessingPreview` | Operation state | Latest service-accepted temporary parameters, input identity, progress, and result; not applied history |
| `ProcessingAttempt` | Embedded operation record | Full-resolution or retry execution with tool/version, input, status, diagnostics, and successful output |
| `ProcessingCheckpoint` | Embedded record | Valid reusable output with the exact lineage required for stage-local retry |
| `AssistantFinding` | Embedded record | Service-produced evidence and proposed values for the current image/operation; advisory only |
| `SavedArtifactSet` | Command result | Logical grouping of the Library assets created by one save; not another stored aggregate |

The product exposes one current history position, not branches. Applying after
Undo replaces the redo path. A session is not an `Asset`; Save creates assets,
and Discard tombstones the working session before asynchronous scratch cleanup.

### Library And Delivery

| Concept | Kind | Meaning and boundary |
| --- | --- | --- |
| `Asset` | Aggregate root | Stable authorized identity for original or derived evidence, including role, checksums, lineage, and provenance |
| `AssetRepresentation` | Embedded record | Format/storage realization with independently changing availability |
| `PublicationOperation` | Operation state | Asynchronous creation or recreation of an R2 representation |
| `DownloadPreparation` | Operation state | Temporary staging operation for remote delivery of a local original |
| `DownloadGrant` | Command result | Short-lived authorized delivery result; not stable asset identity |

The permanent local asset remains authoritative. Publication expiry changes a
representation, not the `Asset`. LAN delivery may stream from Arch; remote
delivery may stage a disposable R2 representation.

## Command Vocabulary

All mutation-capable commands carry `CommandId`; physical or durable commands
also carry `IdempotencyKey`. Each command carries only the expected revisions
listed in the action map, not one global revision.

| Domain | Canonical commands |
| --- | --- |
| Run | `StartRunFromPlan`, `PreviewRunMutation`, `ApplyRunMutation`, `ApproveDisruptiveRunMutation`, `PauseRun`, `ResumeRun`, `StopRun` |
| Control | `RequestControl`, `GrantControl`, `DeclineControl`, `ReleaseControl`, `TakeControl` |
| Acquire | `RetryPlateSolveWithParameters`, `SkipAcquireTarget`, `ApprovePointingCorrection`, `RevisePointingCorrection`, `CapturePolarAlignmentMeasurement`, `AcceptPolarAlignmentEvidence` |
| Process | `StartProcessingSession`, `ResumeProcessingSession`, `SyncProcessingPreview`, `ApplyProcessingPreview`, `UndoProcessingStep`, `RedoProcessingStep`, `PreviewAssistantSuggestion`, `MarkAssistantFindingViewed`, `RetryProcessingStep`, `SwitchProcessingContext`, `SaveProcessingArtifacts`, `DiscardProcessingSession` |
| Library | `RequestAssetDownload`, `RepublishAssetRepresentation`, `OpenAssetInProcess` |

These are semantic intent names, not a promise of one HTTP endpoint per row.
An orchestration command may resolve to another command (`OpenAssetInProcess`)
or return an existing projection without inventing history
(`ResumeProcessingSession`). Queries such as viewing diagnostics, comparing
assets, reading provenance, and opening Inspector are not commands.

## Snapshot Vocabulary

### `AppSnapshot`

The complete authoritative projection installed on load or reconnect:

- `snapshotVersion`, `eventCursor`, `generatedAt`, and service connection facts;
- authenticated membership and current `ClientCapability`;
- workspace summaries and persistent run activity;
- `ControlSnapshot` and current presence;
- current `PlanSnapshot`, `RunSnapshot`, and `AcquireSnapshot` when applicable;
- current or requested `ProcessingSessionSnapshot` summaries;
- relevant `AssetSnapshot` summaries; and
- separate service, rig, tunnel, processing, publication, and storage health.

The browser replaces its canonical domain projection atomically with this
snapshot. It never merges older browser truth into it.

### Domain Snapshots

| Snapshot | Required meaning |
| --- | --- |
| `PlanSnapshot` | Current plan revision, ordered sequences, validation result, limitations, and start availability |
| `RunSnapshot` | Run identity/revision, immutable `RunDefinition` reference, phase, target/work progress, accepted mutations, current evidence, and available actions |
| `ControlSnapshot` | Lease revision/state/holder/grace, pending requests visible to this member, and control availability |
| `AcquireSnapshot` | Acquire revision, current policy and recovery series, attempts/evidence, latest proposal or polar guidance, budgets, and eligible next actions |
| `ProcessingSessionSnapshot` | Processing revision/lifecycle, sources, Build/Develop steps, linear history and position, current valid image, preview, attempts/checkpoints, Assistant findings, save/discard/switch availability, and pressure state |
| `AssetSnapshot` | Asset revision, role, lineage, provenance, representations, availability/expiry, download state, and authorized actions |

Every snapshot contains semantic `ActionAvailability` results so clients can
explain what is possible. The service still rechecks every command; projected
availability is not authorization.

### Snapshot-First Stream Rule

1. Fetch and atomically install `AppSnapshot`.
2. Subscribe after its `EventCursor`.
3. Apply only later events in cursor order.
4. On a gap, stale connection, incompatible event, or reconnect, stop mutation
   controls and fetch a new snapshot.
5. Never replay a command automatically.

## Event Vocabulary

### Event Envelope

A durable `DomainEvent` contains:

- `eventId`, `eventType`, `aggregateId`, and aggregate revision;
- `occurredAt`, `CommandId`, and optional `OperationId` correlation;
- actor identity derived from service context or a named service actor;
- normalized accepted facts sufficient for audit/rebuild; and
- a schema version.

Events state accepted facts; they do not contain buttons, prose-first UI copy,
or raw adapter output. Sensitive diagnostics remain behind `DiagnosticRef`.

### Durable Event Candidates

| Domain | Canonical durable facts |
| --- | --- |
| Run | `RunStarted`, `RunMutationApplied` |
| Control | `ControlRequested`, `ControlDeclined`, `ControlGranted`, `ControlReleased`, `OwnerTookControl`, `ControlLeaseExpired` |
| Acquire | `AcquireRecoveryStarted`, `AcquireTargetSkipped`, `SolveAttemptRecorded`, `SolveRetryScheduled`, `CorrectionApproved`, `CorrectionStarted`, `CorrectionVerified`, `AcquirePaused`, `PolarMeasurementRecorded`, `PolarAlignmentCompleted` |
| Process | `ProcessingSessionStarted`, `ProcessingHistoryMoved`, `ProcessingStepApplyStarted`, `ProcessingStepRetryStarted`, `ProcessingStepCompleted`, `ProcessingStepFailed`, `AssistantFindingRecorded`, `AssistantFindingViewed`, `ProcessingArtifactsSaved`, `ProcessingSessionDiscarded` |
| Library | `AssetCreated`, `AssetDownloadRequested`, `AssetPublicationStarted`, `AssetRepublicationStarted`, `AssetPublished`, `AssetPublicationFailed`, `AssetRepresentationExpired` |

Authoritative incremental UI state uses a closed `IncrementalProjectionEvent`
union. Each message carries one typed per-domain projection, the next event
cursor, and its snapshot version; a domain-name-only invalidation cannot advance
browser truth. Duplicate or older messages are ignored, while a cursor gap or
version regression requires a fresh `AppSnapshot`.

Asynchronous progress and connection freshness may use discardable
`ProjectionNotice` messages. Notices carry neither event cursor nor snapshot
version and never advance authoritative client state. Important outcomes such
as a failed processing attempt or verified publication remain durable facts.

## Failure Vocabulary

Every rejected command returns one `CommandFailure` with:

- stable failure tag and domain;
- safe human-readable summary;
- command/correlation identity;
- current relevant revisions and refresh guidance;
- whether retry is possible and what must change first;
- safe alternative actions; and
- optional authorized `DiagnosticRef`.

The contract uses a small family union plus a closed `reason` value. The
detailed names in the action map—such as `RunRevisionConflict`,
`PreviewSuperseded`, or `ToolUnavailable`—are reason codes inside these
families, not dozens of independent failure models.

| Family | Covers | Representative reasons |
| --- | --- | --- |
| `AuthenticationFailure` | No accepted ingress identity or local membership | `Unauthenticated`, `MembershipRequired` |
| `AuthorizationFailure` | Membership, client capability, asset access, or control lease does not authorize the action | `OwnerRequired`, `ClientReadOnly`, `AssetAccessDenied`, `ControlLeaseLost` |
| `FreshnessConflict` | Relevant aggregate or connection truth changed | `RunRevisionConflict`, `AcquireRevisionConflict`, `ProcessingSessionRevisionConflict`, `ReconnectRequired` |
| `InvalidInput` | Proposed values fail decoding or bounded validation | `ToolParameterInvalid`, `SourceSelectionInvalid`, `DiscardConfirmationMismatch` |
| `ActionIneligible` | Input is valid but current state or policy does not permit the transition | `PlanNotReady`, `MutationIneligible`, `UndoUnavailable`, `DispositionRequired` |
| `ReferenceUnavailable` | A preview, proposal, checkpoint, finding, session, source, or asset is missing, expired, or superseded | `PreviewSuperseded`, `CheckpointIneligible`, `SourceAssetUnavailable`, `AssetNotFound` |
| `CapabilityUnavailable` | Required rig, tool, processing, publisher, or provider capability is unavailable | `RigStateUnsafe`, `ToolUnavailable`, `ProcessingServiceUnavailable`, `R2Unavailable` |
| `ResourceProtected` | Measured limits intentionally prevent new work | `StorageReserveProtected`, `DownloadConcurrencyLimited`, `ProcessingTransitionBusy` |
| `IdempotencyConflict` | An idempotency key was reused with different normalized input | `IdempotencyConflict` |

`CommandFailure` means the requested transition was not accepted and therefore
performed no physical or durable action. A later `OperationFailure` is a
separate result tied to already accepted work and includes an operation kind,
reason, surviving evidence, and retry scope. For example,
`ScratchCleanupFailed` cannot turn an accepted Discard back into rejection.

## Service Transition Vocabulary

These names describe deterministic internal reactions to accepted work or new
evidence. They are testable transitions, not client APIs:

| Domain | Service transitions |
| --- | --- |
| Acquire | `EvaluateSolveAttempt`, `ScheduleBoundedSolveRetry`, `StartAutomaticPointingCorrection`, `VerifyPointingCorrection`, `PauseAcquireForRecovery` |
| Process | `CompleteProcessingPreview`, `CompleteProcessingAttempt`, `EvaluateProcessingPressure`, `ResumeProcessingAfterPressure`, `CleanupDiscardedSession` |
| Library | `CompleteStagedDownload`, `CompleteRepublication`, `ExpirePublishedRepresentation` |
| Control | `MarkControllerReconnecting`, `ExpireControlLease` |

Every transition consumes named current state plus decoded evidence and
produces either a new typed state and durable fact, or a typed failure/diagnostic
without fabricating success.

## Cross-Domain Invariants

1. An accepted run continues without a browser, public tunnel, or controller.
2. Only the current lease holder may issue observing mutations; owner
   membership alone does not satisfy the lease.
3. No stale or rejected command reaches hardware, storage, a processing tool,
   or durable success history.
4. Command acceptance, external acknowledgement, and verified outcome are
   distinct facts.
5. Acquire retries are append-only and bounded; changed solve parameters open
   a new bounded `RecoverySeries`.
6. Process Preview, applied history, and saved Library assets are distinct.
7. Processing retry begins only at the failed stage when its checkpoint and
   input remain valid.
8. Active capture alone cannot throttle processing; measured pressure and a
   policy decision are required.
9. `Asset` identity survives publication expiry. R2 is delivery state, not
   canonical storage authority.
10. Save failure prevents `saveAndSwitch`. Durable Discard permits switching;
    later scratch-cleanup failure only warns and retries.
11. Phone read-only behavior is enforced by the service, not responsive CSS.
12. The normal UI uses semantic states and actions. Revisions, cursors, raw
    events, and diagnostics remain secondary implementation/Inspector detail.

## Current Implementation Boundary

The [shared protocol module](../../../packages/protocol/README.md) owns only the
Effect Schema definitions for HTTP requests, responses, snapshots, and SSE
events. Server lifecycle modules own aggregate state, authority, eligibility,
transitions, receipts, work, and settlement. The web client owns event cursors
and presentation. Production integration tests exercise these rules through
the lifecycle interfaces and actual browser clients; the former Gate fixtures
are not implementation authority.

## Expected Implementation Models

The vocabulary is expected to settle into roughly these seven first-class
models:

| Model | Owns, in practical terms |
| --- | --- |
| `Observatory` | Site configuration, horizon, rig profiles, and policy references |
| `Membership` | The local person-to-`owner`/`viewer` authorization mapping |
| `ObservingPlan` | Editable sequences, constraints, revision, and validation inputs |
| `ActiveRun` | Accepted `RunDefinition`, runtime changes, execution state, and embedded Acquire attempts/evidence |
| `ControlLease` | Exclusive controller, reconnect grace, revision, and pending requests |
| `ProcessingSession` | Sources, Build/Develop history, preview, attempts, checkpoints, findings, and lifecycle |
| `Asset` | Stable original/derived identity, lineage, provenance, representations, and availability |

Shared event records, idempotency receipts, asynchronous operation records,
and diagnostics will also require persistence, but they support these models;
they are not additional product aggregates.
