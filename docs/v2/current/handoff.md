# V2 Current Handoff

Status: **V2.0 complete; V2.1 Phases 1–4 complete; configured Phase 5 Acquire prepared and simulator-proven; follow-on Items 1–4 complete locally; Processing Project lifecycle, shared protocol, origin runtime, and Nightbook workspace runtime refactors complete locally; semantic-intent review corrections merged**

## Current Position

Astro Console provides a rig-local service and web workspaces for Plan,
Observe, Library, and Process. V2.0 includes remote viewing, bounded shared
desktop control, durable service-owned state, and reconnect behavior. V2.1
Phases 1–4 add one configured Alpaca rig boundary, bounded camera exposure and
abort, immutable original intake, and local solve evidence. Phase 5 simulator
preparation adds the complete beta target-acquisition and recovery journey; the
owner-observed outdoor half remains open.

Nightbook is the only presentation for Plan, Observe, Library, Library detail,
and Process. The former presentation and its client-only command paths have
been removed. Normal workspace routes render Nightbook directly, and the root
route `/` maps to Plan.

## UI Direction

The official UI and UX reference is the composed React demo in:

`.gh/clone/nightbook-prototype/apps/nightbook-demo`

The same workspace owns the `@nightbook/ui` source, component Gallery, and
package verification. Astro Console's promoted workspaces are an integration
of that authority with local service projections; they are not a separate
design authority.

Keep the promoted presentation aligned with real Astro Console projections and
the lightweight [UI and UX direction](ui-ux.md). Former Astro Console visual
guides, UX catalogs, component grammar, and Phase 0.5 material are archived.

The accepted implementation sequence is the
[Nightbook beta real-runtime plan](beta-real-runtime-plan.md). It uses a small,
checksum-pinned selection from the owner's real-frame archive in an ignored
local directory and a bounded development Alpaca simulator. Simulation improves
adapter, workflow, and UI proof but does not replace live provider or hardware
evidence.

## Completed Beta Foundation

The first local bundle now provides:

- service-owned Process per-action eligibility and typed denial reasons;
- complete Library detail and lineage for new Process-created outputs;
- deterministic restart-to-unfinished and Resume behavior;
- a checksum-pinned five-file M101 and NGC 7000 local corpus;
- a bounded deterministic Alpaca simulator with real FITS-derived ImageBytes;
- a simulated real exposure through Acquire, Library intake, restart, and
  no-replay proof;
- passing Designer review against Nightbook at wide, 768 px, and 390 px;
- and a live GET-only `ready` projection for the ASI2600MC Pro, ASI Mount, and ZWO
  EAF after matching current device numbers and `UniqueID` values.

The supervised execution milestone is complete. Plan now keeps one structured sequence
as execution authority, the service owns a real durable executor, accepted work
is persisted before provider calls, and uncertain writes reconcile through
GET-only observation without replay. Observe projects the exact work states,
timestamps, eligibility, consequences, and Verify boundary through the
Nightbook evidence grammar.

The next simulator-first slice is also complete. After the service observes an
exposure return to idle, it durably records separate image-retrieval work while
Capture remains current. Only accepted immutable intake advances the run to
Verify and creates the exact Library handoff. The service performs one bounded
GET-only ImageBytes read and retains the immutable original. Retained metadata
records the rig and camera identity from the accepted run definition, never
from browser completion fields. A pixel-derived PNG preview and metrics are
generated when decoding succeeds. A preview failure does not remove the
original. Library shows the unreviewed frame, local download, and review
controls.

The matching live proof is complete for one covered-camera frame. A fresh
camera-only beta Plan used ASCOM Camera 1, `ZWO ASI2600MC Pro`, UniqueID
`613D9519-B32A-4021-8FE9-830F9D09F22A`, for one 15-second Light exposure with
no filter. Observe projected the active exposure, retained the returned
52,183,340-byte original, and linked to the exact Library review. The Library
download matched the retained original at SHA-256
`faddf0214f64dd2190136e80eed49db1cc53df495ca68287af8947695d48baaf`;
the service also generated a 250 x 168 pixel-derived PNG preview. Restart
reopened the same Verify run and Library asset without changing the single
command attempt. Camera 1 remained idle after restart. No mount, focuser,
filter-wheel, guide-camera, or Camera 2 command was sent.

