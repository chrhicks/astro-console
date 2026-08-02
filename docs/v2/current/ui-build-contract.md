# V2 UI Build Contract

Status: **Nightbook final visual implementation authority**

Use this document with the product specification and the visual style guide to
build production V2 UI from backing data. It defines the boundary between data,
semantic presentation, and reusable implementation.

## Implementation Order

1. Read product ownership and state semantics first.
2. Define a typed projection from service/backing data; no browser-owned
   durable substitute state.
3. Map the projection to the native working object, then its decision,
   evidence, context, and action patterns.
4. Implement ordinary plus awkward states before visual polish.
5. Validate keyboard, phone monitor, overflow, freshness, and stale-action
   rejection before component extraction.

For visual implementation and review, inspect [`docs/v2-ui-final`](../../v2-ui-final/).
Adapt its source composition and token system while retaining production route
links, typed projections, and service-owned authority. Do not import its
fixtures, theme runtime, viewport authority, local durable/mutation state, or
button-based workspace navigation. Keep the Alignment Aperture asset.

## Data-To-UI Mapping

| Domain data | UI projection | Required presentation boundary |
| --- | --- | --- |
| Active Run + revision + phase | status anchor and Observe runbar | accepted definition/current phase/progress; changing workspace never mutates it |
| Control lease + presence + freshness | capability/freshness and Authority trace | controller is distinct from viewer; stale intent is rejected before action |
| Plan + sequence + viability | observing window and selected sequence context | future intent only; `Run plan` creates accepted run |
| Acquisition Attempt + frame + solve | evidence surface, geometry, attempt history | desired/solved/uncertainty/bound visible; preserve failed frame |
| Asset + representations + lineage | Library chronology and lineage | stable IDs/provenance/availability; originals may remain local |
| Processing Session + history + checkpoint | Process navigator/canvas/Operation | preview, Apply, undo, checkpoint, failure retry scope are distinct |
| Resource pressure/tool diagnostics | contextual notice/diagnostics | state measured pressure and protection; redact secrets/paths |

## Screen And State Inventory

Build and test Plan viable/invalid/ready, Observe healthy/warning/recovery,
Acquire automatic/exhausted/approval/verified, Authority fresh/stale/disconnect
/rejected/takeover/read-only, Library asset/representation unavailable/lineage,
and Process build/preview/applied/failure/retry/save/discard/switch. For each,
record: dominant object, operator decision, source evidence, owner, freshness,
allowed action, failure protection, and phone projection.

## Non-Negotiable Semantics

- Reconnect installs the current authoritative snapshot; do not merge old local
  edits into service truth or use `reconstructed` as primary UI language.
- Browser presence is not control authority; no buffered/replayed commands.
- Automation explains/proposes; it does not silently mutate hardware, plans,
  or image history.
- Process preview is not Apply; discarded session work is not durable asset;
  saved outputs are related Library artifacts, not one universal final.
- Phone is monitoring only in the initial release.

## Build Checklist

For each screen: use the [style guide](visual-style-guide.md) hierarchy and
[component library](ui-component-library.md) patterns; keep required text at
12px or larger; provide focus/keyboard/semantic status; make a compact layout
before phone; ensure no page-level horizontal overflow; and test live changes
against stale/owner/permission/race outcomes from Gate 5.

## Extension Process

Do not copy a prototype class or create a generic design primitive by default.
First classify the request: product semantic change, existing pattern instance,
workspace-native exception, or genuinely new component. A semantic change
requires product/gate authority. A new component requires the promotion
evidence listed in the component library. Record accepted exceptions and their
ordinary/awkward validation in this document's adjacent change record or the
relevant gate, then update the library and style guide together.

## Component Selection Matrix

| If the user must judge… | Use | Do not use |
| --- | --- | --- |
| future viability and ordered intent | observing window + selected sequence context | generic target cards as the primary object |
| current image-derived result | evidence frame + aligned facts + consequence trace | telemetry dashboard or wizard stepper |
| who may change an accepted run | authority trace + capability/freshness | presence avatar or local form state |
| why an asset exists and is available | lineage + representation facts | unlinked thumbnail grid |
| visual development result | canvas + linear session + Operation context | tool-card dashboard or generic settings page |
| protected interruption | consequence panel/modal with scope and return | toast-only failure or hidden retry |

## Screen Projection Inventory

| Screen/state | Primary service source and owner | Dominant object | Allowed/visible action |
| --- | --- | --- | --- |
| Plan viable / invalid | Observing Plan and Sequence; Plan owns future intent | observing window | validate / Run plan only when eligible |
| Observe healthy / warning / recovery | Active Run; service owns execution | current evidence and decision | bounded Observe action; recovery states protection |
| Acquire retry / exhausted / approval | Acquisition Attempt; service owns bound | solved frame/geometry and attempt history | automatic trace / explicit recovery or approval |
| Authority stale / reconnect / lease | Active Run + Control Lease; service owns authority | authority/freshness trace | request/take control only when capability permits |
| Library availability / lineage | Asset; Library owns durable evidence | chronology and lineage | Open in Process/download only by authorization |
| Process preview / failure / save | Processing Session; service owns session | canvas and current operation | Preview, Apply, retry stage, Save/Discard with scope |

## Acceptance Test Protocol

For each changed screen, capture a wide desktop, compact desktop, and 390px
phone walkthrough. Exercise ordinary, warning, blocked/recovery, stale or
permission state, and one destructive or terminal path when relevant. Verify:

1. projection agrees with the backing data and canonical owner;
2. evidence, freshness, authority, bound, and consequence are intelligible
   before action;
3. keyboard order/focus, accessible names, status announcement, reduced motion,
   12px supporting text, and semantic color independence; and
4. no page horizontal overflow, console error, duplicate shell command, or
   phone mutation control.

Record the exact scenario, source fixture/contract, screenshots, and any
exception. A visual pass alone does not prove a consequential transition.

## Change Authority And Log

Classify every request before coding: (a) presentation instance, (b) existing
component extension, (c) workspace-native exception, or (d) product semantic
change. Only (a) may proceed from this contract alone. (b) needs component
library evidence; (c) needs documented ordinary/awkward validation; (d) needs
product and accepted-gate authority. Add accepted changes to the relevant
authority with date, rationale, reference scenario, responsive/accessibility
result, and owner decision. Do not silently turn a Phase 0.5 preview into a
new product contract.
