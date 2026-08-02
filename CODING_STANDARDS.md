# Coding Standards

## Authority And Scope

- Production application code is Effect-first.
- The `effect` skill is the current authority for Effect APIs and patterns.
- [Effect Guidance](EFFECT_GUIDANCE.md) is binding for this repository's tagged
  data, errors, and service-boundary rules.
- App-specific standards extend this contract. Nearby compatible code sets local
  conventions; report a conflict rather than guessing.

## Effect Boundary

- Keep deterministic pure domain and presentation transformations as plain
  functions.
- Use Effect for application workflows, dependencies and services,
  configuration, expected failures, resource lifecycles, concurrency, streams,
  schedules, and boundary decoding.
- Execute effects with `Effect.runPromise`, `Effect.runSync`, or another runtime
  entry only at executable, framework, or test edges.
- Use `Effect.gen(function* () { ... })` for multi-step workflows and `pipe`
  for linear composition. Keep generators focused on the workflow.
- Use `Schema.decodeUnknownEffect(...)` for unknown data at API, IPC, device,
  persistence, event, and provider boundaries. Do not cast before decoding.
- Use constrained branded Schema IDs for durable or boundary identity.
- Model expected service failures with `Schema.TaggedErrorClass`; recover with
  typed Effect operators such as `catchTag` and `catchTags`.
- Do not use broad `catchAll`, cause recovery, or manual `_tag` dispatch as the
  default recovery or routing mechanism. Follow Effect Guidance for the narrow
  exhaustive-match and metadata-lookup exceptions.
- Use `Context.Service` and `Layer` for real replaceable, lifecycle-owning, or
  authority-bearing dependencies. Do not hide these behind default references.
- Use `Effect.fn` for public or non-trivial service operations.
- Read runtime configuration through `Config`, with providers at startup and
  test boundaries; do not read environment variables in application workflows.
- Use `Scope` and `acquireRelease` for resources. Layers own long-lived work
  and fork it into their scope.
- Use `Schedule` for retry, polling, pacing, and repetition; use `Stream` for
  many-valued effectful sources. Bound concurrency and make its ordering policy
  explicit.

## Architecture

- Give each domain decision, derived state, configuration decision, and action
  eligibility rule one canonical owner. Other layers consume that owner.
- Derive state from authoritative inputs. Stored projections are intentional
  caches with explicit authority and invalidation.
- Keep transports thin: decode input, obtain trusted identity and authority,
  call one workflow or service operation, recover expected typed errors, and
  map to the public contract.
- Adapters isolate vendor protocol details, quirks, compatibility behavior, and
  telemetry normalization behind normalized domain contracts.
- Workflows orchestrate. Projectors are pure. Renderers consume typed
  projections and closed typed actions, never vendor or transport state.
- Guard async state commits with session or generation identity and operation
  identity.
- Recovery work, including stop, park, and disconnect, takes priority over
  ordinary operations. Disconnect cancels and rejects queued work.
- Correlate aggregate state and active session atomically. Aggregate state is
  the app-facing truth.
- Treat storage and media as a subsystem with validated paths, bounded input,
  and honest partial failure.
- Keep provider and network calls outside authoritative persistence
  transactions.
- Keep event and action vocabularies closed typed unions or exhaustive maps.
- Keep phone authority and read authority aligned with their canonical truth
  where those concepts apply.

## Testing And Evidence

- Prefer real behavior and live layers over mocks. Reusable fakes fail closed
  for unconfigured behavior and visibly expose configured scenarios.
- Use Effect test layers and deterministic synchronization: `Deferred`,
  `Queue`, `Latch`, `Ref`, controllable promises, and `TestClock`, not sleeps.
- Test idempotency, typed failures, finalization, retry bounds, concurrency,
  and malformed boundary data when the changed behavior requires them.
- Name `*.proof.test.ts` only for deterministic consequential simulations that
  cover the relevant boundary-to-authoritative-evidence path. Pure transition
  tests are not proof tests.
- Name `*.integration.test.ts` when real SQLite, filesystem, worker, CLI, or
  provider-adapter behavior is required. Test persistence and worker recovery
  with the selected real implementation.
- Version idempotency hashes over canonical decoded semantic fields; exclude
  transport-only identity and JSON property order.
- For visible UI, CLI, or TUI changes, pair automated checks with focused smoke
  evidence, including a screenshot when it is relevant.

## Change Quality And Migration

- Make the smallest correct change. Inspect nearby code before editing.
- Prefer inference unless an exported surface or non-obvious value needs an
  annotation.
- Do not use import aliases, star imports, `any`, unchecked casts, or non-null
  assertions.
- Do not add unnecessary helpers, comments, abstractions, compatibility paths,
  or duplicated decisions. Extract only real concepts or reusable composition.
- Regenerate generated output from its source definition; never patch generated
  output directly.
- New production code follows this Effect-first contract. Migrate existing
  imperative production code when an Epic materially changes its ownership
  boundary; do not perform unrelated big-bang rewrites.
- Prototype, archive, and legacy code is not implementation authority. Edits to
  still-built legacy code must not knowingly introduce new violations.

## Package Gates And Contributions

- New production packages provide `format`, `format:check`, `typecheck`, `lint`,
  `build`, `test`, and `check` scripts where applicable. Existing packages adopt
  missing gates when an Epic materially changes their tooling boundary.
- New TypeScript configurations enable `strict`, `noUncheckedIndexedAccess`,
  and `exactOptionalPropertyTypes`; existing configurations adopt them when an
  Epic materially changes their ownership boundary.
- Verify from the narrowest affected package or app. Use its declared commands
  rather than invoking `tsc` directly when scripts define the contract.
- Keep commits and PRs focused. Use conventional commit form:
  `type(scope): summary`.