The simulator-first part of outdoor Acquire preparation is now complete. The
`target-evidence-progression` scenario installs one NGC 7000 deep-sky Plan with
a five-arcsecond centering threshold, two solve attempts, and one 120-second
capture. The normal beta workflow now runs from accepted Plan and Preflight
through a retained checksum-bound ImageBytes solve, an explicit 10.8-arcsecond
correction approval, provisional provider acknowledgement, a later retained
verification solve, Capture, Complete, and the exact Library review. The
`solve-success-no-solution` scenario exhausts the initial M101 solve series,
enters Recover, and permits one materially changed 15-second retry using the
pinned good frame. Both scenarios use the durable Acquire domain and executor;
the browser does not complete acquisition or invent solve evidence.

The development Acquire provider is simulation-only. It uses standard Alpaca
telescope coordinate and camera exposure, state, and ImageArray routes. The
simulator supplies pixels from the ignored local FITS corpus; Astro Console
retains them through normal `alpaca-imagearray` intake and binds recorded solve
facts to stable ImageBytes pixel-payload checksums. Every simulated slew,
acquisition exposure, and correction is durably claimed by run and attempt
before its Alpaca write, so a duplicate or restart does not replay it. The final
capture uses the later centered frame, not the initial off-center evidence.
This proves repeatable orchestration against pinned image evidence and
simulated provider traffic. It does not prove a new live `solve-field`
invocation, physical telescope movement, sky position, or outdoor image
quality. This bounded development path accepts `hold` completion only; it
rejects `park` before a provider write and does not claim park confirmation.

The configured live-shaped Acquire path is now prepared behind the same durable
service. Production startup activates it only with reviewed Alpaca camera and
telescope device numbers, their `UniqueID` values, complete site coordinates,
and `hold` completion. It validates the accepted run against those identities
before provider work. Slew, correction, and acquisition exposure each receive a
durable claim before a write. Claimed pointing work reconciles with GET-only
coordinates and `Slewing`; it never replays a PUT. A receipt-proven retained
frame also resumes after a retrieval crash gap without another ImageBytes read.

The camera response remains the immutable `cameraRaw` Library original. The
local solver creates only a temporary 16-bit FITS input from those exact
ImageBytes pixels. Solve evidence records both the retained source checksum and
pixel-payload checksum, uses accepted Plan coordinates for its search hint and
desired center, and derives the measured mount RA/Dec correction from the
returned solved center. The worker returns evidence to Acquire and does not
commit a second session transition. Stored provider results are bound to the
run and attempt, not the static attempt name alone.

The configured provider passed the complete loopback simulator workflow:
accepted Plan, Preflight, initial slew and five-second acquisition exposure,
retained local solve, explicit correction approval, fresh verification solve,
one 120-second Capture, Complete, and the exact centered Library handoff.
Restart preserved completion without replay. Separate cases proved a
preclaimed pointing write stays GET-only and unavailable when coordinates do
not prove it, and a retained-frame crash gap resumes from its receipt and
checksum with no second image read. No hardware endpoint was contacted by this
simulator run.

Accepted follow-on Item 2 is complete. The beta Library now has a service-page
catalog, revision-guarded decision, 1–5 rating and note, browser-only peer
comparison from loaded details, exact representation and action eligibility,
and a typed `Open in Process` handoff that resolves the exact source. Catalog
summaries expose only the review decision and optional rating; notes remain in
asset detail. The published fixture is idempotent and invents no grant or
transfer facts. Long availability states wrap inside compact catalog cards,
and phone remains evidence-only navigation with no mutation controls. Local
browser behavior and final Designer review passed at wide, compact, and 390 px.
This is local fixture and service proof; it does not claim a new exposure,
provider command, or outdoor image.

Accepted follow-on Item 3 is complete. Process now starts from one compatible
Library group with explained `Include`/`Exclude`/`Review` decisions and a small
manual exception queue. The exact candidate decisions are frozen into the
session. A separate durable worker owns Build, Preview, Apply, retry, save, and
cleanup; it preserves named checkpoints, resumes after restart without replay,
and pauses only for named measured pressure. Saved outputs have format-matching
bytes, checksum, and Library lineage. Final Designer review passed wide,
compact, and 390 px phone states. This proves only the deterministic local file
adapter, not production processing quality or an external processor.

