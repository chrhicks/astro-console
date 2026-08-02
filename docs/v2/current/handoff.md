# Production Convergence Handoff

Status: **Phases 1 and 2 closed — Production Convergence in progress; complete it before accepting a Phase 3 implementation slice**

## Completed Host-Verification Bundle

The published M13 linear-master FITS was refreshed with R2 attachment metadata,
then downloaded successfully through a fresh five-minute private-R2 link. The
browser saved the FITS instead of rendering its raw bytes. The signed bearer
URL exists only in the redirect, never in a browser JSON projection.

Corrected download deployment, current rig-worker liveness, and scheduled SSD
backup with restore drill are all verified. No Solar capture or device command
was issued during this bundle.

## Phase 1 Closeout

The branch-wide regression against `main` is complete. It retained the accepted
V2 product semantics, fixed the malformed Library asset path, made the
local-web shell explicit instead of copy-patched, and removed whitespace noise.
Local-web build/tests pass **59/59**, contracts build/tests pass **179/179**,
and desktop build/tests pass **182/182**. The local-web Designer re-review
passed at wide, compact, and 390 px phone widths.

`4308796` is now on `main`; `v2` has no unique desktop or SDK paths. Phase 1
does not authorize further cleanup by default.

## Current Work: Continue Production Convergence

