# tmux-cycle-paused — FIFO (oldest-paused first), not alphabetical

**Asana:** MASTER-1858 (GID `1215984506081651`) — Project MASTER → IN PROGRESS
**Branch:** `MASTER-1858`

## TL;DR

`Shift+Alt+Up` (`M-S-Up` → `tmux-cycle-paused prev`) currently jumps to the
**alphabetically-first** paused opencode session. Change the cycle to order by
**pause age** (marker-file mtime, oldest first) so Up goes to the session paused
**longest**, and repeated Up walks longest → shortest. Down mirrors. Only
`tmux-cycle-paused` changes; the status-left glyphs stay alphabetical.
Verification is **manual/simulated** (no bash test harness) — a hermetic
`tmux -L` fixture with crafted marker mtimes drives the red → green → refactor
history via a checklist artifact.

## Goal & scope

**In scope**

- `tmux/.config/tmux/bin/tmux-cycle-paused` — sort the cycle list by marker
  mtime (oldest first), tie-break alphabetical; make cold-entry direction-aware
  and mirror the stepping.
- A committed manual-verification artifact (`MANUAL-VERIFICATION.md`) that pins
  the expected FIFO behavior and records red (before) → green (after).
- Header-comment invariant + behavior-matrix comment rewrite in the same
  script.

**Out of scope (do not touch)**

- `opencode/.config/opencode/plugins/notify.ts` — marker writer; mtime is used
  **as-is** (Q1).
- `tmux/.config/tmux/bin/tmux-status-left` & `tmux-pause-glyph` — glyph order
  stays alphabetical (Q3).
- `tmux.conf:64-66` bindings — unchanged (an optional one-line comment
  clarification is allowed in step 3, not required).
- No new automated test framework / harness file (Q4).

## Decisions (locked)

| # | Decision | Source |
| --- | --- | --- |
| Q1 | Order by marker-file **mtime as-is** (no `notify.ts` change). Tie-break alphabetical. | kickoff |
| Q2 | Full longest→shortest walk for Up: sort oldest-first; Up steps toward **newer** (wrap newest→oldest); Down mirrors. | kickoff |
| Q3 | Scope to `tmux-cycle-paused` only; leave status-left glyphs alphabetical; update the header-comment invariant. | kickoff |
| Q4 | **Manual / simulated** verification only — no new bash test harness. Adapt RED to a manual checklist with crafted mtimes + `run-shell` sims. | kickoff |
| Q5 | **Cold-entry is direction-aware (full mirror):** Up cold-enters at longest-paused, Down at shortest-paused. | review |
| Q6 | **Whole-second mtime** (`stat -c %Y`); same-second pauses fall back to alphabetical (tie-break is commonly live). | review |

## Design

### Ordering model

The cycle list `paused[]` is sorted by marker mtime **ascending** (epoch
seconds), tie-broken alphabetically under `LC_ALL=C`:

- `paused[0]` = **longest-paused** (oldest), `paused[count-1]` =
  **shortest-paused** (newest).
- **Up (`prev`)**: cold-enter `paused[0]`; in-ring step `idx → (idx+1)%count`
  (toward newer, wrap newest→oldest).
- **Down (`next`)**: cold-enter `paused[count-1]`; in-ring step
  `idx → (idx-1+count)%count` (toward older, wrap oldest→newest).

This **inverts** the current direction arithmetic (today `prev`=−1, `next`=+1)
*and* changes the sort key and the cold-entry branch. All three must flip
together.

### Authoritative end-state (`tmux/.config/tmux/bin/tmux-cycle-paused`)

Changed regions vs. current: the candidate-build loop (`:58-63`), the
zero-guard/sort/count block (`:65-73`), the cold-entry branch (`:89-92`), and
the step arithmetic (`:101-105`). The header/behavior-matrix comments
(`:19-40`) land in step 3, not step 2.

