---
name: task-loop
description: Run one task-loop iteration toward GOAL.md
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request
  priority: '850'
  requires_state: 'writable'
  min_version: '0.1.0'
---

# Task Loop Skill

## Purpose

Run exactly one focused iteration toward `GOAL.md`, using `continuum task` as the execution ledger, then stop.

## Entry Point (Re-focuser)

`GOAL.md` at repo root is the north star. Read it at the start of every loop and produce a one-line alignment statement.
If a NOW memory file exists, read the latest entry to avoid duplicating work, but use task priority (lower number = higher priority) as the source of truth for what to resume; createdAt is only a tie-breaker.
If you resume from NOW, verify the task intent explicitly cites a GOAL.md section and update it before proceeding.
Treat `open` as the default working queue because `task create` defaults to `open`.
Priority ordering: lower numbers are higher priority (default is 100).

## Preconditions

- `GOAL.md` exists at repo root
- Continuum task DB initialized (`continuum init`)

If either is missing, stop and ask the user to fix it.

## Single-Iteration Loop (Hard Stop After One Step)

1. Read `GOAL.md` and write a one-line alignment statement.
2. Search memory for prior context on this goal area:
   ```bash
   continuum memory search "<GOAL keyword or active task title>"
   ```
   Run from the target repo (or pass `--cwd <repo-or-subdir>`) so the search
   targets that workspace's local `.continuum` state. This command searches
   materialized memory and recall summaries together by default.
   Note any prior task IDs, known failures, or decisions for this area. Proceed regardless of results.
3. Preflight to avoid redundant work:
   - List `open` tasks.
   - If the list is empty, create one `investigation` task focused on discovering GOAL-aligned work in the current repo. This task should explicitly state the exploration criteria and expected outputs (new concrete tasks with priorities and evidence).
   - For the top priority open task, quickly check whether existing code/tests/docs already implement it.
   - If already implemented, add a discovery note and skip to the next task.
   - If all open tasks appear already implemented, complete them with notes and stop.
4. Select a task (avoid creating duplicates; prefer `open`, ordered by priority):
   - If a `task_id` was provided, use it.
   - Else list `open` tasks sorted by priority (lowest number first; createdAt only breaks ties) and select the top task.
   - If the latest NOW task is still `open` or `ready` and has a priority number less than or equal to the selected task, resume it.
   - Else choose the highest-priority `ready` task (only if your workflow explicitly uses `ready`).
   - If no `open` or `ready` tasks exist, create one `investigation` task from `GOAL.md` and assign it a high priority (lower number than build work for the same focus).
   - If an `investigation` task exists for the same focus, ensure it has a lower priority number than build tasks and select it first.
   - Never create a new task if an existing `open`/`ready` task already has the same intent/title.
5. Ensure task intent references a section of `GOAL.md` and add a minimal plan if missing (update the task before validation).
6. Pick the first `pending` step.
   - If no steps exist, add 1-3 concrete steps derived from GOAL.md success criteria (avoid "run the loop" phrasing).
7. Append a step-start memory entry (run before beginning work):
   ```bash
   continuum memory append agent "Task: <task_id>; Step: <step_id>; Status: starting; Intent: <one-line step goal>"
   ```
8. Mark the step `in_progress`.
9. Do the work (code, docs, config) that completes the step.
   - If the selected task is `investigation`, perform a focused repo exploration and create 1-5 concrete follow-up tasks directly in `continuum task`.
   - Every generated task must include GOAL alignment, a concise plan, and evidence (code/test/doc reference) so it is actionable.
   - De-duplicate against existing `open`/`ready`/`in_progress`/`completed` tasks before creating anything new.
10. Validate (one command at a time, they don't `&&` well):
    - Run `bun run typecheck`
    - Run `bun test`
    - Run one smoke command relevant to the work (example: `continuum task list --json`)

11. Add notes (discovery/decision) to the task as needed.
12. Complete the step with a concise summary.
13. Flush task notes to NOW memory:
    ```bash
    continuum task notes flush <task_id>
    ```
    Skip this step if Phase 2 has not shipped yet (`task notes flush` command does not exist).
14. If all steps are complete, validate and complete the task.
15. Append the full loop-end memory entry (auto-starts a session if missing):
    ```bash
    continuum memory append agent "..."
    ```
16. Stop and return control to the user.

## Commands (Reference)

Create an investigation task when queue is empty:

```bash
continuum task create --title "Discover next GOAL-aligned work" --type investigation --priority 50 --intent "Aligned to GOAL.md: <section>; investigate repo gaps and generate actionable tasks" --description "Explore code/tests/docs for missing or stale work aligned to GOAL.md success criteria. Create 1-5 deduplicated tasks with evidence and priority." --plan "Plan: 1) Inspect GOAL criteria vs current implementation 2) Identify highest-value gaps with evidence 3) Create prioritized follow-up tasks"
```

List open tasks (default queue, priority-ordered):

```bash
continuum task list --status open --sort priority --order asc --limit 20
```

List ready tasks (optional queue):

```bash
continuum task list --status ready --sort priority --order asc --limit 1
```

Get task details:

```bash
continuum task get <task_id>
```

Create task from goal (leave status as default unless you explicitly use a ready queue):

```bash
continuum task create --title "<title from GOAL.md success criteria>" --type feature --priority 100 --intent "Aligned to GOAL.md: <section>" --description "@GOAL.md" --plan "Plan: <1-3 steps>"
```

List steps:

```bash
continuum task steps list <task_id>
```

Add steps:

```bash
continuum task steps add <task_id> --steps @steps.json
```

Add or update plan:

```bash
continuum task update <task_id> --plan "Plan: <1-3 steps>"
```

Mark in progress:

```bash
continuum task steps update <task_id> <step_id> --status in_progress
```

Complete step:

```bash
continuum task steps complete <task_id> --step-id <step_id> --notes "Done"
```

Add note:

```bash
continuum task note add <task_id> --kind discovery --content "@notes.md" --source agent
```

Validate and complete task:

```bash
continuum task validate <task_id> --transition completed
continuum task complete <task_id> --outcome @outcome.md
```

## NOW Memory Entry (Minimum)

Append a short entry via CLI (auto-starts a NOW session if missing):
Run a shorter version (Task, Step, Status, Intent only) at step 7 (start); run the full version at step 15 (end).

```bash
continuum memory append agent "Goal alignment: ...; Task: ...; Step: ...; Changes: ...; Tests: ...; Outcome: ..."
```

Include:

- Goal alignment: one-line summary
- Task: `<task_id>`
- Step: `<step_id>`
- Summary:
  <summary_of_work_markdown_blob>
- Discoveries:
  <discoveries_markdown_blob>
- Changes: file paths touched
- Tests: commands run and results
- Outcome: one sentence

Do not include secrets or credentials.

## Stop Conditions

- One step completed, OR
- Validation failed (log failure and stop), OR
- Blocked by missing info (log and stop)
