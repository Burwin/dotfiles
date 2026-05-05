#!/bin/bash
# Find .toggl in current or parent directories and return project_id

find_toggl() {
    local dir="$PWD"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/.toggl" ]]; then
            jq -r '.project_id // "N/A"' "$dir/.toggl" 2>/dev/null && exit 0
        fi
        dir="$(dirname "$dir")"
    done
    echo "—"
}

find_toggl
