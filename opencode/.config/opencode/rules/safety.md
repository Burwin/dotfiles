# Safety Guardrails

These rules are non-negotiable. If a request conflicts with one, stop and confirm
with the user before proceeding.

## Secrets and credentials

- Never read, edit, print, or commit `.env`, `.env.*`, `*.secret*`, `credentials*`,
  `*.pem`, `*.key`, or anything matching `**/secrets/**`.
- If asked to commit a file that looks like it contains secrets, warn before doing
  so and require explicit confirmation.

## Git operations

- Never run `git commit` unless the user explicitly asks for a commit.
- Never run `git push --force` (or `--force-with-lease`) targeting `main`,
  `master`, `m`, or any default branch. Warn loudly if the user requests it.
- Never `git commit --amend` a commit that has already been pushed unless the
  user explicitly asks.
- Never skip git hooks (`--no-verify`, `--no-gpg-sign`).
- Never modify `git config` automatically.
- Never use `-i` / interactive flags on git subcommands (no support for
  interactive input).

## Destructive shell operations

- Ask before running: `rm -rf`, `truncate`, `> some-file` redirects that wipe
  existing content, `DROP TABLE`/`DROP DATABASE`, `kubectl delete`, `terraform
  destroy`, `aws s3 rm --recursive`, etc.
- Ask before running bulk-rewrite or auto-fix commands that touch many files:
  `npm audit fix --force`, `cargo update --aggressive`, `eslint --fix` against
  the whole repo, `prettier --write` against the whole repo, mass codemods.

## Project mutations

- Ask before installing new dependencies (any package manager).
- Ask before adding new top-level files or directories to a repo.
- Ask before introducing a new tool, framework, or language to a project.
- Don't disable or weaken existing tests, lint rules, or type checks to make a
  change pass. Surface the failure instead.
