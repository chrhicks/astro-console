# V2 Style And Design Guide

Status: **Phase 0.5 draft for owner review — not yet Phase 1 authority**

Updated: July 23, 2026

This guide turns the frozen V2 product, contract, and prototype references into
an implementation visual and interaction-design authority. It complements the
[product specification](../../current/product-spec.md) and
[UX and design guidance](../ui-authority-2026-08-08/ux-design-guidance.md); it does not replace either.

Phase 1 may use this draft for planning and critique, but the guide becomes
binding implementation authority only after explicit owner acceptance.

## 1. Authority And Use

Use these sources in order:

1. The product specification defines product truth, ownership, and workspace
   behavior.
2. The UX and design guidance defines durable interaction principles.
3. Gate 5 contracts define accepted command, freshness, failure, and projection
   semantics.
4. This guide defines the presentation system for those truths.
5. The accepted prototypes show representative compositions and states; a
   screenshot is evidence, not an API.

When sources appear to conflict, first determine whether the issue is product
semantics, presentation, or prototype-only chrome. Do not change product
semantics in order to make a component easier to implement.

## 2. Product-Specific Design Theses

These theses are deliberately falsifiable. A later surface fails the guide if
it contradicts them.

### 2.1 Service truth leaves a visible trace

Every consequential surface must connect a native observatory object to its
current service-confirmed state, the evidence for that state, the operator's
eligibility, and the consequence of acting or waiting.

This thesis fails when:

- a status could be replaced by `Running`, `Warning`, or `Failed` without
  losing important meaning;
- a control appears without the object, authority, or freshness that makes it
  valid;
- browser-local presentation is mistaken for accepted run, Process, control,
  or Library truth; or
- color is the only explanation of state.

### 2.2 The working sky or image outranks the container

The native working object receives the visual space required for judgment:
Plan's observing window, Observe's image-derived acquisition or capture
evidence, Library's chronology and lineage, and Process's image canvas and
linear edit history. Shells, rails, cards, and tabs organize those objects but
must not become the product's identity.

This thesis fails when:

- the same interchangeable card grid could serve every workspace;
- a generic dashboard summary displaces the timeline, evidence frame, asset
  lineage, or image canvas;
- all regions receive equal weight despite different operator decisions; or
- decoration attracts more attention than current evidence or consequence.

### 2.3 Calm means bounded consequence, not absence of urgency

V2 remains calm by showing what is protected, what stopped, what continues,
and the one useful decision now. A serious condition may interrupt the global
run surface, but unaffected work stays visually stable and retained evidence
remains available.

This thesis fails when:

- warnings create a wall of equally urgent color;
- failure replaces the evidence needed to recover;
- a retry hides its bound or reruns valid work without saying so;
- destructive scope is vague; or
- an unavailable action looks like an ordinary enabled control.

## 3. Operator And Environment

V2 serves one observatory shared with a few trusted people:

- the owner may plan, control, recover, review, and process;
- a controller temporarily holds exclusive observing authority;
- a viewer may inspect authorized evidence without gaining control; and
- the first phone client is read-only, including for the owner.

Assume dark adaptation, fatigue, intermittent attention, large high-resolution
desktop displays, occasional touchpad or touch use, and remote connections that
may become stale. Information density is appropriate when it reduces
uncertainty; tiny type and equal-weight density are not.

## 4. Presentation Invariants

### 4.1 Canonical ownership

| Truth | Canonical owner | Presentation requirement |
| --- | --- | --- |
| Accepted run and current phase | Service / `ActiveRun` | Remains visible across workspaces; changing workspace never implies changing execution |
| Observing authority | Service / `ControlLease` | Name the current controller and capability; presence alone never looks authoritative |
| Plan intent | `ObservingPlan` | Timeline and viability remain distinct from the accepted `RunDefinition` |
| Acquire state | `ActiveRun` acquisition state | Pair image-derived evidence with automatic, approval-required, or recovery behavior |
| Processing work | `ProcessingSession` | Distinguish synchronized Preview, applied history, and saved Library artifacts |
| Durable evidence | Library / `Asset` | Preserve identity, lineage, representation availability, and original-source authority |
| Browser state | Current page | Never imply that browser memory, navigation, or optimistic chrome is durable truth |

### 4.2 Freshness and authority

- Primary language is semantic: `Current`, `Changed elsewhere`, `Control
  restored`, or `Preview not yet synchronized`.
