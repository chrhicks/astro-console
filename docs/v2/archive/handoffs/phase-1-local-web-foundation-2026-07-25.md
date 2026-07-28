# Phase 1 Local Web Foundation Handoff — 2026-07-25

> Archived historical handoff. Use
> [the current handoff](../../current/handoff.md) for active work.

Status: **superseded implementation narrative**

This record preserves the detailed continuation packet that preceded the
separate Solar intent, native worker adapter, explicit stop path, and
profile-gated Compose worker. Its claims about a missing worker/adapter,
temporary Tailscale host-route workaround, 39-test suite, and the old
`StartM27Capture` implementation sequence are historical and must not be used
as current deployment authority.

## Historical Position

- The public fixture was live behind Access/Tunnel and `Run plan` was
  fixture-only.
- The first worker proposal was a disabled-by-default separate process that
  would claim generic M27 work, then later gain a Seestar adapter and host
  deployment wiring.
- The Seestar was reported outside with its Solar filter fitted, arm open at
  horizon, and a prior read-only/previews-only smoke test. Those observations
  were snapshots, not a standing preflight.
- The earlier network note warned that a Tailscale host route could override
  the local Eero route. That workaround is superseded by the direct local-LAN
  route described in the current handoff.

## Historical Deferred Work

The packet deferred a named Solar intent, provider acknowledgement versus Stack
evidence, ambiguous-start manual recovery, a distinct Solar stop, host worker
profile, and the supervised daytime run. Those items are now owned by the
current handoff and must be evaluated from current deployment evidence.

## Preserved Foundation Context

The fixture foundation already included SQLite WAL, numbered migrations,
snapshot-first SSE, durable owner/viewer admission, bounded Library delivery,
control/reconnect evidence, and fixture-only M27 Plan/Observe/Process
projections. It did not authorize a browser action to control a physical rig.

The accepted product/gate material remains under `docs/v2/current/` and
`docs/v2/gates/`; this archive only explains the prior operational transition.