The owner review exposed a larger Process product gap after that functional
closeout. Item 3 proved the worker and recovery model, but one fast automatic
Build does not match the intended operator workflow. Item 3.5 now introduces a
target-owned Processing Project with Library multi-select and whole Capture Set
intake, source roles, and persistent explicit Calibration, Registration,
Stacking, Master, and Develop stages. Every executable stage has an explicit
Run or Rerun action and retained attempts. Quality and metadata findings remain
advisory; an explicit mismatched-source inclusion is frozen only into the
current attempt. Develop stays
focused on astronomy operations such as astrometry, background extraction,
color calibration, green-noise reduction, stretching, color controls, and
star removal/addition. General layers, masks, and compositing are out of scope.
The complete accepted breakdown is in the
[Item 3.5 Process workflow plan](process-workflow-plan.md).

Item 3.5.1 is complete. Library can select individual assets or one complete
Capture Set and create a Processing Project or add to an existing project.
The service freezes exact asset IDs and revisions, retains provenance and the
original Capture Set identity, suggests or assigns all six source roles, and
keeps one stable target for Lights while projecting metadata and quality
concerns as warnings. Process now keeps a persistent Sources view across
restart. Intake does not enqueue Build or Calibration work, and phone remains
read-only.

Item 3.5.2 is complete. Processing Projects keep persistent Sources,
Calibration, Registration, Stacking, Master, and Develop navigation. The three
executable stages have bounded draft undo and redo, explicit Run or Rerun,
append-only attempts, selected results, and exact source or upstream lineage.
Worker settlement publishes fresh Process state without timer polling, and
restart keeps drafts, attempts, selections, artifacts, and stale-lineage
evidence. The deterministic stage harness proves service orchestration and
persistence only; it does not prove astronomy processing quality.

Item 3.5.3 is complete. Calibration now projects service-owned compatible,
advisory, and technically unavailable support decisions from retained source
facts. The bounded draft keeps the operation, missing-support policy, and
attempt-scoped source-inclusion choices through undo and redo. The UI tells the
owner whether a support source is excluded or included despite a mismatch and
offers `Use this Flat` or `Remove from project`. Explicit Run or Rerun freezes
exact source revisions, Library roles and formats,
recommendations, settings, overrides, and deterministic adapter identity.
Attempts retain per-Light outcomes, diagnostics, and checksum-bound JSON
outputs. Failed reruns keep the last selected valid result, and restart does
not replay claimed work. Derived or unknown Library inputs are unusable and
cannot be included. Source removal is blocked while stage work is active,
preserves completed attempt evidence, and re-adds as a fresh advisory choice.
This proves local deterministic orchestration and output evidence only; it does
not prove astronomy-quality calibration or an external processing tool.

Item 3.5.4 is complete as a focused Registration MVP. The bounded draft keeps
one reference Light, alignment model, star-detection setting, and explicit
warning-frame choices. Run or Rerun binds the attempt to the exact selected
Calibration result and freezes source revisions, settings, choices, and
deterministic adapter identity. Attempts retain per-Light outcomes,
diagnostics, checksum-bound transforms, and the viable subset for Stacking;
frames without a usable transform remain evidence but cannot enter that
subset. Earlier attempts and the last valid result survive rerun and restart
without replay. Functional and Designer review passed at wide, compact, and
390 px phone widths. This proves deterministic local orchestration and
evidence only, not astronomy-quality alignment or an external registration
tool.

Item 3.5.5 is complete as a focused Stacking and saved Master MVP. The bounded
draft keeps minimal weighting and rejection settings plus explicit usable-frame
choices. Run or Rerun binds each attempt to the exact selected Registration
result and retains versioned deterministic FITS evidence, diagnostics, and
frame decisions. The owner may select an earlier result, save that exact result
idempotently as a retained Library Master, and open Develop only from that
saved asset. Restart preserves attempts, selection, Library lineage, and the
handoff without replay. Functional and Designer review passed at wide,
compact, and 390 px phone widths. This proves deterministic local orchestration
and evidence only, not astronomy-quality stacking or an external processing
tool.

Item 3.5.6 is complete as a focused astronomy Develop MVP. Develop opens one
exact saved Library Master and projects a typed catalog for the accepted
astronomy operation families. Settings synchronize a deterministic Preview;
Apply remains explicit and worker-owned. Applied attempts form one linear
history with undo, redo, branch replacement after undo, exact retry,
temporary Master comparison, and idempotent Library save lineage. Star removal
retains related starless and star-companion evidence, and adding stars back
consumes that exact pair. Restart keeps the draft, preview, attempts, history,
retry scope, and saved results without replay. Functional and Designer review
passed at wide, compact, and 390 px phone widths. This proves deterministic
local orchestration and evidence only, not astronomy-quality processing,
Siril, RC Astro, or another external processing tool.

