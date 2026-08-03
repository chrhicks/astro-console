# Server development and inspection

`apps/server` is the production server implementation target. Run `npm run dev:inspect` for owner, `npm run dev:inspect -- --client=friend`,
or `npm run dev:inspect -- --client=phone`. Add
`--path=/library/assets/asset-m27-001` (or another workspace route) to start
at a direct route. The command deliberately installs the deterministic M27
fixture into the server, then starts `apps/web` Vite against it. Vite proxies
same-origin `/api` requests, including native SSE, to that server. Its web
client uses the authoritative BootstrapClient rather than the ordinary
development visual fixture adapter.

The server-side fixture identity is explicitly selected by `--client` and the
browser opens with a dedicated Chrome profile at
`.astro-local-web/inspect-chrome-profile-<client>`, with CDP on 9223. The
ordinary origin and worker database paths run migrations only; they do not seed
the fixture's Plan, Library, or Process data. The runner never attaches to or
closes a user's normal Chrome profile.

In another terminal:

```sh
agent-browser connect 9223
agent-browser snapshot
agent-browser screenshot /tmp/astro-local-web.png
```

Stop the runner with Ctrl-C; it terminates only its server, Vite, and dedicated
Chrome child. Start it again after stopping to exercise a clean server restart.
If port 9223 is already in use, stop the prior inspect runner first. Ordinary
`apps/web` `npm run dev` remains visual-fixture development.
