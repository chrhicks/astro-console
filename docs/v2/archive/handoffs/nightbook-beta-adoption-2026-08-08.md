# Nightbook Beta Adoption Closeout

Date: **2026-08-08**

Status: **completed local UI-adoption proof; production workspaces unchanged**

## Purpose and Strategy

This effort tested whether the visual language and compositional component
model developed in the Nightbook prototype can serve Astro Console without
weakening Astro Console's service-owned truth, command, or safety boundaries.
It was not a reskin of the existing pages and it was not a migration of
production routes.

The adoption strategy deliberately used a parallel, opt-in beta route. Plan,
Observe, Library, and Process were rebuilt as new workspace compositions while
the existing applications remained the default. The beta implementations
consume Astro Console projections and command seams; they do not introduce a
second domain model or copy service logic into the component package. This made
it possible to compare the new shell and workspace grammar directly, exercise
real local state, and remove the beta implementation without entangling the
production presentation.

The result supports the original premise: `@nightbook/ui` can provide the
presentation grammar for Astro Console. The remaining gaps discovered by the
exercise are primarily in product projection and command eligibility, not in
the generic UI package.

## Local Package Artifact

The web application consumes a repository-retained tarball rather than a
source alias or a registry release:

- package: `@nightbook/ui`
- accepted trial version: `0.1.1`
- SHA-256:
  `59482f0a8ffbb25d3458ddfec5f569020ffc05e8531d15add46fda9f0391d262`
- dependency form: an exact `file:` reference to the content-addressed tarball
- runtime shape: one deduplicated React and React DOM graph at `19.1.0`

The earlier `0.1.0` tarball is retained as adoption history. The installed
package is a normal dependency directory, not a symlink back to the prototype
workspace. This proves the package boundary as another project would consume
it and prevents accidental reliance on unpublished source files.

Version `0.1.1` incorporates the two package defects exposed during adoption:
Dialog now owns complete root-and-body scroll locking and restoration, and
AttentionCard no longer forwards its consumer action payload as an invalid DOM
attribute. No Astro Console-specific label, command, or projection was added to
the package to solve either issue.

## Completed Beta Workspaces

### Plan

The Plan beta composes the Nightbook shell, status grammar, panels, fields,
sequence navigation, schedule view, review state, attention surfaces, action
bar, and confirmation dialog around the existing Plan projection and command
client.

It distinguishes local draft edits from the saved revision, the accepted run
definition from future work, and preview from apply. Save, accept, preview, and
apply remain service commands with current-revision and approval-token
semantics. The interface presents the service's eligibility reasons and never
treats a local edit as accepted execution truth.

The accepted visual golden master is the Nightbook Plan composition: compact
command bar, intentional type hierarchy, restrained state color, centered
workspace content, paired action layouts, and the operational status strip at
the bottom rather than a second status band at the top.

### Observe

The Observe beta maps authoritative lifecycle evidence into the staged
Preflight, Acquire, Capture, and Verify experience. It uses the Nightbook
command bar, progress treatment, evidence viewport, context and decision
panels, health facts, command bar, control flyout, and bottom operational
status strip.

Only command seams already proven by the application are enabled. Provider
refresh is described as read-only; target acquisition, recovery, pointing
approval, and related actions remain guarded by service authority and the
current projection. Missing or unavailable lifecycle evidence fails closed
and is presented as unavailable rather than inferred.

The top-right operational facts remain compact status indicators with flyout
detail. Verbose service strings are not promoted into the permanent shell.
State color, typography, spacing, and the square status-control geometry follow
the Nightbook golden master rather than an interpreted adaptation.

### Library

The Library beta composes the shared shell, asset navigation, inspection
viewport, lineage facts, availability/download evidence, review decision, tabs,
and bottom status strip around the existing Library page and asset-detail
projections.

Selection is route-backed. Entering the beta Library can select the first
available asset without manufacturing a separate client-side catalog, and
subsequent asset navigation retains the beta route. Preview failure is an
explicit inspection state and does not imply loss of the durable asset.
Original download remains a service-owned route.

Accepted and rejected reviews use the existing review endpoint with expected
asset revision, expected review revision, and an idempotency key. The local
detail projection is updated only after an accepted response. Read-only clients
receive no review callback and therefore no mutation control.

### Process

