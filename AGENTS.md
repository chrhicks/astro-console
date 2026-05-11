# Seestar S30 Local API — Quick Reference

## Device
- **Model:** ZWO Seestar S30
- **Firmware:** 7.32 (`version_int` = 2732)
- **Network:** station mode on Wi-Fi `chicksdom`
- **Current IP:** `192.168.4.29` (check app if it changes)
- **mDNS:** `seestar.local` (may not resolve on all networks)

## Authentication (Firmware 7.18+)
The S30 requires a challenge-response handshake before accepting control commands.
- **Algorithm:** RSA PKCS#1 v1.5 with SHA1
- **PEM key:** `seestar_3.1.2_fw_7.32_interop.pem` (in this workspace root)
- **Handshake:**
  1. `get_verify_str` → receives challenge string
  2. Sign challenge with the RSA PEM key
  3. `verify_client` → send signature
  4. `pi_is_verified` → confirm success
- **Source of PEM:** extracted from official Seestar Android app APK v3.1.2 using `bguthro/seestar-tool`

## Native Ports & Protocol
- **Control:** TCP `4700` — JSON-RPC messages terminated with `\r\n`
- **Imaging:** TCP `4800` — binary image/frame data
- **UDP intro:** `4720` — send `{"id":1,"method":"scan_iscope","params":""}` for guest-mode handshake
- **HTTP:** TCP `80` — album thumbnails and saved images
- **RTSP:** TCP `4554` — active only when live view/scenery mode is running in the app
- **SSH:** TCP `22` is open; credentials are unknown

## Common Commands
All are JSON objects sent to port `4700` with an incrementing `id` and `\r\n` terminator.

### Read-only / Safe
- `scope_get_equ_coord`
- `get_device_state`
- `get_view_state`
- `get_setting`
- `test_connection`

### Control
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

### Events (pushed by device)
- `AutoGoto`, `Stack`, `AutoFocus`, `ScopeHome`, `ScopeTrack`, `Client`

## Safety Notes
- Verify the device is in a safe position before sending movement commands.
- The mount is **alt-az**; RA/Dec coordinates may not reflect true sky pointing exactly.
- Do not flash firmware or upload files unless explicitly asked.
- The PEM is sensitive; do not commit it to public repositories.

## Upstream Projects
- `smart-underworld/seestar_alp` — full ASCOM Alpaca proxy with web UI
- `bguthro/seestar-tool` — firmware manager and PEM extractor
- `astrophotograph/scopinator-seestar` / `pyscopinator` — lightweight Rust/Python clients
- `astrophotograph/seestar-proxy` — TCP proxy for multi-client access


## Continuum

We use the `continuum` to keep track of our tasks and to serve as our tool for saving memory.

At the beginning of a session run these commands:

- `continuum --help`
- `continuum init`

During a session use these sub-commands regularly to keep track of your work and thoughts:

- `continuum task`
- `continuum memory`

Important `continuum` usage details:

- `continuum memory append` only accepts `user`, `agent`, or `tool`
- use `continuum memory append user "..."` for user context you want saved
- use `continuum memory append agent "..."` for agent notes you want saved
- use `continuum memory append tool <name> "summary..."` for tool activity
- `discovery` and `decision` are not valid `memory append` kinds
- `discovery` and `decision` are valid only for task notes, for example: `continuum task note add <task_id> --kind discovery --content "..."`

## Output

When it makes sense for large output or explaining things for the user, user **HTML**. Use tmux to run an http server against the output directory. Make links work over the Tailscale network host: `chicks-arch`

Output dir: `./.www`
Tmux session id: `seestar-www`
URL base: `http://chicks-arch[:port]`
