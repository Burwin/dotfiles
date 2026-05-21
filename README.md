# dotfiles

For storing configuration files (and associated tooling) to share across machines.

## Tests

Smoke test for the custom opencode plugins (`notify.ts`,
`cost-tracker.ts`, and `toggl-time.ts` when present). Static
parse-checks + unit/dispatch suites:

```bash
opencode-plugin-smoke
```

Add `--live` to also spawn a transient `opencode serve` and verify
every plugin loads without error. The live tier sandboxes plugin DB
writes to temp files; your real `~/.local/state/opencode-cost.db` is
untouched.

```bash
opencode-plugin-smoke --live
```

Underlying `bun test` invocation still works directly:

```bash
bun test ./opencode/.config/opencode/plugins/
```

> [!NOTE]
> Toggl time-tracking tooling (the `toggl-*` CLIs and the `toggl-time.ts`
> opencode plugin) used to live here under `toggl/` and
> `opencode/.config/opencode/plugins/toggl-time.ts`. It moved to a private
> repo so client/project metadata stays out of public commits. The tmux
> status segment now invokes `toggl-tmux-status` from `~/.local/bin/`,
> which the private repo's `install.sh` symlinks into place.