Item 3.5.7 closes the accepted Process epic. One retained M27 project combined
four exact revision-1 originals from `m27-stack-1` and `m27-stack-2`, retained
two Calibration attempts and two Registration attempts with explicit warning
choices, saved the selected Stack as an exact Library Master, applied one
Develop operation, and saved the final Library asset. The final asset keeps the
saved Master as its direct source and exposes the exact selected Calibration,
Registration, Stack, and Develop attempt lineage. Restart retained six settled
work rows, two save events, exact checksums, and zero active or replayed work.
Functional and Designer review passed at wide, compact, and 390 px phone
widths; phone remained read-only. This proves local deterministic service,
SQLite, and browser behavior only.

The follow-on architecture work replaced the split Process implementation with
one Processing Project lifecycle module. Callers now use `list`, `create`,
`open`, `evidence`, `change`, and `changes` against an explicit Project ID. The
module owns owner-and-desktop authority independently of the observatory Control
Lease, optimistic Project revisions, semantic intent receipts, bounded drafts,
immutable attempts, linear Current Result undo and redo, exact upstream
lineage restoration, durable work claims and settlement, secondary evidence,
and saved Library lineage. Stage viewing is client-only navigation.

The server interface now follows the project Effect standards. The lifecycle is
a `Context.Service` supplied by one SQLite `Layer`; named `Effect.fn` operations
carry typed domain rejection and persistence failures. Project invalidations use
`PubSub` and `Stream`. Durable claim and settlement remain behind a separate
internal worker service, and the HTTP seam decodes unknown input through Effect
Schema before mapping input, size, domain, and persistence failures truthfully.

The old Processing Session domain, global projection, command surface,
workspace tables, save tables, worker API, processor executable, and test data
are removed. Startup performs one destructive reset only when it detects the
retired Process schema, then preserves the new Project data on normal restarts.
The HTTP boundary is now `/api/process/projects` plus explicit Project detail,
evidence, and change routes. The Nightbook Library creates or adds exact source
selections without requiring the observatory Control Lease, and Project pages
show Current Result as the product state while retained attempts remain
evidence. A real Siril, RC Astro, or other processor adapter is not installed.

The former V2 contracts prototype is now the private `@astro-console/protocol`
workspace. It owns only runtime-validated HTTP request, response, snapshot, and
SSE wire schemas. Acquire, Run, Control, captured-frame intake, and Processing
Project state and behavior stay in their server lifecycle modules. Event cursor
and presentation behavior stay in the web application. The former Gate
simulations, fixtures, and harness-only helpers are removed; current proof runs
through production lifecycle interfaces and actual web clients.

The origin now has one deep Effect runtime module. Its one caller operation,
`listen`, turns reviewed configuration and explicit provider adapter factories
into the complete configured listener set. Layer acquisition creates the origin;
runtime-scope disposal closes listeners, worker fibers, projection publication,
Processing Project resources, SQLite, and telemetry. HTTP dispatch is local to
the origin implementation, and the former 28-callback forwarding router is
removed. A production-interface integration test covers HTTP, Process work,
SSE publication, durable restart, and listener shutdown without using origin
implementation hooks.

