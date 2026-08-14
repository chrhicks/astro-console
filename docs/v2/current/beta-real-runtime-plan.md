# Beta Real-Runtime Plan

Status: **accepted — application routes promoted locally; configured Acquire prepared and simulator-proven; outdoor proof and optional live abort pending**

Accepted: August 8, 2026

## Outcome

Promote the beta to the main Astro Console UI after Plan, Observe,
Library, and Process use service-owned projections and complete their accepted
workflows. Hardware-facing milestones must use real provider, device, or image
evidence. Deterministic fixtures remain regression tools, not delivery proof.

The local web implementation now owns composition, interaction, responsive
behavior, and visual treatment. Astro Console runtime and service modules own
contracts, commands, durable state, provider adapters, eligibility, and proof.
The disposable prototype demo is retained only as historical migration input.

## Real-Frame Development Corpus

The owner supplied the source archive at:

`/Users/chicks/dev/personal/astronomy/codex/astro/data`

The archive is about 114 GB and contains 1,066 files. Do not copy it into the
repository. Prepare a small checksum-pinned scenario pack under the existing
ignored directory:

`.tmp/alpaca-simulation-corpus/`

A committed manifest and preparation script should name every selected source,
expected SHA-256, intended scenario, and copied filename. The script must copy
only the declared files and verify each checksum. Generated ImageBytes payloads
belong in the ignored scenario pack and must not duplicate the source archive
unless the scenario requires a stable encoded payload.

Use these evidence families:

| Evidence family    | Useful scenarios                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M101, June 21      | Valid 6024 x 4024 FITS, a good early light, a cloud-obscured late light, successful solve input, honest no-solution input, frame-quality comparison                          |
| NGC 7000, August 6 | ASI2600MC Pro identity and headers, 6248 x 4176 camera geometry, 120-second capture, dithered successive frames, stable severe focus warning, real preview and quality facts |
| M13, May 24        | Lights-only calibration limitation, several original inputs, a small derived FITS, preview, Build provenance, source-to-output Library lineage                               |
| M8, July 8         | Large-file and long-sequence stress only; select a file only when a focused size or throughput test needs it                                                                 |

The first scenario pack should stay small. Prefer two contrasting M101 lights,
two NGC 7000 lights plus its quality report, several M13 lights, one small M13
derived FITS, and existing previews. Add another file only when a named test
cannot use that set.

## Bounded Alpaca Simulation Server

Build a development-only simulation server for the exact Alpaca routes used by
Astro Console. It is not a generic Alpaca implementation and is not part of the
production origin.

The first route set should cover:

- `management/v1/configureddevices`;
- configured camera, telescope, focuser, and filter-wheel identity and
  read-only property requests;
- camera connection, capability, state, start exposure, abort exposure, and
  `imagearray`;
- telescope connection, parked, slewing, and the bounded motion properties
  required by the accepted target-acquisition adapter; and
- normal Alpaca envelopes, nonzero `ErrorNumber`, HTTP failure, timeout,
  disconnect, malformed payload, and unavailable optional facts.

The simulator owns a deterministic scenario clock and explicit state machine.
Tests advance it without wall-clock sleeps. An optional development pace may
advance exposure states for browser demonstrations. A test-only control route
may select and advance a scenario, but Astro Console product code must see only
the Alpaca interface.

At minimum, provide these scenarios:

1. configured rig ready;
2. optional device unavailable;
3. camera exposure succeeds and returns a real-frame payload;
4. camera exposure aborts without producing an image;
5. provider acknowledges a command, then state reconciliation fails;
6. image retrieval fails or exceeds the declared boundary;
7. initial target evidence followed by a later centered-frame observation;
8. solve success followed by typed no-solution;
9. capture quality degrades or crosses a focus threshold; and
10. restart while work is accepted, with no command replay.

Serve a standards-shaped binary ImageBytes representation derived from selected
FITS pixels, plus explicit JSON and provider-error scenarios. Do not label a
plain FITS body as ImageBytes merely because the current adapter accepts both
representations.

## Delivery Sequence

### 1. Beta projection foundation

- Add service-owned Process per-action eligibility and typed denial reasons.
- Complete Library detail for Process-created outputs.
- Add the unfinished-session restart-to-resume journey.
- Reconcile the existing Phase 5 task ledger with the implementation already
  present.
- Use the normal workspace routes for integration.

### 2. Real-frame simulator foundation

- Add the manifest, preparation script, bounded simulator, scenario state
  machine, and recorded-response contract tests.
- Run one exact Observe-to-Library path against the simulator with
  real frame bytes.
