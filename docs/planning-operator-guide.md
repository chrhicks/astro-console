# Planning Operator Guide

This guide covers the planning stack in the desktop app: sites, Tonight, queue drafts, and the first safe queue runner.

## Scope Ownership

- The app owns planning state, target ranking, queue drafts, and queue execution state.
- The Seestar is the execution target for discovery, sync, goto, view start/stop, stack start/stop, and autofocus.
- Native Seestar saved plans are not the source of truth for planning data.

## UI Modes

The desktop app is split into three top-level modes.

- `Observe`: live preview, scope actions, and current telemetry.
- `Planning`: Tonight, Queue, and Sites.
- `Diagnostics`: connection lab, logs, and raw status.

## Core Workflows

### 1. Connect Safely

From the `Session bus`:

- leave `Host` blank to prefer discovery
- use `Discover` when the device IP may have changed
- use `Connect` to authenticate and sync planner prerequisites

On successful connect the app will:

- discover or fall back to a discovered host if needed
- sync host time to the device
- sync the active site location to the device
- surface planner readiness in the status strip

If planner readiness is not `Ready`, stop and inspect the listed issues before attempting automation.

### 2. Manage Sites

From `Planning -> Sites`:

- create or edit reusable observing locations
- set one site as the active session site
- define:
  - latitude / longitude
  - timezone
  - minimum altitude
  - blocked azimuth sectors like `215-260:House`

Backyard masks are intentionally simple in V1 and are applied after the astronomical visibility engine.

### 3. Inspect Tonight

From `Planning -> Tonight`:

- review `Good Now`, `Later Tonight`, and `Blocked / Not Tonight`
- use filter and sort to narrow the list
- compare:
  - altitude now
  - peak altitude
  - usable minutes
  - sky-visible minutes
  - Moon separation
  - visible window
  - positive reasons
  - watch-outs

Important interpretation:

- `sky-visible minutes` means the target clears basic astronomical constraints
- `usable minutes` means the target is also usable from the selected site after backyard masking

### 4. Build a Queue Draft

From `Planning -> Queue`:

- add targets from Tonight or catalog search
- reorder items
- edit:
  - duration
  - not-before local time
  - stop altitude
  - filter choice
- toggle:
  - stop when backyard hidden
  - stop at dawn
  - autofocus before start
  - restart stack

Queue warnings are advisory and help catch obvious problems like:

- requested duration longer than usable visibility
- target blocked by the current backyard mask
- invalid local `HH:MM` time
- stop altitude below the site planning floor

### 5. Run Safely

From `Planning -> Queue`:

- use `Dry run` first whenever queue semantics or queue edits changed
- use `Run queue` only after the queue and planner status look correct
- use `Stop` to request a controlled stop

The first runner implementation is intentionally conservative:

- it validates queue and planner state before starting
- it blocks conflicting manual actions while active
- it records explicit runner state transitions
- it does not depend on device-native saved plans

## Verification Assets

The repo already includes deterministic planning fixtures.

- Visibility and ranking fixtures:
  - `apps/desktop/src/shared/visibility-engine.fixtures.ts`
- Queue fixtures:
  - `apps/desktop/src/shared/queue.fixtures.ts`

These are intended to catch regressions in:

- seasonal ranking buckets
- backyard masking
- queue serialization and validation

## Live Verification Guidance

### Recommended order

1. `npm run build` in `apps/desktop`
2. Connect through the desktop app and confirm planner readiness
3. Check `Planning -> Tonight`
4. Build or inspect a queue draft
5. Run `Dry run`
6. Only then run a low-risk single-item live queue item if needed

### Low-risk live runner strategy

Use a single-item queue with one of:

- a clearly `Good Now` target
- or, safest of all, a manual target at the scope's current coordinates

That keeps motion and recovery risk lower while still exercising the runner path.

## Recording Review

Desktop sessions are recorded under `recordings/`.

Useful files per session:

- `timeline.txt`: fast human-readable flow review
- `summary.json`: outcome, counts, and final status
- `events.jsonl`: detailed event stream
- `errors.jsonl`: warnings/errors only when present

For runner troubleshooting, look for these event families:

- `queue.run.*`
- `queue.item.*`
- `queue.state.transition`
- `observation.time.synced`
- `observation.location.updated`
- `observation.view.*`
- `observation.stack.*`
- `observation.autofocus.*`

Questions the recording should answer:

- what queue item was active
- what runner phase it reached
- what stop condition or failure reason ended the item
- whether disconnect or reconnect affected execution

## Known V1 Limits

- The Tonight and Queue UIs currently optimize for correctness more than compact operator UX.
- Dry-run state transitions may be brief in the UI even though they are captured in recordings.
- The first live runner path is intentionally narrow and conservative.
- Recovery after disconnect is explicit, but not yet fully automatic or unattended.
