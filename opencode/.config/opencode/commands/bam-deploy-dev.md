---
description: Ship the current branch end-to-end — commit, push, open a PR against the correct base branch, run the Copilot review loop until clean, confirm CI is green, then merge. Follows the workflow + safety rules.
agent: build
---

Deploy the current branch end-to-end: **commit → push → PR → Copilot loop → CI green → merge**. Follow `@rules/workflow.md` and `@rules/safety.md` at every step. This command mutates remote state, so **verify every mutation (confirm exit 0, never swallow stderr) and stop to confirm with the human before any irreversible step — a merge or a force-push.**

Optional context (a PR title hint, scope note, or special instructions): $ARGUMENTS

Current state:

- Branch: !`git branch --show-current`
- Working tree: !`git status --short --branch`
- Recent commits: !`git log --oneline -8`
- Repo default base: !`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`

## 1. Commit the work

Stage only the intended changes — inspect `git status` and `git diff` first, and don't blanket `git add .` if it would sweep in unrelated files or secrets. Write a **Conventional Commits** message (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, …): subject ≤ 72 chars, imperative mood, no trailing period; body wrapped at 72 explaining *why*, not *what*. One logical change per commit. Confirm the commit landed (`git log -1`, exit 0) before continuing.

## 2. Push the branch

Push the current branch to its remote, setting upstream on first push (`git push -u origin <branch>`). Confirm it succeeded — exit 0 and the remote ref advanced. Do **not** redirect stderr to `/dev/null`; a swallowed push error produces a false "done". Never `--force` / `--force-with-lease` without explicit confirmation.

## 3. Open the PR — verify the base branch first

**Do not assume `main`/`master`.** Confirm the repo's default base branch before creating the PR (use the "Repo default base" surfaced above, or `gh repo view --json defaultBranchRef`); some bamboo repos target **`m`**. Then open the pull request explicitly against that base so it can't silently retarget the wrong branch:

```
gh pr create --base <default-branch> --fill
```

In the PR body, summarize the *why* in 1–3 bullets, then list the notable changes and any follow-ups or known gaps (per `@rules/workflow.md`). Capture the PR number — the next steps need it.

## 4. Run the Copilot review loop

Hand off to **`/bam-copilot-loop <PR>`** to re-request Copilot, reply to inline comments, and iterate until the review reports **"generated no new comments"**. Address each substantive comment with a real fix (and a "Fixed in `<sha>`" reply) rather than dismissing it. Re-running this command is the loop's job — don't duplicate the re-trigger mechanics here.

## 5. Confirm CI green AND Copilot clean

Gate the merge on **both**, not either:

- **CI green** — `gh pr checks <PR>` shows every required check passing (not pending, not failing).
- **Copilot clean** — the step 4 loop exited on "no new comments".

If anything is red or still pending, fix it and return to step 4. Never disable or skip a failing check just to force a pass.

## 6. Merge

Only once CI is green and Copilot is clean, and **only with explicit human confirmation** (merge is irreversible — a safety-rule gate), merge into the verified base branch:

```
gh pr merge <PR> --squash --delete-branch
```

Match the repo's merge convention if it differs (squash vs. merge commit). Verify the merge actually completed — exit 0 and the PR shows as merged — then report the merged SHA. Stop here; do not start follow-up work without a new instruction.
