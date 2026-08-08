# V2 UI Component Library

Status: **Nightbook final visual implementation authority**

This is a semantic pattern library, not a generic catalog. Promote a component
only when it has one stable product role, owner/evidence/freshness boundary,
state variants, accessibility behavior, responsive rule, and at least two
proven uses. Shared styling alone is not promotion evidence.

Use `apps/web` source and CSS for the real production visual composition:
compact status register; Plan rail/window/inspector/timeline;
Observe image/decision/lifecycle; Library lineage/evidence/inspector/chronology;
and Process steps/canvas/rail. The shared pattern implementations live in
`apps/web/src/components/` — see its `PATTERNS.md` for the invariant each
component owns, the promotion rule, and the review checklist. Retired UI
studies are available only through Git history and are excluded from
implementation authority.

## Core Patterns

| Pattern               | Product role and required data                                                                            | States and responsive behavior                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Run/status anchor     | accepted run identity/phase/progress, controller or capability, freshness, service truth, attention owner | idle/active/stale/read-only/attention; routes only; wraps to readable rows on phone        |
| Workspace navigation  | current workspace and discoverable destinations                                                           | selected/focus/compact; labels remain available without hover                              |
| Semantic status       | label, semantic kind, optional timestamp/evidence                                                         | text/icon/shape + color; never color-only                                                  |
| Aligned fact register | label, value, unit, optional provenance                                                                   | tabular values; 12px minimum; reflows rather than truncating required facts                |
| Evidence surface      | frame/image/geometry, identity, age, quality/uncertainty                                                  | current/preserved/failed/compare; low-radius contained optical surface                     |
| Context rail          | selected object, mutually exclusive inspection tabs, owner/freshness/provenance                           | context changes with selection; moves below primary work on compact desktop                |
| Consequence panel     | decision, eligibility/bound, impact, protection, action                                                   | automatic/available/approval/recovery/blocked; automatic is trace-like, not an action card |
| Primary action        | explicit owner-authorized consequential command                                                           | enabled/disabled/stale/approval/destructive; one dominant action per current task          |

## Native Structures

- **Plan window:** time axis, usable and scheduled windows, viability/readiness,
  selected sequence, and supporting target facts. Do not replace it with a
  target-card grid.
- **Observe Night Trace:** compact semantic events with time, text, symbol,
  and color; it supports image evidence rather than competing with it.
- **Acquire evidence:** latest frame, desired/solved geometry, uncertainty,
  attempt bound/history, and one current decision or protected recovery.
- **Library lineage:** asset identity, time, run/solve/source relationships,
  representation availability, and immutable provenance.
- **Authority trace:** accepted run, controller lease/capability, freshness,
  consequence/rejection, and history. Presence is not authority.
- **Process session:** linear steps/history, dominant canvas, current operation,
  preview/Apply distinction, checkpoint/retry scope, and saved-artifact links.

## Component State Contract

For every promoted component, implement the following where applicable:

1. owner/canonical source and freshness label;
2. ordinary, loading/activity, stale, failure, recovery, and read-only state;
3. keyboard focus/order, accessible name, error/status announcement;
4. compact and phone behavior; and
5. the data fields that make its claim auditable.

Never infer status from local animation or browser memory. Server truth may
replace a stale projection on reconnect; do not label this “reconstruction.”

## Action Hierarchy

Current authorized Apply/Run/Retry is primary. Contextual session actions
(Switch data, Save to Library, Discard) are discoverable but visually quieter.
Destructive actions name scope and preserve sources where applicable. Disabled
is insufficient: explain ineligibility, owner, freshness, approval, or bound.

## Promotion And Extension

Before adding a component, write a one-page proposal with product role, source
fields, states, owner, keyboard/responsive rules, reference evidence, and why
existing patterns cannot represent it. Add it here only after implementation
evidence across an ordinary and awkward state. If it belongs to one workspace
because its working object is native, document it as a workspace exception.

## Pattern Cards

| Pattern                         | Anatomy and backing data                                                                  | Awkward variants                                                    | Responsive/accessibility                                           | Anti-pattern and evidence                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run/status anchor               | run id, phase/progress, controller/capability, freshness, service health, attention owner | stale projection, disconnected client, read-only, no active run     | wraps facts; phone monitors only; landmark/navigation labels       | not a duplicate command bar                                                                                                                                        |
| Observing window                | time axis, viability, sequence schedule, readiness, selected sequence                     | invalid/shortened window, storage recovery, plan not eligible       | wide timeline; compact preserves order; keyboard selectable target | not equal target cards                                                                                                                                             |
| Evidence frame / solve geometry | frame id/age, desired/solved center, uncertainty, quality, bound                          | no solve, retry, exhausted, outside automatic bound                 | image remains visible; geometry has text equivalent                | not telemetry grid or success toast                                                                                                                                |
| Night Trace                     | timestamp, event label, semantic event kind, evidence link                                | correction, retry, recovery, current capture                        | text + shape + color; compact supporting column                    | not color-only event log                                                                                                                                           |
| Consequence trace               | automatic activity/recommendation, bound, evidence, protection, action                    | automatic, approval, blocked, recovery, destructive                 | action name and status announced; automatic requires no control    | not another rounded action card                                                                                                                                    |
| Authority trace                 | controller lease, presence, freshness, accepted result, rejection reason                  | stale command, reconnect, grace/takeover, phone read-only           | controller distinct from presence; status text is accessible       | not browser-owned run state                                                                                                                                        |
| Asset lineage                   | asset id, source/run/solve links, representation availability, provenance                 | original unavailable remotely, preview-only, missing representation | chronology is navigable and facts align                            | not a generic file grid                                                                                                                                            |
| Process session                 | steps, status/checkpoint, canvas, operation/preview, history                              | failed stage, retry, unsaved switch, save/discard                   | canvas keyboard comparison; selected step drives context           | not equal tool cards or warm complete state                                                                                                                        |
| Context rail                    | selected subject, mutually exclusive tabs, facts/actions                                  | alerts, diagnostics, assistant unread, compact below work           | tabs keyboard operable; never steals focus                         | not always-visible duplicate dashboard; accepted references above                                                                                               |

For each entry, source fields must be typed in the projection and its state
must be rendered from service truth. A component may style an absence, but it
may not invent an unknown value, owner, or eligibility result.
