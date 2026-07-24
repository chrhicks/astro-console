# V2 Prototype References

This dependency-free static workspace separates accepted visual references
from historical studies. Nothing here contacts observatory hardware.

## Open Locally

From the repository root:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/prototype/v2-ui/
```

## Accepted References

- `composite-prototype.html` — Gate 1 workspace shell and responsive model.
- `acquire-prototype.html` — Gate 2 acquisition evidence and recovery.
- `run-authority-prototype.html` — Gate 3 run mutation, reconnect, and control.
- `process-prototype.html` — Gate 4 visual Build/Develop workflow.
- `*-prototype-phase-0.5-preview.html` — clean, production-scale visual
  previews used for Phase 1 implementation review. They are non-authoritative
  comparison surfaces, not product builds.
- `phase-0.5-component-library.html` — clean visual companion for the accepted
  V2 component library; a reference showcase, not a dashboard.
- `phase-0.5-brand-style-guide.html` — accepted brand foundation for palette,
  type, material, voice, templates, and accessibility, now carrying the
  selected Alignment Aperture V1 mark. It governs brand expression; the
  current visual style guide, component library, and build contract govern
  Phase 1 product implementation.
- `archive/` — completed Phase 0.5 studies, Gate 6 technical labs, the
  convergence roadmap, visual variants, and rejected alternatives. Historical
  only; use it for a specific past decision, not active implementation guidance.

The four prototypes centralize synthetic truth in their matching JavaScript
models. Renderers consume those projections rather than inventing domain state.

## Historical Archive

`archive/` contains rejected alternatives, pairwise studies, earlier Plan and
Observe prototypes, and superseded model and architecture pages. It is not
default design context. Open `archive/index.html` only to answer a specific
historical question.

Shared presentation remains in `styles.css`. Archived pages reuse it from the
parent directory so their evidence remains viewable without duplicating assets.

## Safety Boundary

All accepted actions and archived studies are simulations. They update local
page state or open local dialogs only. There are no observatory APIs, hardware
commands, backend persistence, package dependencies, or network requests.
