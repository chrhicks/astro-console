# Gate 6 Solve-Geometry Result

Status: **complete July 23, 2026**

This bounded technical spike measured synthetic SVG overlay projection and
responsive presentation for accepted Acquire geometry. It did not redesign
Acquire or validate a real plate solver, image, mount, or coordinate transform.

## Decision

- Retain a normalized directional vector with numeric magnitude kept in text.
- Require adaptive label placement, compact evidence, or a leader treatment
  for small offsets where labels and markers cannot coexist clearly.
- Preserve the phone summary-only, read-only projection.

The vector remains evidence of anchor and direction, not a scale drawing of
physical or angular magnitude. RA/Dec and Alt/Az facts remain explicit numeric
text; image direction remains distinct from physical mount-adjustment guidance.

## Fixture Results

At 1600 px and 1000 px, all nine fixtures passed intrinsic 800×500 SVG/viewBox
and CSS-scale checks, desired and solved anchor residuals at or below 0.5 CSS
px, measured-to-desired vector direction, and legend/ARIA presence. The
no-solution fixture showed `OFFSET UNKNOWN` and no vector.

| Fixture | Geometry result | Label / marker clearance |
| --- | --- | --- |
| Centering 31″ | Pass | Collision observed |
| Centering 45″ | Pass | Collision observed |
| Centering 71″ | Pass | Collision observed |
| Centering 600″ | Pass | Clear |
| Centering 742″ | Pass | Clear |
| Polar 1.3′ | Pass | Collision observed |
| Polar 2.0′ | Pass | Collision observed |
| Polar 18.4′ | Pass | Clear |
| No solution | `OFFSET UNKNOWN`; vector absent | Not applicable |

At the 390 px phone width, the desktop overlay and fixture controls were
visually hidden. The read-only summary remained visible with zero buttons and
no overflow or console errors. The 18.4′ polar fixture showed physical guidance
to raise altitude 11.2′ and move azimuth left 14.6′.

## Method And Limits

The [Gate 6 geometry harness](../../../prototype/v2-ui/gate-06-solve-geometry.html)
uses the accepted 800×500 SVG/viewBox language and deterministic fixtures. It
transforms expected and live marker coordinates with `getScreenCTM()`, checks
the vector direction from measured to desired, measures live screen-rectangle
clearance, checks legend/ARIA presence, and exposes the phone summary for
browser automation.

This establishes only synthetic DOM/SVG behavior. It does not validate solve
accuracy, image orientation, coordinate conventions, mount direction, solver
uncertainty, image rendering, network transport, persistence, or real-device
legibility. The low-offset clearance failures are intentional measurement
evidence, not a visual workaround to be hidden in the harness.
