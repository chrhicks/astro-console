# Coding Standards

Source: `anomalyco/opencode` `v2` branch, distilled from `.references/opencode-v2/AGENTS.md`, `.references/opencode-v2/CONTRIBUTING.md`, `.references/opencode-v2/.editorconfig`, `.references/opencode-v2/package.json`, `.references/opencode-v2/.husky/pre-push`, `.references/opencode-v2/.github/pull_request_template.md`, `.references/opencode-v2/.opencode/agent/*.md`, and `.references/opencode-v2/.opencode/skills/{effect,debug-opencode}/SKILL.md`.

## Core Working Style

- Make the smallest correct change.
- Keep logic in one function unless extraction clearly improves reuse, composition, or names a real concept.
- Do not create single-use helpers without a strong reason.
- Inline values used once when that keeps the code readable.
- Prefer `const` over `let`.
- Avoid `else` when an early return or ternary keeps the flow clearer.
- Avoid `try`/`catch` when a simpler control flow is available.
- Avoid `any` and other loose typing shortcuts.
- Prefer concise names and dot access over unnecessary destructuring.
- Prefer functional array methods over imperative loops when type inference stays clear.

## Imports And Module Boundaries

- Never alias imports.
- Never use star imports.
- If a namespace-like API is needed, import the module's exported namespace by name.
- Use dynamic imports for heavy or branch-specific code paths when that preserves startup cost and readability.
- Keep dependency direction clean. In the source repo this means Schema -> Core and Protocol -> Server, with client runtime code depending on Schema and Protocol but not Core or Server.

## Types And Runtime APIs

- Rely on type inference unless an exported surface or a non-obvious value needs explicit annotation.
- Use precise types instead of unchecked casts, non-null assertions, or compatibility shims.
- In Effect-based code, parse `unknown` external data with `Effect.Schema` instead of ad-hoc structural type guards or unchecked casts when the value crosses a trust boundary and needs validation.
- Decode unknown input explicitly and handle schema failures deliberately. Do not cast unknown input to a typed shape before decoding it.
- Prefer platform-native helpers when they fit the codebase. In the source repo this includes Bun APIs such as `Bun.file()`.

## Complex Logic

- Make the main function read as the happy path.
- Move real supporting concepts into small helpers placed close to the caller, usually below the main export.
- Do not extract helpers for simple expressions just to reduce line count.
- Add comments only for non-obvious constraints, surprising behavior, or important invariants.
- Give each shared domain decision and derived state one owner. Reuse that owner rather than recomputing the rule in workflows, projections, and UI.
- Keep a selector or predicate local when it only shapes one component's presentation. Give reusable or domain-significant selection a named, centralized owner near the state it interprets.
- Name business-priority condition chains as decision functions when their ordering affects behavior. Simple local presentation ternaries remain appropriate when they do not encode a shared rule.
- Model lifecycles with explicit discriminated states when transition validity, cancellation, recovery, or terminal behavior matters; do not infer them from unrelated flags.

## Stateful Changes And Review

For a change that adds or alters state, phases, capabilities, or action eligibility, authors and reviewers must:

- Name the canonical owner for each stateful or action decision, and make other layers consume that decision rather than recreate it.
- Trace each equivalent phase, capability, and action-eligibility rule through the workflow/runtime, projector, and renderer; resolve mismatches at the canonical owner.
- Centralize a predicate or selector only when it is shared or names a domain-significant rule. Keep simple local presentation expressions local.
- Derive projections from authoritative inputs when those inputs are available. Store a projection only as an intentional cache, and document its authority, invalidation, and reason for storage.
- Distinguish stable capabilities from transient activity: derive eligibility and presentation from a stable capability when that is the rule, not from an operation mode that happens to imply it now.
- Do not apply blanket ternary bans or state-machine mandates. Use the smallest representation that makes the decision and its ownership clear.

## Repo-Specific Patterns From OpenCode V2

- Do not hand-edit generated client output after API changes; regenerate it from the owning package.
- Keep V2 work in the V2 package set and avoid legacy V1 areas unless explicitly requested.
- In Effect-heavy code, prefer current Effect v4 patterns, `Effect.gen(...)` for multi-step flows, thin transport handlers, explicit layer composition, and live tests over mocks.
- In Effect generators, bind services to named variables before calling methods instead of nesting service yields.
- In Drizzle schemas, prefer `snake_case` field names so column names do not need remapping strings.

## Architecture Invariants

Enforceable boundaries for this repo. For rationale and migration details see `docs/architecture-v4.md`. Before feature work, identify the owning layer: SDK/vendor protocol, adapter, workflow/runtime, projector, renderer, or storage.

