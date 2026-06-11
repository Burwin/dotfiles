#!/usr/bin/env bash
# Symlink the dotfiles' opencode config into ~/.config/opencode/, and
# wire the cost-tracker's systemd user units into ~/.config/systemd/user/.
#
# Idempotent: safe to re-run. Existing correct symlinks are left alone;
# existing real files are backed up to <name>.bak.<timestamp> before being
# replaced. Existing wrong symlinks are replaced without backup.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SRC_DIR="${SCRIPT_DIR}/.config/opencode"
DST_DIR="${HOME}/.config/opencode"
SYSTEMD_SRC_DIR="${SRC_DIR}/systemd"
SYSTEMD_DST_DIR="${HOME}/.config/systemd/user"

# Files to symlink (relative to SRC_DIR == relative to DST_DIR).
#
# Top-level configs are managed here; the `notify` plugin tree was
# symlinked manually before this script existed and is left alone. The
# `cost-tracker` plugin (cost-tracker.ts entrypoint + cost-tracker/
# helpers subdirectory) is managed here so a fresh-machine install picks
# it up automatically. `bin/`, `opencode-cost/`, and `skills/` are
# whole-dir links (their contents change without needing install.sh edits
# each time); new global skills under skills/<name>/SKILL.md are picked up
# with no install.sh change and auto-discovered by opencode on restart;
# the PATH entry for ~/.config/opencode/bin lives in
# ../../environment.d/.config/environment.d/path.conf so the CLI is
# visible to non-interactive shells too. See
# ../../docs/archive/opencode/PLAN-cost-tracker.md.
FILES=(
    opencode.json
    tui.json
    AGENTS.md
    plugins/cost-tracker.ts
    plugins/cost-tracker
    bin
    opencode-cost
    skills
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

# ---------------------------------------------------------------------------
# Systemd user units (cost-tracker zen-sync timer).
#
# Symlink every *.service / *.timer from .config/opencode/systemd/ into
# ~/.config/systemd/user/, daemon-reload, and enable each timer. Matches
# the install pattern in bamboo/tools/src/toggl/install.sh.
#
# Heads up: opencode-cost-zen-sync needs a Zen session cookie at
# ~/.config/opencode/secrets/zen-session-cookie (chmod 600) and a config
# at ~/.config/opencode-cost/config.json. See
# docs/archive/opencode/PLAN-cost-tracker.md §12.4. If those are missing
# the timer will still install and enable, but each run will exit
# non-zero (visible via `journalctl --user -u opencode-cost-zen-sync`).
# ---------------------------------------------------------------------------

if [[ -d "${SYSTEMD_SRC_DIR}" ]] && compgen -G "${SYSTEMD_SRC_DIR}/*.service" >/dev/null 2>&1; then
    echo
    echo "Linking systemd units into ${SYSTEMD_DST_DIR}"
    mkdir -p "${SYSTEMD_DST_DIR}"

    link_systemd_unit() {
        local src="$1"
        local name
        name=$(basename "${src}")
        local dst="${SYSTEMD_DST_DIR}/${name}"

        if [[ -L "${dst}" ]]; then
            local current
            current=$(readlink "${dst}")
            if [[ "${current}" == "${src}" ]]; then
                echo "  ok    systemd/${name} (already linked)"
                return 0
            fi
            echo "  fix   systemd/${name}: replacing wrong symlink (-> ${current})"
            rm "${dst}"
        elif [[ -e "${dst}" ]]; then
            local backup="${dst}.bak.$(date +%s)"
            echo "  back  systemd/${name}: existing file -> ${backup}"
            mv "${dst}" "${backup}"
        fi

        ln -s "${src}" "${dst}"
        echo "  link  systemd/${name}"
    }

    shopt -s nullglob
    for unit in "${SYSTEMD_SRC_DIR}"/*.service "${SYSTEMD_SRC_DIR}"/*.timer; do
        link_systemd_unit "${unit}"
    done
    shopt -u nullglob

    echo "  reload  systemctl --user daemon-reload"
    systemctl --user daemon-reload

    shopt -s nullglob
    for timer in "${SYSTEMD_SRC_DIR}"/*.timer; do
        unit_name=$(basename "${timer}")
        echo "  enable  ${unit_name}"
        systemctl --user enable --now "${unit_name}"
    done
    shopt -u nullglob

    echo
    echo "Active opencode-cost timers:"
    systemctl --user list-timers --all | awk 'NR==1 || /opencode-cost/'
fi
