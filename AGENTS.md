## Astro Console

This project is a hobby project amongst a few Astrophotography nerds. It is not a large enterprise production system. It doesn't require 'hardened' and 'secure' and 'safe' everything. Focus on what is strictly required to work through the
phases of the project. Avoid distractions about 'what could happen', 'possible risk', 'legacy fallback' or similar
execution forks. Document these concerns only and allow the user to decide what needs to be done by occasionally.

Think, 'What can i do to trim this code/feature down yet preserve the primary functionality?' as a way to help you make
those kinds of decisions.

## Communicating with the user or owner

- Keep your choice of language / vocabulary - use ASD-STE100 (Simplified Technical English)
- You can use complex language/protocols with subagents to make your requests clear and succinct

## Working within this project

### Astro Console operating skill

For Astro Console work, read and follow
`.agents/skills/astro-console/SKILL.md`. It routes task-specific authority,
planning, documentation maintenance, verification, and closeout work without
putting temporary project state in this file.

Use judgment, not rigid checklists. Preserve the intent of these rules: keep
work aligned to accepted outcomes, make the smallest complete change, and state
what the evidence actually proves.

### V2 documentation context

For V2 work, begin with `docs/v2/README.md` and follow its current reading
table. It is the authority for the default context and task-specific documents.

- Load one accepted gate document or one infrastructure section only when the
  task requires that detail.
- For UI or UX work, use `docs/v2/current/ui-ux.md` and the external Nightbook
  demo it names. Archived Astro Console visual guidance, existing non-beta UI
  code, and local hard-coded components are not design authority.
- Do not broadly ingest `docs/v2/archive/`. Archived material is
  non-authoritative and is used only to answer a specific historical question.
- Retired SDK, Electron desktop, and prototype UI artifacts are available only
  through Git history; they are not implementation authority.

### Documentation maintenance

- Keep `docs/v2/current/` short and useful for the next accepted work.
- At a phase or milestone closeout, move superseded detail into the appropriate
  dated archive and update the relevant archive index. Do not delete or
  overwrite historical documentation; preserve it as non-authoritative record.
- Keep durable operating guidance in this file or the Astro Console skill;
  keep product and phase decisions in the V2 documents so they can age out of
  the active context.
- Do not turn routine cleanup into a broad refactor. Archive when stale detail
  obscures the current decision or when a milestone closes.

### Subagents - delegation and context preservation

- Use the `coder` agent as the default implementation path for coding tasks in this project.
- Use the `designer` subagent after every UI-affecting change in V2 or the web implementation, including UI validation. This agent is allowed to make UI (React/CSS/Markup) changes and will report back everything else.

### Verification boundaries

- Functional UI verification proves that the implemented behavior works through
  the relevant route, state, and interaction path.
- Designer verification proves visual and usability quality against the design
  guidance. Run it after each UI-affecting V2 or web change, with wide, compact,
  and 390px phone evidence, and re-review P0/P1 fixes.
- Keep these proof types separate, along with local test, deployment, provider,
  device, and physical-capture evidence.

### Executor

We try to use what is available in the `executor` MCP when possible, its a way for you to programmatically interact with tools giving you consistent and reliable usage over something like CLI commands.

### Continuum

Use the `continuum` MCP through Executor for durable project memory: decisions,
learnings, gotchas, troubleshooting notes, and changelogs.

### LED Panel - Communicating current activity

The `led-panel` mcp (through executor) allows you communicate to an LED Panel (currently LaMetric TIME). Use this semi-regularly for major progress steps.

- your current mood (permanent, default, dismissable)
- what you are a subagent is currently working on (persistent, dismissable) - think planning -> executing -> step 1 -> step N -> finalizing -> alert user
- to get the users attention (persistent, dismissible, audio)
- otherwise use it for fun whenever you fancy you could do something creative/playful with it throughout your work

## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues using the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Domain docs

This repository uses a single-context domain layout. See
`docs/agents/domain.md`.

## Local Web Dev Inspection

Run `npm run dev:inspect` from `apps/server` for UI validation of the
server development scenarios. It starts only that service and a dedicated Chrome
profile with CDP on port `9223`; it never attaches to or closes normal Chrome.

- `agent-browser connect 9223`
- `agent-browser snapshot`
- `agent-browser screenshot ./.tmp/astro-server.png`

Stop the originating runner with Ctrl-C. If port 9223 is occupied, stop the
previous server inspect runner before starting another. Prefer this path for
server screenshot, keyboard, overflow, and console evidence when the
in-app browser has no claimable tab.

## Code Architecture and Design Philosophy

- Use the simple approach first
- document tangents, emerging ideas instead of chasing them down
- Avoid at all cost security theater - is it strictly necessary to complete the task?

## Getting Started

1. Start your session by reading your memory summary in `executor` (**continuum** tool).

Keep your memory updated throughout this session

- Emerging requirements, future troubleshooting reminders, discoveries
- Anything you think important to remember between sessions where your context gets reset or compacted

2. Look at the `docs/v2` directory and especially `handoff.md`