The browser now has one deep Nightbook workspace runtime. Presentation callers
consume one streamed workspace state and submit one closed set of operator
intents across Plan, Observe, Library, and Process. The module owns bootstrap
freshness, route loading, cancellation, last-confirmed values, command
submission, and uncertain-outcome reconciliation. Production HTTP and
EventSource adapters remain internal to its layer, while deterministic tests
cross the same public state-and-intent interface through an in-memory remote
adapter. Explicit Processing Project URLs and client-only stage navigation are
unchanged. The runtime also retains one Processing Project creation receipt
identity after an uncertain response and reuses it only for an explicit
unchanged retry; acceptance or definite rejection clears it. The next web
correction exposes every projected Shared Control action through one semantic
runtime interface. React no longer owns command or idempotency identities;
Request, Release, Grant, Decline, and Take remain service-projected actions,
and accepted commands remain provisional until the next authoritative
projection. The five Acquire actions currently reachable from Observe now use
the same semantic runtime pattern: React states the operator action, while the
runtime owns current Lease, Run, and Acquire revisions, identity, protocol
construction, one write, and failure refresh without replay. The remaining six
Observe lifecycle actions now follow the same rule: React submits Pause, Resume,
Stop, Skip, Retry, or Park, while the internal Observe command module owns
identity, current Lease and Run revisions, request construction, one write, and
established reconciliation. Plan now uses the same semantic interface for its
six current actions. React retains only operator-edited sequences and the
selected mutation; the internal Plan command module owns identity, current
Plan, Lease, and Run revisions, current preview and approval facts, request
construction, one write, and established reconciliation. Library Asset Review
now follows the same semantic interface: React supplies only the decision,
rating, and annotation, while the runtime owns the current routed Asset, Asset
and Review revisions, identity, request construction, one write, and route-safe
reconciliation. Processing Project intake now follows the same rule. Callers
supply a new Project name or an existing Project ID plus selected evidence; the
runtime retains new-Project uncertain identity and owns the current destination
revision, fresh Add Sources identity, request construction, one write, and
Project/evidence reconciliation without replay. This refactor and its follow-up
corrections add no browser-owned domain truth and no new product workflow. The
nine Process mutations currently reachable from the workspace now complete this
semantic-intent sequence: React supplies only edited draft values and selected
stages, while the runtime owns the current routed Project, Process Authority,
Project and Develop draft revisions, saved Master binding, identity, request
construction, one write, and route/latest-operation-safe reconciliation.

After that simulator proof, an indoor GET-only readiness check reached ASCOM
Remote at `192.168.4.104:11111`. Management and every device-property envelope
returned `ErrorNumber: 0`. The configured identities were Telescope 0 `ASI
Mount`, UniqueID `81F661C7-1F99-4747-A040-B7E438E04FF2`; Camera 1 `ZWO
ASI2600MC Pro`, UniqueID `613D9519-B32A-4021-8FE9-830F9D09F22A`; and Focuser
0 `ZWO Focuser`, UniqueID `EA31A640-CD6E-4D68-BF8F-B1D683F61BD1`. The mount
was connected, not parked, and not slewing. The camera was connected and idle
with abort and stop capability. The focuser was connected, stationary,
absolute, and at position `32655`. No PUT, command, or movement occurred.

## Configured Acquire Product Workflow for Review

1. The owner supplies the reviewed rig, camera, mount, and site configuration.
   Completion remains `hold`; no filter-wheel or park behavior is installed.
2. In Plan, the owner accepts one deep-sky sequence. In Observe, the owner takes
   control, starts the accepted definition, and refreshes Preflight.
3. Target Acquire records the requested slew before one Alpaca write. It then
   requires GET-only coordinates and `Slewing` to prove the request settled.
4. Acquire records the short solve exposure before `StartExposure`, observes
   the camera active and then idle, reads ImageBytes once, retains the original,
   and runs the local solver against a temporary FITS input.
5. If the solved center is outside the accepted threshold, Observe shows the
   measured correction for explicit approval. The service claims and reconciles
   that correction with the same no-replay rule.
6. A new retained frame must solve inside the threshold. Only that fresh
   verification advances the run to the accepted modest Capture.
7. The executor retains the final frame, completes the run, and opens the exact
   Library review. The mount remains held at the end.

This review establishes the product and implementation path. Current GET-only
device readiness is proven. A live command acknowledgement, later device
observation, physical movement, sky position, and image quality still require
owner-observed hardware and outdoor proof.

This live run found and closed one provider timing gap. ASCOM can acknowledge
`StartExposure` before its first state read changes from idle to exposing. The
executor now waits for at most two seconds with GET-only observation after an
acknowledgement. It never replays the write; persistent idle still becomes an
ambiguous Recover result. At that checkpoint, the full server suite passed
151/151.

The corpus remains ignored and local. The first foundation is committed as
`10e5b34` (`feat: add beta real-truth foundation`). The latest accepted
simulator Acquire checkpoint is `cde00c9`
(`feat: simulate deep-sky target acquisition`).

## Development Simulation Inspection

From `apps/server`, `npm run dev:sim:inspect` starts the bounded Alpaca
simulator, an isolated Astro Console origin, the Nightbook web app, and a dedicated
inspection browser. Before startup, it enumerates the evidence from every
declared scenario, restores the requested scenario, and verifies the four
referenced local FITS copies against the committed SHA-256 manifest.

