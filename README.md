# dotfiles

For storing configuration files (and associated tooling) to share across machines.

## Tests

Tooling under `toggl/`, `tmux/`, and `opencode/` ships with `bun:test` smoke
suites alongside each implementation. Run the whole lot with:

```bash
bun test ./toggl/.local/bin/ ./tmux/.config/tmux/ ./opencode/.config/opencode/plugins/
```

Each test allocates an isolated tempdir + state DB via the `TOGGL_STATE_DB`
/ `TOGGL_PROJECT_DB` env vars, so the suite never touches your real
`~/.local/state/toggl/state.db` or live project DB.
