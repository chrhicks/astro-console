---
name: memory-manager
description: 'Consolidate NOW/RECENT/MEMORY files for Continuum sessions.'
license: MIT
compatibility: opencode
metadata:
  trigger: manual_user_request, manual_agent_request, session_end
  priority: '800'
  requires_state: writable,no_active_agent
  min_version: '0.1.0'
---

# Memory Manager Skill

## Purpose

Maintain a 3-tier memory system (NOW → RECENT → MEMORY) that captures and
consolidates project context across OpenCode sessions.

Use `continuum memory` for all memory operations. Do not manually edit files
under `.continuum/memory/` unless the CLI cannot run and recovery is required.
When the CLI is installed globally, run memory commands from the target repo or
pass `--cwd <repo-or-subdir>`; memory resolves project-local state from the
nearest parent containing `.continuum/` or `.git/`.

## Memory Architecture

### Three Tiers

1. **NOW** - Live session capture (current session, ~200 lines max)
2. **RECENT** - Summary of the last few sessions (~500 lines, for continuity)
3. **MEMORY** - Long-term consolidated knowledge (permanent archive)

## CLI Reference

### Initialize

```bash
continuum memory init
```

Sets up `.continuum/memory/` on first use.

### Session Management

```bash
continuum memory session start          # Start a new NOW session explicitly
continuum memory session end            # End the current session
continuum memory session end --consolidate  # End and consolidate in one step
```

`session start` is optional — `append` auto-starts a session if none exists.

### Appending to the Current Session

```bash
continuum memory append user "<message>"
continuum memory append agent "<message>"
continuum memory append tool <tool_name> ["<summary>"]
continuum memory session append user "<message>"   # same, scoped to session
```

Passing `/exit` as the user message ends the active session.
Passing `/exit --consolidate` ends it and consolidates immediately.

### Inspecting Memory

```bash
continuum memory status       # Summary: current NOW file, sizes, last consolidation
continuum memory list         # All memory files with sizes and ages
continuum memory validate     # Check structure of all memory files
continuum memory log          # View consolidation audit log
continuum memory log --tail 20
```

### Consolidation

```bash
continuum memory consolidate            # Consolidate NOW → RECENT → MEMORY
continuum memory consolidate --dry-run  # Preview without writing
```

Consolidation updates RECENT and MEMORY from the current NOW file, then logs the
result to the audit trail. Use `--dry-run` to review output before committing.

### Search

```bash
continuum memory search "<query>"
continuum memory search "<query>" --source all
continuum memory search "<query>" --source memory
continuum memory search "<query>" --source recall
continuum memory search "<query>" --tier NOW
continuum memory search "<query>" --tier RECENT
continuum memory search "<query>" --tier MEMORY
continuum memory search "<query>" --tier all
continuum memory search "<query>" --tags tag1,tag2
continuum memory search "<query>" --after 2026-02-01T00:00:00Z
```

Use `continuum memory search` as the default retrieval command. It searches
materialized memory and recall summaries together unless you narrow `--source`.

### Collect

```bash
# Collect OpenCode sessions into local recall artifacts
continuum memory collect --source opencode [--db <path>] [--import]

# Collect task history directly into consolidated memory
continuum memory collect --source task
continuum memory collect --source task --task <task_id>
continuum memory collect --source task --status open,completed
```

### Recovery

```bash
continuum memory recover                     # Find stale NOW files (default threshold)
continuum memory recover --hours 12          # Find sessions older than 12 hours
continuum memory recover --hours 12 --consolidate  # Find and consolidate them
```

### Recall Compatibility (OpenCode Session Import)

Use these only for compatibility, debugging, or working with pre-existing
summary directories:

```bash
# Import summaries directly from a directory
continuum memory recall import --summary-dir <dir> [--dry-run]

# Search existing recall summaries (compatibility alias)
continuum memory recall search "<query>"

# Preferred unified retrieval form
continuum memory search "<query>" --source recall
continuum memory search "<query>" --source recall --mode bm25
continuum memory search "<query>" --source recall --limit 10
```

