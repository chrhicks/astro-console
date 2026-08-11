# Gate 5 — Contract Evidence

Status: **historical accepted Gate 5 product/domain evidence; executable harness retired**

The vocabulary, product decisions, and executable contract evidence below are
accepted. An initial closure claim was reopened after a future-server
walkthrough found that several passing fixtures proved schema shape or only
part of the scenario named by the test. The resulting hardening and regrade are
recorded in
[Gate 5 server-perspective audit](../current/gate-05-server-audit.md).

Gate 5 translates the accepted product behavior from Gates 1–4 into an
executable service boundary. It does not select HTTP routes, database tables,
or tool-specific adapter payloads.

## Accepted Result

- Seven aggregate roots: `Observatory`, `Membership`, `ObservingPlan`,
  `ActiveRun`, `ControlLease`, `ProcessingSession`, and `Asset`.
- Thirty-three closed intent commands with branded identity and revision
  fields.
- Nine stable command-failure families, plus operation failure after accepted
  asynchronous work.
- Thirty-eight durable event variants with typed payloads and separate
  projection events.
- One shared gate for authentication, local membership, client capability,
  owner/controller authority, freshness, and idempotent replay.
- Deterministic state transitions for the shell/client projection, Run,
  Control, Acquire, Process, and Library.
- UI-driving snapshots that keep domain state, action availability, freshness,
  subsystem health, processing pressure, and artifact delivery distinct.
- Executable fixtures for the complete 43-scenario accepted baseline.

## Important Preserved Semantics

- The service owns work and state; reconnect installs a fresh snapshot and
  never replays browser-buffered commands.
- Every accepted aggregate mutation advances its revision once. Stale intent
  performs no physical action.
- A controller disconnect does not stop an accepted run. Lease grace and run
  execution are separate facts.
- Acquire retry is bounded. Changed solve parameters begin a separately bounded
  recovery series. Mount acknowledgement does not prove a correction; a new
  solved image does.
- Process has one current linear history. Preview is synchronized but is not
  applied history. Undo then Apply replaces redo.
- Processing is not paused merely because capture is active. Throttle or pause
  requires measured resource pressure.
- A failed processing step retries from its valid checkpoint; a Stretch retry
  does not rebuild Calibration or Stack.
- Saving may create several related Library assets. Discard protects source
  evidence and previously saved assets.
- Stable Asset identity is independent of local or R2 representation state.
  LAN downloads stream locally; remote downloads use a current R2 grant or an
  explicit preparing flow.

## Evidence

- [Accepted scenarios and state ownership](../current/gate-05-scenarios.md)
- [Consequential action map](../current/gate-05-action-map.md)
- [Canonical contract vocabulary](../current/gate-05-contract-vocabulary.md)

The former executable harness package was retired when current wire schemas
moved to `@astro-console/protocol` and lifecycle proof moved to the owning
production server and web modules. The links above remain accepted product and
ownership evidence; they are not current code-structure authority.

Validation at the initial closure attempt:

```text
npm run build  -> pass
npm test       -> 77 tests pass, including all 43 scenario fixtures
```

This count is retained as history, not evidence that the reopened exit criteria
were satisfied.

Validation after the server-perspective hardening pass:

```text
npm run build    -> pass
npm test         -> 176 tests pass across 21 suites
git diff --check -> pass
```

All 43 accepted scenarios now map either to deterministic future-server proof
coverage or, for the two presentation-only shell scenarios, to focused state
tests with an explicit no-server-impact rationale. Proofs cover rejection side
effects, idempotent replay, authoritative projection, deterministic races, and
atomic aggregate/event/result/outbox acceptance.

## Deferred Boundary

Gate 6 measures catalog rendering, image overlay/solve geometry, and streamed
state/preview reconnect behavior. Real SQLite transaction and worker recovery,
filesystem materialization, CLI/hardware adapters, R2 upload and grant minting,
and transport remain integration boundaries. Their observable behavior must
preserve this contract.
