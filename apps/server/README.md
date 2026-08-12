# Server development and inspection

`apps/server` is the production server implementation target. From the
repository root, first run `npm ci` and `npm run setup` with Node 22.19 or
later. Then run `npm run dev:inspect` for owner, `npm run dev:inspect -- --client=friend`,
or `npm run dev:inspect -- --client=phone`. Use
`npm run dev:inspect -- --scenario=plan-draft` for the Plan browser proof:
it installs the M27 Plan, Library, and workspace data without the preaccepted
fixture RunDefinition, so Save and Accept create the ordinary `fake`
definition. Use `npm run dev:inspect -- --scenario=library-published
--path=/library/assets/asset-m27-001` for published Library detail evidence:
it adds one durable published representation for that known M27 asset without
starting publication or provider work. Add
`--path=/library/assets/asset-m27-001` (or another workspace route) to start
at a direct route. The command deliberately installs the deterministic M27
fixture into the server, then starts `apps/web` Vite against it. Vite proxies
same-origin `/api` requests, including native SSE, to that server. Its web
client always uses the authoritative BootstrapClient.

The server-side fixture identity is explicitly selected by `--client` and the
browser opens with a dedicated Chrome profile at
`.astro-server/inspect-chrome-profile-<client>`, with CDP on 9223. The
Plan-draft and Library-published scenarios use separate database and
Chrome-profile suffixes, preserving their state across runner restarts.
ordinary origin and worker database paths run migrations only; they do not seed
the fixture's Plan, Library, or Process data. The runner never attaches to or
closes a user's normal Chrome profile.

The inspector requires Google Chrome. On macOS it uses the normal Chrome app
location; on Linux it uses `google-chrome`. Set `ASTRO_SERVER_CHROME` to use a
different executable. Run the root wrapper so the shared contracts are built:

```sh
npm run dev:inspect -- --path=/plan
```

In another terminal:

```sh
agent-browser connect 9223
agent-browser snapshot
agent-browser screenshot /tmp/astro-server.png
```

Stop the runner with Ctrl-C; it terminates only its server, Vite, and dedicated
Chrome child. Start it again after stopping to exercise a clean server restart.
If port 9223 is already in use, stop the prior inspect runner first. Ordinary
`apps/web` `npm run dev` also uses the authoritative server client.
