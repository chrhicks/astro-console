# GitHub Stacked Pull Requests For Astro Console

Status: **research evidence — 2026-08-12; not current delivery authority**

## Question

Should Astro Console use GitHub stacked pull requests to keep generated work
small and reviewable, and what exact workflow would that require?

This note uses only official GitHub documentation, official GitHub CLI
documentation, and this repository's current operating files and Git state.
GitHub's stacked pull request feature is in public preview and can change.

## Recommendation

Keep an ordinary pull request from `codex/<topic>` to `main` as the default.
Use a short stack only when all of these conditions are true:

1. The next small change has a real code dependency on an unmerged change.
2. Work must continue before the lower change merges.
3. Each layer is coherent and can be reviewed on its own.
4. The owner accepts bottom-up merge order and cascading rebases.

Generated commits alone are not a reason to make a stack. If two candidates
can each start from `main`, use two independent branches and consider one
candidate at a time. This keeps either candidate independently reviewable,
mergeable, or discardable. A stack is useful for a sequence such as protocol
contract -> server consumer -> web consumer, where each upper layer actually
requires the lower layer.

For this hobby repository, cap a normal stack at two or three pull requests.
Do not adopt stacks as a repository-wide rule while the feature is in public
preview. Install the extension only for a workstream that needs it.

## Repository Fit

The repository currently uses:

- `main` as the checked-out branch and `origin/main` as its upstream;
- `https://github.com/chrhicks/astro-console.git` as `origin`;
- `codex/` topic branch names for recent focused work;
- GitHub Issues and the `gh` CLI as the issue and pull request surface; and
- a simple-work-first rule with small, complete changes.

The local GitHub CLI is version `2.92.0`, which satisfies the stacked-PR
quickstart requirement of `gh` 2.90.0 or later. The `gh-stack` extension is not
currently installed. Recent merged pull request #16 used the ordinary shape
`codex/issue-15-origin-cutover` -> `main`; the local guidance defines normal
`gh pr` operations but no stack convention.

Repository sources:
[AGENTS.md](../../../../AGENTS.md),
[issue-tracker guidance](../../../agents/issue-tracker.md).
The CLI version and PR shape were inspected read-only on 2026-08-12.

## What A Stack Means

GitHub defines a stack as two or more pull requests in one repository. The
bottom pull request targets the trunk, normally `main`; each higher pull
request targets the head branch immediately below it. Each pull request then
shows only the diff between its branch and that lower branch. Dependencies must
point downward: an upper layer can use a lower layer, but a lower layer must not
require an upper one. [GitHub: About stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)

This gives a clear decision rule:

- **Use a stack:** candidate B cannot compile or make sense without candidate
  A, and B must start before A merges.
- **Use independent pull requests:** A and B are alternatives, unrelated
  cleanups, or changes that can each target `main`.
- **Use one ordinary pull request:** the whole change is already one small,
  coherent review unit.

