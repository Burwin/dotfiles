#!/usr/bin/env bash
# Hermetic check: tmux-prune-paused-orphans removes only orphan markers.
#
# MASTER-1976 step 4 (RED) / step 5 (GREEN). No real tmux server — a fake
# `tmux` on PATH returns the live-session list. Marker dir is a temp
# XDG_STATE_HOME.
#
# Expected after prune:
#   live_a   remains (basename matches a live session slug)
#   orphan_x removed (no live session)
#
# Exit 0 = GREEN; non-zero = RED / fail. Prints a one-line RESULT summary.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
script="${repo_root}/tmux/.config/tmux/bin/tmux-prune-paused-orphans"

if [[ ! -x $script ]]; then
  echo "RESULT: RED — prune script missing or not executable: $script"
  echo "  expected: live_a kept, orphan_x removed"
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

state="$tmp/state"
paused="$state/opencode/paused"
mkdir -p "$paused"
printf 'robot\n' >"$paused/live_a"
printf 'question\n' >"$paused/orphan_x"

# Fake tmux: only list-sessions is used by the prune bin.
mkdir -p "$tmp/bin"
cat >"$tmp/bin/tmux" <<'EOF'
#!/usr/bin/env bash
if [[ ${1:-} == list-sessions ]]; then
  # Live set is just live_a (raw name == slug for this fixture).
  printf '%s\n' 'live_a'
  exit 0
fi
echo "fake-tmux: unexpected args: $*" >&2
exit 2
EOF
chmod +x "$tmp/bin/tmux"

set +e
PATH="$tmp/bin:$PATH" XDG_STATE_HOME="$state" "$script"
rc=$?
set -e

kept_live=0
kept_orphan=0
[[ -f $paused/live_a ]] && kept_live=1
[[ -f $paused/orphan_x ]] && kept_orphan=1

echo "after prune: live_a=$kept_live orphan_x=$kept_orphan exit=$rc"
echo "  remaining: $(ls -1 "$paused" 2>/dev/null | tr '\n' ' ')"

if (( rc != 0 )); then
  echo "RESULT: RED — prune exited $rc (want 0; best-effort must not fail callers)"
  exit 1
fi
if (( kept_live != 1 )); then
  echo "RESULT: RED — live_a was removed (must keep markers for live sessions)"
  exit 1
fi
if (( kept_orphan != 0 )); then
  echo "RESULT: RED — orphan_x still present (must rm markers not in live slug set)"
  exit 1
fi

echo "RESULT: GREEN — live_a kept, orphan_x removed, exit 0"
exit 0
