# V2.1 Delivery Plan — Real Alpaca Rig Operation

Status: **accepted — Phases 1–4 complete; Phase 5 configured Acquire prepared and simulator-proven**

V2.1 moves the V2.0 service from deterministic provider proof to one bounded,
real-rig operation path. Alpaca is the only hardware integration boundary for
this release. Both owner rigs, including the Seestar, are reached through
Alpaca.

The release first proves safe indoor operation. Outdoor work is limited to the
acquisition facts that need the sky: pointing, plate solving, centering, and
one modest capture. The target is selected when the rig is outside.

## Outcome

An owner can use the rig-local Astro Console service to connect to one
configured Alpaca rig, inspect current truth, take a bounded real exposure,
store it as a Library original with real provenance, and recover honestly from
a provider interruption. During an outdoor session, the same service can
acquire one owner-selected target through plate-solve evidence and complete one
modest capture.

Cloudflare, Access, remote viewing, the control lease, SQLite, local storage,
and the V2.0 workspace model remain in place. Alpaca is an adapter behind the
service; no browser talks to a rig or provider directly.

## Scope and Non-goals

In scope:

- configured Alpaca endpoints for each owner rig;
- read-only capability and health observations;
- service-owned, explicitly bounded device commands;
- real camera exposure, abort, byte intake, FITS/header provenance, local
  original storage, preview, and Library review;
- restart and provider-disconnect recovery;
- one local plate-solver adapter, selected and verified from real frames;
- one outdoor acquire, solve/center, and modest capture proof.

Out of scope:

- a generic Alpaca control panel or browser-side provider client;
- automatic multi-target or unattended all-night sequences;
- a new rig-configuration UI; V2.1 uses reviewed host configuration;
- simultaneous control of both rigs; validate one configured rig at a time;
- new processing tools, MCP automation, product renaming, or an Effect HTTP
  migration.

## Delivery Sequence

### Phase 1 — Alpaca inventory and read-only truth

Create a typed configured-rig adapter. It reads Alpaca management and device
properties for the configured camera, telescope, focuser, and filter wheel,
then publishes timestamped capability, connection, and safety facts in the
existing snapshot. It must tolerate optional or unavailable devices without
inventing capability. ASI/ASCOM Remote may use standard Alpaca UDP discovery
for setup, then stores the returned host, port, and configured-device
`UniqueID`. The Seestar uses its known device-specific Alpaca endpoint and
port; Phase 1 records the live endpoint rather than assuming the ASI route.

Exit evidence: both owner rigs can be configured separately; indoor service
starts against each endpoint; read-only observations, unsupported capability,
and provider-unavailable state are visible and durable. Adapter contract tests
use recorded Alpaca responses; indoor validation confirms real GET requests
only.

Completed August 5, 2026: recorded-response contract and server evidence
passes; the current release image ran on the rig-local Arch host. Seestar
`192.168.4.63:32323` returned configured Camera, Telescope, Focuser, Filter
Wheel, and Switch identities through GET-only reads. ASCOM Remote
`192.168.4.104:11111` initially timed out and produced the typed durable
provider-unavailable snapshot; after the owner restarted the MiniPC, a
GET-only recheck returned Sony Camera and ASI Mount identities. The mount was
connected, not parked, and not slewing; the Sony camera was disconnected and
did not return optional capability facts. The isolated validation image did
not replace the running production service. No hardware command was sent.

Rechecked August 8, 2026 after the owner restored ASCOM Remote. GET-only
management and device reads matched the ASI Mount, ZWO ASI2600MC Pro, ZWO
ASI220MM Mini, ZWO Focuser, Pegasus conditions, and Pegasus switch. The primary
mount, ASI2600MC Pro, and focuser produced a typed `ready` Astro Console
preflight snapshot. The Sony camera remained disconnected; no filter wheel was
listed; the optional Pegasus pressure property was not implemented. The live
server also exposed the non-standard `cansubexposure` read in Astro Console;
the adapter and simulator now use ASCOM `canstopexposure`. No hardware command
was sent.

### Phase 2 — Bounded real commands and recovery

Add service-owned Alpaca command adapters for the smallest useful indoor set:
camera exposure start/abort and camera state readback. Each command remains
behind the existing control lease, expected revisions, idempotency receipt, and
current safety eligibility. The adapter confirms device state after command
acceptance; it does not claim physical completion from an HTTP acknowledgement
alone. Mount movement, focusing, and park remain outdoor/session-specific work;
park requires explicit post-command `AtPark` confirmation.

Exit evidence: approved indoor commands work on one rig at a time; stale or
lease-less commands fail before the adapter; provider timeout, restart, and
disconnect become honest Recover state with no command replay. Mount movement
or park is exercised only when the owner selects a safe physical setup.

