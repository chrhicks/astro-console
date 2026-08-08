# Retired Astro Console Component Grammar

Status: **historical and non-authoritative as of August 8, 2026**

This was `apps/web/src/components/PATTERNS.md` for the non-beta production UI.
It is preserved as implementation history and must not guide the official
Nightbook beta or `@nightbook/ui` work.

The pattern layer between `styles/tokens.css` (values) and the workspaces
(composition). A component here exists so a workspace **cannot** drift on the
invariant the component owns. Build a screen by composing these; hand-roll a
pattern in a workspace only after the promotion rule below is honestly met.

Authority order when anything here disagrees with a wireframe or a habit:
`docs/v2/current/product-spec.md` → `docs/v2/ux-design-guidance.md` →
`docs/v2/current/visual-style-guide.md` + `ui-component-library.md`. The
wireframe gallery (`kimi_workspace/site-inventory`, frames wf-6…39) is the
accepted _layout and state_ reference; the palette/type there is sketch
fidelity only — production visuals come from the token system.

## Invariants the type system or markup enforces

| Invariant (from the authority docs)                             | Where it lives                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Status is text + shape + tone, never color alone                | `Status` renders text with `data-tone`; no icon-only API                                                             |
| A region's title names its fact or decision                     | `Panel` requires `title`                                                                                             |
| Facts are 12px+, tabular, and reflow instead of truncating      | `FactRegister`                                                                                                       |
| Destructive actions name their scope                            | `ActionBarAction`: `tone: 'danger'` is a type error without `scope`                                                  |
| Disabled is insufficient — explain why                          | `ActionBarAction`: `disabled: true` is a type error without `disabledReason`, and the reason renders as visible text |
| One dominant action per decision                                | `ActionBar` renders at most one `primary` by convention; the guardrail test counts                                   |
| Availability is an 8-state lifecycle, not a binary              | `AvailabilityStrip`; `Record<AssetAvailability, …>` maps make a new contract state a compile error here              |
| Evidence is a real contained object, facts on it are plain text | `EvidenceFrame` (`facts` render as text, not pills)                                                                  |
| Mutation is `<button>`; navigation is `<a>`                     | every component; the phone read-only rule hides buttons                                                              |

## Components

### `panel` — `Panel`

Owned working region: surface background, titled header, optional `note` for
the bound or qualifier ("fixed facets — no query language").

- **Use for:** a region that groups one decision's evidence and controls.
- **Never:** one panel per datum; bordered-card grids. (`visual-style-guide`:
  "Do not make every datum a bordered card.")
- Wireframes: every frame's `panel()`.

### `status` — `Status`

The semantic status. `tone: 'safe' | 'attention' | 'danger' | 'neutral'`.

- Renders `role="status"` (announced); do not stack many in one live region.
- Tone vocabulary (style guide): green = verified/complete/retained, amber =
  waiting/pressure/approval, red = failed/blocked/destructive, and secondary
  blue-green belongs to current/selected/focus (not a status tone).

### `fact-register` — `FactRegister`

Aligned label/value rows. Values get `data-tone` optionally — reinforcement
only, since the value is always text.

### `action-bar` — `ActionBar`

The decision strip: `summary` (what is selected/current), `actions`, `note`
(the bound, in plain sight). Link actions take `href` (+ the app `link()`
helper's `onClick`); button actions take `onClick`.

- The danger `scope` is carried in the button's accessible name; repeat it in
  visible text nearby when the action is irreversible.

### `availability-strip` — `AvailabilityStrip`, `availabilityTone`, `availabilityLabel`

The asset lifecycle: progression `available locally → preparing → published →
expiring → expired`, branches `republishing · temporarily unavailable ·
publication failed`. Current state is marked with tone and text; the rest stay
visible so an odd state has somewhere to live.

### `evidence-frame` — `EvidenceFrame`

The contained evidence surface (frame radius, placeholder starfield until
retained preview bytes exist). `facts` overlay as text. `variant: 'andromeda'
| 'nebula'` is a placeholder-field distinction only.

## Promotion rule (from ui-component-library.md)

Promote a new component only with: one stable product role, typed source
fields, state variants (ordinary + awkward), keyboard/responsive behavior, and
at least two proven uses. **Workspace-native structures stay in the
workspace** (Plan's observing window, Observe's Night Trace, Process's
steps/canvas) — document them there as exceptions instead of forcing a shared
primitive.

## Candidates not yet promoted (wireframe evidence exists; implementation evidence does not)

| Candidate                                                          | Evidence    | Blocks on                       |
| ------------------------------------------------------------------ | ----------- | ------------------------------- |
| StepsRail (steps as location, not log)                             | wf-9, wf-37 | Process build pass              |
| DecisionGate (3 build gates)                                       | wf-37       | Process build pass              |
| RailTabs (Operation/Assistant/Inspector, badge never steals focus) | wf-9, wf-38 | Process pass                    |
| EvidenceTrail (proposed/acted/observed)                            | wf-7, wf-8  | Observe pass                    |
| MetricHUD (capture numerals)                                       | wf-8        | Observe pass                    |
| IntakeLane (bounded "3 of 4, then it stops")                       | wf-34       | needs service intake projection |
| StatusAnchor extraction from `Shell.tsx`                           | wf-14       | shell pass                      |

## Known service gaps surfaced by the Library rebuild (do not paper over)

- Library query supports only `role` + `sort`. wf-34's night / target /
  run-sequence / review-status facets need server-side facet counts.
- Batch review (multi-select Accept/Reject) has no API; review is per-asset.
- Star rating and review notes (wf-15) have no schema in `AssetReview`.
- Compare has no paired-detail endpoint; the strip compares summary facts and
  links out.
- Live intake lane (wf-34) needs an intake projection on the bootstrap state.

## Guardrails

`components.test.ts` proves the markup invariants (text-carried status, named
regions, scoped destructive actions, fully-labeled lifecycle, accessible
evidence). Run with `npm test`; all checks with `npm run check`. Component
styles self-import (`import './style.css'`); the test runner stubs CSS via
`scripts/test-register.mjs`.

## Review checklist for new/changed screens (use this to accept agent work)

1. Every status readable without color; every region titled; facts ≥12px.
2. Destructive action shows scope; disabled action shows reason.
3. Wide / compact / 390px: no page-level horizontal overflow, no mutation
   buttons on phone, essential status still visible.
4. Keyboard: focus visible, order sane; navigation is links, mutation is
   buttons.
5. No invented data — an absence is styled and named, never filled with a
   guess.
6. `npm run check` passes; screenshot evidence recorded for the three widths.
