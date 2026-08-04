# Phase 3 Implementation Planning

Status: **authorized V2.0 first slice — provider-boundary and projection proof implemented; real provider adapter remains pending**

This document prepares Phase 3 in the durable [V2 delivery plan](delivery-plan.md).
Production Convergence is complete. The owner has accepted the first read-only
slice. It authorizes provider reads only; device commands, Solar work, and
capture remain out of scope.

## Objective

Deliver an operator-visible Acquire workflow whose decisions are backed by
current rig evidence. A command acknowledgement is never presented as physical
success; subsequent image evidence remains the proof of pointing and capture.

## First Slice: Read-Only Decision-Grade Preflight

Status: **authorized — provider-boundary and projection proof implemented**

### Entry Gate

Preparation is complete and the owner has accepted this exact read-only slice.
The authorization permits only the configured provider read,
typed `PreflightSnapshot` projection, SQLite/HTTP/SSE proof, and the bounded
Observe presentation described below. It does not authorize a provider write,
device command, capture, Solar capability, or a later Phase 3 slice.

Continuum task `tkt-2e396ziz` tracks this entry slice. Owner acceptance,
contract, SQLite/HTTP/SSE projection, unavailable behavior, and Observe
presentation are implemented and verified with a deterministic read-only
provider. A real configured adapter remains pending.

Implementation starts from one current fake `ActiveRun` at `preflight` and a
typed read-only provider boundary. In normal runtime no provider is configured,
so it returns `unavailable`, never a safe verdict. Existing SDK connection and
authentication paths are not proven read-only, so a real configured adapter is
deliberately deferred to a separate accepted implementation step.

The first slice should make a current accepted fake `ActiveRun` legible at
`preflight` through a service-owned, timestamped checklist. It reads provider
facts only; it sends no mount, camera, focuser, filter, or capture command.

### Scenario And Owner

Given an admitted desktop and a persisted accepted fake run at
`preflight`, the service refreshes and projects the current state of rig
connectivity, ownership, mount/camera availability, observer time/location,
target horizon facts, storage forecast, required focuser/filter capability,
plan validity, and an explicit safe-state verdict. Each check is `ready`,
`blocked`, `unavailable`, or `unknown`, with an observed-at time and an
operator-readable reason.

`ActiveRun` owns the preflight lifecycle and its run revision. A new embedded
`PreflightSnapshot` owns the checklist source facts, freshness, aggregate
verdict, and available next action. The browser renders that projection and may
request a fresh read-only evaluation; it does not combine facts into a verdict
or decide that unknown state is safe.

### Contract And Verification

The packet must define one admitted read-only refresh intent and a typed
projection result. It carries no lease or idempotency guard because it neither
accepts a durable mutation nor sends hardware work. It rejects an unavailable
service/provider, unsupported required capability, and malformed input. A fresh
response replaces the browser projection through the existing snapshot/SSE
path.

The implemented proof covers a deterministic configured provider boundary,
SQLite/HTTP/SSE persistence across restart, a blocked case, source timestamps,
and no outbox row. Missing provider returns `unavailable`; it never fabricates
a safe result. The still-pending real adapter must prove ready, blocked, and
unknown provider cases with no device command, capture evidence, or Solar
activity.

The Observe desktop surface leads with the next blocker and its evidence, not
a telemetry grid. Compact desktop retains the verdict and action. Phone remains
read-only. Any UI change requires wide, compact, and 390 px Designer validation.

### Deferred Remainder

This slice does not start a real run or command the rig. Polar alignment,
slew/solve/center, corrections, focus/filter preparation, capture, live frame
quality, recovery, physical stop/park, and Solar work remain later Phase 3
slices. Provider acknowledgement and image evidence are separate from this
read-only preflight proof.
