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

## Inspect the beta UI

After preparing the current four FITS files, start the complete local
simulation, Astro Console origin, beta web app, and isolated inspection browser
with one command:

```sh
npm run dev:sim:inspect
```

The default opens `/observe?ui=beta` as the desktop owner with the
`exposure-success` scenario. The runner verifies every FITS file used by every
selectable scenario against the committed checksums before it starts Astro
Console. It keeps its database, retained originals, previews, and Chrome
profile under ignored `.astro-server/` paths.

Use bounded options when a focused state is needed:

```sh
npm run dev:sim:inspect -- \
  --scenario=focus-quality-degradation \
  --client=phone \
  --path=/library?ui=beta
```

The beta simulation strip identifies the app as simulated, selects or resets a
scenario, advances the deterministic clock, and shows the pinned FITS filename
and checksum. **Load** changes simulator state; it does not run the named
workflow. The current UI drivers are:

- `ready-rig` and `optional-device-unavailable`: **Run preflight test** starts
  the accepted fixture run when needed, runs the normal Observe preflight, and
  lets the service projection update through the normal snapshot and SSE path;
- `exposure-success`: **Capture test frame** uses the normal Plan, Preflight,
  camera command, captured-original, and Library routes, then links to the
  retained Library asset; and
- every other scenario: the strip names that its beta UI driver is not yet
  implemented and leaves capture disabled. The scenario remains available for
  direct simulator and adapter tests.

The capture driver does not insert a Library fixture. Phone and read-only
clients show the simulation context without mutation controls. None of these
development controls contacts live hardware.

The corpus manifest records source paths and SHA-256 values. Prepared files and
generated payloads remain under ignored `.tmp/alpaca-simulation-corpus/`.