```bash
#!/usr/bin/env bash
# tmux-cycle-paused — "smart cycle" between tmux sessions whose opencode is
# paused (the Alt+Shift+Up / Alt+Shift+Down bindings).
#
# Part of the opencode pause-indicator
# (docs/archive/opencode/PLAN-tmux-pause-indicator.md). The opencode notify
# plugin drops a marker file
#   $XDG_STATE_HOME/opencode/paused/<slug>
# for every tmux session whose opencode has halted for input. <slug> is the
# session name with every byte outside [A-Za-z0-9_-] collapsed to '_' — the
# tmuxSlug() transform in opencode/.config/opencode/plugins/notify/lib.ts,
# also mirrored by the sibling tmux-pause-glyph.
#
# This jumps the calling client to the previous/next such session.
#
# Args:   $1 = "next" | "prev"   (direction to cycle)
# Output: nothing on stdout; user-facing feedback goes via `tmux display-message`.
#
# WHY WE ITERATE LIVE SESSIONS AND FORWARD-SLUG THEM (rather than just listing
# the marker dir, as the PLAN's first-cut sketch did):
#   1. Reverse-mapping. Marker filenames are slugs, but `switch-client` needs
#      the RAW session name, and slugging is lossy (no reliable inverse).
#      Slugging a live name forward is exact, so we recover the real target.
#   2. Orphan markers. A marker left by a session that was since killed or
#      renamed (the plugin's `dismiss` never fires on a hard kill) would be an
#      un-switchable target. Intersecting with live sessions silently drops it.
#   3. Consistency. tmux-status-left builds its glyphs the same way (iterate
#      live sessions, stat the marker), so the set we cycle through is exactly
#      the set the user sees marked in the status bar.
#
# ORDERING — pause age, oldest first (MASTER-1858). The cycle list is sorted by
# each marker file's mtime ascending (mtime == the moment opencode halted, per
# notify.ts). Index 0 is the session PAUSED LONGEST, the last index the
# shortest; same-second mtimes tie-break alphabetically (LC_ALL=C). This
# DELIBERATELY DIVERGES from the status-left glyph order, which stays
# alphabetical (tmux list-sessions order): the glyphs are a glanceable map, the
# cycle is a FIFO service queue.
#
# DIRECTION (note the inversion vs. a naive array walk):
#   Up   (prev): cold-enter the LONGEST-paused, then each press steps toward
#                NEWER, wrapping newest -> oldest.
#   Down (next): mirror — cold-enter the SHORTEST-paused, then each press steps
#                toward OLDER, wrapping oldest -> newest.
#
# Behaviour matrix:
#   0 paused                    -> status-line message, no switch
#   1 paused, current is it     -> message, stay (no switch)
#   1 paused, current is not it -> switch to it
#   2+ paused, current in list  -> step to neighbour, wrapping around the ends
#   2+ paused, current not in   -> jump to the queue end for the pressed
#                                  direction (Up -> longest, Down -> shortest)

dir="${XDG_STATE_HOME:-$HOME/.local/state}/opencode/paused"

direction=$1
case "$direction" in
  next | prev) ;;
  *)
    tmux display-message "tmux-cycle-paused: expected 'next' or 'prev', got '${direction:-}'"
    exit 2
    ;;
esac

# Live, paused sessions, each tagged with its marker mtime (epoch seconds)
# zero-padded to a fixed 11-digit width, so a plain lexicographic sort orders by
# pause age without trusting an in-band field separator. Same forward-slug +
# marker-exists filter as before. A `stat` race — the marker vanishing between
# the test and the stat — drops the entry, same as an orphan. A missing marker
# dir just means no match for every session -> the empty-list path below.
entries=()
while IFS= read -r name; do
  [[ -n $name ]] || continue
  slug="${name//[^A-Za-z0-9_-]/_}"
  marker="$dir/$slug"
  [[ -f $marker ]] || continue
  mtime=$(stat -c '%Y' "$marker" 2>/dev/null) || continue
  printf -v key '%011d' "$mtime"
  entries+=("$key"$'\t'"$name")
done < <(tmux list-sessions -F '#{session_name}' 2>/dev/null)

if (( ${#entries[@]} == 0 )); then
  # 0-paused: visible status-line message only. The PLAN deliberately skips the
  # terminal bell here — it is filtered too inconsistently across emulators to
  # rely on. Do not switch.
  tmux display-message "no opencode sessions waiting"
  exit 0
fi

# Sort by the fixed-width mtime key ascending (longest-paused first); equal keys
# tie-break alphabetically on the raw name — both fall out of one LC_ALL=C
# lexicographic sort because the key is zero-padded to constant width. Strip the
# 12-char prefix (11-digit key + TAB) by CHARACTER POSITION (`cut -c`), never by
# field: a session name may itself contain a TAB, which `cut -f` would corrupt.
mapfile -t paused < <(
  printf '%s\n' "${entries[@]}" | LC_ALL=C sort | LC_ALL=C cut -c13-
)
count=${#paused[@]}

# The calling client's current session. Run from a key binding via run-shell,
# `display-message -p` resolves against that client, so this is the session the
# user is looking at when they press the key.
current=$(tmux display-message -p '#S')

# Index of the current session within the paused list (-1 if not paused).
idx=-1
for i in "${!paused[@]}"; do
  if [[ ${paused[i]} == "$current" ]]; then
    idx=$i
    break
  fi
done

if (( idx < 0 )); then
  # Current session is not itself paused -> cold-enter the queue at the end that
  # matches the pressed direction: Up (prev) at the longest-paused (index 0),
  # Down (next) at the shortest-paused (last index). Covers both "1 paused,
  # current is not it" and "2+ paused, current not in".
  if [[ $direction == prev ]]; then
    target=${paused[0]}            # Up   -> longest-paused
  else
    target=${paused[count - 1]}    # Down -> shortest-paused
  fi
elif (( count == 1 )); then
  # The only paused session is the one we are already on. Nothing to switch to;
  # surface a message instead of a silent no-op (an unexplained dead keypress
  # reads as a broken binding). This still honours the matrix's "no switch".
  tmux display-message "already on the only paused opencode session"
  exit 0
else
  # In the ring with neighbours -> step one over, wrapping at both ends. Up
  # (prev) walks toward NEWER (longest -> shortest), Down (next) toward OLDER.
  if [[ $direction == prev ]]; then
    next_idx=$(( (idx + 1) % count ))
  else
    next_idx=$(( (idx - 1 + count) % count ))
  fi
  target=${paused[next_idx]}
fi

# Leading '=' forces an exact session-name match, so a name that is a prefix of
# another (e.g. "m" vs "master") can never switch to the wrong session.
tmux switch-client -t "=$target"
```