- Prove checksum, intake, preview or explicit preview limitation, restart, and
  browser projection.

The development inspection path is now `npm run dev:sim:inspect` from
`apps/server`. It verifies all scenario-selected FITS copies before startup and
opens the Astro Console beta with a persistent simulation context strip. Its first
interactive capture is deliberately limited to truthful 15-second M101 frames;
the 120-second NGC 7000 frames remain display and workflow evidence until the
camera command accepts that duration.

### 3. Live configured-rig truth

- Activate reviewed host-managed Alpaca endpoint, device-number, and
  `UniqueID` configuration.
- Resolve current identities with GET-only reads before interpreting state.
- Project real connection, capability, freshness, and unavailable facts into
  beta Preflight and the shared shell.

### 4. Supervised execution spine

- Replace presentation-only Plan strings with structured acquisition, capture,
  stop, and recovery facts.
- Add a real executor kind and durable service-owned work queue.
- Persist intent before provider work and reconcile after restart without
  replay.
- Project exact action eligibility and consequences into Plan and Observe.

Completed August 8, 2026. Plan now freezes structured acquisition and capture
facts instead of trusting presentation strings. A real origin-owned executor
persists work before provider calls, claims camera writes once, reconciles
uncertain work with GET-only observations after restart, and never replays a
claimed write. Pause and Stop settle pending work and issue at most one abort
for a claimed exposure. Existing beta Plan and accepted-definition rows are
upgraded before strict decoding.

The supported development path installs one M101 `cameraOnly` sequence with one
15-second frame. The normal beta Plan and Observe controls reached Capture and
then Verify after an active camera observation followed by idle. Observe shows
the durable work trail, exact eligibility, and the explicit no-bytes boundary;
Library remained unchanged. Wider or deeper definitions fail before a provider
write. The first active-camera observation is published once; later polls while
the same exposure remains active do not create repeated projection events.
Fresh held-desktop control also remains available across workspaces even when
Plan and Observe have no currently eligible action. Contracts passed 187/187,
and focused server, web, browser, and Designer proof passed. The visual review
covered 1440 px, 768 px, and 390 px. No live provider or hardware was
contacted.

### 5. Indoor camera-to-Library path

- Start and separately abort an owner-approved bounded exposure.
- Let the service observe completion, retrieve bytes, retain the original,
  create Library truth, and generate inspection evidence.
- Remove the need for the browser to submit invented completion metadata.

Simulator portion completed August 8, 2026. The executor now creates separate
durable `RetrieveFrame` work only after an observed active-to-idle exposure. It
keeps Capture current while retrieval is pending, then retrieves ImageBytes
with one bounded GET, validates the binary shape, retains the original through
the existing immutable intake, and records inspection without auto-accepting
the frame. Only accepted intake advances Verify and exposes the exact Library
handoff. Rig and camera identity come from the accepted run definition and
remain part of the retained Library detail. A valid retained frame receives a
pixel-derived PNG preview and metrics; inspection failure preserves the
original. Library provides local download and owner review.

Restart reuses a retained receipt without a second image read. Malformed,
trailing, or oversized ImageBytes fail closed, including streams without
`Content-Length`; a FITS signature under binary ImageBytes content does not
bypass validation. Restart can also finish a checksum-matching final file left
before its SQLite transaction without replacing bytes, while a mismatch is
recorded and rejected. Retrieval failure settles once from Capture into Recover,
and abort reads no image bytes. The real-frame loopback scenario passed the full
supervised Plan-to-Observe-to-Library path and restart without replay. Focused
contract, server, and web proof passed.

The owner-approved live start and retrieval proof completed August 8, 2026
against ASCOM Camera 1, `ZWO ASI2600MC Pro`, UniqueID
`613D9519-B32A-4021-8FE9-830F9D09F22A`. Both camera covers remained on. The
camera-only Plan requested one 15-second Light frame with no filter. No mount,
focuser, filter-wheel, or guide-camera command was sent.

The first acknowledged start exposed a real driver timing gap: an immediate
state read still reported idle, so the executor entered Recover and did not
replay the write. A direct diagnostic then proved the same Alpaca request
reported exposing for 15 seconds and produced a valid 52,183,340-byte,
6248 x 4176 ImageBytes response. The executor now allows a bounded two-second
read-only post-acknowledgement transition grace. It still never replays the
write, survives restart, and enters Recover if idle persists past the grace.

