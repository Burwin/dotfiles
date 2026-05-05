# toggl-set tests

Manual smoke tests for the `toggl-set` CLI. Each case below is a one-shot
shell invocation that exercises a specific behavior of the script.

State now lives in `~/.local/state/toggl/state.db` (table
`toggl_repo_state`, keyed by realpath of git toplevel) instead of
`<repo>/.toggl`. The cases below assert against that DB; the smoke repo
path doubles as the lookup key.

## Setup

Tests run inside a throwaway git repo to keep state-DB rows isolated:

```bash
smoke=/tmp/toggl-set-smoke
rm -rf "$smoke" && mkdir -p "$smoke" && cd "$smoke" && git init -q
STATE_DB="$HOME/.local/state/toggl/state.db"

# Helper: reset / seed the row for $smoke. Pass empty id to clear.
set_state() {
    sqlite3 "$STATE_DB" "DELETE FROM toggl_repo_state WHERE worktree_path = '$smoke';"
    if [[ -n "$1" ]]; then
        local id=$1 name=$2 client=$3 task=$4
        local client_sql=NULL task_sql=NULL
        [[ -n "$client" ]] && client_sql="'$client'"
        [[ -n "$task"   ]] && task_sql="'$task'"
        sqlite3 "$STATE_DB" \
            "INSERT INTO toggl_repo_state (worktree_path, project_id, project_name, client_name, task) VALUES ('$smoke', $id, '$name', $client_sql, $task_sql);"
    fi
}

# Helper: print the current row as id|name|client|task ('<null>' for NULL).
dump_state() {
    sqlite3 -separator '|' "$STATE_DB" \
        "SELECT project_id, project_name, COALESCE(client_name,'<null>'), COALESCE(task,'<null>') FROM toggl_repo_state WHERE worktree_path = '$smoke';"
}
```

Cleanup after a run also drops the row to keep the DB clean:

```bash
sqlite3 "$STATE_DB" "DELETE FROM toggl_repo_state WHERE worktree_path = '$smoke';"
cd / && rm -rf /tmp/toggl-set-smoke
```

The active Toggl project DB at `~/src/bamboo/tools/src/toggl/toggl.db` is
consulted read-only, so these tests do not require `toggl-pull` and never
mutate it.

## Cases

### 1. No args → full project list

```bash
echo "" | toggl-set 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** count equals the number of active projects in the local DB
(31 at time of writing). The empty `read` cancels the prompt cleanly.

### 2. No-match query → stderr fallback + full list

```bash
echo "" | toggl-set zzzzzzzz 2>&1 >/dev/null | head -1
echo "" | toggl-set zzzzzzzz 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** stderr contains `No matches for 'zzzzzzzz'; showing all projects.`
and the rendered table has the full 31 rows.

### 3. Case-insensitive match on client_name

```bash
echo "" | toggl-set BAMBOO 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]'
```

**Expected:** five rows whose `client_name` is `Bamboo` (uppercase query
matches lowercase data). Currently:

```
   1  186133116   Internal                          Bamboo
   2  186046633   Learning                          Bamboo
   3  216557449   PTO                               Bamboo
   4  216328138   Personal                          Bamboo
   5  189469205   Prospecting                       Bamboo
```

### 4. Substring on name → single match → auto-select (empty task)

```bash
set_state ""
printf '\n' | toggl-set reports 2>/dev/null
dump_state
```

**Expected:** no project prompt is rendered (auto-select fires). The task
prompt accepts an empty line, so `task` lands as NULL. State row:

```
215051643|Reports Automation|AWT|<null>
```

### 5. Substring on name → 1 match → auto-select (Internal/Bamboo, empty task)

```bash
set_state ""
printf '\n' | toggl-set intern 2>/dev/null
dump_state
```

**Expected:** auto-select. State row:

```
186133116|Internal|Bamboo|<null>
```

### 6. Pre-existing row + single match → overwrite (no project prompt)

```bash
set_state 216557449 "PTO" "Bamboo" ""
printf '\n' | toggl-set reports 2>/dev/null
dump_state
```

