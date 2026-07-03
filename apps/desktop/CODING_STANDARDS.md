# Desktop Coding Standards

This app extends the repo-root `CODING_STANDARDS.md`. Treat that file as the base authority; the rules below are desktop-specific additions.

## Parsing Unknown External Data In Effect-Based Code

- When Effect-based code receives `unknown` data that needs structural validation, parse it with `Effect.Schema` (`Schema` exported from `effect`) instead of ad-hoc type guards or unchecked casts.
- Define a `Schema.Struct` for the expected shape and decode with `Schema.decodeUnknownEither` (or the `Effect`-returning `decodeUnknown` when decoding belongs in a generator).
- Handle the `Left`/failure branch explicitly. Do not let parse errors escape as unchecked runtime values, and do not cast the input to a typed shape without decoding it first.
- This applies to data crossing trust boundaries: device payloads, session state, IPC input, persisted JSON. It does not require wrapping values that are already statically typed and produced by code in the same package.
