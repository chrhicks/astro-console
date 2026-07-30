## Astro Console

This project is a hobby project amongst a few Astrophotography nerds. It is not a large enterprise production system. It doesn't require 'hardened' and 'secure' and 'safe' everything. Focus on what is strictly required to work through the
phases of the project. Avoid distractions about 'what could happen' and 'possible risk'. Document these concerns only
and allow the user to decide what needs to be done by occasionally.

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

Use the `coder` agent as the default implementation path for coding tasks in this project.

- For code changes, start by delegating the implementation work to the `coder` subagent.
- Give `coder` the concrete task, affected files or areas, and any verification expectations.
- Objectively review their work and re-task them with feedback until you're satisfied with the work.
- Treat `CODING_STANDARDS.md` as the style authority for that work.

Use `ui-validator` as the default subagent for desktop UI smoke validation and screenshot-backed verification.

- Delegate `agent-browser` work, `npm run dev:inspect` flows, fake Seestar scenario checks, and Electron renderer validation to `ui-validator` when the task is primarily about verifying UI behavior rather than implementing code.
- Give `ui-validator` the exact scenarios or UI states to validate, the evidence you want captured, and any specific DOM assertions or screenshots needed.
- Keep implementation in the primary agent or `glm-coder`; `ui-validator` is for validation only and should not be used as the coding path.

Use the `designer` subagent after every UI-affecting change in V2 or the web implementation.

- Treat Designer review as a required validation gate, not a final-polish pass. Batch only tightly coupled UI edits into one reviewable slice, then re-run the review after fixes.
- Give `designer` the affected routes/components, change classification, source projection or fixture, canonical owner/freshness/action state, exact walkthrough, and known limitations.
- Require screenshot-backed evidence at wide desktop, compact desktop, and 390 px phone where applicable. The review must cover semantic truth, hierarchy, awkward states, responsive behavior, keyboard/accessibility, overflow, and console health.
- `designer` is validation-only: it must report prioritized findings and never implement the fixes. P0/P1 findings block UI completion.

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

## Local Web Dev Inspection

Run `npm run dev:inspect` from `apps/v2-local-web` for UI validation of the
Phase 1 local-web slices. It starts only that service and a dedicated Chrome
profile with CDP on port `9223`; it never attaches to or closes normal Chrome.

- `agent-browser connect 9223`
- `agent-browser snapshot`
- `agent-browser screenshot /tmp/astro-local-web.png`

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
