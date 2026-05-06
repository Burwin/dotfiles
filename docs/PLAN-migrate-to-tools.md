# Plan: Migrate toggl/opencode time-tracking from `dotfiles` to `bamboo/tools`

> **Status:** planned, not yet executed.

Move every piece of the per-machine Toggl time-tracking system out of the
public `dotfiles` repo and into the private `bamboo/tools` repo. After this
migration, `dotfiles` retains only the parts of the opencode + tmux stacks
that have nothing to do with time tracking (notably the `notify.*` plugin).

## 0. Decisions baked into this plan

These were resolved up front; the rest of the document assumes them.

1. **tmux status segment** — `tmux/.config/tmux/toggl_project.sh` and its
   test move to `bamboo/tools` and are exposed via a `~/.local/bin/`
   symlink. `tmux.conf` is updated to invoke the bin name (no absolute
   path). Public dotfiles only references `~/.local/bin/`.
2. **Two opencode plugins overlap** — drop
   `bamboo/tools/src/opencode/plugins/toggl-project.ts` (and its
   `commands/select-toggl-project.md`). The dotfiles `toggl-time.ts`
   plugin is the survivor; selection continues to come from the `toggl-set`
   bash CLI writing `toggl_repo_state`. The to-be-deleted plugin is not
   currently installed on this machine.
3. **Archived PLAN docs** — leave the 5 existing
   `dotfiles/docs/archive/{toggl,opencode}/PLAN*.md` files in place. Their
   path references will become historical, which is consistent with the
   stated `docs/archive/README.md` disclaimer.
4. **Test runner** — keep `bun:test`. `src/toggl/` stays on npm + tsx +
   Node; `src/opencode/` runs on Bun (the opencode runtime is Bun anyway,
   so `bun:sqlite` is required at runtime). Tools becomes a polyglot repo.
5. **`~/.local/bin/` symlinks** — install via `bamboo/tools/src/opencode/install.sh`.
   No more hand-rolled symlinks.

## 1. Target layout in `bamboo/tools/`

```
bamboo/tools/
├── AGENTS.md                                  # update §Structure + add §Testing
├── README.md                                  # add Toggl Time Tracking section
├── package.json                               # (optional) add top-level test script
└── src/
    ├── toggl/                                 # unchanged (npm + tsx + better-sqlite3)
    └── opencode/
        ├── package.json                       # add @types/bun + scripts.test
        ├── package-lock.json                  # regenerated
        ├── install.sh                         # rewritten (see §3)
        ├── README.md                          # rewritten for new contents
        ├── .gitignore                         # unchanged
        ├── .env                               # unchanged (gitignored)
        ├── plugins/
        │   └── toggl-time.ts                  # MOVED from dotfiles
        ├── bin/                               # NEW dir: bash + Bun CLIs
        │   ├── toggl-state.lib.sh             # MOVED
        │   ├── toggl-set                      # MOVED
        │   ├── toggl-migrate                  # MOVED
        │   ├── toggl-time-migrate             # MOVED
        │   ├── toggl-group                    # MOVED
        │   ├── toggl-group.lib.ts             # MOVED
        │   ├── toggl-tmux-status              # MOVED + RENAMED (was tmux/…/toggl_project.sh)
        │   ├── toggl-set.test.ts              # MOVED, fixture path edited
        │   ├── toggl-migrate.test.ts          # MOVED, fixture path edited
        │   ├── toggl-time-migrate.test.ts     # MOVED, fixture path edited
        │   ├── toggl-group.test.ts            # MOVED, fixture path edited
        │   ├── toggl-group.cli.test.ts        # MOVED, fixture path edited
        │   └── toggl-tmux-status.test.ts      # MOVED + RENAMED
        └── test-fixtures/
            ├── heartbeats-synthetic.jsonl     # MOVED
            └── heartbeats-live.jsonl          # MOVED
```

