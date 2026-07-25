# Phase 1 Local Web Foundation Handoff

Status: **active Phase 1 continuation packet**

## Single Next Action

Continue the production-operations boundary from the live protected fixture:
recurring backup/restore operations, health monitoring, device/session
authority, and truthful revocation behavior. Preserve the
accepted read-only workspace projections and do not fold deferred Process
mutations, device/session identity, or worker recovery semantics into a
deployment shortcut.

The first operational foundation is complete in the local-web fixture: numbered
SQLite migrations preserve legacy local state, and liveness, admitted readiness,
and owner-only operational health distinguish service/database truth from
unknown rig and tunnel state. The Compose starter is non-activating, but a
live protected fixture is now active; see [the activation ledger](activation-ledger.md)
for the actual boundary and remaining gaps. Recurring backup/restore, health
monitoring, storage monitoring, R2 integration, and real rig work remain
required.

The repository now packages a reproducible Node image build, fail-closed
non-secret runtime configuration, and SQLite `VACUUM INTO` backup/integrity
preflight. The prerequisites have now been activated for the public fixture:
the target host runs the packaged image behind Access and Tunnel admission,
and one online backup/restore drill has passed. This does not establish a
scheduled backup service, a physical rig adapter, or R2 publishing.

Production admission is now wired into executable startup rather than the
development fixture: an external bind requires verified Cloudflare Access
issuer/audience/HTTPS JWKS endpoint, a host-managed membership bootstrap, and a
server-configured client context. Every verified request is rechecked against
the current normalized bootstrap policy, so removing an email revokes origin
admission even if its subject was previously persisted. Durable `owner` and
`viewer` roles own authorization; owner phone contexts remain read-only. The
approved initial policy is a 24-hour, deny-by-default
`observatory.chicks.dev` Access application using email one-time PIN; actual
email membership is host-managed and provisioned for the approved initial
group. Do not record those addresses in this document.

Cloudflare activation is complete for the fixture: the approved named-identity
email-OTP policy, tunnel route, and origin Access-JWT admission were verified
end-to-end. See the activation ledger for the precise live boundary and
remaining operational gaps.

The Arch-host preflight has now confirmed explicit live Alpaca endpoints for
both rigs: ASI Mount plus Sony Mirrorless Camera at `192.168.4.104:11111`, and
the Seestar S30 Camera/Focuser/FilterWheel/Telescope/Switch bridge at
`192.168.4.63:32323`. UDP discovery did not respond, so initial production
configuration should use those endpoints and verify their configured-device
inventory again at activation.

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
development only. Production admission requires an RS256 assertion `kid` and
uses a bounded HTTPS JWKS/certificate cache; unknown keys force one refresh
and malformed, unavailable, or expired key material fails closed. Cloudflare
Tunnel deployment, live Access rotation validation, revocation, and production
LAN binding remain later operations work.
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

Workspace coverage now has persisted, admitted read-only Plan and Process
projections alongside the bounded Library query/detail route. Plan exposes the
viable M27 future intent, window, clearance, ordered sequence, and existing
revision/lease-guarded `Run plan`; Library opens a stable asset ID into a
linear Process session with synchronized preview, checkpoint, and protection
context. Apply, Save, retry, discard, source switching, Process workers, and
their production mutation/recovery semantics remain deferred.

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
