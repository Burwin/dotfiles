#!/usr/bin/env bash
# Symlink the dotfiles' opencode config into ~/.config/opencode/.
#
# Idempotent: safe to re-run. Existing correct symlinks are left alone;
# existing real files are backed up to <name>.bak.<timestamp> before being
# replaced. Existing wrong symlinks are replaced without backup.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SRC_DIR="${SCRIPT_DIR}/.config/opencode"
DST_DIR="${HOME}/.config/opencode"

# Files to symlink (relative to SRC_DIR == relative to DST_DIR).
FILES=(
    opencode.json
    tui.json
    AGENTS.md
)

mkdir -p "${DST_DIR}"

link_file() {
    local rel="$1"
    local src="${SRC_DIR}/${rel}"
    local dst="${DST_DIR}/${rel}"

    if [[ ! -e "${src}" ]]; then
        echo "skip ${rel}: source missing (${src})" >&2
        return 0
    fi

    if [[ -L "${dst}" ]]; then
        local current
        current=$(readlink "${dst}")
        if [[ "${current}" == "${src}" ]]; then
            echo "ok   ${rel}: already linked"
            return 0
        fi
        echo "fix  ${rel}: replacing wrong symlink (-> ${current})"
        rm "${dst}"
    elif [[ -e "${dst}" ]]; then
        local backup="${dst}.bak.$(date +%s)"
        echo "back ${rel}: existing file -> ${backup}"
        mv "${dst}" "${backup}"
    fi

    ln -s "${src}" "${dst}"
    echo "link ${rel} -> ${src}"
}

for f in "${FILES[@]}"; do
    link_file "${f}"
done

echo
echo "Done. ~/.config/opencode/ now links to:"
for f in "${FILES[@]}"; do
    if [[ -L "${DST_DIR}/${f}" ]]; then
        printf '  %-15s -> %s\n' "${f}" "$(readlink "${DST_DIR}/${f}")"
    fi
done
