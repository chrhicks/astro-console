# Domain Docs

How the engineering skills consume this repository's domain documentation.

## Before exploring, read these

- Read `CONTEXT.md` at the repository root.
- Read relevant decisions under `docs/adr/`.

If these files do not exist, proceed silently. Do not require them before work starts. The domain-modeling workflows create them when domain terms or decisions need a durable record.

## File structure

This repository uses one domain context:

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-example-decision.md
│   └── 0002-example-decision.md
├── apps/
└── packages/
```

`CONTEXT.md` holds the shared domain glossary and model. `docs/adr/` holds decisions that apply across the Astro Console workspaces.

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `CONTEXT.md`. Do not replace it with a synonym that the glossary avoids.

If a required concept is absent, first check whether the project already uses another term. If the gap is real, record it for domain modeling.

## Flag ADR conflicts

If proposed work conflicts with an existing ADR, state the conflict. Do not override the ADR without an explicit decision.