The Process beta uses the shared shell and component grammar for source entry,
session facts, bounded operation controls, preview evidence, exact apply,
history, recovery, save, and the bottom status strip. It consumes the Library
source handoff and the Process workspace projection; it does not simulate a
separate processing service in the UI.

The local proof covered session start, preview, exact apply, undo, redo, a
deterministic failure, exact-checkpoint retry, final TIFF save, and restart
persistence. Preview and apply remain separate commands. Retry carries the
failed attempt and checkpoint identity. A saved output appears in the Library
catalog, preserving the intended Process-to-Library boundary.

The beta contains an explicit unfinished-session resume presentation. The
fixture journey did not naturally produce that exact branch, so its visual and
unit behavior is covered but it is not claimed as a complete live journey
proof.

## Shared Shell and Responsive Behavior

All four slices share the same Nightbook-influenced command bar, navigation,
control presentation, status grammar, and bottom status strip. The UI package
supplies generic primitives and structured components; Astro Console owns
workspace wording, projection mapping, routes, eligibility, and commands.

Wide desktop, compact desktop, tablet, and 390 px read-only phone layouts were
reviewed. Compact layouts retain containment and purposeful action grouping.
Phone presentations are deliberately evidence-first and mutation-free; they
do not merely shrink the desktop control surface. Text wrapping is constrained
to explanatory content, while operational labels, controls, and facts preserve
their composition.

Read-only behavior is capability-based. Mutation callbacks are omitted when
the current client is read-only, controls are not enabled from appearance
alone, and control status is derived from the current projection. Process uses
the stricter rule that commands require a current local owner and a
control-capable projection; unknown authority fails closed.

## Command and Proof Semantics

The beta is a presentation client over existing service contracts:

- Plan commands keep revision, preview, approval, and acceptance boundaries.
- Observe commands keep lifecycle, authority, and provider-evidence boundaries.
- Library review keeps optimistic concurrency and idempotency boundaries.
- Process commands keep session, exact-preview, checkpoint, and revision
  boundaries.
- Command success is not treated as durable truth until the application
  reconciles with a later projection.

Post-command reconciliation is generation-guarded so a slower response cannot
replace a newer projection. This matters especially for Process, where command
responses and the workspace projection can arrive independently.

The proof is local application proof: component rendering, projection mapping,
browser interaction, local HTTP commands, local persistence, restart recovery,
and local artifact appearance. It does not add or prove production deployment,
Arch host behavior, provider acknowledgement, hardware movement, or physical
image quality.

## Verification

The completed adoption was checked with web lint, type checking, production
build, distribution checks, and the complete scoped web test suite. The staged
beta-adoption snapshot reported 33 passing tests with no failures.

Browser review covered all four beta routes and the accepted responsive
breakpoints. It included console-error and accessibility inspection, read-only
phone behavior, route-backed Library selection, command/state journeys for
Process, and modal mechanics.

The Plan confirmation dialog received focused proof: opening locks both the
document root and body, focus enters the dialog, forward and reverse tabbing
remain contained, Escape closes, overflow is restored, and focus returns to the
trigger. A route sweep found no forwarded AttentionCard action attribute and no
new browser warnings or errors.

## Integration Defects Found and Resolved

The adoption exercise exposed issues at useful ownership boundaries:

1. The package Dialog originally left one scroll container unlocked. The fix
   was promoted to `@nightbook/ui`, where the component now owns lock and
   restoration for both document containers.
2. AttentionCard forwarded a non-DOM `action` value onto its element. The
   package now consumes the prop as component data rather than leaking it.
3. Process authority presentation could contradict the current shell state.
   The consumer mapping now requires current owner and control-capable evidence
   and fails closed when that evidence is unavailable.
4. Process command reconciliation could allow a stale response to replace a
   newer workspace fetch. Generation guards now preserve the latest projection.
5. Browser-native runtime styling was validated under the existing content
   security policy. React property updates work without weakening the policy;
   no inline-style exception was added.
6. Responsive action groups and component containment were corrected at the
   composition and package levels where appropriate, preserving side-by-side
   intent until the layout truly needs to collapse.

These were integration findings rather than reasons to encode Astro Console
workflow knowledge in the generic package.

## Product Impact and Production Isolation

