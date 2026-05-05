#!/bin/bash
# Look up the active Toggl project for $PWD in the central state DB and
# emit a tmux status segment.
#
# Output is intended to be embedded in tmux's status-right via #(). Any tmux
# style markup (`#[...]`) below is interpreted by tmux's format parser when
# the result is interpolated. Run standalone, the markup will appear as
# literal text — that's expected.
#
# Lookup strategy:
#   1. If $PWD is inside a git worktree, try the realpath of git-toplevel
#      against the state DB (exact match).
#   2. Otherwise fall back to the longest-prefix ancestor of realpath($PWD)
#      that exists as a key in the state DB.
#
# Schema (managed by toggl-set / toggl-migrate, see toggl-state.lib.sh):
#   toggl_repo_state(worktree_path PRIMARY KEY,
#                    project_id, project_name, client_name, task, ...)
#
# Output (visible portion, ignoring style markup): a " | "-joined sequence
# of segments, each of which is included only when its source field has a
# usable value:
#   "client: <client>"           when client_name is present
#   "proj: <name> (<id>)"        when project_name is present (else "proj: (<id>)")
#   "task: <task>"               when task is present
#
# Falls back to "NO PROJECT" when no row matches, the state DB is missing,
# or project_id is unset.

# Style fragments (tmux markup):
#   POP:   foreground=blue, bold       — for client_name, project_name, task
#   MUTED: foreground=brightblack, nobold — labels, separators, id, etc.
POP='#[fg=blue,bold]'
MUTED='#[fg=brightblack,nobold]'

STATE_DB="$HOME/.local/state/toggl/state.db"

# sql_quote — wrap a string as a SQL-safe single-quoted literal. Inlined
# rather than sourced from toggl-state.lib.sh to keep this script
# self-contained for tmux's #() invocation.
sql_quote() {
    local s=${1//\'/\'\'}
    printf "'%s'" "$s"
}

emit() {
    if [[ -z "$1" ]]; then
        echo "NO PROJECT"
        return
    fi
    local id=$1 name=$2 client=$3 task=$4

    local parts=()
    if [[ -n "$client" ]]; then
        parts+=("client: ${POP}${client}${MUTED}")
    fi
    if [[ -n "$name" ]]; then
        parts+=("proj: ${POP}${name}${MUTED} (${id})")
    else
        parts+=("proj: (${id})")
    fi
    if [[ -n "$task" ]]; then
        parts+=("task: ${POP}${task}${MUTED}")
    fi

    local sep="" out=""
    for p in "${parts[@]}"; do
        out+="${sep}${p}"
        sep=" | "
    done
    printf '%s\n' "$out"
}

# No DB yet (fresh machine, never ran toggl-set or toggl-migrate) → blank slot.
if [[ ! -f "$STATE_DB" ]]; then
    echo "NO PROJECT"
    exit 0
fi

# 1. Prefer git-toplevel of $PWD when available — exact match against the DB.
row=""
if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
    lookup=$(realpath "$git_root" 2>/dev/null) || lookup="$git_root"
    row=$(sqlite3 -separator $'\t' "$STATE_DB" \
        "SELECT project_id, project_name, COALESCE(client_name,''), COALESCE(task,'')
         FROM toggl_repo_state
         WHERE worktree_path = $(sql_quote "$lookup");")
fi

# 2. Fallback: longest-prefix ancestor of realpath($PWD). The
#    `worktree_path || '/%'` clause prevents /foo from matching /foobar.
if [[ -z "$row" ]]; then
    pwd_real=$(realpath "$PWD" 2>/dev/null) || pwd_real="$PWD"
    row=$(sqlite3 -separator $'\t' "$STATE_DB" \
        "SELECT project_id, project_name, COALESCE(client_name,''), COALESCE(task,'')
         FROM toggl_repo_state
         WHERE worktree_path = $(sql_quote "$pwd_real")
            OR $(sql_quote "$pwd_real") LIKE worktree_path || '/%'
         ORDER BY length(worktree_path) DESC
         LIMIT 1;")
fi

if [[ -z "$row" ]]; then
    echo "NO PROJECT"
    exit 0
fi

IFS=$'\t' read -r id name client task <<<"$row"
emit "$id" "$name" "$client" "$task"
