# Phase 1 Local Web Foundation Handoff

Status: **active Phase 1 continuation packet**

## Single Next Action

Complete workspace coverage behind the persistent activity shell: replace the
remaining fixture-only Plan, Library, and Process surfaces with bounded,
service-owned routes and projections. Preserve the accepted Observe behavior,
snapshot-first reconnect, and no-browser-replay rule; this is not an excuse to
reopen identity, rig, or production-operations scope.

The first narrow implementation slice now exists at `apps/v2-local-web`: a
Node 22 rig-local Plan-to-Observe M27 fixture with SQLite WAL, one canonical
writer, decoded run acceptance, durable event/receipt/outbox records, and
snapshot-first SSE. Its integration proof covers atomic acceptance, replay,
trusted read-only identity, rejection no-ops, and cursor delivery.

It deliberately does not yet provide a rig adapter or outbox worker, managed
identity, migrations, lease transfer/recovery, bounded Library/Process routes,
or a production deployment. The executable `v2-contracts` package and the
reconciled infrastructure plan remain the broader implementation contract.

The shared-control-shell slice extends that fixture with two server-configured
desktop identities over one SQLite database, durable control-request/grant/
takeover/reconnect-grace evidence, and a persistent workspace shell. Its
focused proof confirms that an old controller loses guarded authority without
stopping the accepted M27 run or adding adapter work.

The bounded-Library slice adds a persisted deterministic asset fixture, a
server-owned query boundary capped at 100 results with cursor, role, and
allowed-sort validation, stable-ID detail delivery, and a fixed-window Library
viewport. Snapshot and SSE projections remain catalog-summary-free. Its proof
covers pagination, filtering, sort rejection, detail rejection, lineage and
availability delivery, and no raw storage identifiers.

The Observe evidence-and-decision slice adds persisted latest-frame quality,
desired/solved geometry, uncertainty, and bounded correction trace to the
authoritative snapshot. It keeps evidence visible in automatic or exhausted
fixture state and states the service-owned bound, protection, and action
eligibility without issuing adapter work.

The decoded observation-input slice adds a fail-closed adapter boundary for a
latest solved frame and proves its local projection decodes as the exported V2
`AcquireSnapshot` contract. The local test runner uses the contracts package's
`tsx` runtime loader because that package's source imports `.js` specifiers
from TypeScript sources; this is a test-runtime adjustment, not a new app
dependency.

The read-only Seestar Stack push slice uses the built SDK decoder for genuine
Stack events only. It projects timestamped frame count and source availability
without polling, connection setup, host configuration, or device commands;
failed Stack events preserve solved evidence and never claim the accepted run
stopped.

The PauseRun, ResumeRun, and StopRun slice accepts an owner-held,
revision-guarded transition atomically. Pause and resume preserve their
resumable phase through `StopStack` and `ResumeStack`; terminal stop enters
`stopped`, records `RunStopped`, and queues distinct `StopRun` work. Explicit
adapter workers make all physical dispatch visible as pending, complete,
unavailable, or failed without undoing accepted service truth. Observe states
the irreversible Stop consequence before action and never offers Resume after
the run is terminal.

The local worker coordination slice persists each outbox claim token, worker
identity, lease expiry, attempt count, acknowledgement, and retryable failure
in SQLite. It guarantees one live claim and token-matched durable
acknowledgement; expired or failed work recovers after restart. Provider calls
remain outside acceptance transactions, so physical delivery is at-least-once
across lease expiry until a provider-native idempotency contract exists.

The admission slice now requires every local-web snapshot, stream, query, and
command to receive a server-resolved identity. Its Cloudflare Access adapter
verifies an RS256 assertion's signature, issuer, audience, and expiry, then
maps only a verified subject to durable SQLite owner/viewer membership. Desktop
owner and phone/viewer capability derive from that mapping; request bodies and
headers cannot choose a role. The explicit local-fixture admission remains for
development only. Cloudflare Tunnel deployment, Access key rotation/JWKS
discovery, revocation, and production LAN binding remain later operations work.
The local proof derives one client identity per verified subject; production
device/session identity must precede treating a person's multiple browsers as
distinct presence clients.

The reconnect and lease-recovery slice now makes browser loss explicit: the
browser shows last-confirmed stale state with mutations disabled, and resumes
only from a fresh SSE snapshot without replaying commands. Reconnect grace is
durable; after expiry or a service restart it releases the lease to no
controller, records `ControlGraceExpired`, and preserves accepted work. Only
the current holder can report its disconnect or reconnect. Device/session
identity remains unresolved for production presence, while migrations,
deployment, health, and operational hardening remain production-operations
work. The 600px phone monitoring-only shell is presentation enforcement over
the server-resolved capability model, not a substitute for that deferred
device/session identity.

## Read First

1. [V2 Start Here](../README.md).
2. [Product specification](product-spec.md).
3. [Visual style guide](visual-style-guide.md), [UI component library](ui-component-library.md), and [UI build contract](ui-build-contract.md).
4. [Gate 5 baseline](gate-05-scenarios.md), [action map](gate-05-action-map.md), and [contract vocabulary](gate-05-contract-vocabulary.md).

## Phase 1 Constraints

- Service truth owns runs, authority, freshness, and reconnect state; browser
  state is a replaceable projection.
- Reconnect is snapshot-first. Do not replay buffered browser commands.
- Catalog uses a bounded server query/pagination boundary and a virtualized
  viewport; see [catalog-scale result](gate-06-catalog-scale.md).
- Phone is monitoring-only in the initial release.
- Extend the accepted visual authorities only for a real product need, not
  implementation convenience or visual taste.

## Targeted Historical Evidence

Use only when the slice crosses that boundary: accepted Gate 1–4 records in
`docs/v2/gates/`, completed [Gate 7 walkthrough](../archive/phase-1-foundation/gate-07-walkthrough.md), completed [convergence plan](../archive/phase-1-foundation/convergence-plan.md), and completed [solve-geometry result](../archive/phase-1-foundation/gate-06-solve-geometry.md).
