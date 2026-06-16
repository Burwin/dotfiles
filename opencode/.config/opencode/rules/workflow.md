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

### Adding reviewers

When asked to add a reviewer to a PR using a shorthand (first name, nickname,
partial handle):
1. If you don't already have plausible GitHub usernames in context for this
   repo, fetch them first — e.g.,
   `gh api repos/<owner>/<repo>/collaborators` or
   `gh api repos/<owner>/<repo>/contributors`.
2. Match the shorthand against the fetched list to find the likely username.
3. If multiple candidates are plausible, confirm before assigning.

### Review comments

When asked to review, check, or look at PR review comments (e.g. "check copilot
PR review comments", "what does the review say?"):
1. Fetch the review body: `gh pr view <number> --repo <owner/repo> --comments`
2. Fetch **file-level comments** separately: `gh api repos/<owner>/<repo>/pulls/<number>/comments`
   - These are NOT included in `gh pr view --comments` output — a separate API call is required.
3. Report both the review summary AND any individual file/line comments.

## Goal-driven execution

Turn a task into a verifiable goal before writing code, then loop until it's
met — strong success criteria let you self-correct instead of guessing.

- **Define "done" up front.** Restate the task as a checkable outcome, not a
  vague instruction ("make it work" is too weak to verify against).
- **Prefer test-first for bugs and behavior changes.** Write a failing test
  that reproduces the bug (or pins the new behavior), then make it pass.
- **State a brief plan for multi-step work,** with a verification check per
  step:
  ```
  1. <step> → verify: <check>
  2. <step> → verify: <check>
  ```
- **Loop until verified.** Run the check; if it fails, fix and re-run rather
  than declaring success. See also mutation-verification in `@rules/safety.md`.

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