Completed 2026-08-05: contracts and the server suite (`90/90`) prove the
lease, revision, idempotency, current camera-connected eligibility, recovery,
and no-replay boundaries. On the owner-approved indoor ASCOM Remote Sony
camera path, the isolated candidate adapter started a 15-second exposure
(`idle` to `exposing` to `idle`) and separately started then aborted a
30-second exposure (`idle` to `exposing` to `idle`). ASCOM requires command
arguments in an `application/x-www-form-urlencoded` PUT body, with
case-sensitive `Duration` and `Light` form names. The candidate was not
deployed over the running production image.

### Phase 3 — Real exposure to Library

Turn a completed Alpaca camera exposure into an immutable local original.
Retrieve bytes through `camera/imagearray` with
`Accept: application/imagebytes`, then branch on the returned content type for
the binary or JSON representation. Do not use `imagearrayvariant`, which caused
full-resolution failures on the validated ASCOM Remote camera path. Validate
the representation, derive safe FITS/header facts when present, write through
app-owned storage, checksum it, create the Library asset, and generate a
bounded preview. Preserve the original even when preview or inspection fails,
and show that limitation as evidence.

Exit evidence: an indoor real exposure appears in Library after a service
restart with stable provenance, an authorized download path, and a usable
preview or an explicit unsupported-preview result. Abort, image-read failure,
and duplicate completion have deterministic recovery tests.

Completed 2026-08-05: contracts and server tests cover bounded ImageBytes
transfer, FITS and raw representation handling, read failure, duplicate
completion, and retained-original behavior. An isolated candidate on
`chicks-arch` completed a real owner-approved 15-second Sony indoor exposure
and read `camera/0/imagearray` with `Accept: application/imagebytes`. ASCOM
Remote returned a 48,481,196-byte binary ImageBytes payload rather than FITS;
the service retained it as `cameraRaw`, with `alpaca-imagearray` provenance,
checksum, and decoded ImageBytes header facts. After candidate service restart,
the Library record remained available with explicit unavailable-preview
evidence, and its local download endpoint returned the same 48,481,196 bytes
with HTTP 200. The candidate did not replace the running production service.

### Phase 4 — Local plate-solve boundary

Select one local solver already practical for the Arch/rig environment. Wrap
it as a bounded worker adapter: explicit input asset, declared arguments,
timeout, sanitized diagnostics, and a typed solved or no-solution result.
Use real stored frames for validation before outdoor operation. The solve
result supplies `SolveEvidence`; it does not itself move the mount.

Exit evidence: an owner-supplied successful real frame produces stored solve
evidence, and an owner-supplied obstructed real frame produces an honest typed
no-solution result. Solver failure leaves the source asset intact; the service
records solver identity, inputs, output facts, and retry scope.

Completed 2026-08-05: the runtime image contains Astrometry.net `solve-field`
and mounts its selected indexes read-only. The separate solve-only worker reads
one retained FITS source, uses its numeric FITS RA/Dec cards plus declared
20–30 degree field and 15-degree search bounds, and records sanitized solver
facts. It has no mount or correction provider. An isolated candidate solved
the owner-supplied `m101_spcc.fit` with Astrometry.net 0.93 and stored typed
`Solved` evidence at RA 210.010579, Dec 54.362347. The haze/cloud-rejected
`22-57-25_15.00s_0053.fits` stored non-retryable typed `NoSolution` evidence.
Both originals remained intact; the solved original and stored evidence also
survived candidate restart. The candidate did not replace production.

### Phase 5 — Outdoor acquired target and modest capture

With the owner present, choose a suitable target and one rig. Run the existing
Observe model through preflight, owner-confirmed slew/acquire, plate solve,
bounded centering correction, a modest capture, Library intake, and review.
Exercise one realistic interruption or restart only when it is safe to do so.

Simulator preparation completed 2026-08-09: the normal beta Plan and Observe
workflow now exercises retained real-FITS acquisition evidence, explicit
correction approval, provisional acknowledgement, later solved verification,
modest Capture, Complete, and Library handoff. A separate no-solution scenario
enters bounded Recover and succeeds only after one materially changed retry.
The development path uses standard loopback Alpaca telescope and camera
traffic with durable per-attempt write claims. It accepts `hold` completion
only and does not claim park confirmation.

The remaining Phase 5 proof is the owner-observed outdoor provider and physical
run; simulation does not satisfy it.

Configured live-path preparation completed 2026-08-09. Production startup can
activate one Alpaca camera and telescope only from reviewed device numbers,
`UniqueID` values, complete site coordinates, and `hold` completion. Durable
provider work records the requested coordinates or exposure before each write.
A claimed slew or correction reconciles with telescope coordinates and
`Slewing` through GET-only reads and never replays its PUT. A retained
ImageBytes frame remains the immutable `cameraRaw` original; the local solver
receives only a scratch 16-bit FITS conversion of those pixels, with the source
and pixel-payload checksums recorded in solve evidence. The accepted target
coordinates supply the solve hint and desired center, so the returned solved
center produces the measured mount RA/Dec correction.

