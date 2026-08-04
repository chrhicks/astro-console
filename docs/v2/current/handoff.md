# Production Convergence Complete Handoff

Status: **Phases 1, 2, and 2.5 closed — all five Production Convergence Epics complete; Phase 3 read-only preflight remains prepared, not accepted or implemented**

## Completed Phase 2.5: Server Boundary Extraction

Phase 2.5 is authorized before Phase 3. It is an internal cleanup only: no
Phase 3 provider reads, device commands, Solar work, capture, browser changes,
or new persistence model are authorized. The owner explicitly removed any
unshipped backward-compatibility requirement: fresh SQLite initialization is
the authority and obsolete migrations, legacy conversions, and retired runtime
paths may be deleted.

Previously completed and committed:

1. `0746d3c refactor(server): extract identity and database foundation` moves
   shared identity and fresh current-schema SQLite ownership out of `server.ts`.
   `DatabasePathNotAppOwned` is a tagged schema error.
2. `1593f66 refactor(server): extract projection and domain state` adds the
   Effect-owned projection publication service and shared domain state module.
   SSE publication uses self-scheduling `setTimeout` loops (250 ms cursor poll,
   15-second heartbeat), not `setInterval`; active timeouts clear on request or
   service close.

Phase 2.5 is now complete. Plan, Control, Observe, and Library command/read
boundaries own their HTTP decoding and response shaping through explicit
SQLite-backed persistence, snapshot, and SSE publication ports. The origin
router owns route selection and imports only HTTP and identity types;
`server.ts` composes the existing handlers and real ports. No extracted module
imports `server.ts`, and no persistence schema or browser, provider, device,
Solar, or capture behavior changed.

Current evidence: `apps/server` `npm run check` passes format, lint,
typecheck, source checks, and **62/62** integration tests. Phase 3 remains
unimplemented and requires separate owner acceptance.

## Production Convergence Complete

All five sequential Continuum Epics are complete:

1. `tkt-ezxr1fsb` — promote the proven server.
2. `tkt-n9yoieoz` — create the production Nightbook web application.
3. `tkt-uuom4upo` — establish the decoded snapshot, SSE, capability, command,
   and failure seam.
4. `tkt-qffwfa47` — ship web and server from one version-matched origin.
5. `tkt-zcsucxyx` — migrate the proven workspace slices and retire experimental
   implementation paths.

`apps/web` is the canonical Nightbook browser client and `apps/server` is the
canonical rig-local authority. The final server image serves the version-matched
web bundle through the Effect WebHost and scoped OriginListener. Canonical
endpoints cover bootstrap, SSE, typed control, Plan, fake managed-run Observe,
Library/download, and Process handoff; direct legacy routes are retired.
`ASTRO_SERVER` is canonical configuration, with bounded deployed legacy aliases
only. Fixture adapter, theme-study, and prototype runtimes are absent from the
production bundle.

Plan, fake managed-run Observe, Library delivery, and current Process handoff
are migrated. Interactive Process remains Phase 5 work. The typed control
request/grant/decline/release/take seam is preserved, but user-facing presence
and control UI remain Phase 6 work; reconnect and presence lifecycle are not
claimed.

Final evidence: contracts **184/184**, server **62/62**, and web **57/57**;
Compose base/download, rig, and publisher renders; and Designer PASS at wide,
compact, and 390 px for owner, friend, and phone projections. Final image:
`sha256:10c3f8ccbcf9530b24a595e90242ad497720d177b8ffdaae95104cf62b18835e`.
No provider, device, Solar, physical, or capture work was performed or
authorized. The Phase 3 read-only decision-grade preflight packet is prepared
but requires separate owner acceptance before implementation.

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

## Completed Production Convergence

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
It remains prepared and requires owner acceptance before implementation. The
five sequential Production Convergence Epics are complete:

1. `tkt-ezxr1fsb` — promote the proven server. **Complete.**
2. `tkt-n9yoieoz` — create the production Nightbook web application.
   **Complete.**
3. `tkt-uuom4upo` — establish the decoded snapshot, SSE, capability, command,
   and failure seam. **Complete.**
4. `tkt-qffwfa47` — ship web and server from one version-matched origin.
   **Complete.**
5. `tkt-zcsucxyx` — migrate proven workspace slices and retire experimental
   implementation paths. **Complete.**

