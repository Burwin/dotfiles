# Plan: Centralize `.toggl-time` heartbeats in `~/.local/state/toggl/state.db`

> **Status:** implemented; archived 2026-05-06.
>
> Implementation lives in:
> - `toggl/.local/bin/toggl-state.lib.sh` — `toggl_heartbeats` DDL + indexes + helpers
> - `toggl/.local/bin/toggl-time-migrate` — one-shot legacy `.toggl-time` JSONL importer
> - `toggl/.local/bin/toggl-group` — DB-driven CLI (`--repo`, `--all`, `--since`, `--until`)
> - `toggl/.local/bin/toggl-group.lib.ts` — `parseHeartbeats`, `heartbeatsFromRows`, `groupEvents`
> - `toggl/.local/bin/toggl-group.test.ts` + `toggl-group.cli.test.ts` — lib + CLI tests
> - `opencode/.config/opencode/plugins/toggl-time.ts` — DB INSERT path + inline DDL bootstrap
>
> Preserved for decision history. Cross-references in this document are
> historical — notably `TESTS.md` was replaced by `*.test.ts` files
> alongside each implementation in the test refactor.

Move per-worktree `<repo>/.toggl-time` JSONL files into a new `toggl_heartbeats`
table inside the existing state DB, mirroring the `.toggl` →
`toggl_repo_state` migration captured in `PLAN.md`. One-shot
`toggl-time-migrate` script does the cut. After migration, the opencode
plugin writes only to the DB; `toggl-group` queries only the DB.

## 1. New schema

Extend `~/.local/state/toggl/state.db`:

```sql
CREATE TABLE IF NOT EXISTS toggl_heartbeats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT    NOT NULL,                       -- ISO 8601 UTC
    event         TEXT    NOT NULL CHECK (event IN ('start','pause')),
    trigger       TEXT    NOT NULL,
    session_id    TEXT,                                   -- nullable
    worktree_path TEXT    NOT NULL,                       -- realpath(worktree)
    client_name   TEXT    NOT NULL,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    task          TEXT    NOT NULL,
    details       TEXT                                    -- JSON-serialized, NULL when absent
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_worktree_ts ON toggl_heartbeats(worktree_path, ts);
CREATE INDEX IF NOT EXISTS idx_heartbeats_ts          ON toggl_heartbeats(ts);
```

Notes:

- `worktree_path` is **new data on every row** (it was implicit from the file
  location before). Stored as `realpath(worktree)` so it agrees with
  `toggl_repo_state.worktree_path`.
- `details` keeps the lossless JSONL round-trip; `toggl-group` doesn't read it.
- `id AUTOINCREMENT` gives a stable tie-breaker for duplicate `ts`. Dedup
  logic still lives in `groupEvents` (existing behavior preserved).
- `idx_heartbeats_worktree_ts` covers the default `toggl-group` query
  (per-worktree, sorted by ts). `idx_heartbeats_ts` covers `--all` and
  windowed queries.

WAL mode is enabled at bootstrap — see §2.

## 2. Shared lib — extend `toggl/.local/bin/toggl-state.lib.sh`

Two changes to the existing helper:

- `toggl_state_init` adds the `toggl_heartbeats` DDL + indexes alongside the
  existing `CREATE TABLE`. Idempotent.
- `toggl_state_init` also issues `PRAGMA journal_mode=WAL;` once. WAL setting
  is persistent in SQLite, so subsequent opens find it already set.

Two new helpers (used by `toggl-time-migrate` and the test scaffolding in
TESTS.md):

```bash
# toggl_heartbeat_insert <ts> <event> <trigger> <session_id-or-empty>
#                        <worktree_path> <client> <project_id> <project_name>
#                        <task> <details_json-or-empty>
# Empty <session_id> stores NULL; empty <details_json> stores NULL.
toggl_heartbeat_insert() { ... }

# toggl_heartbeat_count <worktree_path>  — print integer row count for a worktree.
toggl_heartbeat_count() { ... }
```

Bash isn't the hot path for inserts (the plugin is), so a shell-level helper
is fine. The migrator uses one INSERT per JSONL line; volume is bounded.

## 3. Plugin — `opencode/.config/opencode/plugins/toggl-time.ts`

Replace the file-append path with a SQL INSERT.