- Revision numbers and event cursors belong in diagnostics.
- Disconnected or stale surfaces show last-confirmed time and disable service
  mutation.
- Snapshot-first reconnect replaces the canonical projection. Do not animate a
  fictional replay of missed work.
- A rejected stale intent states that no physical or durable action occurred.

### 4.3 Status is multi-dimensional

Do not collapse these into one global online/offline color:

- Astro Console service availability;
- rig connectivity;
- public-tunnel availability;
- current run health;
- processing availability or pressure;
- storage pressure;
- asset publication or download preparation; and
- client freshness and control capability.

Show a dimension where it can change the operator's decision. Otherwise keep
it in context or diagnostics.

## 5. Workspace And Shell Composition

### 5.1 Stable shell

The shell owns:

- Plan, Observe, Library, and Process navigation;
- identity and membership;
- a compact active-run surface;
- current controller or capability where consequential; and
- service-level attention relevant outside one workspace.

The shell does not duplicate workspace commands. `Return to Observe` routes to
the owning action surface; it is not a second pause, stop, or recovery control.

The accepted prototype's research question, synthetic-scenario selector,
gate badge, and non-operational banner are prototype chrome. They are not
production shell patterns.

The shared shell is a **run/status anchor**, not a universal workspace layout.
It carries product identity, accepted target and phase/progress, controller or
current capability, evidence freshness where relevant, and service truth.
Compact workspace navigation may reveal labels deliberately; it must not depend
on hover alone for discovery or access.

The same material, type, status, focus, and navigation language binds the
product, but each workspace is an intentional room:

| Workspace | Dominant composition | Persistent supporting context |
| --- | --- | --- |
| Plan | Observing window, sequence order, viability, and readiness | Selected-sequence evidence and run eligibility |
| Observe | Latest image-derived evidence and current decision | Compact Night Trace, controller/freshness, solve or capture facts |
| Library | Chronology, grouping, preview, and lineage | Representation availability and durable source facts |
| Process | Dominant image canvas and linear Build/Develop history | Operation, Assistant, Inspector, checkpoint, and Preview/Apply facts |

Do not force any of these objects into a uniform dashboard grid merely because
they share a header.

### 5.2 Active-run surface

When a run exists, its persistent surface shows, in this order:

1. target and current phase;
2. progress or bounded activity;
3. health or attention state;
4. current controller when relevant; and
5. a route to the owning workspace.

An observatory-level interruption may add one concise consequence band, such as
`Capture held: storage is unavailable`, with one route to recovery. It does not
turn every workspace into Observe or duplicate the full recovery workflow.

In Observe, a compact Night Trace may supplement the active-run surface. It is
an event sequence, not generic activity decoration: event label/time and a
distinct shape state name verified/stable, non-blocking correction, blocked
intervention, or current activity. Teal, amber, and red may reinforce those
states but are never their only representation.

### 5.3 Workspace hierarchy

Each workspace follows three depths:

1. **Glance:** current object, phase, health, progress, and capability.
2. **Decision:** the automatic activity, available action, approval, or bounded
   recovery that matters now.
3. **Evidence:** the visual, temporal, lineage, quality, or diagnostic facts
   supporting that decision.

Depth is not a card style. It is an attention order.

### 5.4 Context rail

Use a context rail for persistent, mutually exclusive detail that must stay
near the working object:

- selected target or sequence evidence;
- Alerts;
- Process Operation, Assistant, and Inspector; or
- presence, control, and technical diagnostics.

Selecting a working object may update the context rail. Assistant findings may
add an accessible unread count but never steal focus or change the active tab.

## 6. Native Working Objects

Shared styling does not make two concepts the same component. Start with these
objects and preserve their distinct structures.

| Object | Necessary structure | Must not collapse into |
| --- | --- | --- |
| Observing plan | Ordered sequences over a time/sky window, viability, readiness, selected-sequence context | Catalog cards with capture buttons |
| Active run | Stable accepted definition, current phase, progress, consequence-aware history | Browser job or workspace-local task |
| Acquisition attempt | Latest frame, solved/desired geometry, uncertainty, attempt bound, correction or recovery | Stepper wizard or success toast |
| Capture evidence | Current exposure/stack, accepted and rejected frames, image/quality trend, stop condition | Device telemetry dashboard |
| Library asset | Preview, stable identity, chronology, lineage, review state, representations and availability | Filesystem row or storage key |
| Processing session | Build/Develop steps, dominant canvas, Preview, applied linear history, checkpoints, provenance | Job graph, recipe runner, or generic form |
| Control lease | Controller, request/grant/takeover state, freshness, capability | Presence badge or permanent role |
| Attention item | Condition, consequence, protection, owner, evidence, remedy | Count-only alert or color chip |

