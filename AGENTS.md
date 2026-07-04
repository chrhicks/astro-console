## Continuum

We use the `continuum` to keep track of our tasks and to serve as our tool for saving memory.

At the beginning of a session run these commands:

- `continuum guide` -- explains usage and workflows and links to command specific guides
- `continuum init`

### Updating long term memory

Use the `memory-manager` skill and keep your memory up to date for these conditions. You are expected to do this regularly and consistently, multiple times, during a session with the user.

- Feature changes or update
- Discoveries: new learnings or ideas that need to be recalled in the future
- Troubleshooting: techniques or approaches that will avoid wasting time in the future to solve similar problems

### Tooling

- Prefer `ast-grep` / `sg` for structural, syntax-aware code search when possible instead of plain text grep-style search. It is usually better for searching through code because it matches language structure, not just raw text.

## Coding Delegation

Use `glm-coder` as the default implementation path for coding tasks in this project.

- For code changes, start by delegating the implementation work to the `glm-coder` subagent.
- Give `glm-coder` the concrete task, affected files or areas, and any verification expectations.
- Treat `CODING_STANDARDS.md` as the style authority for that work.

## UI Validation Delegation

Use `ui-validator` as the default subagent for desktop UI smoke validation and screenshot-backed verification.

- Delegate `agent-browser` work, `npm run dev:inspect` flows, fake Seestar scenario checks, and Electron renderer validation to `ui-validator` when the task is primarily about verifying UI behavior rather than implementing code.
- Give `ui-validator` the exact scenarios or UI states to validate, the evidence you want captured, and any specific DOM assertions or screenshots needed.
- Keep implementation in the primary agent or `glm-coder`; `ui-validator` is for validation only and should not be used as the coding path.

## Primary Agent Role

The primary agent remains responsible for the final result.

- Review `glm-coder` output before presenting it to the user.
- Check that the change actually satisfies the request.
- Check that the implementation follows `CODING_STANDARDS.md` and nearby project conventions.
- Request a follow-up iteration from `glm-coder` when the first pass is incomplete, risky, or off-style.
- Summarize review findings, remaining risks, and verification status clearly.

## When Not To Delegate

Do not use `glm-coder` for:

- purely informational questions
- repo exploration with no implementation
- simple non-code operations where a direct tool call is faster

If `glm-coder` is unavailable or blocked, proceed directly only when necessary and still apply `CODING_STANDARDS.md` during implementation and review.

## Desktop Dev Inspection

Run `npm run dev:inspect` from `apps/desktop` to start the same dev stack as `npm run dev` with Electron's remote debugging port exposed on `9222`. The script sets `ELECTRON_INSPECT_PORT=9222`, which the main process forwards to Chromium via `app.commandLine.appendSwitch('remote-debugging-port', ...)` before `app.whenReady()`. The port is opt-in; `npm run dev` does not expose it.

Use `agent-browser` against the running Electron renderer like this:

- `curl http://127.0.0.1:9222/json/list` — get the renderer target and copy its `webSocketDebuggerUrl`
- `agent-browser connect <webSocketDebuggerUrl>` — attach to the live Electron page
- `agent-browser snapshot -i` — get interactive elements with refs (`@e1`, `@e2`)
- `agent-browser click @e1` / `fill @e2 "text"` — interact using refs
- `agent-browser screenshot /tmp/astro-console.png` — capture visual evidence after UI changes

## Seestar S30 Local API — Quick Reference

### Device
- **Model:** ZWO Seestar S30
- **Firmware:** 7.32 (`version_int` = 2732)
- **Network:** station mode on Wi-Fi `chicksdom`
- **Current IP:** `192.168.4.29` (check app if it changes)
- **mDNS:** `seestar.local` (may not resolve on all networks)

### Authentication (Firmware 7.18+)
The S30 requires a challenge-response handshake before accepting control commands.
- **Algorithm:** RSA PKCS#1 v1.5 with SHA1
- **PEM key:** `seestar_3.1.2_fw_7.32_interop.pem` (in this workspace root)
- **Handshake:**
  1. `get_verify_str` → receives challenge string
  2. Sign challenge with the RSA PEM key
  3. `verify_client` → send signature
  4. `pi_is_verified` → confirm success
- **Source of PEM:** extracted from official Seestar Android app APK v3.1.2 using `bguthro/seestar-tool`

### Native Ports & Protocol
- **Control:** TCP `4700` — JSON-RPC messages terminated with `\r\n`
- **Imaging:** TCP `4800` — binary image/frame data
- **UDP intro:** `4720` — send `{"id":1,"method":"scan_iscope","params":""}` for guest-mode handshake
- **HTTP:** TCP `80` — album thumbnails and saved images
- **RTSP:** TCP `4554` — active only when live view/scenery mode is running in the app
- **SSH:** TCP `22` is open; credentials are unknown

### Common Commands
All are JSON objects sent to port `4700` with an incrementing `id` and `\r\n` terminator.

#### Read-only / Safe
- `scope_get_equ_coord`
- `get_device_state`
- `get_view_state`
- `get_setting`
- `test_connection`

#### Control
- `iscope_start_view` — start a viewing mode (`star`, `moon`, `scenery`, etc.)
- `iscope_stop_view` — stop current view
- `iscope_start_stack` — begin stacking
- `scope_goto [ra, dec]` — slew to coordinates
- `scope_speed_move` — manual slew (`speed`, `angle`, `dur_sec`)
- `scope_sync [ra, dec]` — sync current position
- `start_auto_focuse` — run autofocus
- `set_wheel_position` — change filter (`0` clear, `1` IR, `2` LP)
- `set_setting` / `set_user_location` / `pi_set_time`
- `pi_shutdown` / `pi_reboot`

#### Events (pushed by device)
- `AutoGoto`, `Stack`, `AutoFocus`, `ScopeHome`, `ScopeTrack`, `Client`

### Safety Notes
- Verify the device is in a safe position before sending movement commands.
- The mount is **alt-az**; RA/Dec coordinates may not reflect true sky pointing exactly.
- Do not flash firmware or upload files unless explicitly asked.
- The PEM is sensitive; do not commit it to public repositories.

### Upstream Projects
- `smart-underworld/seestar_alp` — full ASCOM Alpaca proxy with web UI
- `bguthro/seestar-tool` — firmware manager and PEM extractor
- `astrophotograph/scopinator-seestar` / `pyscopinator` — lightweight Rust/Python clients
- `astrophotograph/seestar-proxy` — TCP proxy for multi-client access