Each Epic was blocked by its predecessor and contained its own ordered child
implementation tasks. Convergence preserves existing proof boundaries and does
not authorize a provider read, device command, physical capture, interactive
processing workflow, off-host recovery, or storage-health operation. The
preflight packet must still be accepted before implementation; it authorizes
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

## Historical Epic 3 Evidence

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

## Historical Epic 4 Evidence

Epic 4 ships the one-origin architecture: the Effect WebHost and scoped
OriginListener serve the version-matched client, with one pinned image embedding
`apps/web` `dist`. The integrated Vite real-bootstrap/SSE workflow is complete,
and the inline shell and its inline CSP allowances have been removed. Final
evidence passes
**182** contract, **69** server, and **38** web tests; strict review,
ui-validator, and Designer are PASS across wide, compact, and 390 px layouts
for owner, friend, and phone projections. The image
`sha256:920d6caf56afab3afe7f5cdb0625ff6b295525358b63ec32c3ffdc8798ad6334`
and Compose renders were verified. No physical, provider, Solar, or device
action was issued.

Epic 5 subsequently completed the detailed Plan, Observe, Library, and Process
migration and experimental-path retirement. The final convergence evidence is
recorded above. Phase 3 remains separately authorized only by its accepted
bounded slices.

The user accepts NVMe live/recent data plus the SSD backup as current
same-host resilience. Off-host recovery is not current Phase 1 scope.

## Verified Baseline

- `apps/server` type checks and its SQLite/HTTP/SSE/worker/filesystem
  integration suite pass **62/62**. The suite covers the retained local-web
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

| Boundary                                | Current state                                                                                                                                                                      | Required proof                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Process Save and permanent local output | One-shot manifest processor ingested an existing M13 LIGHT original and distinct Siril linear master into SSD originals/finals with lineage and checksum proof                     | Keep processor one-shot/least-privilege; later processing workflow needs a separately authorized product slice. |
| Publication worker and private R2       | M13 linear master real PUT plus provider HEAD checksum/byte verification observed; durable projection is `published`                                                               | Controlled recovery drill under normal load.                                                                    |
| Downloads                               | Streamlined origin and publisher from `eceab25` are deployed. The M13 object has verified attachment metadata and its fresh private-R2 URL downloaded successfully in the browser. | No further Phase 1 proof. Future outputs receive attachment metadata at publication.                            |
| Storage health and cleanup              | Process Save containment and recorded-orphan cleanup are locally proven; operations disk is `unknown`                                                                              | Authorize a separate storage-health workflow before adding thresholds, capture admission, or scratch cleanup.   |
| Rig-worker liveness                     | Schema-compatible worker is running and durably `alive` / `ready`; no Solar work was pending.                                                                                      | No further Phase 1 proof. This remains liveness only, never capture proof.                                      |
| Same-host resilience                    | Enabled SSD backup timer has a successful 2026-07-29 run with checksum and disposable restore-drill evidence.                                                                      | No further Phase 1 proof. This is the accepted current resilience scope.                                        |
| Off-host recovery                       | Not current scope                                                                                                                                                                  | Revisit only if the user changes the current NVMe-plus-SSD resilience decision.                                 |
| Device/session presence                 | Person-to-client fixture                                                                                                                                                           | Stable production client/session authority before treating a person's browsers as distinct presence clients.    |
| Processing deployment                   | Compose placeholder absent by design                                                                                                                                               | Separate least-privilege processor/publisher lifecycles, bounded resources, and no rig/tunnel credentials.      |

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
- Stable production presence/session authority and automatic reconnect lifecycle
  remain Phase 6 work. Browser-reported disconnect/reconnect is not a control
  command; persisted legacy reconnecting state still expires safely if found.
- The canonical server/web control seam remains preserved, but user-facing
  request, grant, release, and presence lifecycle is explicitly Phase 6 scope;
  it is not an unreachable accidental behavior. A current pending request means
  only an unexpired authoritative request, not proof that its desktop remains
  connected.

## Read First

1. [V2 Start Here](../README.md)
2. [V2 delivery plan](delivery-plan.md)
3. [Phase 3 implementation planning](phase-3-planning.md)
4. [Infrastructure plan](../infra/README.md)
