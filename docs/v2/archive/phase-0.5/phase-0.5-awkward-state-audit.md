# Phase 0.5 Awkward-State Consistency Audit

Status: **current review evidence — not design authority**

Updated: July 24, 2026

This audit tests the versioned Phase 0.5 review variants against the frozen
reference behavior and the [style and design guide](design-system.md). The
frozen originals remain unchanged.

## Method

For each state, test the same four comprehension questions:

1. What is true now, and who/what owns it?
2. What evidence supports that claim?
3. What stopped, continued, or remains protected?
4. What is the one useful next action—or why is there none?

Then verify the state at `1600×1000`, `1000×900`, and `390×844`. At phone
width, verify read-only monitoring and absence of mutation controls rather
than requiring the desktop control surface to fit.

## States And Results

| Variant / state | Comprehension result | Responsive result |
| --- | --- | --- |
| Composite / storage recovery | Pass. It names held new exposures, retained frame-in-camera evidence, and the bounded reconnect/download/validate recovery while Plan remains visible. | No overflow at all three widths; phone has no mutation controls. |
| Acquire / solve retries exhausted | Pass. Failed frames, unknown offset/no correction, remaining bound, recovery choices, and no automatic movement remain together. | No overflow at all three widths; phone has no mutation controls. |
| Run Authority / superseded controller command | Pass on desktop and compact. Controller/timing, rejected command, continued run, and `no hardware action` remain explicit. | No overflow at all three widths; phone has no mutation controls. See open question below. |
| Process / Stretch failure | Pass. The canvas and valid Build checkpoint remain visible; failure names absent output, stage-local retry scope, and tool-output inspection. | No overflow at all three widths; phone has no mutation controls. |

Live checks found no browser console warnings or errors. A temporary phone
overflow from the Phase 0.5 run/status anchor was corrected by making its
phone projection a wrapping vertical anchor; all four variants now measure
`scrollWidth <= innerWidth` at `390×844`.

## Open Question

The Authority phone monitor correctly remains read-only and shows current run,
freshness, controller, and monitoring capability. In the superseded-command
scenario, the rejection itself is not prominent in the phone's first viewport.
That may be an intentional monitoring prioritization, but before guide freeze
decide whether a recent protected/rejected-control attention item belongs in
the phone summary.

## Boundary

- **Passed:** awkward-state evidence, bounded recovery, retained work,
  responsive containment, and phone control restrictions in the reviewed
  variants.
- **Not reopened:** frozen interaction semantics or canonical ownership.
- **Next:** resolve or explicitly defer the Authority-phone attention question,
  then derive the component-library checkpoint from the reviewed patterns.