**Expected:** stdout includes the `Current project ($smoke):` preamble
showing the PTO/Bamboo JSON (since the row pre-exists), no `Select project`
prompt is rendered, the task prompt accepts the empty line, and the row
afterwards is:

```
215051643|Reports Automation|AWT|<null>
```

### 7. Pre-existing row + multi-match including current → green at row 1

```bash
set_state 216328138 "Personal" "Bamboo" ""

# Row count is still 5 (Personal is in result; no synthesis).
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

# Index 1 must be Personal (id 216328138). Without promotion it would be
# Internal (alphabetical sort within Bamboo).
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+1[[:space:]]'

# With FORCE_COLOR=1, row 1 carries green ANSI (\x1b[32m).
echo "" | FORCE_COLOR=1 toggl-set bamboo 2>/dev/null | \
    grep -E '^[[:space:]]+1[[:space:]]' | grep -c $'\x1b\[32m'
```

**Expected:**

- `5` rows (Personal already in the Bamboo filter result; no duplicate added).
- Row 1: `   1  216328138   Personal                          Bamboo`
- Color count: `1` (one green ANSI escape in row 1 when `FORCE_COLOR=1`).
- Plain piped output (no `FORCE_COLOR`) contains no ANSI codes — TTY check off.

### 8. Pre-existing row + multi-match excluding current → red at row 1

```bash
set_state 215051643 "Reports Automation" "AWT" ""

# Row count is 6: 5 Bamboo + Reports Automation prepended (synthesized).
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

# Index 1 must be Reports Automation (id 215051643).
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+1[[:space:]]'

# With FORCE_COLOR=1, row 1 carries red ANSI (\x1b[31m).
echo "" | FORCE_COLOR=1 toggl-set bamboo 2>/dev/null | \
    grep -E '^[[:space:]]+1[[:space:]]' | grep -c $'\x1b\[31m'
```

**Expected:**

- `6` rows (5 Bamboo matches + the synthesized Reports Automation row).
- Row 1: `   1  215051643   Reports Automation                AWT`
- Color count: `1` (one red ANSI escape in row 1 when `FORCE_COLOR=1`).

### 9. id-only query no longer matches (id is excluded from scope)

```bash
echo "" | toggl-set 215051643 2>&1 >/dev/null | head -1
echo "" | toggl-set 215051643 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** stderr `No matches for '215051643'; showing all projects.`
and the rendered table is the full 31 rows. The `id` column is intentionally
not part of the substring scope; only `name` and `client_name` are.

### 10. Subsequence query no longer matches

```bash
echo "" | toggl-set bmb 2>&1 >/dev/null | head -1
echo "" | toggl-set bmb 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
```

**Expected:** stderr `No matches for 'bmb'; showing all projects.` and the
full 31-row list. Substring search requires contiguous characters, unlike
the earlier fuzzy implementation that would have matched `bmb` against
`Bamboo`.

### 11. Auto-select prompts for task; non-empty input is stored

```bash
set_state ""
printf 'Run smoke tests\n' | toggl-set reports 2>/dev/null
dump_state
```

**Expected:** auto-select fires, then the script reads the task line from
stdin. Row afterwards is:

```
215051643|Reports Automation|AWT|Run smoke tests
```

### 12. Re-select same project with empty input → task preserved (bracket default)

```bash
set_state 215051643 "Reports Automation" "AWT" "Existing task description"
printf '\n' | toggl-set reports 2>/dev/null
dump_state
```

**Expected:** row unchanged — the empty input at the task prompt is treated
as "keep the bracket-default" because the selected project id matches the
existing one:

```
215051643|Reports Automation|AWT|Existing task description
```

(The task prompt itself is `Task description [Existing task description]: `,
but `read -p` only renders that string when stdin is a TTY, so it does not
appear under piped tests. The preserved row is the observable evidence.)

### 13. Switch projects with empty input → task cleared to NULL

```bash
set_state 215051643 "Reports Automation" "AWT" "Existing task description"
printf '\n' | toggl-set intern 2>/dev/null
dump_state
```

**Expected:** because the selected id (Internal) differs from the current
id (Reports Automation), the task prompt is plain (no bracket default) and
the empty input falls through to NULL:

```
186133116|Internal|Bamboo|<null>
```

## Run all cases

```bash
smoke=/tmp/toggl-set-smoke
rm -rf "$smoke" && mkdir -p "$smoke" && cd "$smoke" && git init -q
STATE_DB="$HOME/.local/state/toggl/state.db"

