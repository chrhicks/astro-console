# Phase 1 Local Web Foundation Handoff

Status: **active Phase 1 continuation packet**

## Single Next Action

Build the Local Web Foundation: a rig-local service and local web client that
preserve authoritative run state across browser reconnects. Start with one
narrow observable vertical slice; application implementation does not yet
exist.

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