### 6.1 Plan

- Let the observing window and sequence order carry the composition.
- Keep readiness attached to the complete plan, not scattered as unrelated
  badges.
- Use selection to connect a timeline item to its sequence evidence.
- Show `Run plan` only with current eligibility; the accepted run is visually
  distinguishable from the editable plan.

### 6.2 Observe and Acquire

- Give the latest image-derived evidence the dominant region.
- Place assessment and current activity or decision beside the evidence.
- Automatic eligible behavior is labeled as activity, not styled as a button.
- When attempts are exhausted, retain the failed frame and attempt history,
  name the bound, state that movement did not occur when pointing is unknown,
  and offer the bounded recovery.
- Keep a visible abort or safe-stop path without styling it as the default
  action.

### 6.3 Library

- Prefer chronology, target/run grouping, and lineage over an undifferentiated
  thumbnail grid.
- A virtualized viewport and bounded server query are implementation
  requirements, not visible pagination theater.
- Availability is a state of a representation, not the identity of the asset.
- Related saved results remain peers; do not visually crown one `final`.

### 6.4 Process

Use the accepted composition:

```text
Steps | dominant image canvas | Operation / Assistant / Inspector
```

- The canvas remains visible during Preview, Apply, failure, and recovery.
- Build and Develop are visible phases of one session, not routes.
- A selected step activates Operation.
- Preview changes are visibly temporary; Apply creates one undoable operation.
- Failure retains the current image and valid checkpoint, names the failed
  stage, and offers stage-local retry.
- General saved-result comparison remains in Library.

## 7. Consequential Actions

| State | Presentation | Control rule |
| --- | --- | --- |
| Automatic and eligible | Current activity with evidence, bound, and `No operator action required` where useful | Do not render a fake disabled action |
| Available | One direct verb and concise consequence | Enabled only with current capability and freshness |
| Unavailable | Blocking invariant and valid alternative | Omit or disable with an adjacent explanation; never offer a force-through |
| Approval required | Concrete physical, evidence, schedule, time, or storage consequence | Modal or bounded approval surface; default focus is non-destructive |
| Stale | Current service result plus what was rejected or superseded | No replay; state that no action occurred |
| Destructive | Exact scope and what survives | Use the domain verb; do not rely on `Are you sure?` |
| Recovery | Protected state, retained evidence, retry scope and remaining bound | Emphasize the recommended bounded path; keep stop/skip alternatives proportional |
| Save | Selected outputs, destination, lineage, and partial-failure policy | Save creates Library assets; it does not end or rename the Process session implicitly |
| Discard | Unsaved derived state removed; sources and saved assets preserved | Durable disposition before switching; no vague `Delete` |
| Handoff | Source object, destination workspace, and resulting state | Navigation does not imply cancellation or ownership transfer |

Consequential primary and destructive actions must not sit as visually equal
neighbors without explanatory grouping.

## 8. Visual Hierarchy

### 8.1 Surfaces

Use surface depth sparingly:

1. canvas/background;
2. workspace or persistent rail;
3. bounded panel;
4. modal or temporary overlay.

A border may express grouping without introducing a raised card. Avoid nested
rounded rectangles when adjacency, a divider, or whitespace already explains
the relationship.

Reserve strong elevation and backdrop treatment for bounded interruption:
Save, Discard, Switch data, approval, or detailed diagnostics.

Material differences must express a relationship: a quiet workspace field can
recede behind a bounded evidence frame; an inspection edge can separate
optional detail from active judgment; a canvas can own its own atmospheric
light. Do not apply gradients, rounded cards, or shadows as a default skin.
In particular, Process keeps its outer workspace quiet—the image canvas, not
the whole page, may carry luminosity or processing-specific atmosphere.

### 8.2 Priority cues

Priority is established through:

1. area and placement;
2. native-object structure;
3. heading and text contrast;
4. border or inset emphasis;
5. semantic color; and only then
6. motion.

Do not use color or glow to compensate for weak structure.

### 8.3 Shape

