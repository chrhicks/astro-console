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
- `convergence-roadmap.html` — the current seven-gate finish line.

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
