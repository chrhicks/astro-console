# Gate 4: Process Workspace

Status: **accepted — Gate 4 closed July 21, 2026**

Gate 4 tests whether astrophotography processing can remain visual and
approachable while execution, recovery, provenance, and storage stay honest.
The primary interaction is developing an image, not administering jobs.

The prototype is synthetic and non-operational:
[`process-prototype.html`](../../../prototype/v2-ui/process-prototype.html).

## Product Model

Process contains two visibly distinct phases in one workspace:

1. **Build image** calibrates, debayers, registers, evaluates, and stacks
   source frames into a durable linear master.
2. **Develop image** applies visual operations such as background extraction,
   color calibration, stretch, curves, denoise, and export.

There is one current working image and one linear edit history. Undo and redo
move through that history. Applying an operation after undo replaces the redo
path. Cached outputs may survive temporarily for efficiency, but users do not
manage a graph of alternate histories.

The linear master is the durable handoff between phases. Development changes
do not rerun Build steps unless a Build input or setting actually changes.

## Workspace Lifecycle

- Opening, closing, refreshing, or losing a browser does not stop work. A
  reconnect loads the latest service-owned session and renders it normally.
- Preview changes are temporary. Apply records one non-destructive edit that
  can be undone or redone.
- The working session retains the selected step, applied history position,
  current output, and comparison reference.
- **Save to Library** creates the selected artifact formats. Processed FITS,
  preview PNG, and full-resolution PNG are the initial defaults.
- Several saved artifacts can share the same source lineage. None needs to be
  declared the only final result.
- **Discard** removes unsaved derived work and eligible scratch. Original
  source frames and previously saved Library artifacts survive.
- General comparison of saved outputs belongs to Library. Process may link to
  that comparison as a convenience.

## Visual Interaction

- The image canvas is the largest and most visually important surface.
- The left rail navigates Build and Develop steps. It is not an event log.
- The right rail has **Operation**, **Assistant**, and **Inspector** tabs.
  Operation owns compatible tool, settings, sliders, preview, Apply, reset,
  and recovery. Selecting a step activates Operation.
- Assistant findings use a numbered, text-accessible unread badge but never
  switch tabs automatically. Viewing clears unread state without dismissing
  the finding. Previewing a suggestion loads its proposed values and visible
  before/after differences into Operation; it never applies the change.
- Pressing and holding the canvas reveals the linear reference; releasing
  returns to the current result. Pointer, touch, Space, and Enter provide
  equivalent access.
- A prior valid image remains visible while a new preview computes. Progress
  never replaces the image canvas.
- Selecting a completed step exposes its settings and provenance without
  requiring the user to reason about execution records.

## Tool Choice And Optional Assistance

Each operation presents only compatible installed tools. Candidate examples
include Siril, RCAstro tools, and other adapters added later. Tool choice and
parameters are recorded as provenance when a step is applied.

Optional analysis may inspect the current image, explain visual concerns, and
suggest explicit parameter changes. It never changes the working image by
itself. A suggestion first becomes a visible temporary preview; the user still
decides whether to apply it.

## Recovery Rules

- A failed operation retries from its latest valid input checkpoint.
- `Failed · Stretch` retries Stretch, not Calibration, Debayer, Registration,
  or Stack.
- Downstream work is recomputed only when one of its inputs changes.
- Before retry, the interface states exactly which operation will run and
  which completed checkpoints will remain untouched.
- Execution attempts and diagnostics remain inspectable but do not displace
  the image-development workflow.
- A concise failure summary links to an owner-safe diagnostics modal containing
  the exact stage and attempt, tool/version, sanitized invocation, parameters,
  timing, exit status, stdout/stderr, worker state, surviving checkpoints and
  outputs, and the precise retry scope. Known secrets and sensitive paths are
  redacted before copy or download.

## Resource Policy

Active capture alone does not pause processing. The worker normally continues
while the observatory captures because ordinary capture is largely polling,
waiting, and bounded local transfers.

Processing may throttle or exceptionally pause only for an observed condition
that threatens capture or host stability, such as sustained memory pressure,
storage write saturation, critically low storage reserve, or thermal limits.
The interface names the measured condition and keeps observatory health
separate from processing health.

## Ownership

| Concern | Canonical owner | Notes |
|---|---|---|
| Current session and edit history | Astro Console service | Durable across browser closure and reconnect. |
| Temporary control preview | Active desktop client and processing service | Not applied history until explicitly accepted. |
| Operation execution and checkpoints | Processing service | Stage-local retry from the latest eligible input. |
| Tool compatibility and provenance | Processing service | Records exact adapter, version, parameters, and inputs. |
| Source and saved artifact identity | Library service | Stable asset IDs; no paths or provider keys in the UI. |
| Press-and-hold comparison | Processing session | One current result against the linear reference. |
| Saved-artifact comparison | Library workspace | Related outputs can be compared after saving. |
| Resource protection decision | Host resource policy | Based on measured pressure, not capture activity alone. |
| Phone capability | Client capability policy | Read-only in the initial release. |