The supported path for new data is still collector-first:

```bash
continuum memory collect --source opencode --import
```

## Key Workflows

### Starting a Session (Working Agent)

1. Begin the session (auto-started on first append, or explicitly):
   ```bash
   continuum memory session start
   ```
2. For each significant exchange, append:
   ```bash
   continuum memory append user "<user message summary>"
   continuum memory append agent "<agent response summary>"
   continuum memory append tool <tool_name> "<what it did>"
   ```
3. End and consolidate on session close:
   ```bash
   continuum memory session end --consolidate
   ```
   Or, if the session already ended:
   ```bash
   continuum memory consolidate
   ```

### Consolidating Memory

```bash
continuum memory consolidate --dry-run   # Preview first
continuum memory consolidate             # Write RECENT + MEMORY
```

### Checking Status Before and After

```bash
continuum memory status    # Sizes, current NOW, last consolidation time
continuum memory list      # All files with ages
continuum memory validate  # Structural check
continuum memory log --tail 20  # Recent audit entries
```

### Recovering Abandoned Sessions

```bash
continuum memory recover --hours 6
continuum memory recover --hours 6 --consolidate
```

## What to Capture

### High Priority (Always Keep)

- **Decisions**: Why we chose X over Y, architecture choices
- **Discoveries**: Bug root causes, surprising behavior, library quirks
- **Failures**: What didn't work and why (negative knowledge)
- **Patterns**: Reusable approaches, established conventions
- **Milestones**: Project phase completions, releases

### Medium Priority (Condense)

- **Task progress**: Summarize, don't transcribe every step
- **Code changes**: Reference file locations, don't duplicate code
- **Conversations**: Keep key user-agent dialog, omit routine commands

### Low Priority (Discard)

- Routine file operations (ls, cd, git status)
- Tool boilerplate and standard command output
- Failed experiments that taught nothing new
- Temporary workarounds that were later removed

### Special Cases

- **Repeated topics**: Note recurrence and link to prior discussion
- **Abandoned approaches**: Document why (useful future reference)
- **Security concerns**: Note but never log secrets; use placeholders

## When to Run

This skill triggers when:

- User explicitly requests: "consolidate memory", "reflect on recent work"
- Working agent suggests and user approves
- Session ends cleanly (`/exit` or `continuum memory session end`)
- Stale NOW sessions are found during recovery

## Suggesting Consolidation

When you notice any of the following, ask the user if they'd like to consolidate:

- Session is >100 lines or >3 hours old (`continuum memory status`)
- Important decisions or discoveries were made
- User says "wrap up", "we're done", "let's consolidate", "call it a day"
- User expresses frustration about repeating context

Ask:

> This session contains important decisions about X and Y. Should I consolidate the memory now?

If the user agrees, trigger: `skill("memory-manager")`

## Example Trigger Phrases

**User might say**:

- "consolidate my memory"
- "reflect on what we've learned"
- "summarize today's work"
- "update the project memory"
- "save this for future reference"
- "we're done for today"

## Error Handling

- If a command fails, run `continuum memory validate` to check for structural issues.
- For stale or abandoned sessions, use `continuum memory recover`.
- Do not delete lock files or memory files manually; let the CLI manage cleanup.
- If a consolidation fails partway, re-run `continuum memory consolidate`; the CLI
  handles partial state.

## User Customization

Users can override defaults by creating `.continuum/memory/config.yml`:

```yaml
now_max_lines: 200
now_max_hours: 6
recent_session_count: 3
recent_max_lines: 500
memory_sections:
  - Architecture Decisions
  - Technical Discoveries
  - Development Patterns

# Optional: LLM-powered narrative consolidation
consolidation:
  api_url: https://opencode.ai/zen/v1/chat/completions
  api_key: sk-... # or set OPENCODE_ZEN_API_KEY / OPENAI_API_KEY env var
  model: gpt-4o-mini
  max_tokens: 4000
  timeout_ms: 120000
```
