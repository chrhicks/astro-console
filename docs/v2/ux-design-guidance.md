# V2 UX And Design Guidance

Status: **accepted baseline through Gate 4**

Updated: July 21, 2026

This is the semantic UX authority for V2 product work. The longer
[current product specification](current/product-spec.md) supplies domain detail;
accepted gate records supply scenario evidence. New work should follow these
rules unless a later gate records why a rule must change. Concrete visual
composition is implemented in `apps/web` source and CSS, with accepted
screenshots as evidence. `docs/v2-ui-final` and `prototype/v2-ui` remain
historical Gate and design evidence, not runtime implementation authority.

## Product Philosophy

1. **Help the operator decide.** Lead with current truth, the useful decision,
   and the evidence behind it. Do not make internal jobs, events, or transport
   mechanics the primary experience.
2. **Represent authority honestly.** The service owns accepted runs, control,
   durable processing sessions, revisions, and recovery. A browser is a view
   and intent source, not the place where observatory truth lives.
3. **Give visual judgment visual space.** Dense information is welcome, but
   equal visual weight is not. The evidence needed for the current decision
   receives the dominant surface.
4. **Prefer reversible progress.** Preview before Apply, preserve sources,
   retry only invalid work, and make destructive scope explicit.
5. **Keep automation advisory.** Automation and assistants may inspect,
   explain, and propose. They do not silently change hardware, plans, or an
   image.
6. **Use semantic state.** Say what happened, what is affected, and what the
   operator can do. Color, animation, and implementation labels are secondary.
7. **Disclose detail progressively.** Keep routine decisions visible. Put
   occasional bounded choices and raw diagnostics behind deliberate actions.

## Workspace Boundaries

| Workspace   | Owns the operator's task                                                                         | Does not own                                                                | Primary handoff                                                        |
| ----------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Plan**    | Future observing intent, sequence design, readiness, and validation                              | Accepted run execution                                                      | `Run plan` creates a stable `RunDefinition` for Observe                |
| **Observe** | Current run evidence, intervention, acquisition, capture, verification, and recovery             | Browser-local execution or historical asset management                      | Captured evidence becomes Library assets                               |
| **Library** | Durable sources, saved results, review, related-artifact comparison, and downloads               | Unsaved processing scratch                                                  | `Open in Process` supplies raws, a linear stack, or a saved result     |
| **Process** | One current Build/Develop editing session, preview, undo/redo, tool choice, and selected outputs | General history browsing, arbitrary saved-result comparison, or rig control | `Save to Library` creates durable artifacts; Discard preserves sources |

The global shell owns workspace navigation, identity, compact active-run
context, and service-level attention. It must not duplicate domain commands or
suggest that changing workspaces changes an accepted run or server job.

### Cross-workspace handoffs

- Plan to Observe transfers an accepted, revisioned `RunDefinition`—not a live
  pointer to an editable draft.
- Observe to Library records immutable evidence and acquisition lineage.
- Library to Process passes stable asset IDs. Raws begin in Build; an existing
  linear stack may begin in Develop.
- Process to Library saves any selected related outputs. No output must be
  crowned the single final image.
- Process may open Library comparison as a convenience, but Library remains
  the canonical home for comparing several saved versions.
- Leaving a workspace never cancels service-owned activity. Unsaved work is
  protected when switching Process data.
- A Process session is a durable resumable working resource, not a Library
  asset. Switching data may leave it unfinished, save selected outputs to
  Library, discard it, or cancel the switch.

## Composition And Hierarchy

Operational views normally place evidence first and assessment, activity, or
decisions next. An inherently visual task may instead use a dominant central
canvas. Process establishes that exception:

```text
Steps | Image canvas | Operation / Assistant / Inspector
```

- The left rail shows task structure and location, not an event log.
- The central surface is sized according to the judgment being made. In
  Process, the image remains visible during preview, progress, and failure.
- The right context rail groups mutually exclusive contextual views. Selecting
  a processing step activates Operation; an Assistant badge may announce a
  finding but must never steal focus.
- Present three depths where useful: glanceable state, actionable decision,
  then inspectable evidence.
- Avoid turning every datum into a same-weight card. Group by decision and
  relationship, not by the convenience of a component primitive.

## Persistent Surface Or Modal

Keep controls persistent when the operator needs to adjust them while watching
the result: sliders, tool choice, preview, Apply, assistant proposals, and retry
decisions belong in the context rail.