GitHub explicitly presents stacks as a way to split large, dependent changes,
including high-volume agent-generated work, into focused layers. It also says
the author owns the stack shape and should review the bottom layer before
building on it because a foundation error propagates upward.
[GitHub: Stack AI-generated code in pull requests](https://docs.github.com/en/copilot/tutorials/stack-ai-generated-code-in-pull-requests)

## Exact Branch And Base Workflow

For a three-layer stack, the branch and pull request graph is:

```text
main
└── codex/issue-17-protocol   PR 1 base: main
    └── codex/issue-17-server     PR 2 base: codex/issue-17-protocol
        └── codex/issue-17-web        PR 3 base: codex/issue-17-server
```

The official extension creates and tracks this graph:

1. Install it with `gh extension install github/gh-stack`.
2. From the trunk, run `gh stack init <bottom-branch>`.
3. Commit the bottom layer.
4. Run `gh stack add <next-branch>` and commit the next layer. Repeat only for
   another real dependency.
5. Run `gh stack submit`. It pushes the branches, creates or updates the pull
   requests with the correct bases, and links them as a GitHub stack.
6. Use `gh stack view` to inspect branch, pull request, status, and commit state.

[GitHub: Stacked PR quickstart](https://docs.github.com/en/pull-requests/get-started/stacked-prs-quickstart),
[GitHub: Creating stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-stacked-pull-requests)

It is also possible to create the same branch bases with ordinary Git and
`gh pr create --base <lower-branch>`, then link eligible pull requests on the
website or with `gh stack link`. For a new Astro Console stack, `gh stack init`,
`add`, and `submit` are leaner because they keep the local dependency graph and
the GitHub stack object together. The regular CLI supports explicit PR bases,
but it does not provide cascading stack operations.
[GitHub CLI: `gh pr create`](https://cli.github.com/manual/gh_pr_create),
[GitHub: Stacked PR CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)

## Review And Update Mechanics

Review from bottom to top when the layers are strongly dependent. GitHub shows
only the current layer's diff, so feedback belongs on the branch that owns that
change. To fix a lower layer:

1. `gh stack checkout <branch>`
2. make and commit the fix there;
3. `gh stack rebase --upstack` to replay every higher branch onto it; and
4. `gh stack push` to update the remote branches with `--force-with-lease`.

The higher pull requests then contain the lower fix and their CI checks run
again. A full `gh stack rebase` cascades from `main` to the top. A conflict stops
the operation for explicit resolution or `gh stack rebase --abort`.
[GitHub: Reviewing stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-stacked-pull-requests),
[GitHub: Managing stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/managing-stacked-pull-requests)

After a bottom merge, `gh stack sync --prune` fetches, fast-forwards the trunk,
rebases and pushes the remaining layers, synchronizes pull request state, and
removes merged local branches. Use it only with a clean worktree when remote
and local stack composition may differ. A true local/remote divergence needs an
explicit choice; non-interactive sync stops instead of guessing.
[GitHub: Managing stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/managing-stacked-pull-requests)

## GitHub Display, Retargeting, And Merge Order

GitHub shows a stack icon and the current layer number at the top of each pull
request. The merge box contains a stack map with every pull request, status,
and navigation link. Each pull request shows only its layer diff.
[GitHub: About stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs)

Stacks merge from the bottom upward:

- Merging the bottom pull request merges only that layer.
- Selecting a middle pull request merges it and every unmerged layer below it
  as one operation. A middle layer cannot merge alone.
- Selecting the top pull request merges the complete stack.
- After a bottom merge, GitHub automatically rebases the remaining branches
  and makes the next pull request target the trunk. When a contiguous partial
  stack merges, the layers above remain open and target the stack base.

All selected pull requests must form a contiguous group starting at the lowest
unmerged layer. Lower pull requests must have approval and passing checks, the
history must be linear, and the selected pull request must satisfy the trunk's
rules. `gh stack merge <pr-number>` performs the same merge through the official
extension; the operation is all-or-nothing unless a merge queue processes the
layers separately.
[GitHub: Merging stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests),
[GitHub: Stacked PR CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)

## Main Costs And Failure Modes

1. **A higher merge includes lower work.** Choosing PR 3 does not merge only
   PR 3; it merges PRs 1–3. This is correct for a dependency chain but wrong for
   independent candidates.
2. **A lower edit rewrites the layers above it.** The cascading rebase changes
   their commit identities, force-pushes with lease, and reruns CI. Conflicts
   can occur at each higher layer.
3. **Manual base changes can disturb review context.** Outside the managed
   stack flow, GitHub warns that changing a PR base can remove commits from its
   timeline and make review comments outdated.
   [GitHub: Changing the base branch of a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/changing-the-base-branch-of-a-pull-request)
4. **The stack must remain linear.** A moved trunk or a push to a lower layer
   can require a full cascading rebase before merge.
5. **The feature has limits.** It is public preview, all branches must be in the
   same repository, and GitHub Desktop does not support stacks.
6. **Official preview docs currently conflict about auto-merge.** The dedicated
   merge guide says auto-merge is not supported, while the Copilot stacking
   tutorial recommends auto-merge. Use the dedicated merge guide as the
   operating rule and do not depend on auto-merge until GitHub resolves this
   mismatch.

GitHub's linked stack prevents an isolated out-of-order merge. Inference: a
manually managed, unlinked chain does not give that guardrail; merging an upper
branch can carry reachable lower commits with it and can cause a lower pull
request to be marked as indirectly merged. GitHub notes that an indirectly
merged pull request can be marked merged even when its own branch-protection
requirements were not satisfied. Squash and rebase merges also change commit
identity; descendants must be rebased through the official stack flow or they
can show prior commits again and repeat conflicts. Use the stack object and
`gh stack` operations if the dependency chain matters.
[GitHub: Pull request merges](https://docs.github.com/en/pull-requests/reference/pull-request-merges)

[GitHub: About stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs),
[GitHub: Merging stacked pull requests](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests),
[GitHub: Stack AI-generated code in pull requests](https://docs.github.com/en/copilot/tutorials/stack-ai-generated-code-in-pull-requests)

## Does `gh` Natively Orchestrate Stacks?

The normal `gh pr` command set can create a dependent branch-base chain, edit
a base, update a branch, and merge one pull request. It does not orchestrate
the chain as a local stack.

GitHub now provides first-party orchestration through the separately installed
`github/gh-stack` extension. It adds `gh stack init`, `add`, `submit`, `view`,
`checkout`, `rebase`, `push`, `sync`, `modify`, `link`, and `merge`. Thus the
precise answer is: **not in core `gh pr`; yes through GitHub's official CLI
extension**. The extension uses existing `gh` authentication.
[GitHub: Stacked PR CLI commands](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands)

## Minimal Astro Console Example

Use this only after deciding that the server layer truly depends on the
protocol layer. The commands are an example; this research did not run them.

```bash
git switch main
gh extension install github/gh-stack

gh stack init codex/issue-17-protocol
# make, verify, stage, and commit only the protocol change

gh stack add codex/issue-17-server
# make, verify, stage, and commit only the dependent server change

gh stack submit
gh stack view
```

For lower-layer feedback:

```bash
gh stack checkout codex/issue-17-protocol
# fix, verify, stage, and commit the protocol change
gh stack rebase --upstack
gh stack push
```

Merge only the approved bottom layer by passing that bottom PR number, then
synchronize the surviving layer:

```bash
gh stack merge <bottom-pr-number>
gh stack sync --prune
```

For an independent candidate, do not add it to this stack:

```bash
git switch main
git switch -c codex/issue-18-candidate-a
# make, verify, stage, and commit one candidate
gh pr create --base main
```

This preserves Astro Console's current one-candidate-at-a-time preference and
uses stack complexity only where dependency makes it useful.
