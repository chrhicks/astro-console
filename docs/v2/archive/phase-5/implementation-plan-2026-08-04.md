# Phase 5 Planning — Process Workspace

Status: **complete with deterministic local proof — 2026-08-04**

## Operator Outcome

From a saved Library source, the operator opens or resumes a durable Process
session, builds a linear master, develops it through preview and explicit
Apply, then saves selected results or discards only unsaved work. The image
stays visible while decisions are made. The rig remains independent.

## Ownership And Boundaries

The server owns `ProcessingSession`, revisions, sources, operations, attempts,
checkpoints, previews, provenance, and saved outputs. The browser is a
snapshot-first projection and intent source. Preview is synchronized work;
Apply creates the explicit linear history. Library owns sources and saved
artifacts; Process owns only its resumable work.

The first implementation uses deterministic compatible adapters. Exact Siril,
RCAstro, or other external tool invocation remains a later adapter decision,
not a claim of real processing quality. Active capture is not a pause signal;
only measured host pressure may throttle processing, and the UI must name it.

## Delivery Graph

Continuum Epic: `tkt-wpkbh9tz`.

1. `tkt-gtlgot1c` — open, resume, and safely switch a durable session from
   Library sources.
2. `tkt-9j4dq4ul` — build a linear master with durable checkpoint and
   provenance.
3. `tkt-t7fetgrw` — develop through preview, explicit Apply, and one linear
   undo/redo history.
4. `tkt-0q8e8rry` — recover, switch, save selected artifacts, or discard
   unsaved Process work safely.
5. `tkt-qdofyegh` — prove the end-to-end Process exit criteria.

Each child begins only after its predecessor. UI work needs functional proof
and a separate Designer review at wide, compact, and 390 px. Phone remains
read-only.

## Closeout

Phase 5 is complete through Continuum Epic `tkt-wpkbh9tz`. The local Process
workspace persists server-owned sessions in SQLite and provides Library entry,
deterministic Build, preview and explicit Apply, linear undo/redo, failed-stage
retry, selected Library save, switch, discard, and restart recovery. Proof is
contracts **186/186**, server **80/80**, web **63/63**, and production builds.
The focused HTTP/SQLite proof covers Build, deterministic failure, Retry, and
restart resume. This proves deterministic compatible adapters and local browser
behavior only; it does not prove external processing tools, provider or rig
communication, or physical image quality.

## Focused Proof

```text
Library source -> durable session -> Build master -> Preview -> Apply/history
-> retry or switch -> Save selected artifacts or Discard -> restart/reconnect
```

The proof covers deterministic service, SQLite, HTTP/SSE, and browser behavior.
It does not prove a real external processing tool, live-rig capture, provider
communication, or physical image quality.