A fresh beta Plan-to-Observe run then observed the live exposure, retrieved the
frame, retained asset
`asset-capture-60d0dfdcc53347816fa0df64043554f0`, generated a 250 x 168
pixel-derived PNG preview, and exposed the exact Library handoff. The retained
original and Library download were byte-identical at 52,183,340 bytes with
SHA-256
`faddf0214f64dd2190136e80eed49db1cc53df495ca68287af8947695d48baaf`.
Restart reopened the same Verify projection and Library asset with unchanged
work timestamps while the camera remained idle. This proves the supervised
live start, device observation, image transfer, immutable intake, preview,
download, and restart boundary. It does not prove sky image quality because the
camera was covered indoors. A separate owner-observed live abort remains
pending if required for this delivery step.

### 6. Prepare live Acquire indoors, then complete outdoor proof

- Activate a configured Alpaca target provider behind the durable Acquire
  service and connect retained frames to the local solve worker.
- Prove the configured-provider workflow, claim-before-write behavior,
  reconciliation, and restart without replay through the simulator before a
  physical command.
- Keep the first bounded completion behavior at `hold`; do not add park or
  filter-wheel behavior incidentally.
- With the owner present, use only an approved small indoor movement or live
  abort when it supplies missing provider evidence.
- During the outdoor proof, use bounded telescope slew and correction behind
  the service.
- Use the existing local solver for image-backed target verification.
- Complete Preflight, Session Acquire, Target Acquire, Capture, Recover, and
  Complete for one selected target and rig.

Simulator-first preparation completed 2026-08-09. The
`target-evidence-progression` scenario uses pinned NGC 7000 FITS evidence to
drive Preflight, Target Acquire, explicit correction approval, later solved
verification, a 120-second Capture, Complete, and Library intake. The
`solve-success-no-solution` scenario uses pinned clouded and good M101 evidence
to prove bounded Recover and one changed retry. The simulator serves the pinned
frames through standard Alpaca telescope and camera routes. Recorded solve
facts are bound to exact ImageBytes pixel-payload checksums after normal
`alpaca-imagearray` intake. Consequential simulator writes are durably claimed
before the request and do not replay across duplicate commands or restart. The
final Capture uses the centered frame. These facts do not claim a live solver
invocation or physical hardware movement. This bounded development executor
accepts only `hold` completion; it rejects `park` before a provider write and
does not claim park confirmation. The owner-observed outdoor half of this step
remains open. The accepted simulator checkpoint is `cde00c9`
(`feat: simulate deep-sky target acquisition`).

Configured live-path preparation completed 2026-08-09. The production origin
now installs a target provider only when one reviewed Alpaca camera and
telescope have device numbers, `UniqueID` values, complete site coordinates,
and a `hold` run context. The provider validates those accepted identities,
claims target slew, correction, and acquisition exposure before each write,
and reconciles uncertain pointing through GET-only coordinates and `Slewing`
without replay. It does not contain a park or filter-wheel command.

Acquisition ImageBytes remains the immutable `cameraRaw` Library original. A
bounded worker-only conversion writes a temporary 16-bit FITS solver input,
uses the accepted target coordinates as the search hint and desired center,
and records the retained source checksum plus ImageBytes pixel-payload checksum.
The worker returns evidence to durable Acquire instead of committing the same
session twice. Provider-result reuse is bound to both run and attempt, so a
static attempt name from an older run cannot supply current evidence.

The same configured provider passed the loopback Alpaca simulator from Plan and
Preflight through initial solve, explicit correction, fresh verification,
120-second Capture, Complete, and the centered Library original. Restart tests
proved no replay after completion, GET-only handling of a preclaimed slew, and
receipt/checksum reconciliation when a crash leaves retrieval marked in
progress after immutable intake. This is adapter, worker, persistence, and
simulated-provider proof only; no hardware endpoint was contacted.

Only after that proof, an indoor GET-only check matched the reviewed ASCOM
Remote identities: Telescope 0 `ASI Mount`
`81F661C7-1F99-4747-A040-B7E438E04FF2`, Camera 1 `ZWO ASI2600MC Pro`
`613D9519-B32A-4021-8FE9-830F9D09F22A`, and Focuser 0 `ZWO Focuser`
`EA31A640-CD6E-4D68-BF8F-B1D683F61BD1`. Every selected Alpaca envelope had
`ErrorNumber: 0`; the mount was connected, unparked, and still, the camera was
connected and idle, and the focuser was connected and stationary. No PUT,
command, or movement occurred. This proves current read-only provider readiness,
not the configured target command path.

### 7. Complete beta Library judgment and Process entry — complete

- Finish Library organization, review, rating, annotation, related-frame
  comparison, representation state, delivery lifecycle, and Process-output
  lineage against real assets.