set_state() {
    sqlite3 "$STATE_DB" "DELETE FROM toggl_repo_state WHERE worktree_path = '$smoke';"
    if [[ -n "$1" ]]; then
        local id=$1 name=$2 client=$3 task=$4
        local client_sql=NULL task_sql=NULL
        [[ -n "$client" ]] && client_sql="'$client'"
        [[ -n "$task"   ]] && task_sql="'$task'"
        sqlite3 "$STATE_DB" \
            "INSERT INTO toggl_repo_state (worktree_path, project_id, project_name, client_name, task) VALUES ('$smoke', $id, '$name', $client_sql, $task_sql);"
    fi
}

dump_state() {
    sqlite3 -separator '|' "$STATE_DB" \
        "SELECT project_id, project_name, COALESCE(client_name,'<null>'), COALESCE(task,'<null>') FROM toggl_repo_state WHERE worktree_path = '$smoke';"
}

echo "=== 1. no args -> full list count ==="
echo "" | toggl-set 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 2. no match -> stderr fallback msg + full list ==="
echo "" | toggl-set zzzzzzzz 2>&1 >/dev/null | head -1
echo "(rows shown:)"
echo "" | toggl-set zzzzzzzz 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 3. case-insensitive match on client_name ('BAMBOO') ==="
echo "" | toggl-set BAMBOO 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]'

echo "=== 4. substring on name ('reports') -> auto-select (empty task) ==="
set_state ""
printf '\n' | toggl-set reports 2>/dev/null >/dev/null
dump_state

echo "=== 5. substring on name ('intern') -> 1 match -> auto-select (empty task) ==="
set_state ""
printf '\n' | toggl-set intern 2>/dev/null >/dev/null
dump_state

echo "=== 6. pre-existing row + single match -> overwrite (empty task) ==="
set_state 216557449 "PTO" "Bamboo" ""
printf '\n' | toggl-set reports 2>/dev/null >/dev/null
dump_state

echo "=== 7. multi-match including current -> green at row 1 ==="
set_state 216328138 "Personal" "Bamboo" ""
echo "(row count -> should be 5:)"
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
echo "(row 1 -> should be Personal/216328138:)"
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+1[[:space:]]'
echo "(green ANSI count in row 1 -> should be 1:)"
echo "" | FORCE_COLOR=1 toggl-set bamboo 2>/dev/null | \
    grep -E '^[[:space:]]+1[[:space:]]' | grep -c $'\x1b\[32m'

echo "=== 8. multi-match excluding current -> red at row 1 ==="
set_state 215051643 "Reports Automation" "AWT" ""
echo "(row count -> should be 6:)"
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l
echo "(row 1 -> should be Reports Automation/215051643:)"
echo "" | toggl-set bamboo 2>/dev/null | grep -E '^[[:space:]]+1[[:space:]]'
echo "(red ANSI count in row 1 -> should be 1:)"
echo "" | FORCE_COLOR=1 toggl-set bamboo 2>/dev/null | \
    grep -E '^[[:space:]]+1[[:space:]]' | grep -c $'\x1b\[31m'

echo "=== 9. id-only query no longer matches ==="
echo "" | toggl-set 215051643 2>&1 >/dev/null | head -1
echo "(rows shown -> should be full list = 31:)"
echo "" | toggl-set 215051643 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 10. subsequence ('bmb') no longer matches ==="
echo "" | toggl-set bmb 2>&1 >/dev/null | head -1
echo "(rows shown -> should be full list = 31:)"
echo "" | toggl-set bmb 2>/dev/null | grep -E '^[[:space:]]+[0-9]+[[:space:]]' | wc -l

