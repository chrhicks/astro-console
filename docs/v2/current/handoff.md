# V2 Current Handoff

Status: **V2.0 complete; V2.1 Phase 4 complete; beta supervised execution spine complete**

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

The next beta milestone is also complete. Plan now keeps one structured sequence
as execution authority, the service owns a real durable executor, accepted work
is persisted before provider calls, and uncertain writes reconcile through
GET-only observation without replay. Observe projects the exact work states,
timestamps, eligibility, consequences, and Verify boundary through the
Nightbook evidence grammar.

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
Preflight in Observe, inspect durable work during Capture, use **Advance 16s**
to advance simulator time, and inspect the later camera observation at Verify.
The browser no longer sends provider exposure commands or invented completion
metadata. Phone and read-only clients see the same context without mutation
controls.

The supervised executor deliberately stops at Verify. It does not retrieve
bytes or create Library truth, and the inspected Library identity set remained
unchanged. Definitions outside the current boundary -- more than one sequence,
more than one frame, deep-sky acquisition, or a camera-only exposure over 60
seconds -- fail before a camera write. Development simulation also requires the
executor Alpaca origin to match the loopback simulator origin.

The active-exposure observation is published once when Capture becomes proven;
later worker polls do not repeat the same event while the camera remains active.
This keeps the browser on one current projection instead of forcing repeated
snapshot-gap recovery. Simulation and Library review controls follow the fresh
held desktop lease, not whether Plan or Observe happens to have another eligible
action, so moving between workspaces does not make the controller read-only.

Current automated proof is green: contracts 187/187, server 138/138, and web
124/124. Functional browser proof covered the normal Plan-to-Verify workflow,
fresh acceptance projection, restart/no-replay, abort and reconciliation
states, and unchanged Library truth. Designer review passed at 1440 px, 768 px,
and 390 px with no overflow or console error; phone remained read-only. This
inspection work contacted no live provider or hardware.

## Proof Boundary

Completed evidence covers local contracts, service behavior, SQLite/HTTP/SSE,
browser presentation, the opt-in beta integration, deterministic simulated
Alpaca behavior, real-frame transfer and intake, restart without replay, remote
ingress and control, one isolated real camera-original intake, local solve-only
evidence, and current GET-only provider/device communication for the selected
ASI mount, imaging camera, and focuser. It does not prove beta route promotion,
production deployment of the beta, mount movement, production processing
tools, a new physical exposure, or physical image quality.

## Next Action

Build the indoor camera-to-Library path on the supervised executor. Prove image
retrieval, immutable original retention, Library intake, and inspection against
the loopback simulator first, without browser-supplied completion metadata.
Then use the owner-approved bounded live camera path while the owner can monitor
it. Small focus or slew probes remain permitted for endpoint behavior; ask
before any larger action.

Completed chronology and former authority are indexed in the
[documentation archive](../archive/README.md).