- Decode unknown input at every trust boundary. Decode IPC outputs and device events before the renderer consumes them.
- Keep vendor protocol details below the Rig boundary, inside SDK/vendor protocol packages or thin adapters.
- Keep vendor-specific quirks, compatibility behavior, and telemetry normalization in the owning adapter; expose only the normalized domain contract above it.
- Callable Rig surfaces are the canonical capability source. Booleans only express semantics not structurally expressible there.
- Keep generic camera exposure distinct from vendor-native capture.
- Workflows orchestrate. Adapters translate and assemble. Projectors are pure UI normalization.
- The renderer consumes typed projections and actions, never vendor or transport state.
- Guard every async state commit with session identity/generation and operation identity.
- Coordinate connect/disconnect lifecycle. Disconnect terminally cancels and rejects queued work.
- Stop/park/disconnect recovery supersedes ordinary operations and must not wait behind them.
- Correlate aggregate state and active session atomically. Aggregate state is the app-facing truth.
- Treat storage/media as a subsystem: validated paths, bounded inputs, honest partial failure.
- Keep event and action vocabularies as closed typed unions or maps.

## Testing And Verification

- Verify from the narrowest relevant package or app directory, not from a monorepo root that intentionally blocks root tests.
- Use the project's standard typecheck command instead of calling `tsc` directly when local scripts define the contract.
- Prefer testing real behavior over duplicating implementation logic in tests.
- Avoid mocks unless they are the only realistic option.
- Make reusable fakes fail closed for unconfigured behavior and expose configured scenarios visibly; do not let a permissive default hide an untested path. A one-off test may use the smallest local fake that makes its scenario clear.
- Synchronize lifecycle and race tests with deterministic barriers, events, or controllable promises. Do not use fixed sleeps as proof that an asynchronous transition occurred.
- Prefer named fixture configuration to growing optional positional arguments when a fixture has several independently meaningful settings.
- For UI, CLI, or TUI changes, pair automated checks with a focused smoke test and capture screenshot evidence when the change is visible.

## Contribution Hygiene

- Keep branches, commits, and PRs focused and small.
- Use conventional commit style for commit messages and PR titles: `type(scope): summary`.
- Explain why a change works and how it was verified.
- Do not pad reviews, issues, or PR descriptions with long AI-generated filler.

## Agent Authoring Patterns

- Keep agent prompts short, narrow, and operational.
- Put stable metadata in YAML frontmatter.
- Give agents only the tools they need.
- Make ownership boundaries explicit: what the agent should do, what it must not do, and how it should report results.

## Subagent Contract

When implementing code using these standards:

- Read this file first and treat it as the style authority.
- Inspect nearby code before introducing a new pattern.
- Prefer the existing local style when it is compatible with this document.
- Make the smallest correct change that satisfies the task.
- Verify with the narrowest relevant command.
- If the local code clearly requires a pattern that conflicts with this document, stop and report the conflict instead of improvising.

## Few-Shot Examples

### Example: small refactor

Do this:

```ts
function resolveLabel(value: string | undefined) {
  if (!value) return "unknown"
  return value.trim()
}
```

Not this:

```ts
function normalize(value: string | undefined) {
  let result
  if (!value) {
    result = "unknown"
  } else {
    result = value.trim()
  }
  return result
}
```

### Example: helper extraction

Do this when the helper names a real concept:

```ts
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  return createThing(config)
}

function requireConfig(input: unknown) {
  // validation here
}
```

Do not extract a helper that is only a renamed one-line expression.

### Example: ordered business decision

Do this when status precedence affects behavior:

```ts
function decideWorkStatus(work: Work) {
  if (work.cancelledAt) return "cancelled"
  if (work.failedAt) return "failed"
  if (work.completedAt) return "completed"
  return "active"
}
```

Not this:

```ts
const status = work.cancelledAt ? "cancelled" : work.failedAt ? "failed" : work.completedAt ? "completed" : "active"
```

### Example: stable capability selector

Do this when eligibility is determined by a stable capability:

```ts
function canConfigureDarks(camera: Camera) {
  return Boolean(camera.startDarkExposure)
}
```

Not this when `captureMode` only describes current activity:

```ts
const canConfigureDarks = captureMode !== "capturing"
```

### Example: generated surfaces

If a task changes a generated API surface, edit the source definition and run the owning generate command. Do not patch generated files by hand.

### Example: verification

If only one package or app changed, run that package or app's local verification command first. Do not default to root-wide commands when a narrower check proves the change.
