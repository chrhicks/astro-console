---
name: continuum-task
description: Manage tasks via continuum task CLI
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request
  priority: '900'
  requires_state: 'writable'
  min_version: '0.1.0'
---

# Continuum Task Skill

## Purpose

Provide a complete, command-by-command operational guide for the
`continuum task` CLI, including input conventions, safe workflows,
and examples for every subcommand.

## Global Options

Available on all commands:

- `--json` Output JSON envelopes (`ok`, `data`, `meta`)
- `--cwd <path>` Run in a target directory
- `--quiet` Suppress non-JSON output

## Input Conventions

Text inputs can be provided directly, from files, or stdin:

- `@-` read from stdin
- `@path/to/file` read from a file

JSON inputs use the same convention:

- `--input @file.json` for create
- `--patch @file.json` for update
- `--steps @file.json` for steps add

For lists (like `--blocked-by`), values can be comma separated or repeated.

## Valid Values

Task status:

- `open`, `ready`, `blocked`, `completed`, `cancelled`, `deleted`

Task type:

- `epic`, `feature`, `bug`, `investigation`, `chore`

Task priority:

- Integer (lower = higher priority)
- Default: `100`

Step status:

- `pending`, `in_progress`, `completed`, `skipped`

Note kinds:

- `discovery`, `decision`

Note source:

- `user`, `agent`, `system`

## Command Reference

### Initialize

Create the local database in the current directory.

```bash
continuum init
```

### List

List tasks with filters and pagination.

```bash
continuum task list --status ready --type feature --sort priority --order asc --limit 20
```

Options:

- `--status <status>`
- `--type <type>`
- `--parent <task_id>`
- `--include-deleted`
- `--cursor <cursor>`
- `--limit <limit>`
- `--sort <createdAt|updatedAt|priority>`
- `--order <asc|desc>`

Default ordering (when `--sort` is omitted): priority ascending, then createdAt ascending.

### Get / View

View a task, optionally expanding relations or printing a tree.

```bash
continuum task get <task_id>
continuum task view <task_id> --expand all
continuum task get <task_id> --tree
```

Options:

- `--tree` show child tasks in a compact tree view
- `--expand <items>` comma-separated: `parent,children,blockers,all`
- `--include-deleted` include deleted children in tree/expand

### Create

Create a task using flags or JSON input.

```bash
continuum task create --title "Add login audit" --type feature --description "@docs/task.md"
```

```bash
continuum task create --input @task.json
```

Supported fields:

- `--title <title>` (required)
- `--type <type>` (required)
- `--status <status>`
- `--priority <number>` (lower = higher priority)
- `--intent <intent>`
- `--description <description>`
- `--plan <plan>`
- `--parent <task_id>`
- `--blocked-by <ids...>`

### Update

Update a task with direct flags or a JSON patch.

```bash
continuum task update <task_id> --status ready --plan @plan.md
```

```bash
continuum task update <task_id> --patch @patch.json
```

Supported fields:

- `--title <title>`
- `--type <type>`
- `--status <status>`
- `--priority <number>` (lower = higher priority)
- `--intent <intent>`
- `--description <description>`
- `--plan <plan>`
- `--parent <task_id>`
- `--blocked-by <ids...>`

### Complete

Complete a task with an outcome summary.

```bash
continuum task complete <task_id> --outcome @outcome.md
```

### Delete

Delete a task by id. Only do this when explicitly requested.

```bash
continuum task delete <task_id>
```

### Validate

Check whether a status transition is valid (missing fields, open blockers).

```bash
continuum task validate <task_id> --transition completed
```

### Graph

Query task relationships.

```bash
continuum task graph ancestors <task_id>
continuum task graph descendants <task_id>
continuum task graph children <task_id>
```

### Templates

List available task templates (types).

```bash
continuum task templates list
```

### Steps

Add, update, complete, or list task steps.

Add steps (JSON array of TaskStepInput):

```bash
continuum task steps add <task_id> --steps @steps.json
```

Update a step:

```bash
continuum task steps update <task_id> <step_id> --status in_progress
```

Complete a step:

```bash
continuum task steps complete <task_id> --step-id <step_id> --notes "Done"
```

Note: completing an already completed step returns a warning and makes no changes.

List steps:

```bash
continuum task steps list <task_id>
```

TaskStepInput shape:

```json
[
  {
    "title": "Investigate failure",
    "description": "Reproduce issue and capture logs",
    "status": "pending",
    "position": 1,
    "summary": null,
    "notes": null
  }
]
```

### Notes

Add discoveries or decisions to a task.

```bash
continuum task note add <task_id> --kind discovery --content "@notes.md" --source agent
```

Options:

- `--kind <discovery|decision>` (required)
- `--content <content>` (required)
- `--rationale <rationale>` (decision support)
- `--impact <impact>`
- `--source <user|agent|system>` (default: agent)

## Suggested Safe Workflow

1. `init` once per repo
2. `task create` with intent/description/plan and an explicit priority
3. `task steps add` for executable subunits
4. `task note add` for discoveries/decisions
5. `task validate --transition ready|completed` before changing status
6. `task update --status ...` to progress
7. `task complete --outcome ...` when finished

## JSON Output Contract

When `--json` is provided, the CLI returns:

```json
{
  "ok": true,
  "data": {},
  "meta": { "cwd": "/path", "durationMs": 0 }
}
```

Errors follow:

```json
{
  "ok": false,
  "error": { "code": "...", "message": "..." },
  "meta": { "cwd": "/path", "durationMs": 0 }
}
```