Files to **delete** under `src/opencode/` as part of this same change:

- `src/opencode/plugins/toggl-project.ts`
- `src/opencode/commands/select-toggl-project.md`
- `src/opencode/commands/` (empty afterwards; remove the dir)

Naming notes:

- `toggl_project.sh` → `toggl-tmux-status` matches the `toggl-` prefix used
  by every other CLI in `bin/` and signals what it produces. Drop the
  `.sh` extension to match peers.
- The umbrella package stays named `src/opencode/` because the opencode
  plugin still anchors its install story; the bash bins ride along.

## 2. Code-content edits during the move

### 2a. Path-reference updates inside moved source files

| File (in new location)         | Edit |
|---                             |---|
| `bin/toggl-state.lib.sh`       | Line 30 docstring: `opencode/.config/opencode/plugins/toggl-time.ts` → `../plugins/toggl-time.ts` |
| `bin/toggl-group`              | Lines 18-20 docstring: same path replacement |
| `bin/toggl-group.lib.ts`       | Lines 4-6 + 19-20 docstrings: same path replacement |
| `plugins/toggl-time.ts`        | Line ~73 docstring: `toggl/.local/bin/toggl-state.lib.sh` → `../bin/toggl-state.lib.sh`. Comments referencing `<repo>/.toggl-time` migration history can stay (they describe pre-migration behavior). |
| `bin/toggl-tmux-status`        | Lines 38-40 wording: drop "and every other tool in the toggl/ tree" or update to reference the new layout. |
| `bin/toggl-set`                | Line 19 docstring referencing `~/src/bamboo/tools/src/toggl/toggl.db` (the project DB) is unchanged — that path is correct. |

The two SQLite DB paths embedded in source stay as-is:
- `TOGGL_PROJECT_DB` defaults to `~/src/bamboo/tools/src/toggl/toggl.db` (still correct).
- `TOGGL_STATE_DB` defaults to `~/.local/state/toggl/state.db` (still correct).

### 2b. Test-file fixture path updates

All test files in `bin/` reference fixtures via:

```ts
new URL("../../test-fixtures/", import.meta.url)
```

After the move, `bin/<test>.test.ts` and `test-fixtures/` are siblings
under `src/opencode/`, so the path becomes `"../test-fixtures/"`. Affects:

- `bin/toggl-group.test.ts` (line 26)
- `bin/toggl-group.cli.test.ts` (line 30)
- `bin/toggl-time-migrate.test.ts` (lines 22-23)

`bin/toggl-set.test.ts` and `bin/toggl-migrate.test.ts` do not load JSONL
fixtures, but spot-check for any other relative-path arithmetic (these
tests manipulate `TOGGL_PROJECT_DB` and `TOGGL_STATE_DB` env vars).

### 2c. `tmux/.config/tmux/tmux.conf` update

Today (line 85):

```
set -g status-right "#[fg=brightblack]#(cd '#{pane_current_path}' 2>/dev/null && ~/.config/tmux/toggl_project.sh) | #h "
```

After:

```
set -g status-right "#[fg=brightblack]#(cd '#{pane_current_path}' 2>/dev/null && toggl-tmux-status) | #h "
```

This relies on `~/.local/bin` being on the PATH inherited by tmux's `#()`
shell, which is true via Omarchy's default shell rc. If verification fails
on any host, fall back to the absolute path
`~/.local/bin/toggl-tmux-status`.

## 3. Rewrite `bamboo/tools/src/opencode/install.sh`

The existing script links one plugin and one slash-command. Rewrite to:

1. **Remove** the dead `toggl-project.ts` and `select-toggl-project.md`
   linking branches.
