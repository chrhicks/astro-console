# Astro Console V2 Contracts

Status: **accepted Gate 5 executable contract candidate**

This standalone package converts the accepted V2 contract vocabulary into
Effect Schema candidates and deterministic fixtures. It has no dependency on
the legacy Electron application, transports, persistence, adapters, or UI.

## Current Coverage

- branded identities and non-negative aggregate-specific revisions;
- all 33 accepted command variants in one closed `Command` union, including
  named pause, resume, and stop interventions owned by Observe;
- a command envelope that obtains actor authority from service context rather
  than caller payload;
- nine stable `CommandFailure` families with closed reason vocabularies;
- a separate `OperationFailure` for work that fails after acceptance;
- one exhaustive policy entry for every command and a shared gate for
  authentication, membership, client capability, owner/controller authority,
  aggregate-specific freshness, and preclassified idempotent replay;
- complete Plan, Run, and Control snapshot candidates with independent health
  facts, typed action availability, and validated timestamp primitives;
- a bounded Library query/page/detail contract: reconnect snapshots carry only
  Library summary and selected assets, never an unbounded catalog;
- closed typed durable-event and projection-event unions, including one
  non-empty cross-domain projection batch applied under one cursor/version;
- deterministic event-cursor decisions: apply the next event, ignore a
  duplicate, or fetch a fresh snapshot on a gap;
- idempotency receipts bound to actor, command tag, and normalized-input hash,
  distinguishing fresh, pending, recorded, and conflicting requests; and
- deterministic Run, Control, Acquire, Process, Library, shell, and client
  transitions;
- atomic Run start, mutation, and intervention server proofs with durable
  result replay, concurrent revision exclusion, outbox separation, and
  authoritative projections;
- bounded Acquire recovery, correction verification, polar guidance, and
  explicit acceptance;
- linear Process preview/apply/undo/redo, stage-local retry, protected source
  switching, saving, discard, and measured host-pressure policy;
- stable Asset identity across LAN streaming, remote staging, grant eligibility,
  expiry, failure, and republication;
- authoritative Library projection/comparison and stable-ID handoff into the
  shared Processing authority; and
- a 43-scenario fixture catalog mapped to proportional proof evidence, with
  focused presentation-state tests for the two shell-only scenarios.

Run the candidate checks with:

```sh
npm run build
npm test
```

## Test Levels

The filename communicates what a passing test establishes:

| Pattern | Meaning |
| --- | --- |
| `*.test.ts` | Focused schema, pure decision, invariant, or regression test |
| `*.proof.test.ts` | Deterministic future-server simulation proving a consequential accepted scenario across service boundaries |
| `*.integration.test.ts` | Test using a real implementation boundary such as SQLite, filesystem, worker, CLI, or provider adapter |

A proof test must begin with an untrusted command or service transition and
assert the important accepted or rejected outcome across:

1. boundary decoding and trusted actor/context resolution;
2. current authorization and aggregate freshness;
3. idempotency reservation or replay;
4. the pure domain decision;
5. one atomic commit of aggregate state, durable events, command result, and
   outbox work;
6. authoritative projection after commit; and
7. negative evidence such as no work/event/state mutation after rejection.

When concurrency matters, the proof uses deterministic synchronization—not
sleeps—and exercises each legal transaction ordering. Worker completion is a
separate correlated transaction. External adapter behavior belongs in an
integration test.

Normalized command hashes are versioned semantic encodings. They include the
decoded fields that determine behavior, exclude transport identity such as
`commandId`, and change version when normalization semantics change. A
production implementation may digest those canonical bytes cryptographically;
it must not rely on caller JSON property order.

Proofs establish that outbox work is committed with authoritative state and is
not executed inside the acceptance transaction. Worker claim, acknowledgement,
lease expiry, crash recovery, and adapter-level idempotency require
`*.integration.test.ts` coverage against the chosen persistence and worker
implementation.

The existing `gate-05-scenario-catalog.test.ts` is intentionally a
catalog/regression suite. It is not renamed to `.proof.test.ts`; the domain
proof files establish the server composition while the catalog keeps the
accepted scenario-to-evidence map readable and exhaustive.

## Deliberate Boundary

This is a contract harness, not a production API package yet.

- Aggregate snapshots are API-facing projection candidates, not persistence
  rows.
- Idempotency storage, normalized-input hashing, and recorded-result retrieval
  belong to the service implementation; this package defines and tests their
  observable contract.
- HTTP route names, database layout, retention values, and adapter payloads
  remain intentionally undecided. The service implementation must provide
  snapshot-then-catch-up transport with durable cursor resume, bounded client
  backpressure, and snapshot fallback; real SQLite/outbox/filesystem/R2 and
  transport ordering proofs are integration work, not claims made by this
  deterministic harness.

At launch, every person admitted by the explicit observatory membership
allowlist may review and download every Library asset; there is no second
per-asset ACL. Owner-only actions such as republication and opening an asset in
Process remain governed separately by the shared command policy.

The Asset service returns `PublishedRepresentationEligible` after rechecking
the current representation and expiry. This is intentionally not a download
grant. The transport/storage adapter must authorize the current member and mint
the short-lived, scoped R2 grant at the delivery boundary; provider keys and
signed URLs never enter authoritative Asset state.

Gate 5 was reopened because several passing scenario fixtures proved only
schema shape or one part of a server workflow. The completed hardening and
regrade are recorded in the
[server-perspective audit](../../docs/v2/current/gate-05-server-audit.md).

The accepted product meaning remains in
[`docs/v2/current/gate-05-contract-vocabulary.md`](../../docs/v2/current/gate-05-contract-vocabulary.md).
The exhaustive action requirements remain in
[`docs/v2/current/gate-05-action-map.md`](../../docs/v2/current/gate-05-action-map.md).
