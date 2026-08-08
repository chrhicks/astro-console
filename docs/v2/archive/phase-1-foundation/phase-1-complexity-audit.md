# Phase 1 Complexity Audit

Status: **complete — 2026-07-30**

## Purpose

Review Phase 1 for complexity that does not materially support a delivered
behavior, accepted product invariant, or observed operational boundary. The
goal is deletion and simplification, not a feature redesign.

## Review Rules

1. Start from current behavior and the evidence in the handoff.
2. Preserve accepted workspace semantics, service-owned truth, and direct
   authenticated artifact delivery.
3. Classify each concern as `keep`, `simplify`, `remove`, or `defer` with a
   concrete reason and focused verification.
4. Do not add infrastructure, new workers, UI controls, or security layers as
   part of the audit.

## First Pass

- `apps/server`: duplicate abstractions, unnecessary persistence,
  migrations, retries, configuration, and background lifecycles.
- Deployment: containers, profiles, mounts, and release steps that no longer
  correspond to a running role.
- Documentation: stale interim claims, repeated rationale, and active files
  that should be archived or reduced to their current authority.
- Tests: fixture complexity that no longer proves a behavior worth retaining.

## Recent Example

The artifact-delivery path already removed persisted download-grant replay,
reservation, audit, and rate-limit state. It now uses one admitted Asset-ID
lookup, one private signer call, and one 303 redirect; attachment behavior is
stored on the R2 object at publication.

## Outcome

The initial bounded simplification work is recorded in `88ef511` and
`9bf3abb`. The final branch-wide regression against `main` identified and
resolved the malformed Library asset path and opaque local-web shell in
`7eadf38`, then removed remaining whitespace noise in `c969352`.

The unrelated desktop commit `4308796` was fast-forwarded onto `main`, leaving
no desktop or SDK paths unique to `v2`. Phase 1 is closed; use the
[Phase 2 planning handoff](../plans/phase-2-implementation-plan-2026-08-04.md) for historical context.
