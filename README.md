# dotfiles

For storing configuration files (and associated tooling) to share across machines.

## Tests

The opencode `notify.*` plugin ships with a `bun:test` smoke suite alongside
its implementation. Run it with:

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