echo "=== 11. auto-select prompts for task; non-empty input is stored ==="
set_state ""
printf 'Run smoke tests\n' | toggl-set reports 2>/dev/null >/dev/null
dump_state

echo "=== 12. re-select same project + empty input -> task preserved ==="
set_state 215051643 "Reports Automation" "AWT" "Existing task description"
printf '\n' | toggl-set reports 2>/dev/null >/dev/null
dump_state

echo "=== 13. switch projects + empty input -> task null ==="
set_state 215051643 "Reports Automation" "AWT" "Existing task description"
printf '\n' | toggl-set intern 2>/dev/null >/dev/null
dump_state

# cleanup
sqlite3 "$STATE_DB" "DELETE FROM toggl_repo_state WHERE worktree_path = '$smoke';"
cd / && rm -rf "$smoke"
```

# toggl-migrate tests

Manual smoke tests for the `toggl-migrate` CLI. The migrator finds legacy
`<repo>/.toggl` JSON files under one or more roots and imports each row
into `~/.local/state/toggl/state.db`, optionally deleting the originals.

## Setup

Tests use a fully-isolated state DB so they don't touch your real one:

```bash
smoke=/tmp/toggl-migrate-smoke
export TOGGL_STATE_DB=/tmp/toggl-migrate-smoke.db
rm -rf "$smoke" "$TOGGL_STATE_DB"
mkdir -p "$smoke/repo-a" "$smoke/repo-b" "$smoke/bad-json" "$smoke/missing-id"

cat > "$smoke/repo-a/.toggl" <<'JSON'
{"project_id": 111, "project_name": "Alpha", "client_name": "Acme", "task": "T-1"}
JSON
cat > "$smoke/repo-b/.toggl" <<'JSON'
{"project_id": 222, "project_name": "Beta", "client_name": null, "task": null}
JSON
echo "this is not json" > "$smoke/bad-json/.toggl"
cat > "$smoke/missing-id/.toggl" <<'JSON'
{"project_name": "NoID"}
JSON
```

Cleanup:

```bash
unset TOGGL_STATE_DB
rm -rf /tmp/toggl-migrate-smoke /tmp/toggl-migrate-smoke.db
```

## Cases

### 1. `--dry-run` lists imports, doesn't touch the DB

```bash
toggl-migrate --root "$smoke" --dry-run
ls -la "$TOGGL_STATE_DB" 2>&1 | head -1
```

**Expected:** stderr lines flagging `bad-json` and `missing-id` as
skipped; stdout `import …` lines for `repo-a` and `repo-b`;
`summary (dry-run): imported=2 skipped=2 deleted=0`. The DB file does NOT
exist after a dry-run.

### 2. Real run with `--delete` writes rows + removes only successful sources

```bash
toggl-migrate --root "$smoke" --delete
echo "(state rows:)"
sqlite3 -separator '|' "$TOGGL_STATE_DB" \
    "SELECT worktree_path, project_id, project_name, COALESCE(client_name,'<null>'), COALESCE(task,'<null>') FROM toggl_repo_state ORDER BY worktree_path;"
echo "(remaining .toggl files:)"
find "$smoke" -name .toggl -print
```

**Expected:** two rows imported (repo-a fully populated, repo-b with
client_name and task NULL). `summary: imported=2 skipped=2 deleted=2`.
Only `bad-json/.toggl` and `missing-id/.toggl` remain on disk — the
migrator does not delete sources it failed to import.

### 3. Missing root → warning, exit 0

```bash
toggl-migrate --root /no/such/root --dry-run; echo "exit=$?"
```

**Expected:** stderr `toggl-migrate: root /no/such/root not found, skipping`
and `summary (dry-run): imported=0 skipped=0 deleted=0`. `exit=0` — a
missing root is a warning, not a hard error.

### 4. Unknown flag → exit 1

```bash
toggl-migrate --bogus 2>&1; echo "exit=$?"
```

**Expected:** stderr `toggl-migrate: unknown argument: --bogus`, `exit=1`.

# tmux toggl_project.sh tests

Manual smoke tests for the tmux status segment that reports the active
Toggl project for `$PWD`. The script consults
`~/.local/state/toggl/state.db` directly.

## Setup

We use the live state DB but a throwaway worktree path so the test rows
don't collide with real ones:

```bash
script=/home/mbh/src/dotfiles/tmux/.config/tmux/toggl_project.sh
STATE_DB="$HOME/.local/state/toggl/state.db"
smoke=/tmp/tmux-toggl-smoke
git_smoke=/tmp/tmux-toggl-smoke-git
rm -rf "$smoke" "$git_smoke"
mkdir -p "$smoke/sub/deep" "$git_smoke" && (cd "$git_smoke" && git init -q)

