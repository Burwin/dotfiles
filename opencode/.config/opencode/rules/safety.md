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

## Browser automation must be headless — never pop a window

The user works on a graphical desktop. A visible browser window stealing
focus mid-task is a serious interruption. Any time you drive a browser —
Playwright e2e runs, `playwright-mcp`, screenshots, walkthrough/video
recordings, scraping — it **must run headless**, no exceptions.

- **Never drive the user's real browser.** Do not launch or attach to
  `/usr/bin/chromium` (or any `--executable-path` pointing at the user's
  installed browser/profile); that always opens visible, focus-stealing
  windows. Use the automation tool's own bundled, isolated browser.
- **Force headless explicitly.** Don't rely on defaults. Pass `headless:
  true` / `--headless`; never pass `--headed` or set `PWDEBUG=1`. This
  holds even for slow-mo, recording, and walkthrough modes — Playwright
  records video fine while headless.
- **Belt-and-suspenders: strip the display env** for the browser
  subprocess so a window is physically impossible even if a config is
  wrong: prefix with `DISPLAY= WAYLAND_DISPLAY= OZONE_PLATFORM=`. With no
  display a stray headed launch *fails loudly* instead of popping up.
- **If you can't guarantee headless, don't run it.** Stop and ask.
  (Real-world miss from this codebase: an NS-1000 `WALKTHROUGH=1 npx
  playwright test` slow-mo run surfaced a Chromium window and interrupted
  the user; the repo config never pinned `headless: true`.)

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
