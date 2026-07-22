# V1 Shell Review That Informed V2

Status: **historical evidence — July 2026**

This review explains why V2 did not extend the original Electron shell. It is
preserved as design rationale, not current product behavior or an active V2
requirement source.

The original interface had a coherent dark instrument-console style and
several useful operational details, but its layout was organized around
persistent component slots rather than the operator's current task.

The review found:

- The target catalog rendered all 12,590 target buttons while only a small
  number were visible.
- The empty preview dominated disconnected and idle states.
- Empty Inspector and Library regions remained visible regardless of context.
- The header clipped location and removed Simulator and Park at compact widths.
- Common text and controls were too small for dark, cold, fatigued, or
  at-a-distance operation.
- Warnings exposed a count without a discoverable explanation or remedy.
- Capture controls appeared in multiple places, including explicitly unwired
  Inspector settings.
- Capability labels such as `Preview yes` and `Storage no` read as adapter
  diagnostics rather than operator guidance.
- Active capture telemetry was useful, but blank previews and
  provenance-poor asset tiles made frame feedback weak.

The resulting decision was to build task-driven V2 workspaces with progressive
disclosure rather than reproduce the same shell with cleaner spacing.

The current authority is the
[V2 product specification](../../current/product-spec.md).