- `6px`: dense internal facts, compact fields, and small grouped items.
- `8px`: controls and ordinary bounded panels.
- `12px`: major workspace frames and modals.
- Full pills: true compact statuses, capabilities, counts, or modes only.
- Circles: status marks, celestial/target geometry, or compact icon controls;
  not generic decoration.

Use the lower end of this scale when a region is structural or adjacent. A
slight radius earns its place by identifying a contained evidence/image object,
temporary overlay, or clearly layered inspection surface; it is not a blanket
treatment for all panels.

## 9. Foundation Tokens

These tokens are the Phase 1 starting baseline derived from the accepted
references. Their semantic roles are authoritative; exact values may change
during implementation only when contrast, platform rendering, or field testing
provides evidence.

### 9.1 Color

| Token | Initial value | Role |
| --- | --- | --- |
| `canvas` | `#080c10` | Application background |
| `surface` | `#0e141a` | Workspace panel |
| `surface-soft` | `#111920` | Grouped facts or recessed control region |
| `surface-raised` | `#151d25` | Select, hover, or bounded raised region |
| `line` | `#26333e` | Ordinary boundary |
| `line-strong` | `#3a4a57` | Control or major-frame boundary |
| `text` | `#e9f0f4` | Primary text |
| `text-muted` | `#91a0aa` | Secondary operational text |
| `text-faint` | `#667680` | Nonessential large text or decoration only |
| `accent` | `#67d5df` | Selection, current evidence, focus, and primary action |
| `accent-strong` | `#a2f3f4` | High-contrast accent text |
| `attention` | `#f3bb62` | Warning, waiting, pressure, or approval attention |
| `danger` | `#ff7c79` | Failed, blocked, destructive, or unsafe condition |
| `success` | `#7dd3a7` | Verified, complete, healthy, or safely retained |
| `readonly` | `#8fb6ff` | Read-only capability and informational projection |
| `lineage` | `#bea4ff` | Optional visual distinction for derivation/related assets |

The initial primary, muted, accent, attention, danger, and success colors have
strong contrast on `canvas`. `text-faint` does not meet WCAG AA for normal
small text on `canvas`; never use it for necessary operational information.

Semantic color always has a text, icon, shape, or structural equivalent:

- current/selected: cyan plus selection boundary or label;
- warning/waiting: amber plus named condition;
- failed/blocked/destructive: red plus named consequence;
- verified/healthy/complete: green plus named result; and
- read-only: blue plus explicit capability text.

### 9.2 Type

Use the system sans stack for interface text and a system monospace stack only
for values where alignment or literal identity matters.

| Role | Baseline |
| --- | --- |
| Workspace title | `28–34px`, `1.1–1.2` line height, compact negative tracking |
| Major decision or object | `21–25px`, `1.15–1.25` |
| Section heading | `16–18px`, semibold |
| Body | `14px`, `1.45–1.6` |
| Supporting operational text | `12–13px`, at least `1.4` |
| Eyebrow / category | `11px`, uppercase, `0.12–0.14em` tracking |
| Tabular fact | `12–14px` monospace with tabular numerals |

Do not use routine `9–11px` text for state, controls, provenance needed for a
decision, or field operation. Small uppercase labels may categorize an
adjacent readable value but never carry the value alone.

Large prototype research questions are not application typography.

### 9.3 Spacing and sizing

Use a `4px` base rhythm:

- `4`: tight label/value or icon/text relationship;
- `8`: control internals and dense facts;
- `12`: related rows and compact panels;
- `16`: ordinary panel inset;
- `24`: major region separation;
- `32`: workspace heading or composition break;
- `48`: page-level separation outside the operational frame.

Desktop controls are at least `40px` high. Touch-capable controls target
`44px`. A smaller visual icon may sit inside that hit target.

## 10. Controls And Patterns

### 10.1 Buttons

- Primary: the one useful available action in the current decision.
- Secondary: another safe available action or inspection.
- Quiet: navigation, reveal, reset, or contextual utility.
- Destructive: exact destructive domain verb with red treatment.
- Disabled: only when keeping location materially aids comprehension; pair with
  the reason. Otherwise omit it.

Buttons use direct verbs: `Run plan`, `Retry with longer exposure`, `Retry
Stretch`, `Save to Library`, `Switch data`, or `Discard unsaved work`.

### 10.2 Progress and activity

Progress must name its unit or bound: frame count, exposure time, solve attempt,
sequence percentage, or processing stage. Indeterminate activity names what is
happening and what remains protected.

Never infer successful physical outcome from command acceptance. Use verified
language only after image or service evidence confirms it.

