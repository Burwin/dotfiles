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
