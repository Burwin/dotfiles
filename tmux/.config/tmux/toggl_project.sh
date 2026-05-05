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
#     "client_name":  "Some Client"       // optional (null when unknown)
#   }
#
# Output (visible portion, ignoring style markup):
#   "client: <client> | proj: <name> (<id>)"  when client_name + project_name + id all present
#   "proj: <name> (<id>)"                     when project_name + id present (no client)
#   "proj: (<id>)"                            when only project_id is present
#   "NO PROJECT"                              when no .toggl is found, or project_id is missing

# Style fragments (tmux markup):
#   POP:   foreground=blue, bold       — for client_name and project_name
#   MUTED: foreground=brightblack, nobold — labels, separators, id, etc.
POP='#[fg=blue,bold]'
MUTED='#[fg=brightblack,nobold]'

find_toggl() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.toggl" ]]; then
            local id name client
            id=$(jq -r '.project_id // empty' "$dir/.toggl" 2>/dev/null)
            name=$(jq -r '.project_name // empty' "$dir/.toggl" 2>/dev/null)
            client=$(jq -r '.client_name // empty' "$dir/.toggl" 2>/dev/null)

            if [[ -n "$id" && -n "$name" && -n "$client" ]]; then
                printf 'client: %s%s%s | proj: %s%s%s (%s)\n' \
                    "$POP" "$client" "$MUTED" \
                    "$POP" "$name"   "$MUTED" \
                    "$id"
            elif [[ -n "$id" && -n "$name" ]]; then
                printf 'proj: %s%s%s (%s)\n' "$POP" "$name" "$MUTED" "$id"
            elif [[ -n "$id" ]]; then
                printf 'proj: (%s)\n' "$id"
            else
                echo "NO PROJECT"
            fi
            return
        fi
        dir="$(dirname "$dir")"
    done
    echo "NO PROJECT"
}

find_toggl