The configured path passed the full deterministic simulator workflow, including
explicit correction approval, a fresh verification frame, final 120-second
Capture, exact centered Library handoff, restart without provider-write replay,
a preclaimed pointing uncertainty, and a receipt-proven retained-frame crash
gap. No hardware endpoint was contacted by the simulator run.

After the simulator passed, an indoor GET-only check reached the reviewed ASCOM
Remote endpoint. Management and all selected device reads returned Alpaca
`ErrorNumber: 0`. Telescope 0 matched `ASI Mount` UniqueID
`81F661C7-1F99-4747-A040-B7E438E04FF2`; Camera 1 matched `ZWO ASI2600MC Pro`
UniqueID `613D9519-B32A-4021-8FE9-830F9D09F22A`; and Focuser 0 matched `ZWO
Focuser` UniqueID `EA31A640-CD6E-4D68-BF8F-B1D683F61BD1`. The mount was
connected, not parked, and not slewing; the camera was connected and idle with
abort and stop capability; the focuser was connected and stationary. No PUT,
command, or movement occurred.

Exit evidence: the service record, captured original, solve evidence, and
Library review agree on the same outdoor attempt. The proof states what the
device confirmed, what image evidence confirmed, and any remaining physical
uncertainty.

## Accepted Follow-on Order

The owner accepted the first four delivery items on August 9, 2026, then placed
two host-housekeeping items at the bottom of the same order. Items 1 through 3
are complete; owner review inserted Item 3.5 before Item 4:

1. **Complete —** Prepare the configured live Acquire and local-solver path
   indoors. Physical pointing, centering, and sky-quality proof remain for the
   supervised outdoor run.
2. **Complete —** Finish beta Library judgment and comparison with retained
   assets. Include the service-backed catalog, published delivery, and exact
   Process handoff.
3. **Complete —** Replace the Process simulation wrapper with durable
   worker-owned Build and Develop execution.

**Item 3.5 — Accepted epic.** Replace the broad automatic Build presentation
with a target-owned Processing Project and explicit, inspectable stages:

- **3.5.1 Next —** Library selection and Processing Project intake.
- **3.5.2 —** Stage drafts, attempts, and persistent navigation.
- **3.5.3 —** Explicit Calibration.
- **3.5.4 —** Explicit Registration.
- **3.5.5 —** Explicit Stacking and saved Master.
- **3.5.6 —** Astronomy Develop workspace.
- **3.5.7 —** Integrated operator review and closeout.

4. Audit all four Nightbook beta workspaces and make route promotion an explicit
   owner decision.
5. Repair the scheduled host backup container-name mismatch.
6. Remove only the unused failed-build and index-download staging copies after
   retaining the deployed release, installed solver indexes, and verified SSD
   backup.

The detailed scope and proof boundaries remain in the
[Nightbook beta real-runtime plan](beta-real-runtime-plan.md) and the
[Item 3.5 Process workflow plan](process-workflow-plan.md).

## Implementation Rules

- Start with configured unicast Alpaca endpoints. ASI/ASCOM Remote setup may
  use the standard `alpacadiscovery1` UDP probe on port `32227`; use the
  discovered host's configured-device `UniqueID` as durable identity, not its
  current IP address. Keep the Seestar's known Alpaca endpoint explicitly
  configured and validate its port in Phase 1.
- Decode every provider response at the adapter boundary. Keep raw provider
  paths, IDs, and errors out of browser contracts.
- Persist command acceptance and intent before adapter work. Persist later
  provider observations and image/solve evidence as correlated facts.
- Use a single active configured rig. A second rig is a separate validation
  target, not concurrent release behavior.
- A hardware command needs the existing controller lease and fresh service
  state. A reconnect refreshes truth; it never replays a prior command.
- Treat Alpaca acknowledgement as provisional. Record completion only after a
  matching decoded device observation; in particular, do not infer a parked
  mount from a successful Park response.
- Bound camera image transfer and decode before allocating or writing it. The
  prior ASCOM Remote full-frame evidence was about 46 MB.
- Use the accepted real-frame corpus and bounded Alpaca simulator described in
  [the beta real-runtime plan](beta-real-runtime-plan.md) for repeatable
  adapter and workflow development. Simulation proof never replaces live
  provider, device, image, or physical evidence.
- Taildrop is preferred for one-off support artifacts between hosts. It is not
  part of the app asset-transfer path.

## Proof Boundary

Indoor proof establishes real Alpaca communication, bounded commands, actual
camera data, storage, and recovery. It does not establish sky position or image
quality. Outdoor proof establishes one specific real target acquisition and
modest capture; it does not establish unattended operation, all-night
reliability, or simultaneous multi-rig control.

## Owner Inputs During Delivery

- reviewed Alpaca endpoint and device-number configuration for each rig;
- the safe indoor command set and physical setup for each validation session;
- the local solver choice once a representative real frame is available; and
- successful and obstructed historical frames for Phase 4 solver fixtures; and
- the selected rig, target, and safe weather/window for Phase 5.
