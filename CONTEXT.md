# Astro Console

Astro Console models durable observatory work and the evidence that explains it.

## Language

**Processing Project**:
The only active, durable, target-owned Process lifecycle. It holds selected Library evidence, explicit processing stages, retained attempts, and unsaved working results.
_Avoid_: Processing Session

**Library Asset**:
A durable original or explicitly saved derived result with stable identity and lineage. A Processing Project references source Assets, while saved Project results become Library Assets.
_Avoid_: File, output

**Processing Attempt**:
One explicit execution whose frozen inputs and queued state are durably recorded when Run is accepted. Its execution state may advance until settlement; after settlement, its inputs, outcome, evidence, and lineage never change, and every retry or rerun creates another attempt.
_Avoid_: Mutable run, overwritten result

**Current Result**:
The successful result at the active position in one executable stage's linear result history, advanced by Run and moved by Undo or Redo; a failed attempt never replaces it.
Its currency is derived from exact upstream lineage; branch replacement removes redo results from the product history without deleting their Processing Attempt evidence.
_Avoid_: Top of the stack, selected result

**Process Authority**:
Permission for an owner on a mutation-capable desktop to change a current Processing Project. It is guarded by Project revision and is independent of the observatory Control Lease.
_Avoid_: Shared rig control, controller requirement

**Project Intent**:
One explicit, revision-bound request to change a named Processing Project. An intent has a stable identity for durable acceptance, but the client reloads current Project truth instead of automatically replaying it after a stale revision or uncertain outcome.
_Avoid_: Generic command, automatic retry

**Processing Project Lifecycle**:
The single Process module that owns Project intake, Process Authority, revisions, durable drafts, Processing Attempt acceptance and settlement, Current Result history, exact-lineage currency, evidence, and saving results to Library.
Its caller interface exposes Project summaries, explicit Project detail, secondary evidence, closed Project Intents, and change notices while it hides work claims, processor execution, storage rows, and settlement mechanics.
_Avoid_: Processing Session lifecycle, public worker API
