# OpenCode Cost — tmux Status Bar Surface — PLAN.md

Status: proposal (2026-05-19); implementation not yet started
Owner: mbh
Origin session: 2026-05-19 — "display the most updated cost in the top
status bar"

Sibling plans:

- `../opencode-cost-tracker/PLAN.md` — parent plan; defines
  `zen_daily_billed` schema, the zen-sync timer, and the
  `~/.local/state/opencode-cost.db` location.
- `../opencode-cost-zen-per-request/PLAN.md` — future per-row source
  (`zen_usage`) that will let the same status segment break down by
  session if/when we want it.
- `../opencode-cost-breakdown/PLAN.md` — context on per-project
  rollups (out of scope here; this plan is single-number status only).

## Progress

- 2026-05-19 — plan drafted. No code changes yet.

## 1. Problem

The tmux status bar currently shows toggl attribution
(`client: Bamboo | proj: Internal | task: SH-264 | …`) via
`toggl-tmux-status`. Spend tracking lives in
`~/.local/state/opencode-cost.db` (populated by the cost-tracker plugin
and the `opencode-cost-zen-sync` timer) but isn't surfaced anywhere
ambient — you have to run `opencode-cost dump …` or query SQLite
directly to see today's burn.

Target rendering:

```
daily-cost: $13 | total-cost: $1364 | client: Bamboo | proj: Internal | task: SH-264 | <hostname>
```

Two figures, both rounded UP to the nearest dollar:

- **daily-cost** — sum of today's row(s) in `zen_daily_billed`, local tz.
- **total-cost** — sum of everything in `zen_daily_billed` (all-time;
  the DB only has data from 2026-05-01 onward, and the user is OK with
  this growing because tasks are short-lived).

Plus: bump the zen-sync cadence from hourly to every 10 minutes so the
number on screen lags by ≤10 min instead of ≤60.

## 2. Locked decisions (from Q&A in origin session)

| Decision                  | Choice                                                              |
|---------------------------|---------------------------------------------------------------------|
| Timeframes                | `daily-cost` (today, local tz) + `total-cost` (all-time / whole DB) |
| Script placement          | New bin `opencode-cost-tmux-status` (bash + sqlite3)                |
| Empty / stale DB          | Hide the cost segment entirely (silent fall-through)                |
| Sync cadence              | `OnCalendar=*:0/10` (every 10 min on the :00/:10/:20/… mark)        |
| Documentation             | Progress entry on parent PLAN; this dedicated PLAN added on request |
| Today's row not yet synced | `daily-cost: $0` (honest; the 10-min sync will catch up quickly)   |

Rejected: subcommand on `opencode-cost` (bun startup cost on every 5s
tmux tick); extending `toggl-tmux-status` (couples concerns across
repos); showing `cost: $0` when DB missing (misleading vs honest hide).

## 3. Architecture

Three loosely-coupled changes:

1. **New bash script** `opencode-cost-tmux-status` that reads the DB
   and prints the segment (or nothing on failure).
2. **tmux.conf** prepends the script's output to `status-right`.
3. **systemd timer** for `opencode-cost-zen-sync` bumped to 10-min
   cadence.

No DB schema changes. No plugin changes. No CLI changes.

### 3.1 File map

```
dotfiles/
├── opencode/.config/opencode/
│   ├── bin/
│   │   └── opencode-cost-tmux-status     (NEW — bash + sqlite3)
│   └── systemd/
│       └── opencode-cost-zen-sync.timer  (MODIFY — OnCalendar)
├── tmux/.config/tmux/
│   └── tmux.conf                         (MODIFY — status-right)
└── docs/plans/opencode-cost-tracker/
    └── PLAN.md                           (MODIFY — Progress entry)
```

The dotfiles' `opencode/install.sh:34` already whole-dir-symlinks
`bin/`, so a new file inside `bin/` is picked up automatically —
no install.sh edit needed.

## 4. Script: `opencode-cost-tmux-status`

### 4.1 Query

Single SQL statement returns two integers in fxp8 USD:

```sql
SELECT
    COALESCE(SUM(CASE WHEN date = date('now', 'localtime') THEN total_cost_fxp8 ELSE 0 END), 0),
    COALESCE(SUM(total_cost_fxp8), 0)
FROM zen_daily_billed;
```