# Seed: a non-git registered repo at $smoke (for walk-fallback) and a
# registered git repo at $git_smoke (for git-toplevel match).
sqlite3 "$STATE_DB" \
    "INSERT OR REPLACE INTO toggl_repo_state (worktree_path, project_id, project_name, client_name, task) VALUES ('$smoke', 999, 'WalkRepo', 'WalkClient', 'WalkTask');"
sqlite3 "$STATE_DB" \
    "INSERT OR REPLACE INTO toggl_repo_state (worktree_path, project_id, project_name, client_name, task) VALUES ('$git_smoke', 888, 'GitRepo', 'GitClient', 'GitTask');"
```

Cleanup:

```bash
sqlite3 "$STATE_DB" "DELETE FROM toggl_repo_state WHERE worktree_path IN ('$smoke', '$git_smoke');"
rm -rf "$smoke" "$git_smoke"
```

## Cases

### 1. Inside a registered git worktree → git-toplevel match

```bash
cd "$git_smoke" && "$script"
```

**Expected:** segment text mentions `GitRepo (888)`, `GitClient`, and
`GitTask`. The exact form (with tmux markup) is:

```
client: #[fg=blue,bold]GitClient#[fg=brightblack,nobold] | proj: #[fg=blue,bold]GitRepo#[fg=brightblack,nobold] (888) | task: #[fg=blue,bold]GitTask#[fg=brightblack,nobold]
```

### 2. Inside a deep subdir of a git worktree → still git-toplevel match

```bash
mkdir -p "$git_smoke/a/b/c"
cd "$git_smoke/a/b/c" && "$script"
```

**Expected:** identical segment to case 1. `git rev-parse --show-toplevel`
climbs to the worktree root, so subdir depth is irrelevant.

### 3. Non-git subdir of a registered ancestor → walk fallback

```bash
cd "$smoke/sub/deep" && "$script"
```

**Expected:** `WalkRepo (999)` segment. `git rev-parse` fails, then the
SQL longest-prefix lookup finds `$smoke` as an ancestor of
`/tmp/tmux-toggl-smoke/sub/deep`.

### 4. Prefix-collision guard

```bash
mkdir -p "${smoke}y"  # /tmp/tmux-toggl-smokey - shares prefix but isn't a child
cd "${smoke}y" && "$script"
rmdir "${smoke}y"
```

**Expected:** `NO PROJECT`. The `worktree_path || '/%'` clause prevents
`/tmp/tmux-toggl-smoke` from matching `/tmp/tmux-toggl-smokey`.

### 5. Outside any registered tree → NO PROJECT

```bash
cd / && "$script"
```

**Expected:** `NO PROJECT`. No git toplevel and no ancestor in the DB.

### 6. State DB missing → NO PROJECT (no error)

```bash
mv "$STATE_DB" "$STATE_DB.bak"
cd / && "$script"
mv "$STATE_DB.bak" "$STATE_DB"
```

**Expected:** `NO PROJECT`. Fresh-machine code path. The script does not
exit nonzero.

# toggl-group tests

Manual smoke tests for the `toggl-group` CLI. The CLI is a thin wrapper over
`toggl-group.lib.ts`; the lib's behavior is covered by `bun test
./toggl/.local/bin/toggl-group.test.ts`. The cases below exercise input
discovery, error paths, and the JSON output contract.

`toggl-group` consumes `<worktree>/.toggl-time` only — the per-repo
heartbeat log written by the opencode plugin. The project context that
appears inside each heartbeat originates from the central
`~/.local/state/toggl/state.db`, but the grouper is agnostic to that
source.

## Setup

Tests run inside a throwaway git repo and use the in-tree fixtures as
deterministic input:

```bash
smoke=/tmp/toggl-group-smoke
fixtures=$HOME/src/dotfiles/toggl/test-fixtures
rm -rf "$smoke" && mkdir -p "$smoke" && cd "$smoke" && git init -q
```

Cleanup after each run:

```bash
cd / && rm -rf /tmp/toggl-group-smoke
```

## Cases

Most cases use `--file` for portability — they work in both interactive and
non-interactive shells. Cases that target the git-root walk (input source
3 in `toggl-group:1`) require TTY stdin; see case 8 for that.

### 1. `--file` flag → JSON array on stdout, exit 0

```bash
toggl-group --file "$fixtures/heartbeats-synthetic.jsonl" | jq 'length'
echo "exit=${PIPESTATUS[0]}"
```

**Expected:** `3` (synthetic produces three entries with the default 10-min
buffer; see `toggl-group.test.ts` "synthetic fixture" assertions for
per-entry detail), `exit=0`.

### 2. stdin pipe → equivalent JSON

```bash
cat "$fixtures/heartbeats-synthetic.jsonl" | toggl-group | jq 'length'
```

**Expected:** `3`. Stdin and `--file` are interchangeable.

### 3. stdin and `--file` produce identical output

```bash
diff \
    <(toggl-group --file "$fixtures/heartbeats-synthetic.jsonl") \
    <(cat "$fixtures/heartbeats-synthetic.jsonl" | toggl-group)
