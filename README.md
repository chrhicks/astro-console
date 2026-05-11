# Seestar

TypeScript SDK and desktop app work for the ZWO Seestar S30.

## Repo Layout

- `sdk/` - Node/TypeScript SDK for discovery, authentication, and device control
- `apps/desktop/` - Electron desktop app built on top of the SDK

## Current Focus

- local-network device discovery
- firmware 7.18+ authentication flow
- desktop UI for connection, status, and logs

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

## Notes

- The Seestar PEM key is required for authentication and is intentionally not committed.
- This repository is intended to stay private.
