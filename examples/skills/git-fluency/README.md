# Git fluency

Make small commits and recover from mistakes without guessing about repository state.

## Target performance

Choose the correct single Git command for at least 18 of 20 staging, branch, inspection, integration, and undo scenarios in 20 minutes, then explain a safe recovery sequence in a disposable repository.

## Subskill map

- `stage-changes` — Stage deliberately; priority 1; prerequisites: none.
- `make-commits` — Create and amend commits; priority 1; prerequisites: `stage-changes`.
- `branch-work` — Work on branches; priority 1; prerequisites: `make-commits`.
- `inspect-history` — Read log and diffs; priority 2; prerequisites: `make-commits`.
- `integrate-work` — Choose merge or rebase; priority 2; prerequisites: `branch-work`, `inspect-history`.
- `undo-worktree` — Restore and reset local state; priority 2; prerequisites: `stage-changes`, `inspect-history`.
- `recover-history` — Recover and reverse commits; priority 3; prerequisites: `undo-worktree`, `integrate-work`.

## How to start

1. `psi import-skill examples/skills/git-fluency`
2. `/skill`
3. `/practice`

Practice in short rounds: attempt before opening hints, name one lesson after a miss, and retry. Use the build quest to combine skills, then try the boss. Failures still earn progress.

Numeric expected answers are stored as strings to match `Challenge.expected`; tolerances are absolute. Text answers use a canonical answer and listed variants. Equivalent solutions beyond those variants may need tutor review. Open tasks use rubrics.

Use a disposable local repository for command practice. Undo prompts explicitly state which changes should survive. Published history is preserved with new commits.
