# Alpaca Development Simulator

This loopback server exercises Astro Console's current Alpaca preflight and
camera adapters. It is a development tool, not a production origin or a generic
Alpaca implementation.

Prepare only the corpus entries needed by the current work:

```sh
npm run sim:corpus -- --id=m101-good-light
```

Repeat `--id` to prepare or verify a selected pack. With no `--id`, the script
uses every manifest entry, including files that may not have been copied yet.
For example, verify the current five-file pack with:

```sh
npm run sim:corpus -- --verify-only \
  --id=m101-good-light \
  --id=m101-clouded-light \
  --id=ngc7000-first-light \
  --id=ngc7000-dithered-light \
  --id=ngc7000-frame-quality
```

Start the simulator on `127.0.0.1:32324`:

```sh
npm run sim:alpaca -- --scenario=exposure-success
```

Use `--port=<port>` to change the port and `--pace-ms=<milliseconds>` to advance
the deterministic clock after each Alpaca request during a browser demo. Tests
normally advance the clock through `POST /__sim/advance`; product code must use
only the Alpaca management and device routes.

Available scenarios are declared by `alpacaSimulationScenarios` in
`src/simulator/alpaca-simulator.ts`. They cover ready and unavailable inventory,
exposure and abort, provider and reconciliation failures, bounded image
retrieval, restart without replay, target-evidence progression, solve/no-solve
inputs, and pinned focus-quality facts.

The corpus manifest records source paths and SHA-256 values. Prepared files and
generated payloads remain under ignored `.tmp/alpaca-simulation-corpus/`.
