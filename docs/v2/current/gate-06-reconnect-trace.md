# Gate 6 Reconnect-Trace Result

Status: **complete July 23, 2026**

This bounded spike exercised a deterministic in-browser model of streamed
projection state and Process preview reconnect. It is not a WebSocket,
transport, persistence, worker, or timing implementation.

## Decision

- Reconnect atomically installs an authoritative snapshot before accepting
  incremental events.
- Cursor gaps, snapshot-version regressions, and events received while the
  client is not current require a fresh snapshot and mutate no projection.
- A client sends no stale intent and holds no pending replay queue.
- Complete accepted preview state is service-owned and resumes separately from
  applied history. A local input still inside the preview debounce may be lost.

## Trace Results

Every individual trace passed at 1600×1000 and 1000×900. `Run all` passed
13/13 assertions. Both desktop runs had no overflow, console errors, or page
errors.

| Trace | Deterministic result |
| --- | --- |
| Snapshot first | Stale S10/C40 atomically installed fresh S12/C52; C53 then applied, ending at S12/C53 with `preview-s12`, sequence 6, computing 79%. |
| Cursor discipline | Ended reconnecting at S10/C41; duplicate ignored and next applied, while gap, regression, and non-current events required a snapshot with no later mutation. |
| No replay | Pause, Apply, and SyncPreview were all `DoNotSend`; sends and pending queue stayed 0. |
| Debounce loss | Reconnect restored service-accepted `stretch 0.57` and history 2; unsent local `stretch 0.73` was lost. |
| Accepted preview | Restored `preview-6`, sequence 6, computing 62%, full parameters, base history 2, history 2, and `last-valid-image-5`. |
| Supersession | Old and duplicate completions rejected; current completion accepted, then history 3 invalidated the old-base preview. |
| Phone | The same canonical truth projected read-only with no Process mutations. |

At 390×844, the desktop surface and trace controls were hidden. The summary
was visible with `data-phone-controls="none"`, zero visible buttons, current
`preview-6`, and history 2; there was no overflow, console error, or page
error.

## Method And Limits

The [Gate 6 reconnect harness](../../../prototype/v2-ui/archive/gate-06/gate-06-reconnect-trace.html)
runs fixed, synchronous trace inputs. It exposes semantic connection and
Process state alongside secondary snapshot/cursor/sequence/send diagnostics;
browser automation checks the corresponding stable data attributes.

These results do not establish actual WebSocket behavior, transport ordering or
latency, persistence, worker completion, server transaction behavior, real
preview computation, or reconnect timing. They only bound the client projection
and preview semantics that later implementation must preserve.