## Candidate Contract Vocabulary

These names guide later contract work; they are not production schemas.

### Records

- `ProcessingSession { sessionId, sourceAssetIds, buildSteps, developSteps,
  historyPosition, workingArtifactId, comparisonArtifactId, status, revision }`
- `ProcessingStep { stepId, phase, operation, toolFacts, parameters, state,
  inputArtifactIds, outputArtifactId, attempts }`
- `ProcessingAttempt { attemptId, stepId, state, progress, failure,
  diagnosticAssetIds, startedAt, updatedAt }`
- `ProcessingCheckpoint { checkpointId, artifactId, producingStepId,
  eligibility }`
- `ProcessingArtifact { assetId, role, mediaType, sourceAssetIds, provenance,
  availability }`
- `ProcessingHealth { availability, measuredPressure, throttleReason }`

### Commands

- `PreviewProcessingStep { sessionId, stepId, tool, parameters,
  expectedRevision }`
- `ApplyProcessingStep { sessionId, stepId, previewId, expectedRevision }`
- `UndoProcessingStep { sessionId, expectedRevision }`
- `RedoProcessingStep { sessionId, expectedRevision }`
- `RetryProcessingStep { sessionId, stepId, checkpointId,
  expectedRevision }`
- `SaveProcessingArtifacts { sessionId, formats, name, expectedRevision }`
- `DiscardProcessingSession { sessionId, expectedRevision }`
- `SwitchProcessingSource { sessionId, sourceAssetIds, disposition,
  expectedRevision }`

### Expected failures

- `SourceAssetUnavailable`
- `ProcessingSessionRevisionConflict`
- `ProcessingStepFailure { stepId, category, diagnosticAssetIds }`
- `CheckpointIneligible`
- `ToolUnavailable`
- `ToolParameterInvalid`
- `StorageReserveProtected`
- `ProcessingServiceUnavailable`
- `ReadOnlyClient`

Unknown transport, persistence, and external-tool values must be decoded at
their boundaries. Gate 5 may now express these accepted interaction concepts
as Effect Schema candidates and deterministic traces.

## Infrastructure Feedback

- Persist the current processing session, linear history, working artifact,
  checkpoints, attempts, provenance, and selected comparison reference.
- Return the latest authoritative session snapshot before incremental events
  or action eligibility after reconnect.
- Isolate preview scratch from original sources and saved Library artifacts so
  discard and cleanup cannot remove permanent evidence.
- Report CPU, memory, storage throughput, capacity, and thermal pressure well
  enough for resource controls to name the actual reason for throttling.
- Keep processing lower priority than control and capture without converting
  every active exposure into an automatic pause.
- Stable asset IDs must resolve local and published representations without
  exposing filesystem paths or R2 keys.
- Source switching must list recent capture sessions, unfinished processing
  sessions, existing linear stacks, and Library browsing without exposing
  storage layout. Unsaved work requires Save and switch, Discard and switch,
  or Keep working.

## Walkthrough

1. Open a completed linear stack and identify the Build/Develop boundary.
2. Select Develop steps and adjust visible tool-specific controls.
3. Confirm the image remains visible while a preview computes.
4. Press and hold to compare the current result with the linear reference.
5. Apply a change, undo it, redo it, then apply a different setting.
6. Preview an optional assistant suggestion and confirm it never auto-applies.
7. Fail Stretch and verify retry begins at Stretch from the linear checkpoint.
8. Observe a measured-pressure scenario while capture remains healthy.
9. Refresh or reconnect and return to an ordinary current workspace.
10. Switch among raw sessions and existing linear stacks while protecting
    unsaved work.
11. Save several formats to Library, then verify Discard preserves sources.

Validate at wide desktop, compact desktop, and phone widths. Confirm keyboard
access, useful focus order, no color-only state, no horizontal page overflow,
and clear simulated-action feedback.

## Decision And Validation

Iteration 3 is the accepted reference. It preserves the iteration 2 editing
model while consolidating the former operation column into the shared context
rail, adding non-stealing Assistant notifications, bounded tool diagnostics,
and protected source switching.

The owner accepted the iteration after reviewing the visual editor, comparison,
operation controls, assistance, stage-local recovery, diagnostics, save,
discard, and source-switch flows. Browser validation covered 1600 px and
1000 px desktop layouts plus a 390 px read-only phone projection. There was no
page overflow or console error; suggestion preview, failure diagnostics, and
responsive context behavior matched the model above.

The shared rules derived from Gates 1–4 now live in
[V2 UX and design guidance](../ux-design-guidance.md).
