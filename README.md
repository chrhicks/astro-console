# Astro Console

Astro Console is a web-first personal observatory workspace. The rig-local
server owns Plan, Observe, Library, and Process state; the web application is
the version-matched interface it serves.

## Active Workspace Packages

- `apps/server/` — rig-local HTTP, SQLite, SSE, admission, and deployment code
- `apps/web/` — browser workspace
- `packages/v2-contracts/` — shared Effect Schema contracts

Use Node 22.13 or later. On a first checkout, install and prepare the
workspaces from the repository root:

```sh
npm ci
npm run setup
npm run dev:inspect -- --path=/plan
```

The inspector starts a dedicated Chrome profile with CDP on port 9223. Install
Google Chrome first, and stop an earlier inspector runner if that port is in
use. Set `ASTRO_SERVER_CHROME` when Chrome is in a non-default location.

After setup, run any workspace command, for example
`npm run test --workspace @astro-console/web`.

## Documentation

- [V2 start here](docs/v2/README.md)
- [Current handoff](docs/v2/current/handoff.md)
- [Server deployment guide](apps/server/deployment/README.md)

The retired SDK, Electron desktop application, and prototype UI artifacts are
available only through Git history.