Phase 2 is closed. Its five completed slices are [Multi-Sequence Draft and
Deterministic Validation](phase-2-planning.md#first-slice-multi-sequence-draft-and-deterministic-validation),
[Immutable RunDefinition Acceptance](phase-2-planning.md#second-slice-immutable-rundefinition-acceptance),
[Bounded Fake Execution](phase-2-planning.md#third-slice-bounded-fake-execution-of-an-accepted-rundefinition),
[Bounded Pause and Resume](phase-2-planning.md#fourth-slice-bounded-pause-and-resume-of-a-fake-active-run),
and [Deterministic Run Resolution and Consequence-Aware Edits](phase-2-planning.md#fifth-and-final-slice-deterministic-run-resolution-and-consequence-aware-edits).
They prove deterministic Plan persistence/projection, a revisioned immutable
RunDefinition snapshot, a two-sequence fake executor through completion, and
durable fake-run pause/resume, resolution policies, and consequence-aware
edits. The prepared next packet is [Read-Only Decision-Grade Preflight](phase-3-planning.md#first-slice-read-only-decision-grade-preflight).
It remains prepared but is not the next implementation target. First complete
the five sequential Production Convergence Epics:

1. `tkt-ezxr1fsb` — promote the proven server. **Complete.**
2. `tkt-n9yoieoz` — create the production Nightbook web application.
   **Complete.**
3. `tkt-uuom4upo` — establish the decoded snapshot, SSE, capability, command,
   and failure seam. **Implementation and validation complete; pending owner
   closeout.**
4. `tkt-qffwfa47` — ship web and server from one version-matched origin.
5. `tkt-zcsucxyx` — migrate proven workspace slices and retire experimental
   implementation paths.

Each Epic is blocked by its predecessor and contains its own ordered child
implementation tasks. Convergence preserves existing proof boundaries and does
not authorize a provider read, device command, physical capture, processing
workflow, off-host recovery, or storage-health operation. After convergence,
the preflight packet must still be accepted before implementation; it authorizes
only a current provider read and truthful checklist projection.

## Production Web Application Complete

`apps/web` is now the standalone production Nightbook client foundation. It
uses the accepted Alignment Aperture mark, visual tokens, shell, and
workspace-native Plan, Observe, Library, and Process compositions. Typed
presentation interfaces keep fixture and future transport concerns outside the
React workspaces. Route-backed workspace, Asset, processing-session, and source
handoff locations support direct load, refresh, and browser history.

Owner clarification supersedes the prior Phase 0.5 visual wording:
`docs/v2-ui-final` is representative of intended production `apps/web`
visuals. Its screenshots prove visual composition only; they do not prove its
fixture runtime, local mutation behavior, or viewport-derived authority.

The production bundle fails closed with a truthful unavailable/read-only
projection. Development-only visual fixtures cover fresh, stale, disconnected,
rejected, Observe lifecycle and recovery, Library delivery, and Process failure
states without claiming a durable or physical result. The fixture adapter and
theme-study runtime are absent from the production bundle. Capability and
action availability are projection-owned rather than viewport-owned; current
phone and unavailable projections contain no mutation controls.

The web package format, lint, strict typecheck, production build, bundle check,
and focused tests pass. Screenshot-backed Designer and browser reviews passed
at wide, compact, and 390 px phone widths with direct deep-link refresh,
back/forward, keyboard focus, semantic status, no console errors, and no
horizontal overflow.

## Production Client Seam Complete Pending Owner Closeout

Epic 3 emits shared contracts and establishes the bounded bootstrap HTTP/SSE/
control seam between `apps/web` and `apps/server`. The Effect-owned web client
loads authoritative snapshots first, reconnects through a fresh snapshot with
no command replay, and rejects stale state. The Nightbook shell is authoritative;
phone capability is server-owned; and command submission is typed. Contracts
pass **182** tests, server passes **71**, and web passes **37**. Designer PASS
and real-browser/ui-validator PASS cover wide, compact, and 390 px layouts.

The validation uses real native SSE plus a temporary validation-only same-origin
proxy. It does not establish deployment integration: Epic 4 owns the actual
one-origin shipping and integrated local workflow. This work preserves the
existing proof boundary: it authorizes no provider read, device command,
capture, or Phase 3 behavior.

The user accepts NVMe live/recent data plus the SSD backup as current
same-host resilience. Off-host recovery is not current Phase 1 scope.

## Verified Baseline

- `apps/server` type checks and its SQLite/HTTP/SSE/worker/filesystem
  integration suite pass **71/71**. The suite covers the retained local-web
  foundation, Process Save/publisher boundary, and the deliberately installed
  deterministic M27 fixture without creating generic hardware work. Normal
  origin, rig-worker, Solar CLI, publisher, and processor database opening
  runs migrations without seeding that fixture's Plan, Library, or Process data.
  A fresh origin instead reports a truthful `unavailable` plan projection until
  an authorized workflow installs real state. `apps/server` is the active
  production implementation target; “local-web” remains only where it names
  retained historical proof or fixture boundaries.
- A ready persisted deterministic `ObservingPlan` can be accepted once as an
  immutable SQLite `RunDefinition` snapshot with a `fake` executor marker.
  The service revision-guards and idempotently replays acceptance, publishes
  one authoritative SSE update, and does not create an outbox record, active
  run, provider call, or device command. Later draft revisions do not alter
  the accepted snapshot; this is acceptance evidence, never execution proof.
- `StartRunFromPlan` resolves the accepted definition and, for the `fake`
  executor only, starts a controller-owned durable run at `preflight`. The
  deterministic service transition advances both sequences through `acquire`,
  `capture`, and `verify` to `completed`, preserving run revision, sequence
  progress, and SSE truth through restart. This proves a fake executor only:
  it creates no outbox work, provider call, capture evidence, or device command.
- A current desktop controller can pause a fake or fixture active run, which
  durably preserves its resumable phase and records one `RunPaused` fact. The
  executor does not advance while paused; a revision- and lease-guarded resume
  restores that exact phase and records one `RunResumed` fact. This is fake-only
  managed-run intervention: it creates no provider call, device command,
  outbox work, or capture evidence. The desktop Observe fixture exposes the
  eligible Pause/Resume control; the phone remains read-only.
- A current desktop controller can resolve only a fake or fixture active run
  through durable stop, sequence skip, one bounded retry, or terminal
  `parkRequested` policy. A closed service preview classifies three fake edits
  and binds disruptive approval to its displayed consequence. This completes
  Phase 2 managed-run semantics with no provider call, device command, outbox
  work, capture evidence, or Solar activity; browser phone projection remains
  read-only.
- Phase 3 has no implementation evidence yet. Its prepared first slice is
  read-only decision-grade preflight against current provider facts. Rig-worker
  `alive` / `ready` remains liveness only and does not make preflight, capture,
  or physical safety claims.
- Process Save is a service API only: app-owned source IDs resolve under
  configured roots, selected bytes are checksummed and atomically promoted,
  and Asset/provenance/receipt/`PublishAsset` records commit together. Recorded
  promoted-output orphans are bounded cleanup candidates; disk operations
  otherwise remain `unknown` and no storage-health workflow is deployed.
- The one-shot manifest processor is separate evidence tooling, not origin
  configuration or an active workflow. It proved one existing M13 source and
  linear master can become checksum- and lineage-backed SSD originals/finals.
- The publisher streams and checksum-verifies the known file, projects only
  provider-verified R2 publication, and is isolated from public, tunnel, and
  rig credentials. The M13 simulation proved one real private-R2 upload and
  HEAD verification; it was not fresh capture or live image processing.
- Origin and publisher run `eceab25`: an admitted published Asset ID produces
  one five-minute private-R2 redirect, whose attachment metadata made the
  owner's M13 browser request download rather than render the FITS. The signed
  URL is not projected or persisted.
- The schema-compatible rig worker durably reports `alive` / `ready`, with no
  Solar work pending. The enabled backup timer has one checksum-backed SSD run
  and disposable restore drill. These prove liveness and same-host resilience,
  never physical capture or off-host recovery.

The [host-verification record](../archive/handoffs/phase-1-host-verification-2026-07-29.md)
preserves the completed chronology and detailed test evidence. It is historical;
this handoff is the active authority.

## Remaining Backend and Infrastructure Boundaries

| Boundary | Current state | Required proof |
| --- | --- | --- |
| Process Save and permanent local output | One-shot manifest processor ingested an existing M13 LIGHT original and distinct Siril linear master into SSD originals/finals with lineage and checksum proof | Keep processor one-shot/least-privilege; later processing workflow needs a separately authorized product slice. |
| Publication worker and private R2 | M13 linear master real PUT plus provider HEAD checksum/byte verification observed; durable projection is `published` | Controlled recovery drill under normal load. |
| Downloads | Streamlined origin and publisher from `eceab25` are deployed. The M13 object has verified attachment metadata and its fresh private-R2 URL downloaded successfully in the browser. | No further Phase 1 proof. Future outputs receive attachment metadata at publication. |
| Storage health and cleanup | Process Save containment and recorded-orphan cleanup are locally proven; operations disk is `unknown` | Authorize a separate storage-health workflow before adding thresholds, capture admission, or scratch cleanup. |
| Rig-worker liveness | Schema-compatible worker is running and durably `alive` / `ready`; no Solar work was pending. | No further Phase 1 proof. This remains liveness only, never capture proof. |
| Same-host resilience | Enabled SSD backup timer has a successful 2026-07-29 run with checksum and disposable restore-drill evidence. | No further Phase 1 proof. This is the accepted current resilience scope. |
| Off-host recovery | Not current scope | Revisit only if the user changes the current NVMe-plus-SSD resilience decision. |
| Device/session presence | Person-to-client fixture | Stable production client/session authority before treating a person's browsers as distinct presence clients. |
| Processing deployment | Compose placeholder absent by design | Separate least-privilege processor/publisher lifecycles, bounded resources, and no rig/tunnel credentials. |

## Scope and Authority

- The accepted V2 UX, run authority, and service-owned truth remain frozen.
  This packet changes no workspace semantics.
- Rig-worker liveness is not an active Solar or physical-run instruction.
- Cloudflare Access remains identity admission. The service still owns durable
  membership, capability, lease, revision, idempotency, safety, and artifact
  authorization checks.
- R2 is a private artifact/delivery store, never canonical run state or the
  sole copy of original evidence.
- This handoff authorizes no off-host recovery work, new browser controls, or
  processing-workflow implementation.

## Read First

1. [V2 Start Here](../README.md)
2. [V2 delivery plan](delivery-plan.md)
3. [Phase 3 implementation planning](phase-3-planning.md)
4. [Infrastructure plan](../infra/README.md)
