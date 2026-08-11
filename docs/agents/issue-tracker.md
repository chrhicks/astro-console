# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repository from `git remote -v`. The `gh` CLI does this automatically when run inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

When set to `yes`, pull requests run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>`.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, then keep only `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` author associations.
- **Comment, label, or close**: use `gh pr comment`, `gh pr edit`, or `gh pr close`.

GitHub shares one number space across issues and pull requests. Resolve an unclear number with `gh pr view <number>`, then fall back to `gh issue view <number>`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The map is one issue with child issues as tickets.

- **Map**: Create one issue with the `wayfinder:map` label. Its body contains Notes, Decisions-so-far, and Fog.
- **Child ticket**: Link an issue to the map as a GitHub sub-issue. If sub-issues are not enabled, add it to a task list in the map and put `Part of #<map>` at the top of the child body. Apply a `wayfinder:<type>` label: `research`, `prototype`, `grilling`, or `task`.
- **Blocking**: Use GitHub's native issue dependencies. If dependencies are not available, put `Blocked by: #<number>` at the top of the child body.
- **Frontier query**: List the map's open children. Remove assigned children and children with open blockers. The first remaining child in map order is next.
- **Claim**: Run `gh issue edit <number> --add-assignee @me` before starting work.
- **Resolve**: Comment with the answer, close the child, and add its context pointer to the map's Decisions-so-far.
