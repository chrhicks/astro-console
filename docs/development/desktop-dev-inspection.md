# Desktop Development And Inspection

Run desktop commands from `apps/desktop`.

## Development

```sh
npm run dev
```

The development supervisor waits for the SDK, main-process output, preload
output, and Vite renderer before launching Electron. It restarts Electron when
main-process or SDK output changes; renderer changes use Vite HMR.

## Inspected Development

```sh
npm run dev:inspect
```

This is the preferred command for Electron validation. It exposes Chromium
remote debugging on port `9222` while preserving the normal desktop stack.

To attach an inspection client:

```sh
curl http://127.0.0.1:9222/json/list
agent-browser connect <webSocketDebuggerUrl>
agent-browser snapshot -i
```

Use one desktop client when validating hardware that does not support
concurrent connections. Keep direct device API probes and other control apps
disconnected while the desktop session owns the rig.
