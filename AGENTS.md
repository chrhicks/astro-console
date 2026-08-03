## Astro Console

This project is a hobby project amongst a few Astrophotography nerds. It is not a large enterprise production system. It doesn't require 'hardened' and 'secure' and 'safe' everything. Focus on what is strictly required to work through the
phases of the project. Avoid distractions about 'what could happen', 'possible risk', 'legacy fallback' or similar 
execution forks. Document these concerns only and allow the user to decide what needs to be done by occasionally.

Think, 'What can i do to trim this code/feature down yet preserve the primary functionality?' as a way to help you make
those kinds of decisions.

## Working within this project

### V2 documentation context

For V2 work, begin with `docs/v2/README.md` and follow its task-specific
reading table. The default context is only `docs/v2/ux-design-guidance.md` and
`docs/v2/current/handoff.md`.

- Load `docs/v2/current/product-spec.md`, one accepted gate document, or one
  infrastructure section only when the task requires that detail.
- Do not broadly ingest `docs/v2/archive/` or `prototype/v2-ui/archive/`.
  Archived material is non-authoritative and is used only to answer a specific
  historical question.
- Accepted prototypes remain at `prototype/v2-ui/`; rejected alternatives and
  earlier studies live under its `archive/` directory.

### Subagents - delegation and context preservation

* Use the `coder` agent as the default implementation path for coding tasks in this project.
* Use the `designer` subagent after every UI-affecting change in V2 or the web implementation, including UI validation. This agent is allowed to make UI (React/CSS/Markup) changes and will report back everything else.

### Executor

We try to use what is available in the `executor`  MCP when possible, its a way for you to programmatically interact with tools giving you consistent and reliable usage over something like CLI commands.

### Continuum

The `continuum` mcp (thru executor) allows you to do

- manage memory - use this frequently. It's the only way for you to remember things in the future: decisions, learnings, gotchas, troubleshooting, changelogs, etc.
- tasks - a way to keep track of your work. For capturing requirements for yourself or subagents you invoke. Think typical project management stuff like: Epics, Tasks, Plans, Checklists, etc.

### LED Panel - Communicating current activity

The `led-panel` mcp (through executor) allows you communicate to an LED Panel (currently LaMetric TIME). Use this semi-regularly for major progress steps.
- your current mood (permanent, default, dismissable)
- what you are a subagent is currently working on (persistent, dismissable) - think planning -> executing -> step 1 -> step N -> finalizing -> alert user
- to get the users attention (persistent, dismissible, audio)
- otherwise use it for fun whenever you fancy you could do something creative/playful with it throughout your work

## Local Web Dev Inspection

Run `npm run dev:inspect` from `apps/server` for UI validation of the
Phase 1 local-web slices. It starts only that service and a dedicated Chrome
profile with CDP on port `9223`; it never attaches to or closes normal Chrome.

- `agent-browser connect 9223`
- `agent-browser snapshot`
- `agent-browser screenshot ./.tmp/astro-local-web.png`

Stop the originating runner with Ctrl-C. If port 9223 is occupied, stop the
previous local-web inspect runner before starting another. Prefer this path for
local-web screenshot, keyboard, overflow, and console evidence when the
in-app browser has no claimable tab.

## Code Architecture and Design Philosophy

* Use the simple approach first
* document tangents, emerging ideas instead of chasing them down
* Avoid at all cost security theater - is it strictly necessary to complete the task?

## Getting Started

1. Start your session by reading your memory summary in `executor` (**continuum** tool).

Keep your memory updated throughout this session
- Emerging requirements, future troubleshooting reminders, discoveries
- Anything you think important to remember between sessions where your context gets reset or compacted

2. Look at the `docs/v2` directory and especially `handoff.md`
