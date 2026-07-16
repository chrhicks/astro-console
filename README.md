# Astro Console

TypeScript SDK and Electron desktop app for personal astronomy workflows.

## Repo Layout

- `sdk/` - Node/TypeScript SDK for Seestar discovery, authentication, and device control
- `apps/desktop/` - Electron app with Seestar, fake Seestar, and Alpaca rig adapters
- `docs/` - tracked, portable project documentation
- `.local/` - ignored machine-, rig-, and evidence-specific notes

## Current Focus

- personal known-rig imaging through the desktop app
- local-network discovery and typed device adapters
- bounded capture, local frame library, and safe operator-driven recovery

## Development

SDK:

```bash
cd sdk
npm install
npm run build
```

Desktop app:

```bash
cd apps/desktop
npm install
npm run dev
```

## Documentation

- [`docs/README.md`](docs/README.md) - documentation index and privacy boundary
- [`docs/product/current-scope.md`](docs/product/current-scope.md) - supported workflow and exclusions
- [`docs/architecture/overview.md`](docs/architecture/overview.md) - current application boundaries
- [`docs/operations/fake-scenario-testing.md`](docs/operations/fake-scenario-testing.md) - deterministic desktop validation

## Notes

- The Seestar PEM key is required for authentication and is intentionally not committed.
- Set `SEESTAR_PEM_PATH` (or legacy `SEESTAR_PEM`) to point SDK/CLI/desktop flows at your local PEM file.
- Keep local rig addresses, device identifiers, credentials, and hardware evidence under `.local/`.
