# Nightbook Beta Real-Runtime Plan

Status: **accepted — first beta real-truth bundle complete**

Accepted: August 8, 2026

## Outcome

Promote the Nightbook beta to the main Astro Console UI after Plan, Observe,
Library, and Process use service-owned projections and complete their accepted
workflows. Hardware-facing milestones must use real provider, device, or image
evidence. Deterministic fixtures remain regression tools, not delivery proof.

The rendered Nightbook demo remains the authority for composition,
interaction, responsive behavior, and visual treatment. Astro Console owns
contracts, commands, durable state, provider adapters, eligibility, and proof.

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
- Keep `?ui=beta` as the integration route.

### 2. Real-frame simulator foundation

- Add the manifest, preparation script, bounded simulator, scenario state
  machine, and recorded-response contract tests.
- Run one exact Nightbook Observe-to-Library path against the simulator with
  real frame bytes.
- Prove checksum, intake, preview or explicit preview limitation, restart, and
  browser projection.

The development inspection path is now `npm run dev:sim:inspect` from
`apps/server`. It verifies all scenario-selected FITS copies before startup and
opens the Nightbook beta with a persistent simulation context strip. Its first
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

### 5. Indoor camera-to-Library path

- Start and separately abort an owner-approved bounded exposure.
- Let the service observe completion, retrieve bytes, retain the original,
  create Library truth, and generate inspection evidence.
- Remove the need for the browser to submit invented completion metadata.

### 6. Outdoor Acquire and modest capture

- With the owner present, add bounded telescope slew, correction, and park
  confirmation behind the service.
- Use the existing local solver for image-backed target verification.
- Complete Preflight, Session Acquire, Target Acquire, Capture, Recover, and
  Complete for one selected target and rig.

### 7. Complete Library and Process

- Finish Library review, rating, annotation, compare, related representations,
  delivery lifecycle, and Process-output lineage against real assets.
- Replace the synchronous Process simulation wrapper with durable worker-owned
  Build and Develop workflows, checkpoints, retry, save, discard, and measured
  pressure.
- Select one production processing adapter only through a separate owner
  decision; current V2.1 does not yet select one.

### 8. Promote the beta

- Verify every exact Nightbook workflow and shell state against current service
  truth.
- Complete functional browser proof and Designer review at wide, compact, and
  390 px phone widths.
- Promote only after every enabled action has a real command path and every
  unavailable action has a typed reason.
- Retire the old presentation in a later cleanup after promotion.

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
   restart, and the beta UI; and
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
- Automated proof is green: contracts 187/187, server 106/106, and web 113/113.
- Designer review passed against Nightbook at wide, 768 px, and 390 px widths.
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
