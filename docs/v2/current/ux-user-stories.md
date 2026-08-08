# V2 UX User Stories

Status: **living UX catalog — not implementation authorization**

Updated: August 5, 2026

Use this catalog to frame future UX work around an operator decision, the
service-owned truth that supports it, and visible proof. It does not change the
accepted product model, delivery plan, or current V2.1 scope.

`Delivered` means the product boundary exists and is a candidate for UX review
or refinement. `Next` is accepted V2.1 Phase 5 work. `Later` needs owner
planning before implementation.

## Shared Shell And Authority

| ID | Status | User story | UX proof to seek |
| --- | --- | --- | --- |
| UX-01 | Delivered | As an operator, I want to see the current target, phase, progress, health, and controller from every workspace, so I can decide whether to return to Observe. | The compact status surface answers those facts without opening diagnostics. |
| UX-02 | Delivered | As a controller, I want an action to state why it is unavailable, so I can resolve the real block instead of retrying. | The surface distinguishes read-only client, missing lease, stale state, and service unavailability. |
| UX-03 | Delivered | As a reconnecting operator, I want a clear fresh-or-stale indication, so I do not act on an old browser projection. | A reconnect replaces the view with a fresh service snapshot and does not replay an action. |
| UX-04 | Delivered | As a phone viewer, I want useful current state without control buttons, so I can monitor safely in the field. | The 390 px surface remains readable, read-only, and free of horizontal overflow. |
| UX-05 | Later | As an operator, I want attention grouped by the decision it affects, so routine telemetry does not compete with an urgent recovery. | Attention names the affected workspace, consequence, evidence, and next action. |

## Plan

| ID | Status | User story | UX proof to seek |
| --- | --- | --- | --- |
| UX-10 | Delivered | As an operator, I want to compose ordered target sequences with timing and capture constraints, so I can prepare a viable observing night. | The selected sequence and complete-plan readiness remain visible together. |
| UX-11 | Delivered | As an operator, I want validation to identify the exact blocker and its effect, so I can correct the plan before starting it. | Readiness distinguishes ready, limited, and blocked with a useful remedy. |
| UX-12 | Delivered | As a controller, I want `Run plan` to create a stable run from the reviewed plan, so later draft edits do not change live work. | The interface shows the accepted run separately from the editable draft. |
| UX-13 | Later | As an operator, I want a compact explanation of a run-change consequence before I approve it, so I understand its impact on exposure, schedule, and storage. | The decision surface states the specific consequence, not a generic confirmation. |

## Observe And Acquire

| ID | Status | User story | UX proof to seek |
| --- | --- | --- | --- |
| UX-20 | Delivered | As an operator, I want preflight to show the current rig facts and safe-state verdict, so I know what prevents a run from starting. | Raw provider facts stay secondary to a named verdict and next blocker. |
| UX-21 | Delivered | As an operator, I want to inspect a configured rig's observed capabilities and connection state, so I do not assume unsupported hardware is available. | Unknown or unavailable facts are explicit and never shown as safe. |
| UX-22 | Delivered | As a controller, I want a bounded camera exposure action to show later camera observation, so provider acknowledgement is not mistaken for completion. | The result distinguishes request acknowledgement, observed camera state, and retained image evidence. |
| UX-23 | Next | As an owner outdoors, I want a guided target-acquisition surface, so I can complete one deliberate slew, solve, center, and capture attempt. | The surface keeps target, evidence, correction scope, and abort path visible. |
| UX-24 | Next | As an owner, I want a plate-solve result to state solved or no solution with its source frame and remaining retry scope, so I can make a bounded recovery choice. | Failed evidence remains inspectable and the UI does not imply mount movement from a solve result. |
| UX-25 | Next | As an owner, I want an image-backed centering correction to state its proposed physical effect before approval, so I can intervene deliberately. | Proposal, observed result, and correction evidence are distinct. |
| UX-26 | Later | As an operator, I want one recovery surface to state what remains protected after a provider interruption, so I can resume, retry, skip, or stop with confidence. | Recovery names preserved evidence, retry scope, and safe alternatives. |

