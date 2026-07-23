# Effect Guidance

This file supplements the `effect` skill with conventions that are binding for
this repository. It exists so production patterns remain visible during normal
implementation and review without relying on agent context.

## Tagged Data, Decisions, And Errors

Effect uses `_tag` as a valid discriminator. The problem is not the field; the
problem is scattering manual string comparisons throughout application code.

Choose the representation and handling style by role:

| Role | Model with | Handle with |
| --- | --- | --- |
| Internal pure decision or state | `Data.TaggedEnum` | exhaustive `$match` |
| Data crossing API, persistence, worker, or event boundaries | `Schema.TaggedUnion` | exhaustive `match`; use `cases` or `guards` for construction or narrow local checks |
| Expected failure in an Effect service error channel | `Schema.TaggedErrorClass` | `Effect.catchTag`, `Effect.catchTags`, or another typed Effect recovery operator |
| Public serialized failure response | `Schema.TaggedUnion` or other closed schema | map from internal typed errors at the transport boundary |

Prefer:

```ts
const next = RunDecision.$match(decision, {
  Accepted: ({ run }) => install(run),
  Rejected: ({ failure }) => explain(failure),
})
```

```ts
const response = program.pipe(
  Effect.catchTags({
    PlanNotReady: explainPlanProblem,
    ActiveRunConflict: showCurrentRun,
  }),
)
```

Avoid primary dispatch like:

```ts
if (decision._tag === "Accepted") {
  // ...
}
```

and do not hand-roll error classes that merely contain an `_tag` string.

## Why This Boundary Matters

- Exhaustive matching makes a newly added variant a compile-time obligation.
- Typed Effect recovery keeps the error channel visible in the operation type.
- `Schema.TaggedErrorClass` supports in-process class identity while remaining
  schema-aware.
- `instanceof` is acceptable for a genuinely class-specific local operation,
  but it is not the general recovery strategy: class identity does not survive
  JSON, storage, worker, or network boundaries.
- A serialized command failure is data, not a thrown exception. Decode and
  match it as a boundary union.

Direct `_tag` access is limited to small, local type narrowing where exhaustive
dispatch would add no clarity, and to assertions that inspect a tagged value in
tests. It must not be the default for routing commands, deciding workflows, or
recovering service errors.

A total metadata lookup is a deliberate exception when it is compile-time
exhaustive, contains no behavior, and is checked with `satisfies Record<Tag,
Metadata>`. For example, selecting a static authorization policy with
`commandPolicies[command._tag]` is acceptable. Adding a union variant must make
the metadata declaration fail to compile until its entry is supplied.

## Service Boundary Pattern

Transport handlers stay thin:

1. decode unknown input with Schema;
2. obtain identity and authority from trusted server context;
3. call one Effect service operation;
4. recover expected typed errors with `catchTag` or `catchTags`;
5. map the result or error into the public response schema.

Pure domain decision functions may return `Data.TaggedEnum` values. The service
that owns the operation exhaustively matches that decision and either persists
the accepted transition or fails with a `Schema.TaggedErrorClass`. Domain data
must not depend on HTTP status codes, database errors, or adapter-specific
exceptions.