Use a modal for a bounded interruption with a clear completion or cancellation
point: Save to Library, Discard, Switch data, detailed tool output, or advanced
tool configuration. A modal must preserve the underlying session and return
focus to the invoking control.

## State, Recovery, And Safety

- Reconnect begins with a fresh authoritative snapshot before incremental
  events. The refreshed page simply shows the current server state.
- The web app holds no durable domain state. Refresh discards browser memory
  and installs the server snapshot without merging an older local copy.
- Browsers never buffer commands for later replay. Stale run, lease, or
  processing revisions fail before physical or durable action.
- Process controls synchronize complete preview settings to the service after
  a suitable debounce. Only a change still inside that debounce window may be
  lost on refresh. Synchronized Preview, applied history, and saved Library
  artifacts remain distinct states.
- Distinguish service availability, rig connectivity, public tunnel status,
  processing availability, publication state, and storage pressure.
- Retry the failed stage from its latest valid checkpoint. State the retry
  scope before it runs.
- Undo and redo operate on one current edit history. They are not branches or
  user-visible version control.
- Discard names exactly what is removed. Original sources and previously saved
  Library artifacts survive.
- Resource throttling must name measured pressure. Active capture alone is not
  a reason to pause processing.

## Assistance And Tool Choice

- Show only installed tools compatible with the selected operation. Record the
  exact tool, version, inputs, and parameters as provenance.
- Assistant suggestions remain optional and explain their evidence. A numbered
  text-accessible badge may indicate unread findings.
- Viewing a finding clears its unread state but does not dismiss it. A newer
  image may invalidate it.
- `Preview suggestion` loads proposed values into Operation and shows the
  before/after values. The user must still choose Apply.
- Tool failures get a concise primary explanation plus owner-safe detailed
  output: stage, attempt, version, sanitized invocation, times, exit status,
  stdout/stderr, worker state, checkpoints, surviving outputs, and retry scope.
  Redact credentials and sensitive paths before copying or downloading.

## Language Rules

- Prefer direct domain actions: `Run plan`, `Retry Stretch`, `Save to Library`,
  `Switch data`, and `Discard unsaved work`.
- Avoid implementation vocabulary in primary UI: `reconstructed`, `event log`,
  `job graph`, `branch`, raw storage paths, R2 keys, and revision numbers.
- Do not introduce a `recipe` entity unless reuse becomes a demonstrated user
  need. Reproducibility comes from recorded sources, operations, settings, and
  tool facts.
- Avoid `promote final`. Users may save several related artifacts without
  declaring one canonical winner.
- A warning says what is wrong, its impact, the current protection, and the
  available action. Never rely on color alone.

## Responsive And Accessible Behavior

- Wide desktop is the full control surface. Compact desktop may reflow context
  below the primary task, but must retain necessary controls and evidence.
- The initial phone surface is deliberately read-only, including for the owner.
  It prioritizes current run state, health, progress, and attention.
- No supported width may introduce page-level horizontal overflow.
- Every control needs an accessible name, visible focus, sensible order, and a
  keyboard path. Pointer or touch gestures require an equivalent control;
  Process comparison supports pointer, touch, Space, and Enter.
- Touch targets and critical status remain legible in field conditions.

## Prototype Quality Bar

Before drawing a gate prototype:

1. Define healthy, warning, failure, recovery, reconnect, and terminal
   scenarios.
2. Identify canonical ownership and which visible state is only presentation.
3. Name consequential actions, eligibility rules, results, and typed failures.

Before asking for acceptance:

- exercise every scenario and consequential control;
- make simulated feedback explicit rather than leaving decorative controls;
- verify wide desktop, compact desktop, and read-only phone behavior;
- check keyboard access, focus, labels, semantic status, and color independence;
- check page overflow and browser console errors;
- reconcile UI claims with the candidate service contract; and
- record accepted, rejected, deferred, and infrastructure-impacting decisions.

Only owner acceptance closes a gate. Once accepted, do not reopen its model for
copy polish or speculative implementation convenience. Revisit it only when
new evidence exposes a real conflict with a product invariant.

## Boundary Test For New Features

Ask these questions before placing a feature:

1. What decision is the operator making, and what evidence materially helps?
2. Which workspace owns the durable object involved?
3. Would leaving the page stop the activity? If yes, is it incorrectly
   browser-owned?
4. Is this information needed continuously, or is it a bounded modal task?
5. Does a large visual surface improve judgment enough to displace other
   context?
6. Is the proposed language a user concept or an implementation concept?