echo "exit=$?"
```

**Expected:** No diff output, `exit=0`.

### 4. Malformed JSONL line → warning on stderr, valid lines still grouped

```bash
{ echo "not json"; cat "$fixtures/heartbeats-synthetic.jsonl"; } > broken.jsonl
toggl-group --file broken.jsonl 2>&1 >/dev/null | head -1
toggl-group --file broken.jsonl 2>/dev/null | jq 'length'
```

**Expected:**

- Stderr first line: `toggl-group: /tmp/toggl-group-smoke/broken.jsonl: line 1: invalid JSON (...)`
- jq length: `3` (the 8 valid lines still group into the same three entries).

### 5. `--file` with missing path → exit 1

```bash
toggl-group --file /tmp/does-not-exist.jsonl 2>&1
echo "exit=$?"
```

**Expected:** stderr `toggl-group: /tmp/does-not-exist.jsonl not found`,
`exit=1`.

### 6. `--file` without an argument → exit 1

```bash
toggl-group --file 2>&1
echo "exit=$?"
```

**Expected:** stderr `toggl-group: --file requires a path`, `exit=1`.

### 7. Empty stdin (non-TTY) → empty array, exit 0

```bash
echo -n "" | toggl-group
echo "exit=$?"
```

**Expected:** `[]` on stdout, `exit=0`. Empty input is not an error; it
maps to zero entries.

### 8. No args, `.toggl-time` in git root → JSON via git-root walk

This case targets the third input source (git toplevel walk). It only
fires when `process.stdin.isTTY` is true, so run it from an interactive
shell with no stdin redirect:

```bash
cp "$fixtures/heartbeats-synthetic.jsonl" .toggl-time
toggl-group | jq 'length'
```

**Expected:** `3`. Same JSON as case 1.

In a non-interactive context (CI, `bash -c`, sub-pipes), stdin is a
non-TTY pipe and the CLI reads from it instead of walking the git tree;
expect `[]` in that case. To force the git-root path under a non-TTY
shell, allocate a pty:

```bash
script -qec 'toggl-group | jq length' /dev/null < /dev/null | tr -d '\r'
```

### 9. `.toggl-time` missing in git root → exit 1 (TTY only)

Like case 8, this fires only with a TTY stdin:

```bash
rm -f .toggl-time
toggl-group 2>&1
echo "exit=$?"
```

**Expected (TTY):** stderr `toggl-group: /tmp/toggl-group-smoke/.toggl-time not found`,
`exit=1`.