### Manual verification fixture (hermetic, no committed harness)

A private tmux server (`-L cyctest`) that inherits a temp `XDG_STATE_HOME` of
crafted markers. The user's real `tmux.conf` loads, so `M-S-Up`/`M-S-Down` and
the glyph scripts work against the fixture. Setup (run in a spare terminal; the
human attaches and drives it):

```bash
TMPSTATE=$(mktemp -d); P="$TMPSTATE/opencode/paused"; mkdir -p "$P"
for s in delta bravo alpha charlie; do printf robot > "$P/$s"; done
touch -d '2026-01-01 10:00:00' "$P/delta"     # oldest  / longest-paused
touch -d '2026-01-01 10:00:10' "$P/bravo"
touch -d '2026-01-01 10:00:20' "$P/alpha"
touch -d '2026-01-01 10:00:30' "$P/charlie"   # newest  / shortest-paused

export XDG_STATE_HOME="$TMPSTATE"
tmux -L cyctest new-session -d -s home
for s in alpha bravo charlie delta; do tmux -L cyctest new-session -d -s "$s"; done
tmux -L cyctest attach -t home      # then press the keys, or use run-shell one-liners

# Per scenario (example: cold entry, Up):
#   tmux -L cyctest switch-client -t =home
#   tmux -L cyctest run-shell "~/.config/tmux/bin/tmux-cycle-paused prev"
#   tmux -L cyctest display-message -p '#S'      # -> EXPECT: delta

# Teardown:
#   tmux -L cyctest kill-server; rm -rf "$TMPSTATE"
```

mtime order (oldest→newest): `delta, bravo, alpha, charlie`. Alphabetical (the
old/RED order): `alpha, bravo, charlie, delta`. The scrambling makes RED ≠
GREEN obvious.

> Observation needs an **attached client** — `switch-client` has no target on a
> fully-detached server, so keep the `attach -t home` client alive (a spare
> terminal) while running the sims. The human reads the landed session from the
> status bar or the `display-message -p '#S'` echo.

**Scenario table** (the "tests"; ✅ = differentiator, 🛡 = regression guard):

