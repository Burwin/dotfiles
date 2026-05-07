# Workflow

Git, commits, branches, PRs, testing cadence.

## Commits

- **Use Conventional Commits.** Subject prefix from this set:
  - `feat:` — new user-facing capability
  - `fix:` — bug fix
  - `chore:` — tooling, deps, repo hygiene
  - `docs:` — documentation only
  - `refactor:` — code change that neither adds a feature nor fixes a bug
  - `test:` — adding or fixing tests
  - `build:` — build system / package manager
  - `ci:` — CI configuration
  - `perf:` — performance improvement
  - `style:` — formatting / whitespace only
- **Subject ≤ 72 chars**, imperative mood, no trailing period.
- **Body wrapped at 72 chars.** Explain *why*, not *what* — the diff shows
  *what*. Reference issues / tickets when relevant.
- **One logical change per commit.** Don't bundle unrelated work.
- **Never commit unless explicitly asked.** When asked, follow the safety rules
  in `@rules/safety.md`.

## Branches

- **Defer to repo convention.** Look at recent branches (`git branch -a`,
  `git log --all --oneline`) before creating a new one. Match the existing
  pattern.
- If no obvious convention exists, ask the user.
- The default branch is not always `main`/`master`. Check before assuming
  (e.g., one of the bamboo repos uses `m`).

## Pull requests

- Don't open PRs unless asked.
- When asked, summarize the *why* in 1–3 bullets at the top, then list notable
  changes. Mention any follow-ups or known gaps.
- Verify the base branch matches the repo's default before pushing.

## Testing

- Run tests after non-trivial refactors. Mention if you skipped them and why
  (e.g., "tests need live DB; ran build only").
- Don't disable failing tests to make a change pass. Fix them or surface them.
- For repos with multiple test tiers (unit / integration / e2e), default to
  the cheapest tier that exercises the change; escalate if the change is
  cross-cutting.

## Force operations

- Never `--force` or `--force-with-lease` without explicit confirmation,
  regardless of branch.
- Never rewrite shared history (`rebase -i` over pushed commits, `filter-branch`,
  etc.) without explicit confirmation.
