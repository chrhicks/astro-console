# Current Product Scope

Astro Console is a personal desktop application for supervised astronomy
workflows. The current product target is a known local rig, not a general
observatory platform or a commercial device-support matrix.

## Supported Workflow

- Discover and connect supported Seestar, fake Seestar, and Alpaca rigs.
- Select a catalog target, then explicitly slew when the connected rig supports
  pointing.
- Inspect device, mount, preview, capture, and library state through typed
  desktop projections.
- Run bounded, operator-started capture workflows.
- Persist and review app-owned external-camera frames when the rig supports
  them.
- Stop capture, park, and disconnect through coordinated recovery operations.

## Known-Rig Alpaca Support

The Alpaca adapter composes the capabilities reported by the connected host.
Depending on the hardware, that can include mount operations, external camera
exposure and frame retrieval, focuser movement, and filter-wheel positioning.
Capabilities are projected truthfully: unavailable hardware is not represented
as a supported action.

## Deliberate Limits

- No broad driver certification or multi-host observatory support.
- No unattended scheduling, recovery, or quit-time automation.
- No guiding, dithering, autofocus cadence, or generic filter sequencing.
- No claim that a simulated scenario proves physical hardware behavior.

Hardware-specific procedures, addresses, and validation evidence belong in
`.local/`, not this tracked documentation tree.