The beta demonstrates a viable replacement presentation for all four primary
workspaces, not merely isolated component examples. It also establishes a
practical adoption pattern for other Astro Console projects: consume a packed
package, keep domain data and commands in the application, build a parallel
route, validate real projections, and promote only genuinely generic defects
or components back to the package.

The existing production routes remain the default and their components were
not replaced by this closeout. The beta is entered only through its explicit
query marker. No service, schema, shared contract, deployment, Arch host,
hardware, provider, or physical-capture behavior was changed as part of the
adoption proof.

## Remaining Projection and Backend Gaps

The exercise identified three important product gaps that should not be hidden
inside UI components:

1. Process does not expose authoritative per-action eligibility in its
   projection. The beta can safely require current local ownership,
   control-capable state, and current revision, but it still relies on service
   rejection followed by refresh for more specific eligibility.
2. A Process-created final TIFF appears in the Library catalog, but the exact
   asset-detail projection is not yet available for that output. The catalog
   and detail views therefore cannot complete the full saved-output journey.
3. The unfinished-session resume branch needs a deterministic integration
   fixture or service-supported setup so its complete restart-to-resume journey
   can be proven rather than only rendered and unit-tested.

Recommended backend alignment, in order:

1. Add service-owned Process action eligibility and machine-readable denial
   reasons to the Process workspace projection. Reuse the same revision and
   authority concepts already enforced by commands.
2. Ensure every durable Process output that enters the Library catalog has a
   retrievable detail projection with lineage, availability, and download
   evidence.
3. Add a deterministic unfinished-session fixture or supported local setup
   command that exercises recovery without bypassing normal service ownership.
4. Keep projection wording concise and typed. The UI should map stable state to
   user language rather than receive verbose hard-coded sentences as domain
   requirements.

These are later, separately approved backend changes. They are not prerequisites
for retaining the beta presentation proof and must not be approximated in the
client.

## Package Findings and Backlog

No additional `@nightbook/ui` blocker remains after `0.1.1`. The adopted package
already covers the recurring shell, buttons, fields, native form controls,
status indicators, panels, tabs, lists, evidence frames, attention surfaces,
dialogs, action bars, and supporting layout grammar used by the beta.

Future promotion should continue to meet the public-library test:

- the component has reusable semantics beyond one Astro Console workflow;
- product labels, eligibility, routes, and commands arrive as data or callbacks;
- styling and state behavior are self-contained;
- the component composes beside arbitrary peers without assuming page context;
- responsive, read-only, keyboard, focus, and overflow behavior work in
  isolation;
- promotion removes real duplication or fixes behavior at the true owner.

Do not promote a component merely because two beta screens look similar. A
workspace-specific composition can remain in Astro Console while its stable
primitives live in `@nightbook/ui`.

## Extension Rules

Future work can extend the beta without drifting from this proof by following
these rules:

1. Treat the accepted Nightbook demo as the visual golden master. Match its
   hierarchy, geometry, density, state color, flyouts, and bottom status strip
   before adapting content.
2. Keep the opt-in beta boundary until an explicit product decision replaces a
   production route. Do not intermingle old and beta components to create a
   reversible switch.
3. Drive every screen from real application projections or explicit loading,
   unavailable, empty, stale, read-only, pending, conflict, and failure states.
   Do not hard-code fixture strings as if they were requirements.
4. Keep command construction in the application. Components receive values,
   state, labels, eligibility, and callbacks.
5. Reconcile mutations from service truth and preserve generation ordering.
6. Validate wide, compact, and 390 px read-only phone presentations, plus
   keyboard, focus, overflow, console, and accessibility behavior.
7. Promote only package-owned defects and genuinely generic composition
   patterns. Record product projection gaps for later backend alignment rather
   than compensating in the UI.
8. Preserve the proof boundary. Local service and browser evidence do not imply
   deployment, Arch host, provider, hardware, or physical-capture proof.

## Closeout Verdict

The four-workspace beta is sufficient evidence that `@nightbook/ui` can serve
Astro Console's new presentation layer. The package boundary held under real
application composition, the local artifact behaved like an external
dependency, and the defects found were corrected at their actual owners. The
next meaningful validation work is backend/projection alignment for the gaps
above, followed by an explicit product decision about replacing production
routes. Neither step is part of this completed local UI-adoption closeout.
