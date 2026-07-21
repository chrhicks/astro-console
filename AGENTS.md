## Continuum

Start your session by reading your memory summary in `continuum`. Keep your memory updated throughout this session.

## Working within this project

### Subagents - delegation and context preservation

Use the `coder` agent as the default implementation path for coding tasks in this project.

- For code changes, start by delegating the implementation work to the `coder` subagent.
- Give `coder` the concrete task, affected files or areas, and any verification expectations.
- Objectively review their work and re-task them with feedback until you're satisfied with the work.
- Treat `CODING_STANDARDS.md` as the style authority for that work.

Use `ui-validator` as the default subagent for desktop UI smoke validation and screenshot-backed verification.

- Delegate `agent-browser` work, `npm run dev:inspect` flows, fake Seestar scenario checks, and Electron renderer validation to `ui-validator` when the task is primarily about verifying UI behavior rather than implementing code.
- Give `ui-validator` the exact scenarios or UI states to validate, the evidence you want captured, and any specific DOM assertions or screenshots needed.
- Keep implementation in the primary agent or `glm-coder`; `ui-validator` is for validation only and should not be used as the coding path.

### Executor

We try to use what is available in the`executor`  MCP when possible, its a way for you to programmatically interact with tools giving you consistent and reliable usage over something like CLI commands.

### Continuum

The `continuum` mcp (thru executor) allows you to do

- manage memory - use this frequently. It's the only way for you to remember things in the future: decisions, learnings, gotchas, troublesheeting, changelogs, etc.
- tasks - a way to keep track of your work. For capturing requirements for yourself or subagents you invoke. Think typical project management stuff like: Epics, Tasks, Plans, Checklists, etc.

### LED Panel - Communicating current activity

The `led-panel` mcp (through executor) allows you communicate to an LED Panel (currently LaMetric TIME). Use this semi-regularly for major progress steps.
- your current mood (permanent, default, dismissable)
- what you are a subagent is currently working on (persistent, dismissable) - think planning -> executing -> step 1 -> step N -> finalizing -> alert user
- to get the users attention (peristent, dismissible, audio)
- otherwise use it for fun whenever you fancy you could do something creative/playful with it throughout your work

## Desktop Dev Inspection

Run `npm run dev:inspect` from `apps/desktop` to start the same dev stack as `npm run dev` with Electron's remote debugging port exposed on `9222`. The script sets `ELECTRON_INSPECT_PORT=9222`, which the main process forwards to Chromium via `app.commandLine.appendSwitch('remote-debugging-port', ...)` before `app.whenReady()`. The port is opt-in; `npm run dev` does not expose it.

Both `dev` and `dev:inspect` launch Electron through `scripts/dev-electron.ts`, which waits for `dist/main`, the SDK dist, and the Vite dev server before starting Electron, then restarts Electron automatically whenever the built main-process or SDK dist changes. Renderer-only changes still rely on Vite HMR. Prefer `dev:inspect` for validation so UI checks always run against the latest main-process build instead of stale cached modules.

Use `agent-browser` against the running Electron renderer like this:

- `curl http://127.0.0.1:9222/json/list` — get the renderer target and copy its `webSocketDebuggerUrl`
- `agent-browser connect <webSocketDebuggerUrl>` — attach to the live Electron page
- `agent-browser snapshot -i` — get interactive elements with refs (`@e1`, `@e2`)
- `agent-browser click @e1` / `fill @e2 "text"` — interact using refs
- `agent-browser screenshot /tmp/astro-console.png` — capture visual evidence after UI changes