### 10.3 Facts and metrics

Use compact aligned facts when values are meaningfully comparable or repeatedly
scanned. Do not convert prose or isolated metadata into a tile grid merely for
symmetry.

Labels use ordinary language. Monospace is appropriate for times, angles,
dimensions, counts, versions, checksums, and literal tool output—not all
secondary text.

### 10.4 Attention

An attention item contains:

- condition and severity;
- affected object;
- operational consequence;
- current protection or continuity;
- recommended or available remedy; and
- evidence source or time.

The global Alerts surface is priority-sorted and retains history. The owning
workspace expands the actionable evidence.

### 10.5 Modals

Use a modal only for a bounded interruption with a clear completion or cancel
point:

- consequence-aware approval;
- Save to Library;
- Discard;
- Switch data;
- detailed tool output; or
- advanced tool configuration.

Keep preview controls, sliders, tool selection, assistant proposals, Apply,
routine Retry, and ordinary evidence beside the working object.

Return focus to the invoking control. Trap focus while open, support `Escape`
when cancellation is safe, and label the dialog from its visible title.

## 11. Responsive Model

The accepted validation widths are `1600×1000`, `1000×900`, and `390×844`.
Initial composition bands are:

- **wide desktop, above 1120px:** full workspace rail, dominant working object,
  and persistent context rail;
- **compact desktop, 781–1120px:** compact icon rail, preserved working object,
  and context moved below only when side-by-side width would weaken judgment;
  and
- **phone, 780px and below:** an intentionally read-only projection designed
  around current truth and attention.

These are composition thresholds, not device labels. Adjust a threshold when
content evidence shows loss of intent, not to match a fashionable device list.

### 11.1 Compact desktop

- Keep the native working object first.
- Collapse labels before removing evidence.
- A context rail may move below the canvas or main evidence surface.
- Controls remain available and keyboard reachable.
- Do not reduce operational text below the type baseline to preserve columns.

### 11.2 Phone

Phone consumes the same service truth but performs a different task:
monitoring.

Show:

- service/observatory state;
- active target, phase, and progress;
- latest useful preview or evidence summary;
- health and current attention;
- current controller; and
- last-confirmed freshness when relevant.

Do not show observing, plan, control, or Process mutation controls, even
disabled. State capability explicitly: `Read-only phone`, `Monitoring only`,
or `Continue on desktop`.

The phone projection may summarize image geometry or processing work instead of
installing the full desktop visualization. Never squeeze the desktop timeline,
context rail, or editing controls into one narrow column.

## 12. Accessibility And Motion

- Every control has an accessible name, visible focus, and logical order.
- Focus uses a `2px` accent outline with at least `3px` separation where space
  permits; inset focus is acceptable inside clipped canvases.
- Workspace and context navigation use the proper current or selected state.
- Pointer and touch gestures have keyboard equivalents. Process comparison
  supports press-and-hold plus `Space` and `Enter`.
- Live activity updates use restrained status announcements. Do not repeatedly
  announce exposure timers or decorative progress.
- Attention and failure never rely on color alone.
- Tables, timelines, image overlays, and charts require a readable textual
  summary of the decision-relevant facts.
- Respect `prefers-reduced-motion`. Remove nonessential transitions and never
  make motion necessary to understand state.
- Motion is normally `120–180ms` and explains focus, selection, disclosure, or
  continuity. No ambient pulsing except a narrowly justified live status that
  remains understandable when still.

## 13. Representative State Coverage

Every new reusable pattern is reviewed in the states that apply:

- healthy/current;
- active/automatic;
- delayed or waiting;
- warning or measured pressure;
- blocked or failed;
- bounded recovery;
- approval required;
- stale or changed elsewhere;
- disconnected and reconnected;
- unauthorized or read-only;
- destructive confirmation and completion;
- dense content;
- empty or not-yet-available;
- compact desktop; and
- read-only phone.

The initial cross-slice Phase 0.5 review specifically includes:

- Composite healthy capture and storage recovery;
- Acquire automatic correction and exhausted solve recovery;
- Run Authority baseline and superseded-controller rejection; and
- Process editing and stage-local Stretch failure.

These states demonstrate the system; they do not exhaust later feature-specific
coverage.

## 14. Anti-Drift Review

Before accepting a V2 surface, ask:

