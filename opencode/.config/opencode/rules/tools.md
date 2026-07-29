# Tooling Preferences

Defaults when the project doesn't dictate otherwise. Per-repo `AGENTS.md`
overrides these.

## Search and file navigation

- `rg` (ripgrep) instead of `grep`.
- `fd` instead of `find`.
- `jq` for JSON; `yq` for YAML.

## JavaScript / TypeScript

- **Use the lockfile present** to pick the package manager:
  - `bun.lock` / `bun.lockb` → `bun`
  - `pnpm-lock.yaml` → `pnpm`
  - `yarn.lock` → `yarn`
  - `package-lock.json` → `npm`
- **New repo with no lockfile → `npm`.**
- Don't switch a repo's package manager without asking.
- Run scripts via the matching runner (`bun run`, `pnpm run`, etc.) rather than
  invoking node directly, so workspace resolution works.

## Python

<!-- TODO: settle on uv vs. poetry vs. pip+venv. -->

For now: defer to whatever the repo uses (`pyproject.toml` + `uv.lock`,
`poetry.lock`, `requirements.txt`, etc.). Don't introduce a new tool.

## .NET

- Run `dotnet tool restore` before `dotnet ef …` if `dotnet-tools.json` is
  present.
- Prefer `dotnet test --filter "FullyQualifiedName~..."` over editing csproj /
  test config to narrow runs.

## Email (`gmail-*` CLI suite)

Personal Gmail tooling lives in `~/.local/bin/gmail-*` (a single bash
dispatcher symlinked per subcommand, each exec'ing a `tsx` TypeScript
impl). **This is the way to send or read email — do NOT reach for
`sendmail`/`msmtp`/`mutt`/`gam`; none are installed, and probing for them
is the wrong instinct.**

Auth: `gmail-auth login` (browser OAuth; token cached at
`~/.local/state/gmail/token.json`, override `GMAIL_TOKEN_PATH`). Check with
`gmail-auth status`. Access tokens auto-refresh; a `gmail-*` command that
prints nothing and exits `3` means the token fully lapsed — run
`gmail-auth login`. Don't run `login` proactively; it's interactive.

Send / draft:

    gmail-send --to <addr> --subject <s> --body-file <path>
    #   --cc <addr> / --bcc <addr>   repeatable
    #   --attach <path>              repeatable
    #   --draft                      stage in Gmail drafts instead of sending
    #   --reply-to <id>              thread a reply (auto "Re:" + threadId)
    #   --body <s>                   inline body (short only); or pipe body on stdin
    #   --from <alias>               only a verified send-as alias
    #   --format json|table|ndjson   (default json)

Prefer `--body-file` for anything multi-line (sidesteps shell quoting).
For customer-facing mail, send `--draft` first so a human can eyeball it
in Gmail, then send. `--to` is single; put extra recipients on repeated
`--cc`/`--bcc`. Send exit codes: `0` ok, `1` usage, `3` auth, `4` API.

Read / triage (all accept `--format json|table|ndjson`):

    gmail-list           list / search messages
    gmail-get <id>       fetch one message or thread
    gmail-threads        list threads
    gmail-needs-reply    messages awaiting a reply
    gmail-draft-context  gather context for drafting a reply
    gmail-modify         labels / read state / archive
    gmail-labels         list labels
    gmail-filters        list filters

### Thread truth before outreach claims (2026-07-10 incident)

A single `gmail-get <messageId>` returns **one** message. A `gmail-list`
search can miss SENT replies (query shape, pagination, label filters).
Both were used in NS-1044 review to assert "Mike was never asked" and
later "nothing was sent yesterday" — wrong twice: the Reporting thread
already had two SENT replies (hold-off + date-range ask).

