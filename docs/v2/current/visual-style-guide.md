# V2 Visual Style Guide

Status: **Accepted Phase 1 visual implementation authority — Phase 0.5 closeout**

This guide tells an implementation agent how V2 should look and read after the
product model is already known. It is not permission to change that model.

## Authority And Conflict Rule

Read in this order: the [product specification](product-spec.md),
[UX guidance](../ux-design-guidance.md), accepted contract/gate evidence, this
guide, then the [component library](ui-component-library.md) and
[build contract](ui-build-contract.md). If a visual rule conflicts with owner,
freshness, consequence, recovery, or access semantics, preserve the semantic
truth and change the visual rule. A screenshot or familiar component pattern
never wins that conflict.

## Character

V2 is a dense, calm personal observatory workspace. It is recognizable through
an observing window, image-derived evidence, accepted-run authority, asset
lineage, and image history—not a dark palette, cyan accents, or astronomy
decoration. Ask the noun-swap question: if incident-management nouns could
replace V2 nouns without changing the screen, add domain evidence or hierarchy.

The order of attention is: current service truth; current decision or protected
automatic activity; evidence that supports it; optional inspection. Do not
make every datum a bordered card.

## Shared Shell

Use one observatory run/status anchor: product identity, accepted run/phase or
idle state, controller/capability, concise freshness/evidence age, and service
truth. It routes to a workspace; it never duplicates pause, stop, retry, or
Apply controls. Compact workspace navigation must reveal labels deliberately,
not only on hover. On phone, it becomes a readable monitoring projection:
state, progress, health, evidence, and attention; no mutation controls.

## Material, Shape, And Type

Canvas is dark and quiet. Use a surface for an owned working region, a softer
surface for grouped facts/recessed context, and raised material only for a
selected or temporary layered object. Depth signals attention order, not a
card style. Keep Process's outer field quiet; luminosity, color, and depth
belong to the image canvas and evidence objects.

- 6px: dense facts and adjacent grouped items; 8px: controls/ordinary bounded
  panels; 12px: major frames and modals. Rounded shapes must identify a real
  contained object, image, overlay, or inspection layer.
- Primary and secondary operational text must be at least 12px. Faint text is
  decoration or nonessential large text only.
- Labels are compact uppercase/letter-spaced only when they improve scanning;
  they name a fact or state, not generic section chrome.
- Use tabular numerals for aligned durations, attempts, progress, and offsets.
- Selection has visible placement/border/inset treatment; focus is a
  high-contrast outline. Color never supplies state alone.

Semantic color: cyan current/selected evidence and focus; green verified,
complete, healthy, or safely retained; amber waiting/pressure/approval;
red failed, blocked, destructive, or unsafe; blue read-only; violet optional
lineage distinction. Every use also has text, icon, or structure.

## Intentional Rooms

Plan privileges the observing window, sequence order, viability, and readiness;
target summaries are supporting aligned facts. Observe privileges the latest
image-derived evidence and current decision; its compact Night Trace has a
text label plus shape/icon and semantic color. Library privileges chronology,
lineage, durable asset identity, representation availability, and provenance.
Process privileges `steps | image canvas | context`; session history is linear,
completed work reads verified/cool, and Apply/current operation outranks Save,
Switch, and Discard. These are intentional exceptions, not inconsistencies.

## State And Motion

Say what happened, impact, protection, and next action. Automatic activity
reads as a live trace with its bound, evidence, and “no operator action
required,” not a second decision card. Recovery preserves valid evidence and
names retry scope. Freshness and authority stay visible wherever action can be
misread. Motion is reserved for work in progress and must respect reduced
motion; never animate merely to simulate a live console.

## Accessibility And Responsive Check

Every control has an accessible name, visible focus, keyboard path, and touch
target. Pointer-only comparison also supports Space and Enter. Test wide,
compact, and 390px phone states: no document overflow, no hidden essential
status, and no desktop mutation controls on phone.

## Anti-Generic Review

Reject a change that adds uniform cards, decorative status pills, tiny required
text, generic dashboard grids, unrelated-product copy, or warm attention color
for completed work. Prefer native working objects, causal language, evidence,
and consequential-state coverage over ornamental differentiation.

## Foundation Reference

| Role | Reference | Use |
| --- | --- | --- |
| canvas | `#080c10` | application background; never a raised card substitute |
| surface / soft / raised | `#0e141a` / `#111920` / `#151d25` | owned work / grouped facts / selected or bounded raised region |
| line / strong line | `#26333e` / `#3a4a57` | ordinary relationship / major frame or control boundary |
| text / muted / faint | `#e9f0f4` / `#91a0aa` / `#667680` | primary / secondary operational / decorative only |
| accent / strong | `#67d5df` / `#a2f3f4` | current evidence, selection, focus, primary action |
| success / attention / danger | `#7dd3a7` / `#f3bb62` / `#ff7c79` | verified / waiting-or-approval / failed-or-destructive |
| readonly / lineage | `#8fb6ff` / `#bea4ff` | monitoring capability / optional derivation distinction |

| Type role | Size and line height | Use |
| --- | --- | --- |
| screen title | 34–64px / 1.02 | one workspace question or major reference title |
| workspace heading | 24–34px / 1.15 | native object and decision context |
| panel heading | 15–20px / 1.25 | contained evidence or inspection subject |
| body / action | 14px minimum / 1.45 | decisions, explanations, controls |
| supporting operation text | 12px minimum / 1.35 | facts, labels, timestamps, bounds, provenance |
| mono fact | 12–13px / 1.35 | offsets, progress, IDs, duration, attempt counts |

Use a 4px base spacing rhythm: 4/8 for tightly related facts, 12/16 for a
contained region, 20/24 for a working-object boundary, and 32/48 for a screen
section. Elevation is sparse: an image/evidence surface or modal may receive a
low, spatially meaningful shadow; ordinary panels do not. Focus is a 2px
accent outline with offset. Hover may reveal affordance but may not carry
exclusive information. Motion is 120–180ms for feedback/progress only and is
removed or reduced under `prefers-reduced-motion`.

## Canonical Visual Evidence

Use the [Composite](../../../prototype/v2-ui/composite-prototype.html),
[Acquire](../../../prototype/v2-ui/acquire-prototype.html),
[Run Authority](../../../prototype/v2-ui/run-authority-prototype.html), and
[Process](../../../prototype/v2-ui/process-prototype.html) references for
accepted interaction semantics. Use the [clean Phase 0.5 previews](../../../prototype/v2-ui/index.html)
and [visual component companion](../../../prototype/v2-ui/phase-0.5-component-library.html)
for applied visual language. Neither replaces product or contract authority.
The separate [accepted brand foundation](../../../prototype/v2-ui/phase-0.5-brand-style-guide.html)
extends this language to marketing and collateral: palette, type, material,
voice, templates, accessibility, and the selected Alignment Aperture V1 mark
are accepted. Its versioned symbol release, exports, and governance note live
in [`prototype/v2-ui/assets/brand/v1/README.md`](../../../prototype/v2-ui/assets/brand/v1/README.md).
It is not a production UI authority and does not by itself close Phase 0.5.
The wordmark is currently an approved reference composition pending an outlined
lettering release; future mark changes require versioned brand governance.