1. What is the native working object?
2. What operator decision or judgment receives the largest useful surface?
3. Which service-owned truth, authority, and freshness make the surface valid?
4. Where is the evidence for the current claim?
5. What continues, stops, or remains protected in an awkward state?
6. Does the surface preserve workspace ownership and handoffs?
7. Could unrelated product nouns replace the V2 nouns without changing the
   structure? If yes, the design is too generic.
8. Are shared components representing one shared concept, or merely reusing
   styling?
9. Does phone preserve intent as read-only monitoring rather than expose a
   miniature desktop?
10. Are type, focus, keyboard, contrast, and reduced-motion rules satisfied?

Generic drift is not diagnosed by the presence of dark mode, Inter, rounded
corners, cyan, cards, or any other token alone. It is the accumulated result of
weak product evidence, interchangeable structure, uniform hierarchy, generic
copy, and ideal-state-only design.

## 15. Intentional Exceptions And Rejected Defaults

- Process uses a dominant central canvas because visual adjustment requires
  continuous comparison. Other workspaces do not inherit that composition
  automatically.
- Plan may use target colors to distinguish simultaneous sky windows. Those
  colors do not become status semantics.
- Celestial overlays may use specialized geometry and labels. They still
  provide adjacent numeric magnitude and textual direction.
- Tool diagnostics may use denser monospace text inside a bounded owner-safe
  modal. Primary recovery language remains plain.
- Full-DOM Library rendering, generic dashboard grids, count-only warnings,
  visible event/job graphs, browser-owned reconstruction, reusable processing
  recipes, promoted-final artifacts, automatic assistant application, and
  phone mutation controls are rejected defaults.

## 16. Maintenance And Extension

A new pattern proposal must state:

- operator job;
- native object and canonical owner;
- evidence and freshness;
- eligibility and consequence;
- ordinary and awkward states;
- responsive behavior;
- keyboard and accessibility behavior; and
- why an existing pattern cannot express it.

Classify feedback before changing the guide:

- **product/model or workflow conflict:** return to current product authority
  and record the invariant conflict;
- **missing presentation rule:** amend this guide with a representative state;
- **implementation constraint:** preserve the semantic role and document the
  bounded adaptation; or
- **copy/polish preference:** improve locally without reopening accepted
  interaction semantics.

Revisit an accepted interaction only for recorded evidence of a
product-invariant conflict. A framework preference, component-library
limitation, visual trend, or desire for uniformity is not sufficient.

## 17. Accepted References

- [V2 product specification](../../current/product-spec.md)
- [V2 UX and design guidance](../ui-authority-2026-08-08/ux-design-guidance.md)
- [Gate 7 walkthrough and decision log](../phase-1-foundation/gate-07-walkthrough.md)
- [Accepted prototype hub](../../../../prototype/v2-ui/index.html)
- [Phase 0.5 brief](phase-0.5-design-system-brief.md)
- [Phase 0.5 reference audit](phase-0.5-reference-audit.md)
- [Phase 0.5 shell study](phase-0.5-shell-study.md)
- [Workspace-language study](../../../../prototype/v2-ui/archive/phase-0.5/phase-0.5-workspace-language-study.html)

Accepted prototype observations used in this draft:

- wide desktop preserves a stable shell, persistent run context, dominant
  workspace object, and contextual evidence;
- compact desktop shortens the workspace rail before sacrificing working
  evidence;
- phone replaces desktop controls with explicit read-only monitoring;
- storage recovery interrupts the active-run surface without erasing Plan;
- exhausted Acquire retains failed evidence beside one bounded recovery;
- stale control rejection explains that no hardware action occurred; and
- Process failure keeps the image and valid checkpoint visible while retry is
  stage-local.

The selected Phase 0.5 direction adds a common observatory run/status anchor,
intentional workspace rooms, evidence-bearing material contrast, compact
semantic Night Trace events in Observe, and a quiet Process field around the
dominant canvas. The workspace-language study is selection evidence; it does
not replace accepted interaction behavior.

## 18. Phase 0.5 Acceptance

This guide is ready to freeze only when:

- the owner accepts its theses and implementation rules;
- the accepted prototypes and this guide read as one product;
- reusable patterns have product roles, state variants, responsive treatment,
  and accessibility behavior;
- representative ordinary and awkward states have been reviewed together;
- rejected defaults and intentional exceptions are explicit; and
- remaining questions cannot materially change the first Local Web Foundation
  slice.

Until then, keep this status as a Phase 0.5 draft and do not present it as
accepted authority.
