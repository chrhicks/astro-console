# Gate 7 Final-Reference Walkthrough

Status: **accepted — V2 reference frozen by owner acceptance July 23, 2026**

Updated: July 23, 2026

This is the decision log and evidence record for the final V2 reference
walkthrough. It consumes accepted Gates 1–6; it does not redesign them.

## Scope And Result So Far

The accepted interaction, scenario, and contract evidence is internally
consistent. The executable contract candidate passed its full suite: 176 tests
in 21 suites, including all 43 accepted scenarios and the associated server
proofs.

Static reference inspection and live browser validation found no
product-invariant conflict across the Composite, Acquire, Run Authority, and
Process references. The pages were checked at 1600×1000, 1000×900, and
390×844. No checked page had horizontal overflow, console warnings, or console
errors. Desktop pages exposed named controls and focusable paths; every phone
render had zero visible interactive controls.

The live trace exercised exhausted Acquire recovery, superseded-controller
rejection before hardware action, Process stage-local failure recovery, and the
keyboard Process comparison control. The browser screenshots reviewed during
validation confirmed the wide Composite hierarchy, compact Process failure
surface, and read-only phone Process monitor.

Owner acceptance freezes the reference at [the accepted prototype hub](../../../prototype/v2-ui/index.html).

## Coherent Operator Trace

| Story beat | Accepted visible behavior | Contract reconciliation |
| --- | --- | --- |
| Plan to active run | Plan stays editable; `Run plan` makes an independent accepted run visible in every workspace. | `RUN-01`; `StartRunFromPlan` freezes a `RunDefinition` and requires the current lease. |
| Acquire and capture | Observe leads with solve/image evidence. Eligible correction and retry are automatic; image verification, not driver acknowledgement, completes centering. | `ACQ-01`, `ACQ-02`, `ACQ-05`; bounded attempts and verified outcomes. |
| Warning and recovery | Exhausted solve attempts preserve evidence and offer a bounded longer-exposure recovery or skip. A valid checkpoint lets Process retry only its failed stage. | `ACQ-03`; `PROC-08`; no indefinite retry or broad rerun. |
| Durable review | Library presents chronology, lineage, availability, and related saved-result comparison without changing the assets. | `LIB-01` through `LIB-04`; stable asset IDs, no storage paths as identity. |
| Build and develop | Process starts raws in Build or a valid linear master in Develop. Preview remains distinct from explicit Apply, and undo/redo stay linear. | `PROC-01` through `PROC-07`; `StartProcessingSession`, `SyncProcessingPreview`, and `ApplyProcessingPreview`. |
| Save, discard, and switch | Several related outputs may be saved; discard preserves sources and prior Library assets; switching requires an explicit disposition. | `PROC-12` through `PROC-14`; save/discard transitions fail closed before switching. |
| Reconnect | The page replaces its projection with an authoritative snapshot, then accepts newer events. It never reconstructs jobs or replays a stale intent. | `CLIENT-01` through `CLIENT-03`; `PROC-11`. |
| Control transfer | Presence remains separate from authority. Request, explicit grant, reconnect grace, and owner takeover do not stop accepted work; late old-controller work is rejected before action. | `LEASE-01` through `LEASE-06`; lease-revision guards and `ControlLeaseLost`. |
| Phone projection | The same current observatory truth is readable on phone without observing, control, or Process mutations. | `PHONE-01`; server-side capability enforcement. |

## Gate 6 Constraints Retained

| Constraint | Final-reference implication |
| --- | --- |
| Catalog scale | Library implementation must use bounded server queries and a virtualized viewport; full-DOM catalog installation is rejected. |
| Solve geometry | Keep normalized direction plus numeric magnitude, adapt small-offset label treatment, and retain the phone summary-only projection. |
| Reconnect and preview | Install snapshots atomically, reject cursor/version gaps until refreshed, retain no replay queue, and restore service-accepted preview separately from applied history. |

## Decision Log

| Matter | Decision | Evidence |
| --- | --- | --- |
| Workspace ownership and cross-workspace handoff | Accepted; no conflict found. | Gate 1–4 references and Gate 5 scenario/ownership baseline align. |
| Acquire evidence and bounded recovery | Accepted; no conflict found. | Gate 2 scenarios, Acquire proofs, and `ACQ-01`–`ACQ-07`. |
| Service ownership, reconnect, and exclusive control | Accepted; no conflict found. | Gate 3 reference, client/control proofs, and `CLIENT-*` / `LEASE-*`. |
| Process model | Accepted; no conflict found. | Gate 4 reference, Process proofs, and `PROC-01`–`PROC-14`. |
| Library ownership and delivery semantics | Accepted; no conflict found. | Asset proofs and `LIB-01`–`LIB-04`. |
| New product models, recipes, visible branches, phone mutation, production adapters, or transport | Rejected as Gate 7 scope expansion. | Gate 7 handoff and convergence stop criteria. |
| Synthetic-scenario selector visible on phone in two prototype pages | Resolved: hidden with the containing test header at the phone breakpoint; desktop behavior is unchanged. | It is not a product command, but hiding it keeps the literal phone validation surface free of interactive controls. |
| Live wide/compact/phone runtime evidence | Accepted as complete. | In-app browser validation at 1600×1000, 1000×900, and 390×844 found no overflow, warnings, or errors; phone pages had zero visible interactive controls. |

## Outcome

Gate 7 is accepted. The V2 reference is frozen at the accepted prototype hub,
with this walkthrough, the accepted gate records, Gate 5 contracts, and Gate 6
constraints retained as the implementation specification. Reopen an accepted
model only for a recorded product-invariant conflict.

No accepted interaction decision should be reopened for copy polish,
implementation convenience, or visual taste alone.