`date('now', 'localtime')` matches Zen's per-tz `date` column. Zen
returns dates in the user's local tz because the zen-sync request
body sends `{"t":1,"s":"-04:00"}` (parent PLAN §6 Phase 4). Today
on the machine == today in the DB.

Open read-only so the 5-second tmux tick never blocks the plugin or
the zen-sync writer:

```bash
sqlite3 -readonly -separator $'\t' "$DB_PATH" "<query>"
```

WAL mode is already on (parent PLAN §5 `PRAGMA journal_mode=WAL`), so
concurrent readers don't block writers either way; `-readonly` is
defensive and documents intent.

### 4.2 Round-up math

Integer ceiling-by-floor: `(x + denom - 1) / denom`.

```
denom = 100_000_000   (= 10^8, the fxp8 unit)
cents = (fxp8 + 99_999_999) / 100_000_000   # bash integer arithmetic
```

Sanity table:

| Input fxp8     | USD               | Rounded up |
|----------------|-------------------|------------|
| 0              | $0.00             | $0         |
| 1              | $0.00000001       | $1         |
| 99_999_999     | $0.99999999       | $1         |
| 100_000_000    | $1.00 exactly     | $1         |
| 100_000_001    | $1.00000001       | $2         |
| 1_363_678_667  | $13.63678667      | $14        |
| 14_194_167_950 | $141.9416795      | $142       |

### 4.3 Output contract

When `total_fxp8 > 0`:

```
daily-cost: <POP>$13<MUTED> | total-cost: <POP>$1364<MUTED> |
```

(trailing ` | ` separates from the toggl segment that follows in
tmux.conf). Styles:

- `POP=#[fg=blue,bold]` — same as `toggl-tmux-status`'s value style
- `MUTED=#[fg=brightblack,nobold]` — same muted color for labels +
  pipes + trailing separator

When `total_fxp8 <= 0`, DB file missing, sqlite3 errors, or any
other failure: exit 0 with empty stdout. tmux renders nothing for
that `#()` slot, so the status bar falls through to the existing
`client: … | proj: …` rendering with zero visual change.

### 4.4 Reference implementation

```bash
#!/bin/bash
# opencode-cost-tmux-status — emit a tmux status segment showing
# today's spend and all-time spend from ~/.local/state/opencode-cost.db.
#
# Output is intended for tmux's status-right via #(); tmux style
# markup (#[...]) below is interpreted by tmux's format parser when
# the result is interpolated. Run standalone, markup shows literally.
#
# Hidden silently (empty stdout) when:
#   - The DB file is missing.
#   - sqlite3 fails or returns nothing.
#   - The total of zen_daily_billed is zero (no rows yet).
#
# Both figures are rounded UP to the nearest dollar.
#
# See: docs/plans/opencode-cost-tmux-status/PLAN.md

POP='#[fg=blue,bold]'
MUTED='#[fg=brightblack,nobold]'

DB_PATH="${OPENCODE_COST_DB:-$HOME/.local/state/opencode-cost.db}"

[[ -f "$DB_PATH" ]] || exit 0

row=$(sqlite3 -readonly -separator $'\t' "$DB_PATH" "
    SELECT
        COALESCE(SUM(CASE WHEN date = date('now', 'localtime') THEN total_cost_fxp8 ELSE 0 END), 0),
        COALESCE(SUM(total_cost_fxp8), 0)
    FROM zen_daily_billed;
" 2>/dev/null) || exit 0

[[ -z "$row" ]] && exit 0

IFS=$'\t' read -r today_fxp8 total_fxp8 <<<"$row"

[[ "$total_fxp8" -le 0 ]] && exit 0

# Ceiling-by-floor: (x + denom - 1) / denom on integer fxp8.
daily_usd=$(( (today_fxp8 + 99999999) / 100000000 ))
total_usd=$(( (total_fxp8 + 99999999) / 100000000 ))

printf 'daily-cost: %s$%d%s | total-cost: %s$%d%s | ' \
    "$POP" "$daily_usd" "$MUTED" \
    "$POP" "$total_usd" "$MUTED"
```

Path resolution mirrors `opencode-cost/dump.ts:30` — `OPENCODE_COST_DB`
override so tests can point at a fixture DB.

