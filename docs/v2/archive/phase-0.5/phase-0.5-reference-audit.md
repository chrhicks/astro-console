# Phase 0.5 Reference Audit

Status: **current review artifact — findings are not design authority**

Updated: July 23, 2026

This audit is the first Phase 0.5 artifact. It reviews the frozen V2 references
through the original `develop-product-ui` method before a design guide is
treated as authoritative. It does not redesign accepted interactions.

Visual companion:
[Phase 0.5 reference audit](../../../../prototype/v2-ui/archive/phase-0.5/phase-0.5-reference-audit.html).

## Question

Can the Composite, Acquire, Run Authority, and Process references be extended
as one recognizably observatory-specific product without flattening their native
working objects, weakening consequential state, or drifting into generic
dashboard syntax?

## Method And Evidence

The review uses the accepted reference set, the Gate 7 walkthrough, V2 UX
guidance, and the `develop-product-ui` audit method:

- visual authorship / AI-slop review: domain evidence, priority contrast,
  structural specificity, native working objects, ownable cues, state
  completeness, copy specificity, and motion with work;
- non-design product review: operator comprehension, canonical ownership,
  freshness, authority, consequence, recovery, and handoff; and
- cross-slice review at wide desktop, compact desktop, and read-only phone,
  including representative recovery, failure, and stale-authority states.

The main review inspected the rendered references at `1600×1000`, `1000×900`,
and `390×844`. An independent reviewer completed a source/static-reference
audit; it did not have browser access, so its findings are not represented as
live-interaction evidence.

## Observed Strengths

### The consequential surfaces are not AI slop

The core V2 work surfaces are product-specific rather than a generic dashboard
with astronomy copy:

| Slice | Native working object | Product-specific evidence |
| --- | --- | --- |
| Composite / Plan | Observing-window timeline | Target fit, darkness, schedule, storage, and active-run continuity |
| Acquire | Latest solved frame and correction geometry | Desired versus solved center, uncertainty, attempt bounds, image verification |
| Run Authority | Current accepted run with lease and freshness trace | Controller, stale rejection, continuation during disconnect, consequence-aware change |
| Process | Image canvas and linear Build/Develop history | Preview versus Apply, valid checkpoint, stage-local retry, provenance, selected saves |

The references also resolve hard states directly: exhausted acquisition retains
the failed frame and offers a bounded recovery; stale controller work explains
that no hardware action occurred; Process failure retains the image and valid
checkpoint; phone is useful monitoring rather than a squeezed control surface.

### What makes the work attributable to V2

- Service truth has visible evidence and a consequence.
- The object being judged receives the largest useful surface.
- Recovery says what is protected, what continues, and what can happen next.
- Read-only phone consumes the same truth while changing the task to monitoring.
- Specific copy names frames, solves, exposure time, checkpoints, controller,
  and physical outcomes instead of generic statuses.

## Findings

### Presentation and coherence

| Finding | Classification | Evidence and Phase 0.5 question |
| --- | --- | --- |
| Prototype apparatus competes with the production projection in the first viewport: non-operational strip, hub navigation, gate question, scenario control, and evaluation note. | Presentation issue | Review the product projection without study scaffolding before turning prototype chrome into a shell system. |
| The outer dark/cyan rail, run bar, tabs, pills, and rounded panels are competent but partly noun-swappable before the native working object appears. | Presentation issue | Which persistent shell objects carry real run, evidence, and attention meaning, and which are generic containment? |
| Repeated equal-bordered panels and compact statuses can flatten current truth, evidence, and optional inspection—especially in Authority. | Presentation issue | Test a stronger priority relationship without changing authority semantics. |
| `text-faint` at small sizes is not sufficient for required operational context on the dark surface. | Presentation issue | Identify supplementary metadata versus field-critical status, then establish size/contrast treatment from evidence. |
| Compact Process preserves its navigator and canvas while moving context below; the composition needs a comprehension walkthrough under active failure or recovery. | Open question | Can an operator still connect current operation, image, and retry scope without vertical hunting? |
| The persistent active-run projection changes emphasis appropriately by workspace but lacks an explicit invariant content set. | Presentation issue around accepted invariant | Define the minimal cross-workspace run projection: identity, phase/progress, freshness, capability/controller, and relevant attention. |

### Narrow product-language conflicts

| Finding | Classification | Why it matters |
| --- | --- | --- |
| Run Authority labels reconnect `reconstruction complete` and says durable changes were `reconstructed`. | Product-invariant conflict | Accepted V2 language says reconnect atomically replaces the stale browser projection with current service truth; primary UI must not imply browser reconstruction. |
| Composite's historical Process placeholder presents `Recipe` as a provenance object. | Product-invariant conflict | A first-class reusable recipe remains deferred; reproducibility comes from sources, operations, settings, and tool facts. |
| The changed-elsewhere Authority scenario retains a `local edit`, but its refresh/reconnect lifetime is not explicit. | Open question | It is coherent only as genuinely unsent current-page state; it must not read as browser-owned durable workflow state. |

These are narrow reference-language issues, not evidence to reopen the accepted
Plan, Observe, Library, Process, control, or phone interaction models.

## Noun-Swap Test

The answer is mixed in a useful way.

- The inner work cannot be noun-swapped without breaking the screen: timeline
  fit, solve vector, image verification, exposure evidence, linear image
  history, and checkpoint retry are V2-specific.
- The outer containment can be noun-swapped more easily: a dark rail, compact
  activity bar, tabbed inspector, status pills, and bordered panels could host
  an incident or build console until native evidence appears.

Phase 0.5 should therefore improve product evidence and priority contrast in
the shell—not add decorative astronomy motifs or reject familiar controls.

## Next Inquiry

The next bounded review is not a new component catalog. It should test whether
the production projection, stripped of prototype apparatus, can make the
following clear in one scan:

1. What is the observatory doing and what evidence supports that claim?
2. What is the one current decision, automatic activity, or protected recovery?
3. Who can act, how current is the view, and what continues if the operator
   leaves the workspace?

Use Composite storage recovery, Acquire exhausted solves, Authority stale
control, and Process stage-local failure as the shared walkthrough. Record
comprehension before preference. Only then synthesize the official style and
design guide from selected evidence, resolved language, and explicit
exceptions.

## Decision Boundary

- **Accepted:** native working objects, consequential-state behavior,
  workspace ownership, snapshot-first reconnect, bounded recovery, and
  read-only phone.
- **Investigate:** shell specificity, priority contrast, compact comprehension,
  cross-workspace run projection, and accessible field-density treatment.
- **Resolve narrowly:** `reconstructed` reconnect language and legacy `Recipe`
  placeholder language.
- **Not yet authoritative:** the current style/design guide draft and any token
  values derived from the prototype.