Open-DB change (lines 76–100):

- Drop `readonly: true, create: false`. New: `new Database(path, { create: true })`
  so a fresh machine bootstraps the file.
- After open, run a one-time bootstrap inside `dbPromise`:

  ```ts
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS toggl_repo_state (...);  -- mirrors lib DDL
    CREATE TABLE IF NOT EXISTS toggl_heartbeats (...);  -- new
    CREATE INDEX IF NOT EXISTS idx_heartbeats_worktree_ts ON toggl_heartbeats(worktree_path, ts);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_ts          ON toggl_heartbeats(ts);
  `)
  ```

  Idempotent on every plugin start; cheap. The state table DDL stays in
  `toggl-state.lib.sh` as canonical, but the plugin holds an inline copy so
  a Node-but-not-shell installation still bootstraps cleanly. (Lib DDL and
  inline DDL must stay in sync — call this out in a comment on both.)

Write path (current `log()`, lines 155–180):

- Drop `await fs.appendFile(logPath, ...)`.
- Drop the `logPath = path.join(worktree, ".toggl-time")` constant.
- Add a cached `INSERT` prepared statement obtained from `db.prepare(...)`.
  `bun:sqlite` `db.prepare` is sync; cache once per plugin lifetime alongside
  `dbPromise`.
- Run `stmt.run(ts, event, trigger, sessionId ?? null, canonicalWorktree,
  ctx.client_name, ctx.project_id, ctx.project_name, ctx.task,
  details ? JSON.stringify(details) : null)`.

Error handling:

- Wrap the insert in `try { ... } catch { /* swallow */ }` — same best-effort
  philosophy.
- If `dbPromise` resolves to `null` (Node host without `bun:sqlite`),
  continue to no-op silently.

Comment block at the top (lines 6–47):

- Update to reflect "appends to `toggl_heartbeats` table" (was "appends to
  `<worktree>/.toggl-time`").
- Drop the "JSONL" wording.
- Note `bun:sqlite` runs the same DDL inline as `toggl-state.lib.sh` for
  fresh-machine bootstrap.

## 4. CLI — `toggl/.local/bin/toggl-group`

Replace input discovery with a DB query. New signatures:

```
toggl-group                     # current worktree (realpath of git toplevel of CWD)
toggl-group --repo PATH         # explicit worktree (realpath'd before lookup)
toggl-group --all               # every worktree, sorted by ts
toggl-group --since ISO         # optional, applied as SQL WHERE ts >= ?
toggl-group --until ISO         # optional, applied as SQL WHERE ts <= ?
```

`--file` and stdin paths are removed (per the locked-in decision). Help text
and error messages updated accordingly.

Implementation:

- Open `~/.local/state/toggl/state.db` via `bun:sqlite` read-only.
- If file missing → stderr `"toggl-group: state DB not found at <path>"`,
  exit 1.
- Build a `SELECT ts, event, trigger, session_id, worktree_path, client_name,
  project_id, project_name, task, details FROM toggl_heartbeats WHERE ...
  ORDER BY ts ASC` with the right `WHERE` for the chosen mode.
- Map rows → `Heartbeat[]` (parse `details` from JSON text; convert
  `session_id` NULL → undefined).
- Hand to `groupEvents()` and dump JSON. Same output contract as today.

`--since` / `--until` are added now because:

- They're trivial in SQL and zero-cost via `idx_heartbeats_ts`.
- The lib already exposes `filterByWindow`; without DB-side filtering,
  `--all` would scan every row in JS to filter to a window.
- They're a strict superset — leaving them out would mean shipping `--all`
  with no escape hatch.

## 5. Lib — `toggl/.local/bin/toggl-group.lib.ts`

Minimal change. The pure grouping logic is unchanged.

- `parseHeartbeats(jsonl)` stays — used by `toggl-time-migrate` to read
  legacy `.toggl-time` files and by `toggl-group.test.ts` to assert the
  JSONL parser still works (it's still the on-disk shape during migration).
- Add a thin `heartbeatsFromRows(rows: SqliteRow[]): { events: Heartbeat[];
  warnings: string[] }` so the CLI doesn't reimplement the row→Heartbeat
  mapping inline. Same warning shape (`"row N: invalid JSON in details"`
  etc.) for consistency.
- The "events embed project context, lib is agnostic" header comment
  (lines 4–17) updates to say the events come from the central
  `toggl_heartbeats` table.

## 6. New script — `toggl/.local/bin/toggl-time-migrate`

Mirror of `toggl-migrate`. Usage:

```
toggl-time-migrate [--root DIR]... [--delete] [--dry-run]
```

- Default `--root $HOME/src`, repeatable.
- `find "$root" -type f -name .toggl-time` walks the tree.
- For each file:
  1. `key=$(realpath "$(dirname "$f")")`.
  2. Stream lines through `jq -c .` to validate. Bad lines → stderr warning,
     increment `skipped`, keep going.
  3. For each valid line: extract `ts`, `event`, `trigger`, `session_id`,
     `client_name`, `project_id`, `project_name`, `task`, `details`. Reject
     the line (warn + skip) if any required field is missing or the wrong
     shape — same validation `parseHeartbeats` applies.
  4. `--dry-run`: print `import: <file>  rows=N`, do nothing.
  5. Otherwise: open one transaction per file, INSERT all rows via
     `toggl_heartbeat_insert`, commit. (Per-file transaction keeps a partial
     failure local.)
  6. With `--delete`: `rm "$f"` after the commit succeeds.
- Final summary: `imported_rows=N skipped_rows=M files_deleted=K`.

Edge cases:

- Empty `.toggl-time` (zero lines) → log `import: <file>  rows=0` and (with
  `--delete`) remove the file. No DB write.
- Mixed valid/invalid lines in one file → valid lines commit, invalid ones
  counted in `skipped`. With `--delete`, the file is **kept** (we don't
  delete sources that didn't fully import — same conservative rule
  `toggl-migrate` uses).

## 7. Tests + docs

`toggl/.local/bin/toggl-group.test.ts`:

- `parseHeartbeats` cases stay — they test the JSONL parser, which lives on
  for the migrator.
- `groupEvents` cases stay — they construct `Heartbeat[]` directly. Pure
  logic, no I/O.
- Add a small `heartbeatsFromRows` suite: round-trip a few rows (with and
  without `details`), assert `warnings` shape on a row with malformed
  `details` JSON.

`toggl/test-fixtures/`:

- Keep `heartbeats-synthetic.jsonl` and `heartbeats-live.jsonl` for the
  parser/group tests.
- Add a tiny `seed-heartbeats.sh` helper script that inserts the synthetic
  fixture into a temp DB, used by the new `toggl-group` CLI tests in
  TESTS.md.

`toggl/TESTS.md`:

- Replace the entire `toggl-group` section. New cases:
  - **DB lookup for current worktree**: seed a temp DB with the synthetic
    fixture (or its rows) keyed to a tmp git repo, `cd` in,
    `toggl-group | jq length` → 3.
  - **`--repo PATH`**: same fixture, but invoked from outside the repo with
    explicit `--repo`.
  - **`--all`**: seed two worktrees, assert merged ordering by `ts`.
  - **`--since` / `--until`**: assert windowing reduces row count as expected.
  - **State DB missing**: rename `state.db` away → exit 1 with the expected
    stderr.
  - **No matching rows**: empty repo → `[]` on stdout, exit 0.
  - Drop old cases that referenced `--file` and stdin pipes.
- Add a new `toggl-time-migrate` section, mirroring the `toggl-migrate` one:
  - Stage two `<root>/{a,b}/.toggl-time` files with synthetic content.
  - `toggl-time-migrate --dry-run` → counts only, no DB.
  - `toggl-time-migrate --delete` → rows present, files gone.
  - Mixed-validity file → some rows imported, file retained.
  - Missing root → warning, exit 0. Unknown flag → exit 1.
- Update the prose at the top of TESTS.md (lines 6–9, 537–550) to say
  `toggl-group` reads from `state.db` and `.toggl-time` is no longer a
  runtime concept.

`toggl/PLAN.md` (the previous plan):

- Add a one-line note pointing to this plan; the §2.5-style "`.toggl-time`
  stays per-worktree" wording is superseded.

## 8. Execution order

1. Land the schema additions in `toggl-state.lib.sh` and the new
   `toggl_heartbeat_insert` / `toggl_heartbeat_count` helpers. Verify
   `toggl_state_init` is idempotent against an existing `state.db` (creates
   the new table; no-op on the old one) and that WAL is enabled
   (`sqlite3 state.db "PRAGMA journal_mode;"` → `wal`).
2. Land `toggl-time-migrate`. Smoke-test with the live
   `/home/mbh/src/dotfiles/.toggl-time` (134 rows) under `--dry-run`. Then
   run `--delete` once to populate the DB and remove the file.
3. Update the opencode plugin (`toggl-time.ts`). Restart opencode, fire a
   chat message in this repo, verify a row lands via
   `sqlite3 ... "SELECT count(*) FROM toggl_heartbeats WHERE worktree_path = ...";`.
4. Update `toggl-group` and `toggl-group.lib.ts`. Run
   `bun test toggl/.local/bin/toggl-group.test.ts` (lib tests must pass
   unchanged). Smoke `toggl-group | jq length` from inside `dotfiles` and
   compare to the migrated row count.
5. Refresh `TESTS.md` and run all CLI cases.
6. Final cleanup: confirm `find ~/src -name .toggl-time` returns nothing.

## Files changed (final list)

Modified:

- `toggl/.local/bin/toggl-state.lib.sh` — schema + new heartbeat helpers + WAL bootstrap
- `toggl/.local/bin/toggl-group` — DB-only input discovery, `--repo`/`--all`/`--since`/`--until`
- `toggl/.local/bin/toggl-group.lib.ts` — header comment + new `heartbeatsFromRows` helper
- `toggl/.local/bin/toggl-group.test.ts` — additional `heartbeatsFromRows` cases
- `opencode/.config/opencode/plugins/toggl-time.ts` — DB write path, WAL bootstrap, comment block
- `toggl/TESTS.md` — replaced `toggl-group` section, new `toggl-time-migrate` section, prose updates
- `toggl/PLAN.md` — superseded note on `.toggl-time` (one line)

Added:

- `toggl/.local/bin/toggl-time-migrate`
- `toggl/test-fixtures/seed-heartbeats.sh` (TESTS.md helper)

Removed (post-migration):

- `/home/mbh/src/dotfiles/.toggl-time`

## Risks

- **DDL drift between lib and plugin**: the plugin holds an inline copy of
  the table DDL so a fresh Bun-only host bootstraps without sourcing the
  bash lib. If the lib's DDL changes, the plugin's must too. Mitigation:
  cross-reference comments on both sides; the test in `TESTS.md` that
  asserts the table exists after a plugin run catches drift in practice.
- **Concurrent writers + WAL on tmpfs/network FS**: `~/.local/state` is a
  local disk on this machine. WAL on NFS would corrupt; on tmpfs it works
  but is reset on boot. Both are non-issues here, but worth noting if the
  dotfiles ever sync `~/.local/state` to a remote.
- **DB growth**: 134 rows for 2 hours of one repo's work extrapolates to
  ~1k–10k rows/day under heavy use. The DB will grow indefinitely. No
  pruning in this change. `toggl-group --since` is the relief valve. A
  future `toggl-vacuum`/`toggl-prune` is out of scope.
- **`bun:sqlite` write fail**: the plugin currently swallows file-write
  errors. After this change, write errors include "DB locked under a
  non-WAL stale state" or "schema bootstrap failed". All swallowed silently
  per the existing best-effort contract.
- **Migration of in-flight `.toggl-time`**: if an opencode session is
  running while `toggl-time-migrate --delete` executes, lines appended
  after the migration starts and before plugin restart end up in a deleted
  file. Mitigation: stop opencode sessions before migrating (already
  implicit in the "restart plugin in step 3" flow).

## Locked-in decisions (from Q&A)

- **Storage**: same `~/.local/state/toggl/state.db`; new `toggl_heartbeats`
  table.
- **`details` shape**: single TEXT column, JSON-serialized, NULL when
  absent.
- **`toggl-group` input modes**: DB only (`--repo` / `--all` /
  `--since` / `--until`). `--file` and stdin removed.
- **Concurrency**: WAL mode enabled at bootstrap.
- **Cutover**: one-shot `toggl-time-migrate` with `--dry-run` / `--delete`.
  Hard cut.