2. **Convert `~/.config/opencode` from dir-symlink to real dir** (one-shot,
   idempotent):
   - If `~/.config/opencode` is a symlink, `rm` it and `mkdir -p` a real
     directory.
   - File-symlink the things that stay in `dotfiles`:
     - `~/.config/opencode/opencode.json` → `~/src/dotfiles/opencode/.config/opencode/opencode.json`
     - `~/.config/opencode/tui.json` → `…/tui.json`
     - `~/.config/opencode/plugins/notify.ts` → `…/plugins/notify.ts`
     - `~/.config/opencode/plugins/notify.lib.ts` → `…/plugins/notify.lib.ts`
     - `~/.config/opencode/plugins/notify.test.ts` → `…/plugins/notify.test.ts`
3. **Symlink the new plugin** from `bamboo/tools`:
   - `~/.config/opencode/plugins/toggl-time.ts` → `<src>/plugins/toggl-time.ts`
4. **Bin-link the CLIs** into `~/.local/bin/`:
   - `toggl-set`, `toggl-migrate`, `toggl-time-migrate`, `toggl-group`,
     `toggl-state.lib.sh`, `toggl-tmux-status`
   - Skip-or-overwrite logic identical to the existing `link()` helper.
5. **Run `npm install`** in `src/opencode/` for plugin deps (already does
   this; preserve the `--force` / `--skip-install` flags).
6. **Print next steps**: tail mentions the dotfiles cleanup the user does
   once and the tmux.conf one-line update (also handled in §5).

The conversion in step 2 is the most disruptive bit. It is safe (idempotent
on re-run because `link()` already detects existing symlinks pointing to
the right target), but it is a one-shot transition per machine.

## 4. Updates inside `bamboo/tools/`

### 4a. `src/opencode/package.json`

Before:

```json
{
  "name": "opencode-config",
  "private": true,
  "description": "Bamboo opencode configuration: dependencies for plugins in ~/.config/opencode/plugins",
  "dependencies": { "@opencode-ai/plugin": "^1.14.33" }
}
```

After:

```json
{
  "name": "opencode-config",
  "private": true,
  "description": "Bamboo opencode plugin + Toggl time-tracking CLIs",
  "dependencies": { "@opencode-ai/plugin": "^1.14.33" },
  "devDependencies": { "@types/bun": "^1.3.13" },
  "scripts": {
    "test": "bun test ./bin ./plugins"
  }
}
```

Bun is required at runtime (opencode IS bun); `@types/bun` is only for
typecheck. The actual `bun` binary is assumed present on dev machines —
document under §4c.

### 4b. `AGENTS.md`

Update §Structure to reflect both sub-packages:

- `src/toggl/` — Toggl reporting tools (Node + npm + tsx + better-sqlite3)
- `src/opencode/` — opencode plugin + Toggl time-tracking CLIs (Bun)

Add a §Testing section:

```
cd src/opencode
npm install         # only needed once, or after dependency changes
npm test            # bun test ./bin ./plugins
```

Document the env-var contract used by tests (`TOGGL_STATE_DB`,
`TOGGL_PROJECT_DB`) so future contributors know they can safely run the
suite without touching the user's real DB.

### 4c. `README.md`

Add a section under "Internal Tools" describing the time-tracking pipeline
as it exists post-migration:

1. `toggl-pull` (already documented) populates project/client metadata in
   `src/toggl/toggl.db`.
2. `toggl-set` writes a `toggl_repo_state` row keyed by realpath of
   git-toplevel into `~/.local/state/toggl/state.db`.
3. opencode loads `plugins/toggl-time.ts`, which appends to
   `toggl_heartbeats` on every busy/idle transition.
4. `toggl-group` reads heartbeats and emits grouped time entries (JSON).
5. `toggl-tmux-status` queries the same state DB and renders a tmux status
   segment.

### 4d. (optional) Top-level `package.json`

`AGENTS.md` describes the root `package-lock.json` as an empty placeholder.
Add a top-level `scripts.test` that delegates if it's useful:

```json
{
  "scripts": {
    "test": "cd src/opencode && npm test"
  }
}
```

