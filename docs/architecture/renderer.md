# Renderer Architecture

The Electron renderer is a projection consumer. Main-process workflows publish
the typed `DesktopStatus` model, and renderer mutations invoke the typed desktop
API exposed by preload.

## Data Flow

1. The main process owns device sessions, workflows, and the aggregate state.
2. The status projector converts aggregate and rig capability state into
   renderer-facing labels, actions, and projections.
3. IPC validates requests and returns the projected status.
4. The preload surface exposes the typed API to the renderer.
5. Query and mutation hooks update the projection store from returned status.

## UI Rules

- Selecting a target is local UI state; `Slew to target` is the explicit mount
  operation.
- Render only actions supplied by the status projection.
- Display recovery operations such as Stop, Park, and Unpark only when the
  connected rig projects the required capability and state.
- Keep device-specific terminology out of shared renderer components.

Use fake scenarios for deterministic UI states and a supervised physical rig
for hardware behavior.
