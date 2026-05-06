# Plan: Centralize `.toggl` state in `~/.local/state/toggl/state.db`

> **Status:** implemented; archived 2026-05-06.
>
> Implementation lives in:
> - `toggl/.local/bin/toggl-state.lib.sh` — DDL + helpers + WAL bootstrap
> - `toggl/.local/bin/toggl-set` — DB-backed picker (writes `toggl_repo_state`)
> - `toggl/.local/bin/toggl-migrate` — one-shot legacy `.toggl` JSON importer
> - `tmux/.config/tmux/toggl_project.sh` — git-toplevel-then-walk lookup
> - `opencode/.config/opencode/plugins/toggl-time.ts` — DB read path
>
> Follow-up that also centralizes `.toggl-time` heartbeats into the same
> DB (table `toggl_heartbeats`) is captured in `PLAN-heartbeats.md`; the
> "heartbeat log stays per-worktree" claim below is therefore superseded.
>
> Preserved for decision history. Cross-references in this document are
> historical — notably `TESTS.md` was replaced by `*.test.ts` files
> alongside each implementation in the test refactor.

Move per-worktree `<repo>/.toggl` JSON files into a single SQLite store, keyed
by canonical worktree path. Hard cut after a one-shot migration. The
heartbeat log (`.toggl-time`) stays per-worktree.

## 1. New schema

`~/.local/state/toggl/state.db`:

```sql
CREATE TABLE IF NOT EXISTS toggl_repo_state (
    worktree_path TEXT PRIMARY KEY,    -- realpath of git-toplevel (or worktree)
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    client_name   TEXT,                -- nullable (matches current shape)
    task          TEXT,                -- nullable (matches current shape)
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

One row per worktree, keyed by canonicalized absolute path. `client_name` /
`task` stay nullable so the existing JSON shape round-trips losslessly.
`updated_at` is new — useful for "what did I last touch" queries, no
behavioral impact.

The DB self-initializes (`CREATE TABLE IF NOT EXISTS`) on every consumer's
first call; we only need `mkdir -p ~/.local/state/toggl` ahead of the first
`sqlite3` invocation.

## 2. Shared shell helper — `toggl/.local/bin/toggl-state.lib.sh` (new)

Sourced by `toggl-set`, `toggl-migrate`, and the tmux script. Provides:

- `TOGGL_STATE_DB` constant (`$HOME/.local/state/toggl/state.db`).
- `toggl_state_init` — `mkdir -p` the dir + `CREATE TABLE IF NOT EXISTS`.
- `sql_quote <str>` — emits `'safely-escaped'` (doubles single quotes).
- `toggl_state_get <worktree-path>` — `SELECT` returning tab-separated
  `id\tname\tclient\ttask`, empty on miss.
- `toggl_state_set <path> <id> <name> <client-or-empty> <task-or-empty>` —
  `INSERT OR REPLACE`.

Centralizing this avoids duplicating the schema DDL and quoting helpers in
three scripts.

## 3. `toggl/.local/bin/toggl-set` — switch to SQLite

- Drop the `<repo>/.toggl` JSON read/write entirely.
- `repo_root=$(realpath "$(git rev-parse --show-toplevel)")` for the key.
- Replace `write_toggl()` (lines 94–111) with
  `toggl_state_set "$repo_root" "$id" "$name" "$client" "$task"`.
- Replace the existing-`.toggl` preamble (lines 83–91) with
  `toggl_state_get "$repo_root"` parsed into `current_id` / `current_name` /
  `current_client` / `current_task`. Keep the rendered preamble visually
  similar (json-shaped via `jq -n` so existing eyeball habits survive, or as
  a 4-line key/value listing — minor).
- Promotion / green / red logic (lines 142–186) is unchanged — it only
  depends on `current_id` / `current_in_set`.
- Drop dependency on writing JSON; `jq` is still used on the read path for
  nice display.

## 4. `opencode/.config/opencode/plugins/toggl-time.ts` — switch to `bun:sqlite`

- Replace `readToggl(togglPath)` (lines 48–76) with `readToggl(worktree)`:
  - Resolve `worktree` via `fs.realpath` once at plugin init (cache the
    canonical path).
  - Lazy-open `~/.local/state/toggl/state.db` with
    `new Database(path, { readonly: true, create: false })`. If the open
    throws (DB missing on a fresh machine), return null forever — plugin
    silently no-ops, mirroring today's "missing `.toggl`" behavior.
  - `db.query("SELECT project_id, project_name, client_name, task FROM toggl_repo_state WHERE worktree_path = ?").get(canonical)`.
  - Same null/empty validation as today.
- Per-event re-read stays — `bun:sqlite` SELECT is microseconds.
- The append target stays `<worktree>/.toggl-time` (per-worktree, unchanged).

## 5. `tmux/.config/tmux/toggl_project.sh` — git-first, then `$PWD` walk

Replace the upward-walk-for-`.toggl` loop with a single SQL lookup:

```bash
[[ -f "$TOGGL_STATE_DB" ]] || { echo "NO PROJECT"; exit 0; }

# 1. Prefer git-toplevel of $PWD when available.
if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    lookup=$(realpath "$git_root")
else
    lookup=$(realpath "$PWD")
fi

