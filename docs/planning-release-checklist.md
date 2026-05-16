# Planning Release Checklist

Use this checklist to verify planning milestones independently instead of waiting for the final runner.

## Baseline

- [ ] `npm run build` passes in `apps/desktop`
- [ ] Desktop app opens and loads planning state without crashing
- [ ] No new planning data was written outside `planning-state.json` and `recordings/`

## 1. Sites

- [ ] Create at least two sites
- [ ] Switch active site
- [ ] Restart app and confirm active site persists
- [ ] Invalid timezone input is rejected
- [ ] Invalid blocked azimuth input is rejected

## 2. Catalog

- [ ] Local lookup resolves `M31`, `M42`, `M51`, `M13`, and `NGC 7000`
- [ ] Catalog works offline
- [ ] Manual RA/Dec target can be added
- [ ] Manual target survives planning-store reload

## 3. Visibility Engine

- [ ] Fixture-backed ranking remains deterministic
- [ ] Seasonal expectations hold:
  - [ ] summer fixture favors `M13` / `NGC 7000`
  - [ ] winter fixture favors `M42` / `M45`
- [ ] `Later Tonight` vs `Blocked / Not Tonight` remains explainable in result reasons

## 4. Backyard Mask

- [ ] Fully blocked fixture yields `skyVisibleMinutes > 0` and `visibleMinutes = 0`
- [ ] Real Backyard site reduces usable minutes for at least one target
- [ ] Blocked-sector labels appear in watch-outs when relevant

## 5. Tonight Browser

- [ ] Site switching changes Tonight results immediately
- [ ] Filtering by target name and object class works
- [ ] Sorting changes result ordering meaningfully
- [ ] Cards expose:
  - [ ] altitude now
  - [ ] peak altitude
  - [ ] usable minutes
  - [ ] sky-visible minutes
  - [ ] Moon separation
  - [ ] visible window
  - [ ] positive reasons
  - [ ] watch-outs

## 6. Queue Model

- [ ] Queue items serialize and reload cleanly
- [ ] Queue item `siteId` matches a valid non-archived site
- [ ] Queue item target snapshot matches the catalog target
- [ ] Invalid queue writes are rejected before persistence

## 7. Queue Editor

- [ ] Add targets from Tonight
- [ ] Add targets from catalog search
- [ ] Reorder items
- [ ] Remove items
- [ ] Edit duration, not-before, stop altitude, and filter
- [ ] Toggle queue stop conditions and autofocus/restart settings
- [ ] Duplicate add for same target/site is prevented
- [ ] Add buttons reflect current queue state
- [ ] Queue edits persist across restart

## 8. Runner Dry Run

- [ ] Dry run starts from `Planning -> Queue`
- [ ] Runner state moves out of `idle`
- [ ] Recording timeline includes:
  - [ ] `queue.run.started`
  - [ ] `queue.item.started`
  - [ ] `queue.state.transition`
  - [ ] `queue.run.completed`
- [ ] Queue editing is blocked while runner is active

## 9. Runner Live Single Item

- [ ] Use a low-risk single-item queue only
- [ ] Prefer a `Good Now` or current-position target
- [ ] Live run reaches `queue.item.completed`
- [ ] Recording timeline clearly shows:
  - [ ] connect and planner sync
  - [ ] goto or minimal-motion target handling
  - [ ] star view start
  - [ ] stack start
  - [ ] stop condition or completion
  - [ ] `queue.run.completed`

## 10. Regression Checks After Any Planning Change

- [ ] Discovery-only connect still succeeds
- [ ] Stale-host fallback still succeeds
- [ ] Planner sync still reaches `ready`
- [ ] Recording bundles remain readable and high-signal

## Reference Recordings

These recordings are useful known references from development:

- Discovery and sync success:
  - `recordings/2026-05-15T17-21-16Z__desktop__discovery__bda2128f/`
- Stale-host fallback success:
  - `recordings/2026-05-15T17-21-21Z__desktop__192.168.4.250__cdf124c6/`
- Queue runner dry run:
  - `recordings/2026-05-15T23-46-26Z__desktop__discovery__5ef25054/`
- Runner troubleshooting examples:
  - `recordings/2026-05-15T23-51-47Z__desktop__discovery__943b804e/`
  - `recordings/2026-05-15T23-53-44Z__desktop__discovery__e8cc9db3/`
- Successful live single-item runner examples:
  - `recordings/2026-05-15T23-57-49Z__desktop__discovery__25805819/`
  - `recordings/2026-05-15T23-59-16Z__desktop__discovery__52f79acc/`

## Ship Criteria For This Epic

- [ ] Every completed planning milestone above has at least one explicit verification path
- [ ] Operator docs explain the difference between Observe, Planning, and Diagnostics
- [ ] Queue runner troubleshooting can be understood from recordings alone
- [ ] The app remains app-authoritative for planning and execution state