`chmod 755` on commit.

## 5. tmux.conf wiring

Single-line change at `tmux/.config/tmux/tmux.conf:88`.

Before:

```
set -g status-right "#[fg=brightblack]#(cd '#{pane_current_path}' 2>/dev/null && PATH=$HOME/.local/bin:$PATH toggl-tmux-status) | #h "
```

After:

```
set -g status-right "#[fg=brightblack]#(opencode-cost-tmux-status)#(cd '#{pane_current_path}' 2>/dev/null && PATH=$HOME/.local/bin:$PATH toggl-tmux-status) | #h "
```

PATH already includes `~/.config/opencode/bin` via
`environment.d/.config/environment.d/path.conf:14`, so no PATH= prefix
is needed on the new `#()` slot — tmux inherits the user-session PATH.

The cost script self-includes its trailing ` | ` so it concatenates
cleanly into the existing toggl segment. When the cost script outputs
nothing, the rendered status is byte-identical to the current
behavior.

## 6. Systemd timer cadence

File: `opencode/.config/opencode/systemd/opencode-cost-zen-sync.timer`

Changes:

- `Description=opencode-cost: Zen daily-billed sync (hourly)` →
  `Description=opencode-cost: Zen daily-billed sync (every 10 minutes)`
- `OnCalendar=hourly` → `OnCalendar=*:0/10`
- Update the inline comment that says "Hourly is plenty" to explain
  the 10-min cadence and trade-offs.

`*:0/10` fires at xx:00, xx:10, xx:20, etc. — predictable wall-clock
buckets, aligns with Zen's own daily rollup boundaries. `Persistent=false`
stays (a sleeping laptop still skips missed windows; one-page fetch
is idempotent so no thundering-herd concern).

Apply after merge:

```bash
systemctl --user daemon-reload
systemctl --user restart opencode-cost-zen-sync.timer
systemctl --user list-timers opencode-cost-zen-sync.timer
```

## 7. PLAN.md update on parent

Add a Progress entry dated 2026-05-19 at the top of
`docs/plans/opencode-cost-tracker/PLAN.md` Progress block, before
the "**Next:**" line. Wording:

```
- 2026-05-19 — tmux status bar surface added
  (`bin/opencode-cost-tmux-status`, bash + sqlite3) showing
  `daily-cost: $N | total-cost: $M`, both rounded up to the nearest
  dollar. Daily reads today's row in `zen_daily_billed` via
  `date('now','localtime')` (matches Zen's per-tz date column);
  total sums the whole table. Hidden silently when DB is missing or
  empty. Wired into `tmux/.config/tmux/tmux.conf` status-right
  ahead of the existing `toggl-tmux-status` segment. The zen-sync
  systemd timer cadence bumped from `OnCalendar=hourly` to
  `OnCalendar=*:0/10` so the number on screen lags by ≤10 minutes
  instead of ≤60. Details in
  `../opencode-cost-tmux-status/PLAN.md`.
```

No changes to §11 implementation order — this is a post-Phase-4 user
surface, not a numbered phase.

## 8. Implementation order

| #  | Step                                            | Effort  |
|----|-------------------------------------------------|---------|
| T1 | Write `bin/opencode-cost-tmux-status` (chmod +x)| ~15 min |
| T2 | Update `tmux/.config/tmux/tmux.conf:88`         | ~2 min  |
| T3 | Bump `opencode-cost-zen-sync.timer` to `*:0/10` | ~2 min  |
| T4 | Add Progress entry to parent PLAN.md            | ~5 min  |
| T5 | Manual verification (see §9)                    | ~5 min  |

Total ~30 min. All five steps land in one commit on `MASTER-1703`.

## 9. Verification

After committing on `MASTER-1703` and (when ready) merging into `m`:

1. **Syntax check.**
   ```bash
   bash -n ~/src/dotfiles/MASTER-1703/opencode/.config/opencode/bin/opencode-cost-tmux-status
   ```

2. **Standalone run.**
   ```bash
   ~/.config/opencode/bin/opencode-cost-tmux-status
   # expected: daily-cost: #[fg=blue,bold]$142#[fg=brightblack,nobold] | total-cost: #[fg=blue,bold]$1364#[fg=brightblack,nobold] |
   ```