**Hard rule — before claiming anything about outreach state** (never
asked / already asked / never sent / should draft / should re-ask /
Mike hasn't been contacted):

1. **Load the full thread**, not a single message:
   `gmail-get --thread <threadId|anyMessageIdInThread> --format=json`
2. **Walk every message**: from, date, labels (`SENT` vs `DRAFT` vs
   `INBOX`), and body. Count real SENT outbound separately from drafts.
3. **Only then** state whether outreach happened, what was asked, and
   whether a new draft/send is warranted.
4. **Never draft or send a "first ask"** until step 1–2 show no prior
   equivalent SENT ask (or the human explicitly wants a nudge/follow-up).
5. Asana/card notes that say "BLOCKED: ask Mike" are **not** evidence
   that email was or wasn't sent — verify Gmail.

If you only have a message id from a card/link, still use `--thread` on
that id; `gmail-get` without `--thread` is insufficient for thread state.

### Stdin gotcha on mutations (2026-06-11 incident)

`gmail-modify` accepts message IDs from BOTH positional args AND stdin.
Inside a pipeline block, leftover stdin lines are consumed as additional
IDs and the mutation applies to ALL of them. Incident: the line below
was meant to trash 1 draft; `gmail-modify` read the other 13 piped IDs
from stdin and trashed the entire email thread. Recovered — but only
because the IDs were still visible in earlier tool output.

    # WRONG: read consumes one line; gmail-modify slurps the other 13
    gmail-get --thread "$T" --format json | jq -r '.messages[].id' |
      { read -r ID; gmail-modify "$ID" --trash; }

Rules for mutating gmail-* commands (`gmail-modify`, `gmail-send`):

- **Close stdin** — append `< /dev/null` — unless stdin is deliberately
  part of the invocation (a curated ID list piped to `gmail-modify`, or
  a body piped to `gmail-send`):

      gmail-modify "$ID" --trash < /dev/null

- **Never mix positional IDs with piped stdin** in the same
  `gmail-modify` invocation. Pick one source.
- **Prefer `--dry-run` first** for any multi-ID mutation.

Recovery notes:

- `--untrash` does NOT restore the INBOX label (unread state survives
  trashing; INBOX does not). After `--untrash`, follow with
  `--add-label INBOX < /dev/null`.
- A draft has its own message ID, discoverable via
  `gmail-list in:draft`; trash that ID to discard the draft.

## General

- Prefer the project's existing test runner, linter, and formatter. Don't
  introduce a new one without asking.
- When running a build/test/lint command for the first time in a session,
  prefer the canonical entry point (`./start-web.sh`, `npm test`, the documented
  task) over reconstructing the command from raw tool invocations.

## Long-running shell commands

Two independent things make long-running commands invisible to the user:

1. **Output piped through `tail`/`head`/`grep` is buffered until the
   upstream command finishes.** `slow-thing | tail -20` shows nothing
   for the full duration even though `slow-thing` is producing
   progress on stdout the whole time.
2. **The bash tool has its own per-call timeout.** When it fires, any
   stdout the command produced but hadn't yet flushed back to the
   tool is lost. A bash call that does `start-thing &; sleep 60;
   check-thing` may return `(no output)` even though `start-thing`
   printed a PID before the sleep — the timeout cut the session
   before the buffer drained.

The combination is what burns trust: the user sees a dead terminal,
can't tell a hang from legitimate work, and aborts.

When invoking a command that might take **more than ~60 seconds** (full
test suites, e2e runs, container-pulling builds, large installs):

- **Don't pipe long commands through `tail`/`head`/`grep`.** It hides
  incremental progress entirely.
- **Split launch and poll across separate tool calls.** Launch
  returns immediately; each poll is its own tool call that prints
  current progress. This gives the user concrete updates at each
  interval instead of a single silent wait, and it sidesteps the
  bash-tool timeout swallowing the launcher's stdout.

  Tool call #1 (launch, returns in ~1s):
  ```
  rm -f /tmp/run.log /tmp/run.pid
  nohup long-command > /tmp/run.log 2>&1 &
  echo $! > /tmp/run.pid
  echo "started pid=$(cat /tmp/run.pid)"
  ```

  Tool call #2 (poll later, runs `sleep N` then prints status):
  ```
  sleep 45
  tail -20 /tmp/run.log
  kill -0 $(cat /tmp/run.pid) 2>/dev/null && echo "still running" || echo "done"
  ```

  Repeat tool call #2 until "done". Do **not** chain the launcher and
  a long sleep in the same tool call — output from the launch line
  will be eaten if the tool times out before the sleep finishes.

- **Avoid long bash one-liners that chain multiple side effects.**
  `pkill A; sleep 2; pkill B; sleep 2; cd X && rm Y && nohup Z &` is
  fragile: if any step stalls (a `pkill` waiting on a zombie, an
  unrelated process holding a lock), the whole chain is opaque and
  the timeout eats the rest. Prefer one verb per tool call when the
  steps aren't trivially fast.

- **Narrow scope when you can.** E.g., e2e: `--grep`/`--project`/spec
  selection to run only the impacted slice first; escalate to the full
  suite only if the slice passes and the change is cross-cutting. Same
  shape for `dotnet test --filter`, `pytest -k`, `cargo test <name>`,
  etc.

- **Heads-up the user** before kicking off a multi-minute command if
  it's not obviously expected from context. One short line — "this will
  take ~3 min" — costs nothing and prevents a confused abort.

The same caveat applies to commands that produce a lot of output: if
the natural output is dozens of lines, prefer logging to a file and
reading the file with `Read` (which can use `offset`/`limit`) over
`| tail -N` from a single bash call.
