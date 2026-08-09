# V2 Current Handoff

Status: **V2.0 complete; V2.1 Phase 4 complete; supervised live camera-to-Library proof complete**

## Current Position

Astro Console provides a rig-local service and web workspaces for Plan,
Observe, Library, and Process. V2.0 includes remote viewing, bounded shared
desktop control, durable service-owned state, and reconnect behavior. V2.1
Phases 1–4 add one configured Alpaca rig boundary, bounded camera exposure and
abort, immutable original intake, and local solve evidence.

The existing workspace presentation remains the default route. It is retained
only until the newer beta presentation is ready to replace it; its local visual
system and component grammar are no longer UI authority.

## UI Direction

The official UI and UX reference is the composed React demo in:

`/Users/chicks/dev/personal/kimi_workspace/nightbook-prototype/apps/nightbook-demo`

The same workspace owns the `@nightbook/ui` source, component Gallery, and
package verification. Astro Console's `?ui=beta` workspaces are a high-level
integration pass that validated the package and supplied feedback. They are not
the source design authority.

The desired outcome is to align the beta with real Astro Console projections
and then promote it as the main UI. Follow the lightweight
[UI and UX direction](ui-ux.md). Former Astro Console visual guides, UX
catalogs, component grammar, and Phase 0.5 material are archived.

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

This live run found and closed one provider timing gap. ASCOM can acknowledge
`StartExposure` before its first state read changes from idle to exposing. The
executor now waits for at most two seconds with GET-only observation after an
acknowledgement. It never replays the write; persistent idle still becomes an
ambiguous Recover result. The full server suite now passes 151/151.

The corpus remains ignored and local. The first foundation is committed as
`10e5b34` (`feat: add beta real-truth foundation`).

## Development Simulation Inspection

From `apps/server`, `npm run dev:sim:inspect` starts the bounded Alpaca
simulator, an isolated Astro Console origin, the beta web app, and a dedicated
inspection browser. Before startup, it enumerates the evidence from every
declared scenario, restores the requested scenario, and verifies the four
referenced local FITS copies against the committed SHA-256 manifest.

All beta workspaces show a persistent **Simulation - not live hardware** strip.
Desktop owners can select and reset scenarios and advance deterministic time.
**Load** changes simulator state only. The isolated inspection service installs
one development-only M101 `cameraOnly` Plan with one 15-second frame. The user
then follows the normal beta workflow: accept the definition, start it, refresh
Preflight in Observe, inspect durable work during Capture, and use **Advance
16s** to advance simulator time. Observe then reaches Verify after the service
retrieves and retains the frame. Select **Review captured frame in Library** to
open the exact beta Library detail, inspect the real pixel preview, download the
local original, and record an Accept or Reject review. The browser sends no
provider exposure command or completion metadata. Phone and read-only clients
see the same context without mutation controls.

The supervised executor holds at Verify after Library retention. Definitions
outside the current boundary -- more than one sequence,
more than one frame, deep-sky acquisition, or a camera-only exposure over 60
seconds -- fail before a camera write. Development simulation also requires the
executor Alpaca origin to match the loopback simulator origin.

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

Current automated proof is green: contracts 187/187, server 151/151, and web
126/126. Functional browser proof covered the normal Plan-to-Verify workflow,
fresh acceptance projection, restart/no-replay, abort and reconciliation
states. Automated browser projections cover the exact Observe-to-Library link
and Library review state. Final read-only Designer review of the matching live
retained frame passed at wide, 768 px, and 390 px. It corrected compressed
compact Observe panels and added the exact read-only Library handoff to phone
Observe. The 390 px projection has no horizontal overflow or mutation control,
and an idle interval produced no refresh churn.

## Proof Boundary

Completed evidence covers local contracts, service behavior, SQLite/HTTP/SSE,
browser presentation, the opt-in beta integration, deterministic simulated
Alpaca behavior, real-frame executor retrieval and intake, pixel-derived local
preview, one covered-camera physical exposure, live Alpaca ImageBytes transfer,
restart without replay, remote
ingress and control, one isolated real camera-original intake, local solve-only
evidence, and current GET-only provider/device communication for the selected
ASI mount, imaging camera, and focuser. It does not prove beta route promotion,
production deployment of the beta, mount movement, live abort behavior,
production processing tools, or sky image quality from the covered indoor
frame.

## Next Action

Prepare the next accepted delivery step: bounded outdoor Acquire and modest
capture. Use the simulator to complete the target-acquisition and recovery
states first, then use only owner-observed small slew, focus, and camera probes
for live provider evidence. Keep the unavailable filter wheel explicit and ask
before any larger movement or exposure sequence. A separate live abort can be
added if the owner wants that remaining indoor hardware proof before Acquire.

Completed chronology and former authority are indexed in the
[documentation archive](../archive/README.md).