# 2. Single SQL: exact match on lookup, else longest-prefix ancestor.
#    `worktree_path || '/%'` ensures /foo doesn't match /foobar.
row=$(sqlite3 -separator $'\t' "$TOGGL_STATE_DB" \
    "SELECT project_id, project_name, COALESCE(client_name,''), COALESCE(task,'')
     FROM toggl_repo_state
     WHERE worktree_path = $(sql_quote "$lookup")
        OR $(sql_quote "$lookup") LIKE worktree_path || '/%'
     ORDER BY length(worktree_path) DESC
     LIMIT 1")
```

The "git-first, then walk" semantics fall out of two passes:

- If git-toplevel matches a row → use it (fast, exact).
- Otherwise the longest-prefix-ancestor in the table is chosen, which is the
  SQL equivalent of today's `while [[ $dir != / ]]` walk.

Output formatting (`POP` / `MUTED` / segments) is unchanged.

## 6. `toggl/.local/bin/toggl-migrate` (new)

Usage: `toggl-migrate [--root DIR]... [--delete] [--dry-run]`

- Default `--root $HOME/src`, repeatable.
- `find "$root" -name .toggl -type f` (no `-maxdepth` cap so nested
  worktrees are reached, but reasonable in practice; can add a configurable
  depth if scans get slow).
- For each match:
  1. `parsed=$(jq . "$f" 2>/dev/null)` — skip + warn on malformed.
  2. Pull `project_id`, `project_name`, `client_name`, `task`. Skip + warn
     if `project_id` is missing.
  3. `key=$(realpath "$(dirname "$f")")`.
  4. `--dry-run`: print the planned action, don't touch the DB.
  5. Otherwise: `toggl_state_set "$key" "$id" "$name" "$client" "$task"`,
     log `import: $key  proj=$name  client=$client  task=$task`.
  6. With `--delete`: `rm "$f"` after the row is committed.
- Final summary: `imported=N skipped=M deleted=K`.

The `dotfiles/.toggl` at the repo root is the canonical first test case —
it'll migrate to a row keyed by `realpath ~/src/dotfiles`.

## 7. Tests / docs

- Update `toggl/TESTS.md`:
  - Cases 4–13 currently `cat .toggl`; switch to
    `sqlite3 "$STATE_DB" "SELECT ... WHERE worktree_path = ..."`.
  - Add migration cases: stage `/tmp/toggl-migrate-smoke/{a,b}/.toggl`, run
    `toggl-migrate --dry-run` and `--delete`, assert rows + file removal.
  - Add tmux cases: git-toplevel match; non-git subdir of a tracked repo
    (walk fallback); fresh machine with no DB → `NO PROJECT`.
- Lib comment in `toggl-group.lib.ts` (lines 4–10) gets a one-line note that
  `.toggl` lives in state.db now; group itself is unchanged because it only
  consumes `.toggl-time`.
- Plugin comment block in `toggl-time.ts` updated to reflect SQLite source.

## 8. Execution order

1. Land `toggl-state.lib.sh`, `toggl-migrate`, and the schema bootstrap.
   Verify `toggl-migrate --dry-run` against `~/src` lists every existing
   `.toggl`.
2. Run `toggl-migrate --delete` once to populate `state.db` and remove the
   JSON files.
3. Update `toggl-set` to use `toggl_state_get` / `toggl_state_set`. Smoke:
   re-run TESTS.md cases 4–13 against the migrated DB.
4. Update tmux script. Smoke: tmux status segment renders for
   `~/src/dotfiles`, for a non-git subdir under it, and renders `NO PROJECT`
   outside any tracked tree.
5. Update opencode plugin (`bun:sqlite`). Smoke: trigger a `chat.message`,
   verify a heartbeat appended to `.toggl-time`. Verify graceful no-op when
   `state.db` is renamed away.
6. Update `TESTS.md`.
7. Final cleanup: remove the now-orphaned `/home/mbh/src/dotfiles/.toggl`
   (already done by `--delete`).

## Files changed (final list)

Modified:

- `toggl/.local/bin/toggl-set`
- `opencode/.config/opencode/plugins/toggl-time.ts`
- `tmux/.config/tmux/toggl_project.sh`
- `toggl/TESTS.md`
- `toggl/.local/bin/toggl-group.lib.ts` (header comment only)

Added:

- `toggl/.local/bin/toggl-state.lib.sh`
- `toggl/.local/bin/toggl-migrate`

Removed (post-migration):

- `/home/mbh/src/dotfiles/.toggl`

## Risks

- **`bun:sqlite` runtime assumption**: confirmed — opencode binary is Bun.
  If a future opencode build switches off Bun, the plugin breaks.
  Mitigation: wrap the import in
  `try { await import("bun:sqlite") } catch { /* no-op */ }` so a Node
  runtime degrades to silent no-op rather than crashing the plugin host.
- **`realpath` divergence**: bash `realpath` and Node `fs.realpath` agree on
  existing paths. Both fail similarly on non-existent paths; we only
  realpath things we know exist (git-toplevel, worktree from opencode SDK).
- **Concurrent writes**: only `toggl-set` writes; many concurrent readers.
  Default rollback journal is fine; WAL is overkill for this volume.
- **Migration corner**: a `.toggl` whose parent dir isn't a git root (rare;
  the writer always uses git-toplevel) still gets imported keyed by its
  parent path. The tmux walk-fallback will find it; opencode will find it
  as long as opencode's `worktree` realpath equals that key.

## Decisions (locked in via Q&A)

- **Storage**: New SQLite at `~/.local/state/toggl/state.db`.
- **Key**: Canonical absolute worktree path (`realpath` of git-toplevel or
  worktree).
- **Migration**: One-shot `toggl-migrate` script (`--dry-run`, `--delete`).
- **Tmux behavior**: Try `git rev-parse --show-toplevel` first, fall back to
  `$PWD`-walk via SQL longest-prefix match.
- **`.toggl-time`**: stays per-worktree (out of scope here).
- **Plugin SQLite access**: `bun:sqlite` (opencode is Bun-compiled).
