# Phase 3 Implementation Planning

Status: **one ordered Epic; only its preflight child has owner authorization**

This is the execution plan for Phase 3 in the durable
[V2 delivery plan](delivery-plan.md). It turns the six Phase 3 outcomes into
one dependent Epic, rather than treating them as unrelated slices.

## Objective

Deliver an operator-visible Observe, Acquire, and Capture workflow whose
decisions use current rig and image evidence. A driver acknowledgement is never
physical success. Solar is not a product capability and is excluded.

## Epic And Delivery Order

Continuum Epic `tkt-2xpkp65f` — **Phase 3: Observe, Acquire, and Capture** —
owns the complete phase. Each child has its own implementation detail,
acceptance gate, and proof. A child starts only after its blockers are complete;
the owner must explicitly authorize it before implementation. The existing
preflight child is the one exception: it is already authorized and partly
implemented.

| Order | Child task | Delivery responsibility | Depends on |
| --- | --- | --- | --- |
| 1 | `tkt-2e396ziz` — Complete real read-only preflight adapter | Read and decode rig, plan, and safety facts into a timestamped `PreflightSnapshot`. Normal runtime remains `unavailable` until a provider is proven read-only. | — |
| 2 | `tkt-ue2yl172` — Guide polar alignment from solved frames | Capture/solve a polar measurement, show manual Alt/Az overlay guidance, and require explicit acceptance of current in-tolerance evidence. | 1 |
| 3 | `tkt-gj8btl1l` — Acquire targets with deep-sky and lunar paths | Use plate solve for deep-sky slew/center and a separate disk/limb path for lunar acquisition. | 1, 2 |
| 4 | `tkt-gwl6lc30` — Verify pointing corrections from successive images | Persist the correction proposal and bound; verify the physical result from a new solved image. | 3 |
| 5 | `tkt-dqmkymd7` — Project live frame evidence and quality | Project frame identity, quality, drift, target-in-frame, and storage facts during Capture. Full Library review stays in Phase 4. | 4 |
| 6 | `tkt-0g6q3wl7` — Run managed capture with visible progress and actions | Run approved sequences with progress, stop conditions, storage reserve, and server-owned actions. | 5 |
| 7 | `tkt-1ozfsam5` — Add bounded Acquire recovery and rollback | Keep failure, remaining budget, recovery choice, rollback/reconciliation, and abort visible. | 4, 5, 6 |
| 8 | `tkt-wnhdp696` — Prove Phase 3 exit criteria end to end | Verify every outcome and responsive projection through deterministic adapters and the configured provider boundary. | 1–7 |

## Child Implementation Rules

All device-facing children use the accepted capability, control-lease, run
revision, acquire revision, idempotency, SQLite, HTTP, and SSE seams. The
server owns policy and transitions; the browser renders the current projection.
Phone remains read-only.

1. **Preflight.** The existing typed boundary, SQLite/HTTP/SSE persistence,
   unavailable behavior, and Observe panel are complete with a deterministic
   provider. The remaining work is a real provider adapter that can prove it
   performs reads only. Existing SDK connection and authentication calls cannot
   be used until this is true. It must produce `ready`, `blocked`,
   `unavailable`, or `unknown` facts without device commands, capture, outbox
   work, or Solar behavior.
2. **Polar.** Implement accepted `ACQ-06` and `ACQ-07`:
   `CapturePolarAlignmentMeasurement` and `AcceptPolarAlignmentEvidence`.
   The operator makes the physical adjustment. The service records a solved
   measurement and overlays estimated axis, true pole, vector, tolerance,
   timestamp, image identity, and Alt/Az guidance. It never sends a motor
   command for manual alignment.
3. **Target acquisition.** Keep deep-sky plate-solve correction distinct from
   the lunar disk/limb method. Both record provider acknowledgement as
   provisional and await image evidence. Unsupported capability, unsafe rig
   state, cancellation, and abort have typed results.
4. **Correction verification.** Implement accepted `ACQ-01`, `ACQ-04`, and
   `ACQ-05`. Automatic corrections are only inside policy bounds; larger
   corrections require an exact approval/proposal. A subsequent solved image,
   not a mount acknowledgement, completes centering.
5. **Live frame evidence.** Decode and persist only bounded capture facts:
   current frame, acceptance/rejection counts, target framing, drift,
   clipping/exposure, focus/shape when available, and storage forecast. Facts
   may be unavailable or unknown. Asset catalog and review workflows remain
   Phase 4 work.
6. **Managed capture.** Project exposure/stack, elapsed/remaining time,
   stop condition, resource protection, quality state, and current allowed
   actions. Pause, stop, and recenter stay guarded server intents. No browser
   retry or inferred capture success is allowed.
7. **Recovery and rollback.** Implement accepted `ACQ-02` through `ACQ-04`:
   bounded identical retries, one materially changed recovery series, explicit
   skip/abort, and reconciliation after rejected or unverified work. Recovery
   preserves the prior verified state and does not become an unbounded loop.
8. **Exit proof.** Prove both target paths, polar acceptance, image-verified
   correction, live capture quality/storage/drift, recovery, restart and
   reconnect, and owner/viewer/phone projections. Run the Designer review at
   wide, compact, and 390 px. Real-rig/provider evidence remains separately
   stated; deterministic proof does not imply physical capture.

## Phase Exit Criteria

Phase 3 completes only when the Epic proves all four delivery-plan criteria:

1. Acquire exposes correction, evidence, remaining bound, and abort path.
2. Driver acknowledgement stays provisional until image evidence confirms it.
3. Capture says whether useful evidence is accumulating.
4. Recovery remains visible across Observe and responsive layouts.