All Nightbook workspaces show a persistent **Simulation - not live hardware**
strip.
Desktop owners can select and reset scenarios and advance deterministic time.
**Load** changes simulator state only; it does not replace the installed Plan
or provider. When a loaded scenario does not match the launch scenario, the UI
shows the exact `npm run dev:sim:inspect -- --scenario=...` restart command
instead of advertising an incompatible workflow.

The normal `exposure-success` launch installs one development-only M101
`cameraOnly` Plan with one 15-second frame. Accept and start the definition,
refresh Preflight in Observe, inspect durable work during Capture, and use
**Advance 16s**. Observe reaches Verify after the service retrieves and retains
the frame. **Review captured frame in Library** opens the exact Nightbook detail for
preview, download, and Accept or Reject review.

The `target-evidence-progression` launch installs the NGC 7000 deep-sky Plan.
The normal Plan and Observe controls reach a retained initial solve, explicit
correction approval, provisional acknowledgement, a fresh centered verification
solve, final Capture, **Advance 121s**, Complete, and the exact Library handoff.
The `solve-success-no-solution` launch uses two clouded M101 results to enter
Recover, exposes one changed 15-second retry, then reaches final Capture and
Library intake after **Advance 16s**. Phone and read-only clients keep the same
evidence without mutation controls.

The camera-only executor holds at Verify after Library retention. The bounded
development target executor reaches Complete only for one deep-sky sequence,
one frame of at most 120 seconds, a matching launch scenario, and `hold`
completion. More than one sequence or frame, camera-only exposure over 60
seconds, target exposure over 120 seconds, and `park` fail before a provider
write. Simulator target Skip and Abort remain hidden and are rejected without
state change. Development execution also requires the executor Alpaca origin to
match the loopback simulator origin.

ImageBytes intake validates metadata, dimensions, exact payload length, and a
64 MiB transfer limit even when `Content-Length` is absent. Binary ImageBytes
content cannot bypass validation with a FITS signature; FITS requires an
explicit FITS representation. Restart reuses a durable retained receipt or a
checksum-matching final file without replacing stable bytes. Retrieval failure
settles once from Capture into Recover, and abort does not read image bytes.

The active-exposure observation is published once when Capture becomes proven;
later worker polls do not repeat the same event while the camera remains active.
This keeps the browser on one current projection instead of forcing repeated
snapshot-gap recovery. Simulation and Library review controls follow the fresh
held desktop lease, not whether Plan or Observe happens to have another eligible
action, so moving between workspaces does not make the controller read-only.

Current automated proof is green: protocol 4/4, server 177/177, and web
117/117. Functional browser proof covered the normal
Plan-to-Verify workflow,
fresh acceptance projection, restart/no-replay, abort and reconciliation
states. It also covered explicit Project intake and routing, client-only stage
navigation, deterministic Calibration settlement, live Current Result refresh,
and a 390 px Project projection with no mutation control or horizontal
overflow. Automated browser projections cover the exact Observe-to-Library
link and Library review state. Designer review covers wide, 768 px, and 390 px
Nightbook states separately.

## Observability

The reconciled server has one opt-in, Effect-owned OTLP/HTTP protobuf runtime
for traces, structured logs, and metrics. Standard OTEL configuration controls
each signal. The origin owns initialization, flush, and disposal. Publisher
telemetry uses the same lifecycle model in its process.

Traces cover stable HTTP roots and high-value Plan, Observe, Acquire, Library,
Process, projection, executor, frame, plate-solve, publisher, startup,
admission, Alpaca, and named SQLite boundaries. Metrics cover closed operational
outcomes, SQLite duration/count/backlog, and Node.js event-loop, V8 heap, and GC
signals. Empty worker polls, SSE heartbeats, static assets, and health polling
do not create spans.

Telemetry fields use closed, low-cardinality operations and outcomes. They do
not export identities, request bodies, raw domain IDs, coordinates, paths,
object keys, checksums, provider response text, JWT details, email addresses,
SQL text or values, process arguments, or environment values.

Deployment examples route the origin and publisher containers to the host
collector through `host.docker.internal:4318` with the Compose host-gateway
mapping. Final isolated-candidate proof on Arch covered healthy Plan, Library,
snapshot, and live routes plus stored traces, logs, operational/SQLite/runtime
metrics, correct metric units, and cross-signal privacy exclusions. The
candidate exited cleanly; production Astro Console and SigNoZ were unchanged.
Exact candidate identity, signal results, earlier trace IDs, historical test
counts, and rollout notes are in the
[OTEL observability delivery record](../archive/handoffs/otel-observability-2026-08-09.md).
The dashboard, infrastructure agent, and alert definitions remain owned by the
separate `arch-sig-noz` repository.