| ID | Start `#S` | Key | Expected GREEN | Current RED |
| --- | --- | --- | --- | --- |
| ✅S1 | `home` (unpaused) | Up ×1 | `delta` | `alpha` |
| ✅S2 | `home` | Down ×1 | `charlie` | `alpha` |
| ✅S3 | `delta` | Up ×4 | `bravo, alpha, charlie, delta` | `charlie, bravo, alpha, delta` |
| ✅S4 | `charlie` | Down ×4 | `alpha, bravo, delta, charlie` | `delta, alpha, bravo, charlie` |
| 🛡S5 | only `solo` paused, `#S=solo` | Up | message "already on the only paused…", no switch | same |
| 🛡S6 | only `solo` paused, `#S=home` | Up / Down | `solo` (both) | `solo` |
| 🛡S7 | none paused, `#S=home` | Up | message "no opencode sessions waiting" | same |
| ✅T | tie-break set `mike@:00, alpha2@:10, zulu@:10`, `#S=home` | Up ×3 from cold | `mike, alpha2, zulu` (alpha2 before zulu) | `alpha2, zulu, mike` |

S5–S7 share the same RED/GREEN value on purpose: they guard that the existing
0-paused / single-paused matrix rows are preserved while the ordering changes.

> **T RED corrected in step 1.** The original sketch had T's RED as
> `alpha2, mike, zulu` — that applied the *GREEN* step direction (`prev` = +1)
> to the alphabetical list. The pre-fix code mapped `prev` to `idx-1`,
> so cold `alpha2` (idx 0 in `[alpha2, mike, zulu]`)
> Up-steps to idx 2 (`zulu`), then idx 1 (`mike`) → `alpha2, zulu, mike`, which
> the hermetic fixture produced. Expected GREEN for T is unaffected. See
> `MANUAL-VERIFICATION.md` §"T RED correction".

## TDD implementation order (M = 5)

Phases are independently shippable; each step is one move + its own commit so
history reads **red → green → refactor**. Commit subjects use Conventional
Commits; bodies explain *why* and reference MASTER-1858. The act of running a
step authorizes its commit.

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| **A — pin behavior** | | | |
| 1 | RED | Author `docs/plans/tmux-cycle-paused-fifo/MANUAL-VERIFICATION.md` (fixture recipe + scenario table, two-layer doc). Run the **current, unmodified** script through S1–S4 + T via the fixture; record the RED column showing alphabetical results that miss Expected. Commit `test(tmux): pin FIFO cycle-order expectations for tmux-cycle-paused`. | GLM 5.2 |
| **B — implement** | | | |
| 2 | GREEN | Apply the Design end-state to `tmux-cycle-paused` (mtime-tagged build → zero-guard → `sort`/`mapfile` → direction-aware cold entry → mirrored stepping). Leave header/matrix comments for step 3. Re-run S1–S7 + T; fill the GREEN column = all match Expected. Commit `fix(tmux): cycle paused sessions oldest-paused first (FIFO)`. | GLM 5.2 |
| **C — document** | | | |
| 3 | REFACTOR | Rewrite the header **ORDERING/DIRECTION** invariant + behavior-matrix comment (replace the alphabetical paragraph at `:31-40`); fix the stale `docs/plans/tmux-opencode-pause-indicator/PLAN.md` provenance path → `docs/archive/opencode/PLAN-tmux-pause-indicator.md`; optional one-line clarify on `tmux.conf:64-66`. No behavior change; re-smoke S1–S3. Commit `docs(tmux): document mtime cycle-order invariant`. | GLM 5.2 |
| **D — ship** | | | |
| 4 | INTEGRATION | Dogfood on the **real** tmux server: `touch -d` a couple live markers to known mtimes, press `Shift+Alt+Up`/`Down`, confirm longest-first cold entry + walk + Down mirror live. If red, loop back to step 2. | Opus 4.8 |
| 5 | INTEGRATION | Move Asana **MASTER-1858 → REVIEW**, post a plain-text comment summarizing the change + commit SHA(s), tick this plan's Progress. (Open a PR only if asked.) | GLM 5.2 |

## Testing strategy

- **No automated tests** (Q4). The scenario table in `MANUAL-VERIFICATION.md`
  is the test ledger; RED records current output, GREEN records post-fix
  output, both via the hermetic `-L cyctest` fixture.