Optional; skip if it muddies the existing single-package convention.

## 5. Cleanups in `dotfiles/`

After §7 verification passes:

- `git rm -r toggl/`
- `git rm opencode/.config/opencode/plugins/toggl-time.ts`
- `git rm tmux/.config/tmux/toggl_project.sh tmux/.config/tmux/toggl_project.test.ts`
- Edit `tmux/.config/tmux/tmux.conf` per §2c.
- Edit `README.md`: replace
  ```
  bun test ./toggl/.local/bin/ ./tmux/.config/tmux/ ./opencode/.config/opencode/plugins/
  ```
  with
  ```
  bun test ./opencode/.config/opencode/plugins/
  ```
  and trim the env-var sentence (only `notify.*` tests remain; they don't
  use `TOGGL_STATE_DB`).
- Edit `git/.config/git/ignore`: change line 4's comment from
  `~/.config/opencode/plugins/toggl-time.ts` to a generic mention of the
  toggl-time opencode plugin (path now lives in another repo). Keep the
  `/.toggl-time` rule itself — cheap insurance against legacy stragglers.

Per §0.3, **leave** `docs/archive/{toggl,opencode}/PLAN*.md` untouched.

## 6. User-machine state re-pointing

Unchanged (env-var-driven and stable):

- `~/.local/state/toggl/state.db` — heartbeat + repo-state DB.
- `~/src/bamboo/tools/src/toggl/toggl.db` — project DB.

Re-pointed by the rewritten `install.sh` (§3):

- `~/.config/opencode` converts from dir-symlink → real dir with file-level
  symlinks.
- `~/.local/bin/toggl-{set,group,migrate,state.lib.sh}` re-pointed at
  `bamboo/tools`.
- `~/.local/bin/toggl-{time-migrate,tmux-status}` newly created.
- The orphaned `~/.config/opencode/node_modules/` (from the historical
  in-place `npm install` in dotfiles) becomes unreachable through realpath
  resolution and can be deleted by the install script as a hygiene step.
  Each plugin now resolves through its own source repo's `node_modules`.

## 7. Verification before deleting from dotfiles

Order of operations to keep the system working throughout:

1. **Stage the move in `bamboo/tools`** — copy files (do not `git mv` from
   dotfiles; copy across repos), edit relative paths per §2, write the new
   `install.sh`, add `@types/bun`, update `README.md` + `AGENTS.md`.
2. **Run tests in tools**:
   ```
   cd ~/src/bamboo/tools/src/opencode && npm install && npm test
   ```
   All 5 suites should pass without dotfiles being modified.
3. **Run the new install.sh** — converts `~/.config/opencode` to real dir,
   sets up file-level symlinks, bin-links CLIs, removes orphan
   `node_modules`.
4. **Smoke-test the runtime**:
   - In a repo with a `toggl_repo_state` row, open opencode, fire a chat
     message, confirm a row lands in `toggl_heartbeats`.
   - Run `toggl-tmux-status` from a directory inside that same repo and
     verify the output renders the expected `client | proj | task`.
5. **Restart tmux** and confirm the status bar still renders correctly
   with the updated `tmux.conf`.
6. **Only after #2-5 pass:** apply §5 cleanups in dotfiles, commit.

## 8. Out of scope

- The 5 archived PLAN docs in `dotfiles/docs/archive/` (per §0.3).
- The `notify.*` plugin and tests (stay in dotfiles).
- The `src/toggl/` reporting tools (already in tools, untouched).
- The deploy workflow `.github/workflows/toggl.yaml` (still only deploys
  `src/toggl`).
- The `toggl-pull` / `toggl-projects` aliases in `bash/.bashrc` — already
  point at `~/src/bamboo/tools/src/toggl/`, no change needed.

## 9. Open considerations

- The `~/.config/opencode` dir-symlink → real-dir conversion is a one-shot
  transition. Idempotent if `install.sh` runs twice, but every machine
  using these dotfiles has to run the new tools `install.sh` once.
