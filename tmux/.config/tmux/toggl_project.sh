#!/bin/bash
# Find .toggl in current or parent directories and emit a tmux status segment.
#
# Output is intended to be embedded in tmux's status-right via #(). Any tmux
# style markup (`#[...]`) below is interpreted by tmux's format parser when
# the result is interpolated. Run standalone, the markup will appear as
# literal text — that's expected.
#
# .toggl format:
#   {
#     "project_id":   12345678,           // required for "active" status
#     "project_name": "Some Project",     // optional
#     "client_name":  "Some Client",      // optional (null when unknown)
#     "task":         "Refactor auth"     // optional (null when unset)
#   }
#
# Output (visible portion, ignoring style markup): a " | "-joined sequence
# of segments, each of which is included only when its source field has a
# usable value:
#   "client: <client>"           when client_name is present
#   "proj: <name> (<id>)"        when project_name is present (else "proj: (<id>)")
#   "task: <task>"               when task is present
#
# Falls back to "NO PROJECT" when no .toggl is found or project_id is missing.

# Style fragments (tmux markup):
#   POP:   foreground=blue, bold       — for client_name, project_name, task
#   MUTED: foreground=brightblack, nobold — labels, separators, id, etc.
POP='#[fg=blue,bold]'
MUTED='#[fg=brightblack,nobold]'

find_toggl() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.toggl" ]]; then
            local id name client task
            id=$(jq -r '.project_id // empty' "$dir/.toggl" 2>/dev/null)
            name=$(jq -r '.project_name // empty' "$dir/.toggl" 2>/dev/null)
            client=$(jq -r '.client_name // empty' "$dir/.toggl" 2>/dev/null)
            task=$(jq -r '.task // empty' "$dir/.toggl" 2>/dev/null)

            if [[ -z "$id" ]]; then
                echo "NO PROJECT"
                return
            fi

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
            return
        fi
        dir="$(dirname "$dir")"
    done
    echo "NO PROJECT"
}

find_toggl