- **Cheapest tier that exercises the change** = the hermetic fixture (steps
  1–2); the **real-server dogfood** is the acceptance gate (step 4).
- **Mutation check:** S1–S4 + T are differentiators — if any still matches the
  *RED* column after step 2, the fix didn't take; if any matches *neither*
  column, the spec or the patch is wrong.

## Risks & gotchas

- **Direction inversion is the subtle bit.** Up = `prev` now maps to `idx+1`;
  Down = `next` to `idx-1`. The cold-entry branch is *also* direction-aware
  (`paused[0]` vs `paused[count-1]`). Sort key + cold entry + step arithmetic
  must flip together or Up/Down desync.
- **Whole-second ties (Q6).** Two sessions paused in the same second order
  alphabetically, not by true sub-second time. Accepted; `%Y` chosen over
  `%.9Y` so the alphabetical tie-break is meaningful rather than dead code.
- **`LC_ALL=C sort`** gives deterministic byte-collation, close to tmux's own
  list order for the tie-break edge.
- **Name edge cases.** Names with embedded **tabs/newlines** are pre-existing
  unsupported (upstream `read` is newline-delimited); the `-t<TAB>` / `cut -f2-`
  decoration preserves **spaces**.
- **`stat`/`mapfile` are GNU/bash-4+** — fine here (bash 5.3, GNU coreutils
  confirmed on this host).
- **Hermetic observation needs an attached client** (`switch-client` requires
  one) — keep the `attach -t home` client alive; don't sim against a fully
  detached server.
- **Glyph/cycle divergence is intentional** (Q3) — a reviewer may flag it; the
  rewritten header comment explains why.

## Progress

- [x] 1 — RED: verification spec + recorded red (commit 95dbd01)
- [x] 2 — GREEN: mtime-ordered, direction-aware selection (commit da45dce)
- [x] 3 — REFACTOR: invariant comments + stale-path fix (commit 2f36251)
- [x] 4 — Dogfood on live tmux (acceptance; manual, no commit)
- [x] 5 — Asana → REVIEW + bookkeeping (this commit)

## References

- `tmux/.config/tmux/bin/tmux-cycle-paused` — the file to change (build
  `:58-63`, select `:89-107`, invariant `:31-33`).
- `tmux/.config/tmux/tmux.conf:64-66` — `M-S-Up`→`prev`, `M-S-Down`→`next`.
- `tmux/.config/tmux/bin/tmux-status-left`, `tmux-pause-glyph` — siblings;
  glyph order stays alphabetical.
- `opencode/.config/opencode/plugins/notify.ts:158,193,213` — marker
  create/unlink/write (mtime source); **unchanged**.
- `opencode/.config/opencode/plugins/notify/lib.ts` — `tmuxSlug()` transform.
- `docs/archive/opencode/PLAN-tmux-pause-indicator.md:234-236,442-444` —
  anticipated this mtime revisit.
- Asana MASTER-1858 —
  https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1215984506081651

## Triggers

Post the **next** step's trigger verbatim when a step completes.

- After 1 → ▶️ Step `2` of `5` — `GREEN: cycle oldest-paused first (FIFO)` — model: `GLM 5.2` — plan: `docs/plans/tmux-cycle-paused-fifo/PLAN.md`
- After 2 → ▶️ Step `3` of `5` — `REFACTOR: document mtime cycle-order invariant` — model: `GLM 5.2` — plan: `docs/plans/tmux-cycle-paused-fifo/PLAN.md`
- After 3 → ▶️ Step `4` of `5` — `INTEGRATION: dogfood on live tmux` — model: `Opus 4.8` — plan: `docs/plans/tmux-cycle-paused-fifo/PLAN.md`
- After 4 → ▶️ Step `5` of `5` — `INTEGRATION: Asana → REVIEW + bookkeeping` — model: `GLM 5.2` — plan: `docs/plans/tmux-cycle-paused-fifo/PLAN.md`

### Kickoff

▶️ Step `1` of `5` — `RED: pin FIFO cycle-order expectations` — model: `GLM 5.2` — plan: `docs/plans/tmux-cycle-paused-fifo/PLAN.md`