## Library And Evidence

| ID | Status | User story | UX proof to seek |
| --- | --- | --- | --- |
| UX-30 | Delivered | As an operator, I want captured originals to retain identity, checksum, lineage, and provenance, so I can trust their relationship to a run. | Asset detail does not depend on a raw path or a temporary published copy. |
| UX-31 | Delivered | As an operator, I want an explicit unavailable-preview state, so a retained camera original is not mistaken for a broken or missing asset. | The original remains downloadable while the visual limitation is clear. |
| UX-32 | Delivered | As a reviewer, I want to inspect a frame's preview, quality facts, rationale, and related results, so I can make a durable review decision. | The review action does not alter the original or acquisition evidence. |
| UX-33 | Delivered | As a reviewer, I want to compare related saved assets, so I can judge alternatives without declaring one mandatory final image. | Comparison is bounded to related assets and remains a Library responsibility. |
| UX-34 | Delivered | As an authorized remote viewer, I want a deliberate original download, so large data is not sent as routine preview traffic. | Preview and download have visibly different intent and availability states. |
| UX-35 | Later | As an operator, I want Library filters to make acquisition lineage and review status easy to scan, so a growing catalog stays useful. | Filtering preserves orientation and avoids an unbounded catalog surface. |

## Process

| ID | Status | User story | UX proof to seek |
| --- | --- | --- | --- |
| UX-40 | Delivered | As an operator, I want to open a Library source into a durable Process session, so switching or refreshing does not lose working state. | The handoff names the source and resumes the authoritative session when possible. |
| UX-41 | Delivered | As an operator, I want the image canvas to stay visible while I preview and tune an operation, so I can judge its effect. | The canvas remains dominant at wide and compact desktop layouts. |
| UX-42 | Delivered | As an operator, I want Preview and Apply to be visibly different states, so a temporary result does not silently change history. | Only explicit Apply advances the linear history. |
| UX-43 | Delivered | As an operator, I want undo and redo to show one current linear history, so I understand what will be retained after another Apply. | The UI does not suggest branches or arbitrary version control. |
| UX-44 | Delivered | As an operator, I want a failed stage to show its checkpoint and retry scope, so I do not rerun unaffected Build work. | The recovery surface names the surviving output and next valid action. |
| UX-45 | Delivered | As an operator, I want Save, Switch, and Discard to name their exact scope, so sources and saved artifacts remain protected. | A destructive decision says what is removed and what survives. |
| UX-46 | Later | As an operator, I want optional assistant findings to explain their evidence without taking focus, so advice remains advisory. | Viewing a finding changes its unread state but never applies a processing change. |

## Remote Viewing And Shared Control

| ID | Status | User story | UX proof to seek |
| --- | --- | --- | --- |
| UX-50 | Delivered | As a trusted viewer, I want remote availability and admitted identity to be visible, so I know whether I am seeing current service truth. | Tunnel or Access loss reads as remote unavailable, not as a stopped observatory. |
| UX-51 | Delivered | As a desktop viewer, I want to request control explicitly, so I can ask an owner without assuming membership grants authority. | The request stays pending until an owner grants or declines it. |
| UX-52 | Delivered | As an owner, I want to grant, decline, release, or take control with one visible controller state, so authority does not become ambiguous. | Every client projects the same lease holder and stale actions fail clearly. |
| UX-53 | Delivered | As a local owner during a Tunnel outage, I want local service continuity to remain clear, so I can distinguish remote access loss from observatory failure. | Local state remains readable while remote status changes. |
| UX-54 | Later | As a trusted remote viewer, I want a clear handoff when a desktop action needs local owner confirmation, so shared work does not imply remote hardware autonomy. | The surface names the owner decision and the action that remains blocked. |

## Use In Future UX Work

Start with one story, then define the healthy, warning, failure, recovery, and
reconnect states before drawing a screen. For a story that changes a durable
object or hardware behavior, identify the service owner, expected revision,
and proof boundary before implementation. New stories should be added only when
they describe a distinct operator decision; copy or layout refinement belongs
with the story it improves.
