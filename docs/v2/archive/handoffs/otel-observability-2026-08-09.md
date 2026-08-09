# OTEL Observability Delivery Record

Status: **historical and non-authoritative**

This record preserves the implementation and deployment chronology that was
removed from the current handoff during the August 9 reconciliation. Use the
current handoff and infrastructure runbook for active operation.

## Delivery chronology

The first deployed slice exported selected production-origin traces to the
host-local SigNoz collector over OTLP/HTTP protobuf. Image
`astro-console-origin:otel-20260808-1` stayed healthy after a local-owner
`GET /api/library`. SigNoz stored trace
`eedc7a4479b237022e778a63b69132a5` with the server root
`HTTP GET /api/library` and its Library page child.

Local follow-on slices added:

- complete Alpaca provider operation spans with nested raw-fetch spans for
  preflight reads, camera reads and commands, and ImageBytes transfer;
- intentional Plan, Observe, Library, and Process business-flow spans;
- executor and recovery, projection snapshot and bounded SSE setup, frame
  intake and inspection, plate solving, publisher stages, startup, and
  admission signals;
- structured `astro.operation` logs and the `astro.operation.count` metric;
- named SQLite operation spans, duration and count metrics, and bounded
  executor and publisher backlog observations; and
- Node.js event-loop utilization and delay, V8 heap, and GC metrics in the
  same Effect-owned OTLP lifecycle.

All local OTLP tests used deterministic receivers and fake providers or
workers. The privacy assertions excluded identity, request bodies, raw IDs,
coordinates, file paths, object keys, checksums, provider response text, JWT
details, email addresses, SQL text, SQL values, process arguments, and
environment values. Empty executor polls, SSE heartbeats, static assets, and
health polling did not create spans.

The server-suite progression recorded during the slices was 151, 155, 163,
165, and 167 passing tests, each with 3 expected skips. These counts are
historical snapshots, not current acceptance counts. The runtime-metrics slice
also passed build, focused lint, format, and diff checks; full lint retained 23
pre-existing findings outside that slice.

## Stored SigNoZ evidence

An isolated Arch `m27` fixture candidate exported Plan trace
`8e27fd74a2ce4b1d831e2c63facecf95`, Observe trace
`b0274d90f90f03cf75cb4f27b6a928e3`, Library catalog/detail/review traces
`b480290021cbb14ded9b01568a4bf624`,
`bf0bb30aa28742242fd72e44ef978bbf`, and
`4c4be5c62e7a32b32535e1391fa52dee`, and Process trace
`761780129fcd56928e0c8608668b9a97`. It used fixture data and did not contact a
provider or hardware.

A later isolated candidate stored `SQLite.projection.snapshot.read` and
`SQLite.command.state.transaction` under their HTTP and business parents, plus
SQLite count and duration metrics. It used its own database volume and stopped
cleanly.

Image `astro-console-origin:otel-runtime-20260809-1` ran as
`astro-console-runtime-candidate` on loopback port `28093`. SigNoZ stored all
event-loop, heap, and GC metric families for that candidate. OTLP metric units
were present as metadata, and no data point had a duplicate `unit` label. The
candidate exited zero. The production origin and SigNoZ ingester start times
did not change.

The separate `arch-sig-noz` repository contains the infrastructure-agent,
dashboard, and alert definitions. The agent stored host and container metric
families without publishing host ports. The dashboard and four rules were
present and all rules evaluated as OK at the time of proof; no notification
channel was configured.

## Historical rollout note

During one comparison, a body-discarded local-owner
`GET /api/workspaces/plan` returned an empty reply and exited both the earlier
uninstrumented image and the traced candidate. This showed a pre-existing
route/state defect rather than an OTEL-only regression. The healthy Library
route was used for trace verification. This note is retained for historical
troubleshooting and does not state the current route condition.
