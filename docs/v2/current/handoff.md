# Phase 1 Local Web Foundation Handoff

Status: **active supervised Solar-run packet — 2026-07-27**

## Single Next Action

Perform one short, physically supervised daytime Solar observation using the
already deployed rig worker on `chicks-arch`. The public fixture's `Run plan`
remains fixture-only and must never be represented as hardware control.

The historical foundation narrative is preserved as
[the July 25 local-web handoff](../archive/handoffs/phase-1-local-web-foundation-2026-07-25.md).
It is evidence, not current operational authority.

## Current Operational Boundary

- `astro-console-origin` is verified running the pinned
  `astro-console-v2-local-web:c9afc65-solar` image, healthy on loopback. Its
  visible release label remains stale; that label alone is not a reason to
  restart a healthy origin.
- `astro-console-rig-worker` is verified running with `unless-stopped`, a
  read-only root filesystem, no host port, the canonical state volume, and a
  read-only host-managed PEM mount. It is in `seestar` mode for native host
  `192.168.4.63`.
- The deployed worker claims only `StartSolarTestObservation` and
  `StopSolarTestObservation` work. It never claims `StartM27Capture`.
- The Solar adapter uses the native SDK endpoint `192.168.4.63:4700` with a
  host-managed PEM. The Alpaca bridge at `192.168.4.63:32323` is preflight
  evidence only for this slice; the worker does not issue Alpaca commands.
- `chicks-arch` is reachable directly on the local Eero LAN by SSH at
  `192.168.7.235`. Use that direct LAN path for host deployment and rig-local
  checks. Tailscale is not the route authority for the Seestar on this network.
- The Seestar's last recorded physical/preflight condition is historical:
  solar filter fitted, arm opened at the horizon, firmware 7.32, battery 97%,
  roughly 36 GB free, and an elevated 59°C without an over-temperature state.
  Re-establish every one of those facts immediately before the run; do not
  treat them as current telemetry.

## Implemented Solar Contract

1. A named, owner-resolved CLI intent is accepted into canonical SQLite only
   with explicit confirmation. It creates separate Solar intent, evidence, and
   `StartSolarTestObservation` outbox records.
2. The worker connects/authenticates with the configured host and PEM, performs
   a read-only SDK preflight, starts the `sun` view, then requests a bounded
   Stack stage.
3. Provider acknowledgement is durable but is not capture-active evidence.
   Only a decoded native `Stack` push can move the Solar intent to
   `stackObserved`.
4. An ambiguous start error or expired worker claim becomes durable
   `manualRecovery`/`uncertain` evidence. It is never automatically retried;
   the operator must inspect the physical rig before another intent.
5. The separate owner-resolved stop intent cancels an undispatched start or
   queues `StopSolarTestObservation`. The real adapter stops Stack and then the
   Solar view. Stop acknowledgement is not proof of the device's final state.

## Supervised Daytime Runbook

1. At the telescope, physically confirm the fitted Solar filter, direct
   supervision, clear surroundings, device power/battery, storage, and a safe
   device temperature. Do not run if any preflight warning or physical fact is
   unresolved.
2. From `chicks-arch` over direct LAN SSH, confirm the running origin and
   worker container state, worker heartbeat, `adapter=ready`, canonical volume,
   read-only PEM mount, and native host configuration. Do not restart the
   healthy origin merely to change its stale visible release label.
3. Confirm no Solar intent is pending and the worker has not recorded an
   uncertainty/manual-recovery state before submitting an intent. There is no
   host port for the worker.
4. Use the owner-resolved `solar-test` CLI with its explicit confirmation to
   submit one unique named intent. Record the returned intent ID. Do not use
   browser `Run plan`.
5. Observe the durable sequence in SQLite/owner operational evidence:
   pending claim, provider acknowledgement, then an actual decoded `Stack`
   event. Do not call the observation active merely because the provider
   acknowledged a request.
6. Issue the distinct CLI stop for that intent while still supervising the
   telescope. Confirm durable stop work, Stack-stop then view-stop provider
   acknowledgement, and the final read-only device/view check.
7. Restart the worker only after the stop/reconciliation evidence is durable.
   Confirm it neither replays a completed Solar start nor touches M27 fixture
   work. If any start is `uncertain` or `manualRecovery`, do not retry it;
   inspect the physical device, reconcile its view/Stack state, and record the
   manual decision first.

## Genuine Unknowns

- No Solar intent has been submitted through the deployed worker, and no
  physical device command has been issued by this slice.
- A real Solar provider acknowledgement, Stack push, stop result, and
  restart-recovery trace remain unproven on the device.
- Device/session identity remains unresolved for production browser presence.
- Off-host backup replication, storage monitoring, R2 publishing, and the
  broader production rig deployment remain unfinished.

## Authority And Product Constraints

- Cloudflare Access verified identity plus durable service role remains the
  intended control boundary. Do not add device enrollment, WARP posture,
  certificates, or fingerprint authority.
- Service truth owns runs, authority, freshness, and reconnect state; browser
  state is replaceable and reconnect is snapshot-first.
- Phone is monitoring-only presentation in the initial release. That does not
  replace server authorization.
- Extend accepted visual authority only for a real product need. This runbook
  does not reopen accepted interaction models.

## Read First

1. [V2 Start Here](../README.md).
2. [Activation ledger](activation-ledger.md).
3. [Operations and reliability](../infra/operations.md).
4. [Product specification](product-spec.md) only when the run crosses a
   product-contract question.
