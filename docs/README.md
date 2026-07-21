# Documentation

This directory contains portable, tracked documentation for Astro Console.

Do not add credentials, private network addresses, device serial numbers,
machine paths, raw hardware evidence, or other personal observatory details.
Keep those materials under the ignored `.local/` directory instead.

## Current Documents

- [Product scope](product/current-scope.md)
- [Architecture overview](architecture/overview.md)
- [Renderer architecture](architecture/renderer.md)
- [Desktop development and inspection](development/desktop-dev-inspection.md)
- [Catalog maintenance](development/catalog-maintenance.md)
- [Fake scenario testing](operations/fake-scenario-testing.md)

## Future V2 Planning

- [V2 plan](v2/README.md) describes the proposed web-first product and UI
  direction. It is intentionally separate from the documents above and does
  not describe current application behavior.

## Status

Documents in this tree describe the current product and supported development
workflow. Retire or rewrite a document when its claims no longer match the
application. Documents under `v2/` are the explicit exception: they are
future-facing plans and must remain clearly labeled as proposals until their
behavior is implemented.