- Make `Open in Process` an exact service-owned handoff from an eligible local
  asset while keeping phone Library evidence read-only.

Completed 2026-08-09 against the local M27 service fixtures. Desktop Review
persists a decision, 1–5 rating, and note through the existing revision and
idempotency guard. Compare loads only typed peer detail and keeps selection in
browser state. `/library` is a service-page catalog grouped by exact
`comparisonGroupId`, with only the supported Role, Sort, cursor, and
catalog-change controls. Catalog summaries expose review decision and optional
rating without exposing the note. Availability & delivery uses typed
representation, Download, and Process eligibility; the published fixture is
idempotent and invents no expiry or transfer progress. `Open in Process`
resolves the exact service source. Phone remains
read-only. Automated proof passes contracts 187/187, server 157/157, and web
134/134. Final Designer review passed wide, compact, and 390 px, including the
long availability-state overflow correction. This closes accepted Item 2 with
local fixture and service proof only.

### 8. Move Process onto worker-owned execution — complete

- Replace the synchronous Process simulation wrapper with a durable work ledger
  and a separate worker that claims and completes Build and Develop work. A
  browser command records intent and returns current truth; it does not complete
  its own worker result.
- Item 3 entered Process from one compatible Library comparison or capture
  group through `Build recommended set`. That was the bounded worker-delivery
  path, not the final product boundary; Item 3.5 supersedes it with Library
  multi-select and whole Capture Set intake. The completed Item 3 path projected
  an exact source summary and let the owner inspect only the smaller exception
  queue.
- Keep the platform's explained `Include`, `Exclude`, and `Review`
  determination separate from the owner's durable `Accepted`, `Rejected`, and
  `Unreviewed` judgment. Manual rejection excludes a frame. Manual acceptance
  overrides a quality exclusion but cannot override corrupt, incomplete,
  unavailable, or incompatible evidence. Unreviewed frames follow Include or
  Exclude; Review enters the exception queue.
- Show each needs-review frame with its preview, determination rationale, and
  metrics relative to its group. `Accept` and `Reject` resolve the durable
  Library judgment and update the proposed set. Freeze the exact candidate set
  and decisions when the owner starts Process; later Library review changes do
  not silently alter that session.
- Build through Validate, Calibrate, Debayer, Align, Evaluate, and Stack. Keep
  named decision gates, last-valid checkpoints, bounded failure output, and
  retry only for the affected remaining stages. Plate-solve evidence may inform
  pointing and framing but does not act as the sole quality verdict.
- Develop through synchronized Preview, explicit Apply, one linear undo/redo
  history, reference comparison, and checkpoint-bound retry. Keep Preview,
  applied history, and saved Library artifacts visibly distinct.
- Save selected retained outputs to Library with checksums and lineage; discard
  only unsaved derived work; resume unfinished sessions after refresh or service
  restart. Processing may continue during observing and throttles only for
  named, measured host pressure.
- Select one production processing adapter only through a separate owner
  decision. Use a deterministic file-backed adapter for this worker and product
  proof without claiming Siril, RCAstro, or production processing quality.

Deliver this item as four end-to-end review slices:

1. durable worker claims, attempts, outputs, restart reconciliation, and one
   file-backed Build result;
2. recommended source selection, the small review queue, Build gates,
   checkpoints, and scoped retry;
3. worker-owned Preview, Apply, linear history, reference comparison, and
   Develop retry; and
4. save, discard, resume, session switching, measured pressure, complete
   browser review, and current-document closeout.

Exit proof includes worker restart after claim without duplicate execution,
stale completion rejection, exact checkpoint retry, refresh during Preview and
Apply, idempotent Library save with lineage, source-preserving discard, normal
observing and processing together, injected measured-pressure throttling, and
functional plus Designer review at wide, compact, and 390 px phone widths.
This proves durable local Process execution for the selected scenarios. It does
not prove a production processing adapter, external-tool output quality,
hardware behavior, outdoor capture, or beta route promotion.

Completed 2026-08-09 with the deterministic local file adapter and M27 service
fixtures. Browser commands now persist work and return before a separate worker
claims Build, Preview, Apply, retry, save, or cleanup. The service projects the
recommended group, the smaller review queue, frozen source decisions, named
Build checkpoints, Develop history, saved Library lineage, and measured
pressure state. Restart/no-replay, stale completion, Debayer-to-Align retry,
refresh during Preview and Apply, truthful TIFF save, source-preserving discard,
normal capture concurrency, and pressure throttle/recovery are automated proof.
Designer review passed wide, compact, and 390 px phone states; it added keyboard
hold behavior for reference comparison. The normal browser fixture did not
render the injected Align failure or non-normal pressure states, so those two
states remain integration-test proof rather than browser screenshots. The work
does not select or prove a production processing adapter. Closeout proof is
green at contracts 187/187, server 184/184, and web 136/136.

