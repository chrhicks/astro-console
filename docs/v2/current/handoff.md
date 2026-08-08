# V2 Current Handoff

Status: **V2.0 complete; V2.1 Phase 4 complete; first beta real-truth bundle complete**

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
**Load** changes simulator state only. `ready-rig` and
`optional-device-unavailable` provide **Run preflight test**, which starts the
accepted fixture run when needed and runs the normal Observe preflight.
`exposure-success` provides **Capture test frame**, which runs one 15-second
M101 exposure through the normal Plan, Preflight, camera command, immutable
original, and Library paths. Every other selectable scenario says that its
beta UI driver is not implemented yet and keeps capture disabled; those states
remain available for direct simulator and adapter tests. Phone and read-only
clients see the same context without mutation controls. NGC 7000 test capture
also remains disabled because its truthful 120-second exposure is outside the
current 60-second camera-command boundary.

Current automated proof is green: server 121/121 and web 126/126. Functional
and Designer browser review covered the supported preflight and
capture-to-Library paths, unsupported-driver guidance, and Library preview
containment at wide, 768 px, and 390 px widths. This inspection work contacted
no provider or hardware.

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

Use the one-command simulator inspection for the next supervised execution
spine: replace presentation-only acquisition and capture strings with
structured facts, add durable service-owned work, and reconcile accepted work
after restart without replay. The owner has approved small, bounded slews,
focus adjustments, and camera use for endpoint and behavior verification. Ask
before any larger action so the owner can monitor it in person.

Completed chronology and former authority are indexed in the
[documentation archive](../archive/README.md).
