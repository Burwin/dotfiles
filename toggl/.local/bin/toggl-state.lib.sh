# toggl-state.lib.sh — shared helpers for the central Toggl state DB.
#
# Source this from any bash consumer that needs to read or write
# ~/.local/state/toggl/state.db. The file is not executable on its own.
#
# Provided variables:
#   TOGGL_STATE_DB    Absolute path of the SQLite state DB.
#
# Provided functions:
#   toggl_state_init                       - mkdir + CREATE TABLE IF NOT EXISTS
#                                            (both toggl_repo_state and
#                                            toggl_heartbeats) + PRAGMA WAL.
#   sql_quote <str>                        - emit SQL-safe single-quoted literal.
#   toggl_state_get <worktree-path>        - print TAB-separated row, empty on miss:
#                                            id\tname\tCOALESCE(client,'')\tCOALESCE(task,'')
#   toggl_state_set <path> <id> <name> <client> <task>
#                                          - INSERT OR REPLACE; pass empty string
#                                            for client or task to store NULL.
#   toggl_heartbeat_insert <ts> <event> <trigger> <session_id-or-empty>
#                          <worktree_path> <client> <project_id> <project_name>
#                          <task> <details_json-or-empty>
#                                          - INSERT one heartbeat row. Empty
#                                            session_id / details_json store NULL.
#   toggl_heartbeat_count <worktree-path>  - print integer row count for a worktree.
#
# Schema: see PLAN.md (toggl_repo_state) + PLAN-heartbeats.md (toggl_heartbeats)
# and the DDL in toggl_state_init below.
#
# NOTE: the opencode plugin (opencode/.config/opencode/plugins/toggl-time.ts)
# holds an inline copy of the toggl_heartbeats DDL so a fresh Bun-only host
# bootstraps without sourcing this lib. Keep both copies in sync.
#
# Required tools: bash, sqlite3.

# Resolve once. Callers may override TOGGL_STATE_DB before sourcing for tests.
: "${TOGGL_STATE_DB:=$HOME/.local/state/toggl/state.db}"

# sql_quote — wrap an arbitrary string as a SQL string literal. Doubles any
# embedded single quote. Output INCLUDES the surrounding single quotes so
# callers can splice the result directly into SQL.
#   sql_quote "O'Brien"  ->  'O''Brien'
sql_quote() {
    local s=${1//\'/\'\'}
    printf "'%s'" "$s"
}

# toggl_state_init — ensure the DB directory and tables exist + WAL enabled.
# Idempotent. Creates the file on first call; subsequent calls are no-ops at
# the SQL level (CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS).
# `PRAGMA journal_mode=WAL` is persistent across opens — once set, the DB
# stays in WAL mode until explicitly switched back.
toggl_state_init() {
    local dir
    dir=$(dirname "$TOGGL_STATE_DB")
    mkdir -p "$dir"
    sqlite3 "$TOGGL_STATE_DB" <<'SQL' >/dev/null
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS toggl_repo_state (
    worktree_path TEXT PRIMARY KEY,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    client_name   TEXT,
    task          TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS toggl_heartbeats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT    NOT NULL,
    event         TEXT    NOT NULL CHECK (event IN ('start','pause')),
    trigger       TEXT    NOT NULL,
    session_id    TEXT,
    worktree_path TEXT    NOT NULL,
    client_name   TEXT    NOT NULL,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    task          TEXT    NOT NULL,
    details       TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartbeats_worktree_ts
    ON toggl_heartbeats(worktree_path, ts);
CREATE INDEX IF NOT EXISTS idx_heartbeats_ts
    ON toggl_heartbeats(ts);
SQL
}

# toggl_state_get <worktree-path> - emit "id\tname\tclient\ttask" or nothing.
# client and task columns are emitted as empty strings when NULL in the DB,
# matching the convention the writer uses.
toggl_state_get() {
    local path=$1
    sqlite3 -separator $'\t' "$TOGGL_STATE_DB" \
        "SELECT project_id, project_name, COALESCE(client_name,''), COALESCE(task,'')
         FROM toggl_repo_state
         WHERE worktree_path = $(sql_quote "$path");"
}

# toggl_state_set <path> <id> <name> <client> <task>
# Empty string for <client> or <task> stores NULL. <id> must be an integer;
# <name> must be a non-empty string. Caller is responsible for those
# preconditions — sqlite3 will reject NOT NULL violations either way.
toggl_state_set() {
    local path=$1 id=$2 name=$3 client=$4 task=$5
    local client_sql task_sql
    if [[ -z "$client" ]]; then
        client_sql=NULL
    else
        client_sql=$(sql_quote "$client")
    fi
    if [[ -z "$task" ]]; then
        task_sql=NULL
    else
        task_sql=$(sql_quote "$task")
    fi
    sqlite3 "$TOGGL_STATE_DB" <<SQL
INSERT OR REPLACE INTO toggl_repo_state
    (worktree_path, project_id, project_name, client_name, task, updated_at)
VALUES
    ($(sql_quote "$path"), $id, $(sql_quote "$name"), $client_sql, $task_sql,
     strftime('%Y-%m-%dT%H:%M:%fZ','now'));
SQL
}

# toggl_heartbeat_insert <ts> <event> <trigger> <session_id-or-empty>
#                        <worktree_path> <client> <project_id> <project_name>
#                        <task> <details_json-or-empty>
# Empty session_id stores NULL; empty details_json stores NULL. <project_id>
# must be an integer; <event> must be 'start' or 'pause' (CHECK constraint
# will reject other values). Caller is responsible for these preconditions.
toggl_heartbeat_insert() {
    local ts=$1 event=$2 trigger=$3 session_id=$4 worktree=$5 \
          client=$6 project_id=$7 project_name=$8 task=$9 details=${10}
    local session_sql details_sql
    if [[ -z "$session_id" ]]; then
        session_sql=NULL
    else
        session_sql=$(sql_quote "$session_id")
    fi
    if [[ -z "$details" ]]; then
        details_sql=NULL
    else
        details_sql=$(sql_quote "$details")
    fi
    sqlite3 "$TOGGL_STATE_DB" <<SQL
INSERT INTO toggl_heartbeats
    (ts, event, trigger, session_id, worktree_path,
     client_name, project_id, project_name, task, details)
VALUES
    ($(sql_quote "$ts"), $(sql_quote "$event"), $(sql_quote "$trigger"),
     $session_sql, $(sql_quote "$worktree"),
     $(sql_quote "$client"), $project_id, $(sql_quote "$project_name"),
     $(sql_quote "$task"), $details_sql);
SQL
}

# toggl_heartbeat_count <worktree-path> - emit integer row count for a worktree.
toggl_heartbeat_count() {
    local path=$1
    sqlite3 "$TOGGL_STATE_DB" \
        "SELECT COUNT(*) FROM toggl_heartbeats WHERE worktree_path = $(sql_quote "$path");"
}
