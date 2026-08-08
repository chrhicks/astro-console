# V2 Visual Style Guide

Status: **historical Astro Console-local visual authority**

This guide tells an implementation agent how V2 should look and read after the
product model is already known. It is not permission to change that model.

## Authority And Conflict Rule

`apps/web` source and CSS plus accepted screenshot evidence are the production
visual authority. Retired UI studies are available only through Git history and
never provide current palette, type, shape, or composition authority.

Read in this order: the [product specification](../../current/product-spec.md),
[UX guidance](ux-design-guidance.md), accepted contract/gate evidence, this
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

Canvas is Nightbook ink `#070b12`, with paper `#e6e1d7`, warm-sand primary
`#c6ad7a`, and secondary blue-green `#3d9ca6` for focus and evidence distinction.
Use the final token system for semantic colors, surfaces, disabled states,
image fields, shadows, type, spacing, radii, and controls. Facts use 4px
radii, controls are square, and contained evidence frames are about 10px.
Canvas is dark and quiet. Use a surface for an owned working region, a softer
surface for grouped facts/recessed context, and raised material only for a
selected or temporary layered object. Depth signals attention order, not a
card style. Keep Process's outer field quiet; luminosity, color, and depth
belong to the image canvas and evidence objects.

- Facts use 4px corners; controls are square; evidence and inspection frames
  use the final study's approximately 10px corner. Rounded shapes identify a
  real contained object, image, overlay, or inspection layer.
- Primary and secondary operational text must be at least 12px. Faint text is
  decoration or nonessential large text only.
- Labels are compact uppercase/letter-spaced only when they improve scanning;
  they name a fact or state, not generic section chrome.
- Use tabular numerals for aligned durations, attempts, progress, and offsets.
- Selection has visible placement/border/inset treatment; focus is a
  high-contrast outline. Color never supplies state alone.

Semantic color: blue-green secondary for current/selected evidence and focus; green verified,
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

| Role                                     | Reference                                                                      | Use                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| core ink / paper                         | `#070b12` / `#e6e1d7`                                                          | canvas / primary text                                       |
| core primary / secondary / tertiary      | `#c6ad7a` / `#3d9ca6` / `#80679c`                                              | selected working object / focus and evidence / image depth  |
| core safe / danger / attention / neutral | `#70ae94` / `#d36e64` / `#e4a443` / `#a9aeb7`                                  | verified / failed / waiting / neutral facts                 |
| surface / raised / current               | derived from ink, neutral-dark-1, and primary at `14%`                         | owned work / selected or bounded material / current context |
| text / secondary / faint                 | paper / paper at `72%` mixed with neutral / neutral mixed with ink at `55%`    | primary / operational / decorative only                     |
| border / strong border                   | neutral-dark-1 mixed with ink at `18%` / neutral mixed with ink at `38%`       | relationship / major frame or control boundary              |
| primary / secondary / image              | primary-light-1 / secondary-light-1 / secondary-dark-1 mixed with ink at `38%` | selection / focus / evidence field                          |

| Type role | Size and line height | Use                                           |
| --------- | -------------------- | --------------------------------------------- |
| display   | 24px / 1.15          | workspace title or major reference title      |
| heading   | 20px / 1.25          | contained evidence or inspection subject      |
| body      | 14px / 1.5           | decisions, explanations, controls             |
| fact      | 12px / 1.35          | facts, labels, timestamps, bounds, provenance |

Use a 4px base spacing rhythm: 4/8 for tightly related facts, 12/16 for a
contained region, 20/24 for a working-object boundary, and 32/48 for a screen
section. Elevation is sparse: an image/evidence surface or modal may receive a
low, spatially meaningful shadow; ordinary panels do not. Focus is a 2px
accent outline with offset. Hover may reveal affordance but may not carry
exclusive information. Motion is 120–180ms for feedback/progress only and is
removed or reduced under `prefers-reduced-motion`.

## Canonical Visual Evidence

The final study's compact horizontal status register, native rooms, and 390px
compositions are canonical: Plan is sequence rail / sky arcs / selected facts
/ timeline; Observe is image / decision rail / lifecycle; Library is lineage /
selected evidence / inspector / chronology; Process is steps / image canvas /
operation rail. Study runtime fixtures, local mutation state, theme runtime,
and button navigation are not production behavior authority.

The operational visual reference is `apps/web` source and CSS, with accepted
screenshots as visual evidence. Retired UI studies, fixtures, and brand-source
artifacts are available only through Git history and are not production
implementation authority.
The wordmark is currently an approved reference composition pending an outlined
lettering release; future mark changes require versioned brand governance.
