#!/bin/bash
# capture-lid-event.sh — clean repro capture for lid-close externals freeze
#
# Captures Hyprland runtime log, dmesg drm events, and monitor state
# snapshots around a manual lid-close → stall → recover cycle. Output goes
# under ~/lid-capture-<timestamp>/ for review and upstream submission.
#
# Usage:
#   1. Log out and back in to start a fresh Hyprland session.
#   2. Open a terminal (preferably in tmux so it survives the lid event).
#   3. Run this script.
#   4. When prompted, close the lid. Wait until externals stall (black
#      with cursor still moving).
#   5. Recover: open lid + move mouse until screens come back.
#   6. Press Enter in the script terminal to finalize.
#   7. Upload the generated report directory.

set -euo pipefail

OUTDIR="$HOME/lid-capture-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTDIR"

# ---- Resolve current Hyprland session log path ----
HIS="${HYPRLAND_INSTANCE_SIGNATURE:-}"
if [[ -z "$HIS" ]]; then
  echo "error: HYPRLAND_INSTANCE_SIGNATURE not set; run inside a Hyprland session" >&2
  exit 1
fi
HYPR_LOG="$XDG_RUNTIME_DIR/hypr/$HIS/hyprland.log"
if [[ ! -f "$HYPR_LOG" ]]; then
  echo "error: hyprland.log not found at $HYPR_LOG" >&2
  exit 1
fi

# ---- Phase 1: System inventory ----
echo "[1/6] Capturing system inventory..."
{
  echo "# System inventory — $(date -Iseconds)"
  echo
  echo "## Packages"
  pacman -Q hyprland aquamarine hyprutils hyprlang hyprcursor hyprgraphics nvidia-open-dkms mesa linux 2>/dev/null
  echo
  echo "## Kernel / GPU"
  uname -a
  echo
  echo "## DRM cards"
  for c in /sys/class/drm/card*/device; do
    [[ -e "$c" ]] || continue
    name=$(basename "$(dirname "$c")")
    vendor=$(cat "$c/vendor" 2>/dev/null || echo unknown)
    device=$(cat "$c/device" 2>/dev/null || echo unknown)
    driver=$(basename "$(readlink "$c/driver" 2>/dev/null)" 2>/dev/null || echo unknown)
    echo "$name vendor=$vendor device=$device driver=$driver"
  done
  echo
  echo "## NVIDIA driver state"
  nvidia-smi --query-gpu=name,driver_version --format=csv 2>/dev/null || echo "(nvidia-smi unavailable)"
  echo
  echo "## Aquamarine env vars set"
  env | grep -E '^(AQ_|HYPRLAND_)' || echo "(none)"
  echo
  echo "## Lid state"
  cat /proc/acpi/button/lid/LID*/state 2>/dev/null || echo "(no lid devices)"
} >"$OUTDIR/system-inventory.md"

# ---- Phase 2: Pre-test snapshots ----
echo "[2/6] Capturing pre-test state..."
hyprctl monitors -j >"$OUTDIR/monitors-before.json"
hyprctl getoption misc:disable_lid_dpms >"$OUTDIR/dpms-option.txt" 2>&1 || true
DMESG_CURSOR=$(dmesg --since "1 minute ago" 2>/dev/null | wc -l || echo 0)

# ---- Phase 3: Mark the log ----
echo "[3/6] Marking hyprland.log start..."
PRE_LOG_BYTES=$(stat -c %s "$HYPR_LOG")
PRE_LOG_LINES=$(wc -l <"$HYPR_LOG")
echo "Pre-test: $HYPR_LOG = $PRE_LOG_BYTES bytes, $PRE_LOG_LINES lines" >"$OUTDIR/log-markers.txt"
START_TIME=$(date +%s)
echo "Start time: $START_TIME ($(date -Iseconds))" >>"$OUTDIR/log-markers.txt"

# ---- Phase 4: User reproduction ----
cat <<EOF

================================================================
Ready to capture. Do this now:

  1. CLOSE the lid.
  2. Wait for the stall (externals go black, cursor still visible).
  3. RECOVER: open lid, move mouse, until screens return.
  4. (Optional) close lid again to confirm post-recovery normal behavior.
  5. Press ENTER below to finalize and generate the report.

Output directory: $OUTDIR
================================================================

EOF
read -r -p "Press ENTER when reproduction is complete (or 'a' + ENTER to abort): " resp
if [[ "$resp" == "a" ]]; then
  echo "Aborted by user. Outputs partial in $OUTDIR" >&2
  exit 2
