# Gate 6 Catalog-Scale Result

Status: **complete July 23, 2026**

This bounded technical spike measured browser-side catalog installation and
interaction with deterministic synthetic Library assets. It did not redesign
Library or establish production transport, persistence, thumbnail decoding, or
reconnect behavior.

## Decision

- Reject full-DOM catalog rendering.
- Require viewport virtualization for the rendered result set.
- Require a bounded server query/pagination boundary. Client-side pagination
  alone is insufficient because it still installs and sorts the entire catalog
  in the browser.

The selected implementation direction is therefore a bounded Library query
with a virtualized viewport. Asset detail and representations should be loaded
on selection rather than installed as an unbounded catalog payload.

## Measurement

The retired Gate 6 harness generated deterministic assets with representative review status, lineage,
availability, capture facts, and synthetic preview placeholders. It is
available only through Git history. It used a
double-`requestAnimationFrame` install-to-paint boundary; filter, render, and
interaction-sample timings are browser-side harness timings. Heap values are
directional. The interaction sample applies an accepted filter, sharpest sort,
and related-asset comparison.

| Strategy | Assets | Install to paint | Filter | Render | Sample | DOM nodes / mounted rows | Heap | Long task |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Virtualized | 1,000 | 16.6 ms | 0.6 ms | 2.0 ms | 12.2 ms | 378 / 18 | 4.8 MB | none observed |
| Virtualized | 10,000 | 16.7 ms | 1.6 ms | 1.8 ms | 16.7 ms | 378 / 18 | 7.2 MB | none observed |
| Virtualized | 50,000 | 50.9 ms | 6.8 ms | 2.0 ms | 16.9 ms | 378 / 18 | 17.2 MB | none observed |
| Virtualized | 100,000 | 83.4 ms | 14.1 ms | 1.7 ms | 31.4 ms | 378 / 18 | 37.4 MB | one 80 ms task |
| Paged + virtualized | 100,000 | 74.9 ms | 12.5 ms | 1.7 ms | 33.4 ms | 378 / 18 | 33.1 MB | one 72 ms task |
| Full DOM | 1,000 | 228.9 ms | — | — | — | 10,635 / 807 | — | one 154 ms task |
| Full DOM | 10,000 | 1,050.1 ms | — | — | — | 105,015 / 8,067 | — | one 1,118 ms task |
| Full DOM | 50,000 | 6,288.9 ms | — | — | — | 524,512 / 40,336 | 82.1 MB directional | one 5,679 ms task |

Full DOM at 100,000 assets was not run: the 50,000-asset result had already
made the strategy decisively unusable. The page-reported filter, render, and
sample timings exclude a guaranteed paint; the table's Install-to-paint column
uses double-rAF, and long-task observations are the responsiveness evidence.

## Limits And Follow-up

This spike does not measure thumbnail decode, image bytes or network transport,
persistence, server query cost, authoritative reconnect/catalog replacement,
or phone and 1000 px responsive behavior. The 1000 px and 390 px harness
smokes remain incomplete.

The next active Gate 6 spike is image overlays and solve geometry. It should
measure geometry fidelity and visual legibility without changing the accepted
Acquire model.