### 8.5. Add the explicit Process workflow

Item 3's worker, ledger, claims, restart reconciliation, artifacts, pressure
handling, and OpenTelemetry evidence remain the execution foundation. Item 3.5
changes the product workflow around that foundation:

1. **3.5.1 —** Library selection and Processing Project intake.
2. **3.5.2 —** Stage drafts, attempts, and persistent navigation.
3. **3.5.3 —** Explicit Calibration.
4. **3.5.4 —** Explicit Registration.
5. **3.5.5 —** Explicit Stacking and saved Master.
6. **3.5.6 —** Astronomy Develop workspace.
7. **3.5.7 —** Integrated operator review and closeout.

Do not slow deterministic work to make transient states easier to watch. Keep
the completed attempts and evidence navigable instead. The detailed product,
service, proof, and non-goal boundaries are in the
[Item 3.5 Process workflow plan](process-workflow-plan.md). The explicit
workflow and subsequent route promotion are now complete locally.

### 9. Audit and promote the beta

- Verify every exact application workflow and shell state against current service
  truth.
- Complete functional browser proof and Designer review at wide, compact, and
  390 px phone widths.
- Promote only after every enabled action has a real command path and every
  unavailable action has a typed reason.
- Retire the old presentation after promotion.

Completed locally August 10, 2026. Plan, Observe, Library, Library detail, and
Process routes render the application presentation. The former presentation has been removed.
Normal workspace routes render the application workspaces directly.
The final audit corrected exact Library-to-Process handoff precedence,
completed Observe evidence, exact final Library operation IDs, compact Develop
containment, and promoted-shell wording. Functional and Designer proof passed
wide, compact, and 390 px with contracts 187/187, server 202/202, and web
151/151. This is local route, retained-fixture, simulator, service, and browser
proof; it does not prove deployment or new provider, hardware, or physical
behavior.

## Proof Boundary

Real-frame simulation proves adapter decoding, orchestration, transfer,
checksum, persistence, solve behavior, Library behavior, processing workflow,
and beta presentation for the selected scenarios. It does not prove a live
provider, device communication, hardware movement, physical exposure, sky
position, or image quality from a new capture.

Hardware-facing completion still requires, in order, live GET-only provider
proof, command acknowledgement where authorized, later device observation,
captured-byte or solved-image evidence, and physical outcome when applicable.

## First Implementation Bundle

The first approved bundle is the **beta real-truth development foundation**:

1. close the three known projection gaps;
2. prepare the checksum-pinned real-frame scenario pack;
3. implement the bounded Alpaca simulator;
4. drive one real-frame simulated exposure through Observe, Library intake,
   restart, and the Astro Console UI; and
5. finish with live GET-only configured-rig activation, without a hardware
   command.

### First-bundle proof completed August 8, 2026

- Process now projects service-owned per-action eligibility and denial reasons,
  restart-to-unfinished recovery, Resume, and complete Library lineage for new
  Process outputs.
- The checksum-pinned local pack contains five declared M101 and NGC 7000 files
  under ignored `.tmp/`, totaling about 194 MB. No source archive data is
  committed.
- The bounded simulator covers the ten named scenario families and emits
  standards-shaped ImageBytes from selected FITS pixels.
- One simulated M101 exposure passed through the real Acquire adapter, immutable
  Library intake, service restart, and no-replay checks. Browser proof separately
  validated the same service-owned Process and Library projections.
- The first bundle's contract, server, and web proof passed.
- Designer review passed against Astro Console at wide, 768 px, and 390 px widths.
  It found one restart Resume replay defect; the fix is included in the server
  suite.
- Live GET-only activation matched Telescope 0 ASI Mount, Camera 1 ZWO
  ASI2600MC Pro, and Focuser 0 ZWO Focuser by device number and `UniqueID`. The
  corrected Astro Console adapter returned `ready`: all three were connected,
  the mount was not parked or slewing, and the focuser was not moving.
- Live integration exposed an invalid `cansubexposure` camera read. The adapter
  and simulator now use the standard `canstopexposure` property, and the
  simulator rejects the retired typo so it cannot hide this fault again.

The GET-only inventory also found the ASI220MM Mini, Pegasus conditions, and
Pegasus switch connected. The configured Sony camera was disconnected, no
filter wheel was listed, and the optional Pegasus pressure property was not
implemented. No device command was sent.