fi

# ---- Phase 5: Post-test snapshots ----
echo "[5/6] Capturing post-test state..."
END_TIME=$(date +%s)
hyprctl monitors -j >"$OUTDIR/monitors-after.json"
POST_LOG_BYTES=$(stat -c %s "$HYPR_LOG")
POST_LOG_LINES=$(wc -l <"$HYPR_LOG")
{
  echo "Post-test: $HYPR_LOG = $POST_LOG_BYTES bytes, $POST_LOG_LINES lines"
  echo "End time: $END_TIME ($(date -Iseconds))"
  echo "Test duration: $((END_TIME - START_TIME)) seconds"
  echo "Lines added: $((POST_LOG_LINES - PRE_LOG_LINES))"
} >>"$OUTDIR/log-markers.txt"

# ---- Phase 6: Extract relevant slices ----
echo "[6/6] Extracting log slices..."

# Full log copy (in case anything else interesting is hiding)
cp "$HYPR_LOG" "$OUTDIR/hyprland-full.log"

# Slice from the test window (lines added during the capture)
if [[ "$POST_LOG_LINES" -gt "$PRE_LOG_LINES" ]]; then
  tail -n "$((POST_LOG_LINES - PRE_LOG_LINES))" "$HYPR_LOG" >"$OUTDIR/hyprland-test-window.log"
else
  echo "(no new log lines during test window — block buffer probably not flushed yet)" >"$OUTDIR/hyprland-test-window.log"
fi

# Filtered slice: just lid / drm / aquamarine errors
grep -E "(switch:|Lid Switch|Modesetting|Disabling output|Cannot commit|page-flip|page_flip|libinput.*lid|focusmonitor|monitor:|dpms)" \
  "$HYPR_LOG" | tail -n 200 >"$OUTDIR/hyprland-lid-events.log" || true

# Kernel-side dmesg drm slice from test window
dmesg --since "@$START_TIME" 2>/dev/null | grep -i drm >"$OUTDIR/dmesg-drm.log" || true
dmesg --since "@$START_TIME" 2>/dev/null >"$OUTDIR/dmesg-full.log" || true

# Page-flip error count
PRE_FLIP_ERRORS=$(head -n "$PRE_LOG_LINES" "$HYPR_LOG" | grep -c "Cannot commit when a page-flip is awaiting" || true)
POST_FLIP_ERRORS=$(grep -c "Cannot commit when a page-flip is awaiting" "$HYPR_LOG" || true)
TEST_FLIP_ERRORS=$((POST_FLIP_ERRORS - PRE_FLIP_ERRORS))

# ---- Generate summary report ----
{
  echo "# Lid-event capture report"
  echo
  echo "Captured: $(date -Iseconds)"
  echo "Output dir: $OUTDIR"
  echo
  echo "## Test window"
  echo
  echo "- Start: $(date -d "@$START_TIME" -Iseconds)"
  echo "- End:   $(date -d "@$END_TIME" -Iseconds)"
  echo "- Duration: $((END_TIME - START_TIME))s"
  echo
  echo "## Page-flip errors"
  echo
  echo "- Pre-test (from session start to capture start): $PRE_FLIP_ERRORS"
  echo "- During test window: $TEST_FLIP_ERRORS"
  echo "- Total in session: $POST_FLIP_ERRORS"
  echo
  echo "## Monitor state diff"
  echo
  echo "### Before"
  echo
  echo '```json'
  jq '[.[] | {name, disabled, dpmsStatus, activeWorkspace: .activeWorkspace.name}]' \
    "$OUTDIR/monitors-before.json" 2>/dev/null || cat "$OUTDIR/monitors-before.json"
  echo '```'
  echo
  echo "### After"
  echo
  echo '```json'
  jq '[.[] | {name, disabled, dpmsStatus, activeWorkspace: .activeWorkspace.name}]' \
    "$OUTDIR/monitors-after.json" 2>/dev/null || cat "$OUTDIR/monitors-after.json"
  echo '```'
  echo
  echo "## Files"
  echo
  for f in "$OUTDIR"/*; do
    name=$(basename "$f")
    sz=$(stat -c %s "$f")
    echo "- \`$name\` ($sz bytes)"
  done
} >"$OUTDIR/REPORT.md"

echo
echo "================================================================"
echo "Capture complete."
echo
echo "Output: $OUTDIR"
echo "Summary: $OUTDIR/REPORT.md"
echo
echo "Page-flip errors during test: $TEST_FLIP_ERRORS"
echo "================================================================"
