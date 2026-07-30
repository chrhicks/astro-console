# Local web inspection

Run `npm run dev:inspect` for owner, `npm run dev:inspect -- --client=friend`,
or `npm run dev:inspect -- --client=phone`. It deliberately installs the
deterministic M27 fixture and starts only the local-web service with that
trusted server-side fixture identity plus a dedicated Chrome profile at
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

Stop the runner with Ctrl-C; it terminates only its server and dedicated Chrome
child. If port 9223 is already in use, stop the prior inspect runner first.
