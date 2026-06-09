# Safety rules

Non-negotiable guardrails. These apply to every OpenCode session, in
every repo, regardless of project context.

## Verify mutations before reporting success

When running any command that changes state — file writes, deletes,
trash/archive operations, API calls that mutate remote data, git pushes,
rm, mv, drop table, etc. — never claim success without verifying.

- **Never redirect stderr to `/dev/null` (or equivalent) on mutation
  commands.** Hidden errors produce false confirmations to the user.
  (Real-world miss from this codebase: `gmail-modify --move-to-archive`
  silently failed with exit 1; the `2>/dev/null` swallowed the error
  message and the user got a confident "Done.")
- **Always confirm exit code 0** for commands you report as successful.
  If you can't see the exit code, you can't claim success.
- **Successful tools usually emit something.** If a command on success
  prints a confirmation blob (JSON, table row, line of text) and you see
  nothing, treat the silence as a failure signal worth checking before
  reporting.
- **Prefer `--dry-run` first** for irreversible operations (delete,
  trash, force-push, drop) when the tool supports it.
- **Read-only commands are exempt.** `2>/dev/null` is fine on `ls`,
  `cat`, `gmail-list`, etc., where stderr noise might be cosmetic.

## Don't invent CLI flags — check `--help` first

Guessing flag names produces silent no-ops that masquerade as success
(see the example above). Running `<cmd> --help` is cheap and removes the
guesswork. Specifically:

- If you've never run a CLI in this session, run `--help` once before
  the first invocation, especially for state-changing operations.
- If a command behaves unexpectedly (no output, weird output, exit 1),
  re-check `--help` rather than retrying with more guessed flags.
- When using a tool that's documented in a project's README or AGENTS.md,
  prefer the documented invocation patterns over inferred ones.