- The `npm test` added in §4a needs `bun` on PATH. If you want a no-bun
  fallback for `src/toggl` tests in CI, the deploy workflow stays unchanged
  (it has no test step today).
- A separate `.github/workflows/opencode.yaml` to run `bun test` on PR is
  worth doing eventually but is optional and can come after the migration
  ships.

## 10. Implementation file list

For convenience when executing, the concrete moves and edits:

**Move (dotfiles → bamboo/tools):**

| From (dotfiles)                                                  | To (bamboo/tools)                            |
|---                                                               |---                                           |
| `toggl/.local/bin/toggl-state.lib.sh`                            | `src/opencode/bin/toggl-state.lib.sh`        |
| `toggl/.local/bin/toggl-set`                                     | `src/opencode/bin/toggl-set`                 |
| `toggl/.local/bin/toggl-set.test.ts`                             | `src/opencode/bin/toggl-set.test.ts`         |
| `toggl/.local/bin/toggl-migrate`                                 | `src/opencode/bin/toggl-migrate`             |
| `toggl/.local/bin/toggl-migrate.test.ts`                         | `src/opencode/bin/toggl-migrate.test.ts`     |
| `toggl/.local/bin/toggl-time-migrate`                            | `src/opencode/bin/toggl-time-migrate`        |
| `toggl/.local/bin/toggl-time-migrate.test.ts`                    | `src/opencode/bin/toggl-time-migrate.test.ts`|
| `toggl/.local/bin/toggl-group`                                   | `src/opencode/bin/toggl-group`               |
| `toggl/.local/bin/toggl-group.lib.ts`                            | `src/opencode/bin/toggl-group.lib.ts`        |
| `toggl/.local/bin/toggl-group.test.ts`                           | `src/opencode/bin/toggl-group.test.ts`       |
| `toggl/.local/bin/toggl-group.cli.test.ts`                       | `src/opencode/bin/toggl-group.cli.test.ts`   |
| `toggl/test-fixtures/heartbeats-synthetic.jsonl`                 | `src/opencode/test-fixtures/heartbeats-synthetic.jsonl` |
| `toggl/test-fixtures/heartbeats-live.jsonl`                      | `src/opencode/test-fixtures/heartbeats-live.jsonl` |
| `opencode/.config/opencode/plugins/toggl-time.ts`                | `src/opencode/plugins/toggl-time.ts`         |
| `tmux/.config/tmux/toggl_project.sh`                             | `src/opencode/bin/toggl-tmux-status`         |
| `tmux/.config/tmux/toggl_project.test.ts`                        | `src/opencode/bin/toggl-tmux-status.test.ts` |

**Delete from `bamboo/tools`:**

- `src/opencode/plugins/toggl-project.ts`
- `src/opencode/commands/select-toggl-project.md`
- `src/opencode/commands/` (empty dir)

**Edit in `bamboo/tools`:**

- `src/opencode/package.json` — see §4a.
- `src/opencode/install.sh` — rewrite per §3.
- `src/opencode/README.md` — rewrite per §3 + §4c summary.
- `AGENTS.md` — see §4b.
- `README.md` — see §4c.
- `package.json` (root) — optional, see §4d.
- The 5 file-content edits inside the moved files — see §2a.
- The 3 fixture-path edits in moved tests — see §2b.

**Edit in `dotfiles` (after §7 verification):**

- `tmux/.config/tmux/tmux.conf` — see §2c.
- `README.md` — see §5.
- `git/.config/git/ignore` — see §5.

**Delete from `dotfiles` (after §7 verification):**

- `toggl/` (entire subtree)
- `opencode/.config/opencode/plugins/toggl-time.ts`
- `tmux/.config/tmux/toggl_project.sh`
- `tmux/.config/tmux/toggl_project.test.ts`