3. **Empty-DB hide.**
   ```bash
   OPENCODE_COST_DB=/nonexistent opencode-cost-tmux-status
   # expected: empty stdout, exit 0
   ```

4. **Empty-table hide.**
   ```bash
   tmp=$(mktemp); sqlite3 "$tmp" 'CREATE TABLE zen_daily_billed (date TEXT, model TEXT, key_id TEXT, plan TEXT, total_cost_fxp8 INTEGER, fetched_at TEXT);'
   OPENCODE_COST_DB="$tmp" opencode-cost-tmux-status
   # expected: empty stdout, exit 0
   rm "$tmp"
   ```

5. **Reload tmux.**
   ```bash
   tmux source ~/.config/tmux/tmux.conf
   # within 5s the cost segment appears at the start of status-right
   ```

6. **Timer cadence.**
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart opencode-cost-zen-sync.timer
   systemctl --user list-timers opencode-cost-zen-sync.timer
   # expected: NEXT is within 10 minutes; LAST is the most recent xx:x0 boundary
   ```

7. **Post-sync log check.**
   After the next timer fire:
   ```bash
   journalctl --user -u opencode-cost-zen-sync -n 20
   # expected: clean run, no auth/server-id errors
   ```

8. **Rounding spot-check.**
   ```bash
   sqlite3 ~/.local/state/opencode-cost.db "SELECT SUM(total_cost_fxp8) FROM zen_daily_billed WHERE date = date('now', 'localtime');"
   # divide by 1e8, compare against the daily-cost figure in the bar:
   #   bar value must equal ceil(query result / 1e8)
   ```

## 10. Open items / non-goals

1. **Per-task / per-project rollup in the bar.** Out of scope. Waits
   on `zen_usage` (per-row Zen table) from
   `../opencode-cost-zen-per-request/PLAN.md` and the toggl-join SQL
   from `../opencode-cost-breakdown/PLAN.md` §A.

2. **Reading from `messages` table for sub-10-min freshness.** The
   plugin writes per-message rows so the local capture lags by zero
   (instead of ≤10 min). Two reasons not to use it for the bar:
   - It's empty in practice right now (capture-side bug per the
     breakdown PLAN's data-state block).
   - Even when populated, Zen's billed dollars are authoritative;
     local recompute drifts on tier crossings and cache TTLs.
   Revisit if the 10-min lag turns out to be annoying.

3. **Color thresholding.** No red-over-$X-today / green-under-$Y
   logic. Easy to add later as a third style state on POP; not
   shipping in this round.

4. **Local cache / memoization across 5s ticks.** SQLite WAL reads
   land in ~1-5 ms; not worth adding state.

5. **Rate-limit / API-pressure concern from 6× more frequent
   zen-sync.** Personal usage; low risk. The captured failure modes
   (cookie expiry, x-server-id rotation — parent PLAN §7) don't
   change in frequency, only in time-to-detection. Acceptable.

6. **`flock(2)` advisory lock around zen-sync.** Spec'd in
   `../opencode-cost-zen-per-request/PLAN.md` §5.3 but not yet
   implemented. At 10-min cadence with sub-second run time, the
   race window (timer + manual run) is unchanged in practice.
   Land it when that plan's Z3/Z4 ships, not as part of this work.

7. **Daily-cost timezone drift across DST boundaries.** If the
   user's `-04:00` flips to `-05:00` (or back), `date('now',
   'localtime')` follows the system clock so the bar stays
   correct from one query to the next. Zen's `date` column is
   computed server-side from the tz_offset in the request body —
   the parent PLAN's tz_offset config will need to track DST too,
   but that's a parent-plan concern, not this surface.

## 11. Reference data

- DB path: `~/.local/state/opencode-cost.db` (override via
  `OPENCODE_COST_DB`).
- DB schema: parent PLAN §5; `zen_daily_billed` is the only table
  read here.
- Style markup: copied from
  `~/src/bamboo/tools/src/opencode/bin/toggl-tmux-status:33-34`.
- PATH entry: `environment.d/.config/environment.d/path.conf:14`.
- tmux poll interval: `tmux.conf:77` (`set -g status-interval 5`).
- Current zen-sync timer: `opencode/.config/opencode/systemd/opencode-cost-zen-sync.timer:10`.
