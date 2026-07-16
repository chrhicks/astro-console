# Fake Scenario Testing

Use fake scenarios to exercise deterministic desktop UI states without
hardware. They validate the real v2 IPC and projection path, but they do not
prove network, mount, camera, RTSP, or storage behavior on a physical device.

## Start An Inspected Desktop Session

From `apps/desktop`:

```sh
npm run dev:inspect
```

Attach to the renderer through the remote debugging target on port `9222`, then
use `agent-browser snapshot -i` to inspect and drive the UI.

## Use A Scenario

Unpackaged desktop builds expose the fake scenario panel and the
`window.seestarDevFake` development surface. Select a scenario, discover the
fake device, connect, select a target, and use `Slew to target` to exercise the
normal workflow path.

Representative scenarios cover clean connection, stale time, missing location,
connect failure, point failure, active preview, preview failure, active capture,
and capture failure.

## Evidence

Capture a screenshot with the active scenario identifier and the relevant UI
state. For behavior involving real device protocols, mount motion, frame
storage, or recovery timing, run a supervised hardware validation instead.
