# toggl-state.lib.sh — shared helpers for the central Toggl state DB.
#
# Source this from any bash consumer that needs to read or write
# ~/.local/state/toggl/state.db. The file is not executable on its own.
#
# Provided variables:
#   TOGGL_STATE_DB    Absolute path of the SQLite state DB.
#
# Provided functions:
#   toggl_state_init                       - mkdir + CREATE TABLE IF NOT EXISTS.
#   sql_quote <str>                        - emit SQL-safe single-quoted literal.
#   toggl_state_get <worktree-path>        - print TAB-separated row, empty on miss:
#                                            id\tname\tCOALESCE(client,'')\tCOALESCE(task,'')
#   toggl_state_set <path> <id> <name> <client> <task>
#                                          - INSERT OR REPLACE; pass empty string
#                                            for client or task to store NULL.
#
# Schema: see PLAN.md and the DDL in toggl_state_init below.
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

# toggl_state_init — ensure the DB directory and table exist. Idempotent.
# Creates the file on first call; subsequent calls are no-ops at the SQL
# level (CREATE TABLE IF NOT EXISTS).
toggl_state_init() {
    local dir
    dir=$(dirname "$TOGGL_STATE_DB")
    mkdir -p "$dir"
    sqlite3 "$TOGGL_STATE_DB" <<'SQL'
CREATE TABLE IF NOT EXISTS toggl_repo_state (
    worktree_path TEXT PRIMARY KEY,
    project_id    INTEGER NOT NULL,
    project_name  TEXT    NOT NULL,
    client_name   TEXT,
    task          TEXT,
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
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
