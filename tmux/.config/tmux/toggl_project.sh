#!/bin/bash
# Find .toggl in current or parent directories and emit a tmux status segment.
#
# .toggl format:
#   {
#     "project_id":   12345678,        // required for "active" status
#     "project_name": "Some Project"   // optional
#   }
#
# Output:
#   "proj: <name> (<id>)"  when both fields are present
#   "proj: (<id>)"         when only project_id is present
#   "NO PROJECT"           when no .toggl is found, or project_id is missing

find_toggl() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.toggl" ]]; then
            local id name
            id=$(jq -r '.project_id // empty' "$dir/.toggl" 2>/dev/null)
            name=$(jq -r '.project_name // empty' "$dir/.toggl" 2>/dev/null)

            if [[ -n "$id" && -n "$name" ]]; then
                printf 'proj: %s (%s)\n' "$name" "$id"
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
