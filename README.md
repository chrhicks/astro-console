# Astro Console

Astro Console is a web-first personal observatory workspace. The rig-local
server owns Plan, Observe, Library, and Process state; the web application is
the version-matched interface it serves.

## Active Workspace Packages

- `apps/server/` — rig-local HTTP, SQLite, SSE, admission, and deployment code
- `apps/web/` — browser workspace
- `packages/v2-contracts/` — shared Effect Schema contracts

Install once from the repository root, then run a workspace command:

```sh
npm install
npm run build --workspace @astro-console/server
npm run test --workspace @astro-console/web
```

## Documentation

- [V2 start here](docs/v2/README.md)
- [Current handoff](docs/v2/current/handoff.md)
- [Server deployment guide](apps/server/deployment/README.md)

The retired SDK, Electron desktop application, and prototype UI artifacts are
available only through Git history.
