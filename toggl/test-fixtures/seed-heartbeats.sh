#!/bin/bash
# seed-heartbeats.sh — load a JSONL heartbeat fixture into a SQLite state DB
# under a chosen worktree_path. Used by the toggl-group CLI tests in
# ../TESTS.md to stage deterministic input.
#
# Usage:
#   seed-heartbeats.sh <state_db> <worktree_path> <jsonl_fixture>
#
# Examples (TESTS.md context):
#   seed-heartbeats.sh "$TOGGL_STATE_DB" "$smoke" \
#       "$fixtures/heartbeats-synthetic.jsonl"
#
# Behavior:
#   - Initializes the DB (CREATE TABLE IF NOT EXISTS via sourcing
#     toggl-state.lib.sh + toggl_state_init).
#   - Inserts each JSONL line as a row in `toggl_heartbeats` keyed by
#     <worktree_path>. Lines failing JSON validation are skipped silently;
#     the synthetic/live fixtures are well-formed by construction so this
#     should never fire in practice.
#   - Idempotency: this script appends. Run a delete-by-worktree first if
#     you want a clean slate.
#
# Required tools: bash, jq, sqlite3.

set -euo pipefail

if (( $# != 3 )); then
    echo "usage: seed-heartbeats.sh <state_db> <worktree_path> <jsonl_fixture>" >&2
    exit 1
fi

export TOGGL_STATE_DB=$1
worktree=$2
fixture=$3

if [[ ! -f "$fixture" ]]; then
    echo "seed-heartbeats.sh: fixture not found: $fixture" >&2
    exit 1
fi

# Source the lib via its canonical path under the dotfiles repo. Resolve
# relative to this script's location so it works regardless of CWD.
lib_dir=$(dirname "$(realpath "$0")")/../.local/bin
# shellcheck source=../.local/bin/toggl-state.lib.sh
source "$lib_dir/toggl-state.lib.sh"

toggl_state_init

# Build one big multi-row INSERT per fixture for speed.
sql="BEGIN;\nINSERT INTO toggl_heartbeats"
sql+=" (ts, event, trigger, session_id, worktree_path, client_name, project_id, project_name, task, details) VALUES\n"
first=1
while IFS= read -r raw; do
    [[ -z "${raw// }" ]] && continue
    parsed=$(jq -c . <<<"$raw" 2>/dev/null) || continue

    ts=$(jq -r '.ts // empty'           <<<"$parsed")
    event=$(jq -r '.event // empty'     <<<"$parsed")
    trigger=$(jq -r '.trigger // empty' <<<"$parsed")
    session_id=$(jq -r '.session_id // ""' <<<"$parsed")
    client=$(jq -r '.client_name // empty' <<<"$parsed")
    project_id=$(jq -r '.project_id // empty' <<<"$parsed")
    project_name=$(jq -r '.project_name // empty' <<<"$parsed")
    task=$(jq -r '.task // empty' <<<"$parsed")
    details=$(jq -c '.details // empty' <<<"$parsed")

    [[ -z "$ts" || -z "$event" || -z "$trigger" || -z "$client" || \
       -z "$project_id" || -z "$project_name" || -z "$task" ]] && continue

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

    row="($(sql_quote "$ts"), $(sql_quote "$event"), $(sql_quote "$trigger"), $session_sql, $(sql_quote "$worktree"), $(sql_quote "$client"), $project_id, $(sql_quote "$project_name"), $(sql_quote "$task"), $details_sql)"
    if (( first )); then
        sql+="$row"
        first=0
    else
        sql+=",\n$row"
    fi
done <"$fixture"

# Don't emit an empty INSERT when fixture has no usable lines.
if (( first )); then
    echo "seed-heartbeats.sh: no usable rows in $fixture" >&2
    exit 0
fi

sql+=";\nCOMMIT;"
printf '%b\n' "$sql" | sqlite3 "$TOGGL_STATE_DB"
