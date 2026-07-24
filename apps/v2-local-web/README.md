# Local web inspection

Run `npm run dev:inspect` for owner, `npm run dev:inspect -- --client=friend`,
or `npm run dev:inspect -- --client=phone`. It starts only the local-web
service with that trusted server-side fixture identity plus a dedicated Chrome
profile at `.astro-local-web/inspect-chrome-profile-<client>`, with CDP on 9223.
It never attaches to or closes a user's normal Chrome profile.

In another terminal:

```sh
agent-browser connect 9223
agent-browser snapshot
agent-browser screenshot /tmp/astro-local-web.png
```

Stop the runner with Ctrl-C; it terminates only its server and dedicated Chrome
child. If port 9223 is already in use, stop the prior inspect runner first.