## Proof Boundary

Completed evidence covers local contracts, service behavior, SQLite/HTTP/SSE,
browser presentation, locally promoted Nightbook routes, deterministic simulated
Alpaca behavior, real-frame executor retrieval and intake, pixel-derived local
preview, one covered-camera physical exposure, live Alpaca ImageBytes transfer,
restart without replay, remote ingress and control, one isolated real
camera-original intake, local solve-only evidence, current GET-only
provider/device communication for the selected ASI mount, imaging camera, and
focuser, and deterministic worker-owned Process execution. It does not prove
production deployment of the promoted routes, mount movement, live
abort behavior, production processing tools, or sky image quality from the
covered indoor frame.

## Next Owner Action

GitHub issues `#2`, `#3`, and `#4`, the shared protocol refocus, origin runtime
deepening, and Nightbook workspace runtime deepening are complete locally. The
first four selected corrections from the `apps/web` architecture map in GitHub
issue `#18` are merged. The fifth selected correction, Shared Control action
reachability in `#27`, is merged through PR `#28`. The bounded Acquire semantic
intent slice in `#29` is merged through PR `#30`. The Observe lifecycle semantic
intent slice in `#31` is merged through PR `#32`. The Plan semantic-intent
slice in `#33` is merged through PR `#34`. The Library Asset Review semantic-
intent slice in `#35` is merged through PR `#36`. The Processing Project intake
semantic-intent slice in `#37` is merged through PR `#38`. The current Process
mutation semantic-intent slice in `#39` is merged through PR `#40`. The bounded
review correction in issue `#41` is merged through PR `#45`. The follow-up local
state correction in issue `#46` is complete at `a02ca2f`. Process now binds the
Develop editor to the exact routed Project and authoritative Develop draft, and
binds source-handoff naming to the exact routed Library Asset. Route-leading
projection gaps fail closed without exposing stale mutation controls. Production
Processing Project lifecycle evidence now projects the saved Library Master onto
its exact Stacking attempt without mutating stored attempt evidence.
`NightbookWorkspaceRuntime.states + submit` tests prove fail-closed Process stage
eligibility, complete latest saved Stacking Master evidence, and latest-operation
ownership for overlapping same-route existing-Project intake reconciliation,
with one write and no replay. The Master presentation is eligible only from that
same complete, matched Stacking evidence; an incomplete page remains unavailable.
Focused mounted React proof and functional browser evidence cover successive
Project, draft, and Asset identities. The complete web check passes 186/186, and
Designer review passes wide, compact, and 390 px phone states with no P0, P1, or
P2 finding; phone remains read-only. The handled optional simulation 404 remains
unrelated development-console noise. No later architecture opportunity is
selected. The other architecture frontiers remain the durable work-claim re-audit
in `#5` and the origin integration-test harness in `#6`.
Select and integrate a real processing library only in a later accepted item;
the current deterministic materializer proves orchestration and evidence, not
astronomy processing quality. The remaining accepted delivery list continues
with the host backup repair and owner-observed outdoor Acquire proof when its
operating window is available.

## Later Accepted Items

Follow the ordered scope and proof in the
[Item 3.5 Process workflow plan](process-workflow-plan.md).

5. **Repair the scheduled host backup job.** The pre-update backup and isolated
   restore drill succeeded, but `astro-console-backup.timer` currently calls a
   script that expects container `astro-console-origin` while Compose creates
   `deployment-origin-1`. Reconcile that host-only identity before relying on
   the timer again.
6. **Remove unused installation staging copies.** After the release and backup
   retention boundary is reviewed, remove only the unused failed-build and
   index-download staging copies under the explicit `chicks` home paths. The
   deployed `776242a` release, installed Astrometry.net indexes, and SSD backup
   remain retained.

Configured Acquire physical pointing, image-backed centering, sky quality, and
live abort remain owner-observed outdoor proof for a suitable nighttime window.
They do not block the remaining beta audit and promotion work.

The unavailable filter wheel stays explicit throughout this sequence. The
current bounded target path continues to use `hold`; park is not added as an
incidental part of indoor preparation.

Completed chronology and former authority are indexed in the
[documentation archive](../archive/README.md).
