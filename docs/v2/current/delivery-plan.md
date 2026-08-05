# V2.1 Delivery Plan — Real Alpaca Rig Operation

Status: **accepted — Phase 1 complete**

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

### Phase 5 — Outdoor acquired target and modest capture

With the owner present, choose a suitable target and one rig. Run the existing
Observe model through preflight, owner-confirmed slew/acquire, plate solve,
bounded centering correction, a modest capture, Library intake, and review.
Exercise one realistic interruption or restart only when it is safe to do so.

Exit evidence: the service record, captured original, solve evidence, and
Library review agree on the same outdoor attempt. The proof states what the
device confirmed, what image evidence confirmed, and any remaining physical
uncertainty.

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
