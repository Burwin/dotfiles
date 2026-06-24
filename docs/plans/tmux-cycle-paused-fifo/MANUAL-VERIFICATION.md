# MANUAL-VERIFICATION — tmux-cycle-paused FIFO (oldest-paused first)

**Asana:** MASTER-1858 · **Plan:** `docs/plans/tmux-cycle-paused-fifo/PLAN.md`

This is the test ledger for the `tmux-cycle-paused` ordering change. There is
no automated bash harness (plan decision Q4); instead a hermetic `tmux -L
cyctest` fixture with crafted marker mtimes drives a **red → green** record.
Step 1 (RED) fills the **Observed RED** column against the *current* script;
step 2 (GREEN) re-runs the same scenarios against the patched script and fills
the **Observed GREEN** column. ✅ rows are differentiators (must flip);
🛡 rows are regression guards (must not change).

## TL;DR

A private tmux server (`-L cyctest`) holds paused sessions whose marker files
have crafted mtimes. Press `Shift+Alt+Up`/`Down` (or the `run-shell` one-liners
below) and read which session the client lands on. The scenario table in
[Reference / Scenario table](#scenario-table) is the authoritative pass/fail
ledger. Run it before and after the fix; RED ≠ GREEN on the ✅ rows proves the
patch took.

## Prerequisites

- `tmux` ≥ 3.x, `bash` ≥ 4 (uses `mapfile`/`stat`), GNU coreutils (`stat -c`).
- The repo's `tmux-cycle-paused` on `PATH` or by absolute path. In a worktree,
  use the worktree copy so you exercise the version you are editing.
- A **spare terminal** you can attach to the fixture server — `switch-client`
  has no target on a fully-detached server, so observation needs a live client.

## Steps

### 1. Build the S-fixture (scenarios S1–S7)

In a shell (this becomes your *driver* shell):

```bash
TMPSTATE=$(mktemp -d); P="$TMPSTATE/opencode/paused"; mkdir -p "$P"
for s in delta bravo alpha charlie; do printf robot > "$P/$s"; done
touch -d '2026-01-01 10:00:00' "$P/delta"     # oldest  / longest-paused
touch -d '2026-01-01 10:00:10' "$P/bravo"
touch -d '2026-01-01 10:00:20' "$P/alpha"
touch -d '2026-01-01 10:00:30' "$P/charlie"   # newest  / shortest-paused
export XDG_STATE_HOME="$TMPSTATE"

tmux -L cyctest kill-server 2>/dev/null        # clean slate
tmux -L cyctest new-session -d -s home
for s in alpha bravo charlie delta; do tmux -L cyctest new-session -d -s "$s"; done
```

mtime order (oldest→newest): `delta, bravo, alpha, charlie`. Alphabetical (the
current/RED order): `alpha, bravo, charlie, delta`. The scrambling makes
RED ≠ GREEN obvious.

### 2. Attach a client (spare terminal)

```bash
tmux -L cyctest attach -t home
```

Keep this terminal open for the whole run — it is the client the script moves.
Read the landed session from the status bar or, from the driver shell, with:

```bash
tmux -L cyctest list-clients -F '#{client_session}'
```

### 3. Run a scenario

Each press = one invocation. To start a scenario, move the client to the start
session from the driver shell, then fire the script:

```bash
tmux -L cyctest switch-client -t home       # set start #S
~/.config/tmux/bin/tmux-cycle-paused prev   # one Up press; repeat for xN
tmux -L cyctest list-clients -F '#{client_session}'   # read landing
```

For multi-press scenarios, just repeat the `tmux-cycle-paused` line; the client
moves each time, so the next call sees the new `#S` exactly like the live
binding. Record the sequence of landings in the table.

> **Socket routing.** Run from a shell whose `TMUX` env var points at the
> cyctest socket (set automatically when you attach, or see
> [Implementation notes / automated runner](#automated-runner) for driving it
> without a hand-attached terminal). Otherwise the script's bare `tmux` calls
> hit your default server, not the fixture.

### 4. Build the T-fixture (tie-break scenario T)

T needs a fresh marker set — `mike@:00`, `alpha2@:10`, `zulu@:10` (two ties at
`:10`), plus an unpaused `home`:

```bash
TMPSTATE2=$(mktemp -d); P2="$TMPSTATE2/opencode/paused"; mkdir -p "$P2"
printf robot > "$P2/mike";   touch -d '2026-01-01 10:00:00' "$P2/mike"
printf robot > "$P2/alpha2"; touch -d '2026-01-01 10:00:10' "$P2/alpha2"
printf robot > "$P2/zulu";   touch -d '2026-01-01 10:00:10' "$P2/zulu"
# drop the S-fixture paused sessions so only mike/alpha2/zulu remain paused:
for s in alpha bravo charlie delta; do tmux -L cyctest kill-session -t "$s" 2>/dev/null; done
tmux -L cyctest new-session -d -s mike; tmux -L cyctest new-session -d -s alpha2; tmux -L cyctest new-session -d -s zulu
export XDG_STATE_HOME="$TMPSTATE2"
```

Then run Up ×3 from `home` as in step 3.

### 5. Teardown

```bash
tmux -L cyctest kill-server
rm -rf "$TMPSTATE" "$TMPSTATE2"
```

---

## Reference

### Scenario table

The ledger. **Observed RED** was recorded in step 1 against the unmodified
script at `tmux/.config/tmux/bin/tmux-cycle-paused` (commit prior to the step-2
fix). **Expected GREEN** is the post-fix target from the plan's Design. Step 2
fills the **Observed GREEN** column; a row passes when Observed GREEN equals
Expected GREEN (and, for 🛡 rows, also equals Observed RED).

| ID | Fixture (marker mtimes) | Start `#S` | Key | Expected GREEN | Observed GREEN | Observed RED (current) |
| --- | --- | --- | --- | --- | --- | --- |
| ✅S1 | delta:00 bravo:10 alpha:20 charlie:30 | `home` | Up ×1 | `delta` | `delta` | `alpha` |
| ✅S2 | (same as S1) | `home` | Down ×1 | `charlie` | `charlie` | `alpha` |
| ✅S3 | (same as S1) | `delta` | Up ×4 | `bravo, alpha, charlie, delta` | `bravo, alpha, charlie, delta` | `charlie, bravo, alpha, delta` |
| ✅S4 | (same as S1) | `charlie` | Down ×4 | `alpha, bravo, delta, charlie` | `alpha, bravo, delta, charlie` | `delta, alpha, bravo, charlie` |
| 🛡S5 | only `solo`:00 | `solo` | Up | message "already on the only paused opencode session", no switch | no switch (`rc=0`), session unchanged | same — no switch (`rc=0`) |
| 🛡S6 | only `solo`:00 | `home` | Up / Down | `solo` (both) | `solo` (both) | `solo` (both) |
| 🛡S7 | none paused | `home` | Up | message "no opencode sessions waiting" | no switch (`rc=0`), session unchanged | same — no switch (`rc=0`) |
| ✅T | mike:00 alpha2:10 zulu:10 | `home` | Up ×3 cold | `mike, alpha2, zulu` | `mike, alpha2, zulu` | `alpha2, zulu, mike` |

**Pass criteria**

- ✅ rows are **differentiators**: Observed GREEN must equal Expected GREEN and
  must differ from Observed RED. If a ✅ row's GREEN still matches its RED, the
  fix did not take; if it matches *neither* column, the spec or patch is wrong
  (plan §Testing strategy).
- 🛡 rows are **regression guards**: Observed GREEN must equal Observed RED
  (the 0-paused / single-paused matrix rows are preserved while ordering
  changes). S5/S7 surface a `tmux display-message` and do **not** switch;
  confirm via "client session unchanged + `rc=0`".

**Step-2 result (GREEN, recorded):** all eight rows pass. ✅S1–S4 + ✅T —
Observed GREEN equals Expected GREEN and differs from Observed RED (the
alphabetical-order behaviour is gone). 🛡S5–S7 — Observed GREEN equals
Observed RED: S5/S7 no switch with `rc=0` and the client session unchanged;
S6 lands on `solo` for both directions. Produced headlessly via the
pty+`TMUX` runner (see [Implementation notes / Automated runner](#automated-runner)).

### Ordering & direction model

Pinned by plan decisions Q1, Q2, Q5, Q6; see plan §Design for full rationale.

- **RED (pre-fix):** `paused[]` is tmux `list-sessions` order (alphabetical).
  Cold entry always `paused[0]`. `prev` (Up) steps `idx-1`; `next` (Down)
  steps `idx+1`. Source: the build, cold-entry, and step blocks of
  `tmux-cycle-paused` as it stood before this change.
- **GREEN (target):** `paused[]` sorted by marker mtime **ascending**
  (oldest/longest-paused first), tie-break alphabetical under `LC_ALL=C`.
  `paused[0]` = longest-paused, `paused[count-1]` = shortest. Cold entry is
  **direction-aware**: Up → `paused[0]` (longest), Down → `paused[count-1]`
  (shortest). Stepping is **inverted**: `prev` (Up) steps `idx+1` (toward
  newer, wrap newest→oldest); `next` (Down) steps `idx-1` (toward older).
  Sort key + cold entry + step arithmetic all flip together (plan §Risks).

### Observable protocol

The script's only side effects are `tmux switch-client -t "=$target"` (switch
scenarios) and `tmux display-message "…"` (edge scenarios S5/S7). Read the
landed session from the single attached client:

```bash
tmux -L cyctest list-clients -F '#{client_session}'
```

For S5/S7, "no switch" = the client session is unchanged after the call and the
script exits `0`; the message text is deterministic from the source
(the two `display-message` branches in `tmux-cycle-paused`).

---

## Implementation notes

### Hermetic server

`tmux -L cyctest` uses an isolated socket (`/tmp/tmux-$UID/cyctest`), fully
separate from the default server you may be running in. The fixture never
touches real opencode markers because `XDG_STATE_HOME` is redirected to the
temp dir. The script resolves its marker dir via
`dir="${XDG_STATE_HOME:-$HOME/.local/state}/opencode/paused"`
(in `tmux-cycle-paused`), so exporting `XDG_STATE_HOME` is sufficient.

### Attached-client requirement

`switch-client` errors on a fully-detached server. The script also reads the
current session with `tmux display-message -p '#S'`
(in `tmux-cycle-paused`), which targets the calling client. So a live client
must be attached to `cyctest` for the whole run — that client is both the
observer and the driven target, exactly as the real key binding drives the
user's own client.

### Automated runner

For headless reproduction (how both the step-1 RED and step-2 GREEN columns
were produced), attach a pty client in the background and route the script's
bare `tmux` calls to `cyctest` via the `TMUX` env var, whose format is
`<socket>,<server-pid>`:

```bash
SOCK=/tmp/tmux-$UID/cyctest
PID=$(tmux -L cyctest display-message -p '#{pid}')
# keep a client alive on a pty (no hand-attached terminal needed):
nohup setsid script -qfc "tmux -L cyctest attach -t home" /tmp/cyctest_pty.log >/dev/null 2>&1 &
# one press:
TMUX="$SOCK,$PID" XDG_STATE_HOME="$TMPSTATE" bash "$SCRIPT" prev
tmux -L cyctest list-clients -F '#{client_session}'   # read landing
```

`TMUX` is inherited by the script's subshells, so `tmux list-sessions`,
`display-message -p`, and `switch-client` inside it all hit `cyctest`. This is
environment-only — the script itself is unmodified. Verified on tmux 3.6b,
bash 5, GNU coreutils.

### Slug transform

The script maps a live session name to its marker via
`slug="${name//[^A-Za-z0-9_-]/_}"` (in `tmux-cycle-paused`), mirroring
`tmuxSlug()` in `opencode/.config/opencode/plugins/notify/lib.ts`. All fixture
session names (`alpha`, `bravo`, `charlie`, `delta`, `home`, `solo`, `mike`,
`alpha2`, `zulu`) are already slug-safe, so marker filenames equal session
names verbatim — no slugging edge cases are exercised here.

### mtime source

Marker mtime is the moment opencode halted, written by the notify plugin
(`opencode/.config/opencode/plugins/notify.ts:158,193,213`). The fixture fakes
it with `touch -d`; the fix reads it with `stat -c '%Y'` (whole seconds, Q6).
Same-second pauses tie-break alphabetically — that is exactly what scenario T
pins (`alpha2` before `zulu` at `:10`).

### T RED correction

The plan's scenario table predicted T's RED as `alpha2, mike, zulu`. That
prediction was **wrong**: it applied the GREEN step direction (`prev` = +1,
toward newer) to the alphabetical list. The pre-fix code mapped `prev` to
`idx-1`, so from the cold entry `alpha2` (index 0 in
`[alpha2, mike, zulu]`) Up steps to index 2 (`zulu`), then index 1 (`mike`) —
i.e. `alpha2, zulu, mike`, which is what the fixture produced. The plan's
T-row RED cell has been corrected to match; **Expected GREEN for T
(`mike, alpha2, zulu`) is unaffected and remains correct** (GREEN `prev` = +1
on the mtime-sorted list). This is precisely the class of error the RED step
exists to catch — empirically pinning current behaviour before changing it.

### Why S5–S7 are guards

S5 (single paused, current is it), S6 (single paused, current is not it), and
S7 (zero paused) exercise the `count == 1` and `count == 0` branches of
`tmux-cycle-paused` that the ordering change does not touch.
Their RED and GREEN values are identical by design; they exist to prove the
matrix's non-ordering rows survive the sort-key/cold-entry/step inversion.

## Decisions log

- **Q4 — no bash harness.** Verification is this manual/simulated ledger, not
  an automated test file. The fixture is hermetic but human-driven (or driven
  via the pty+`TMUX` trick above). Rationale: a one-off behavioural pin for a
  shell script that talks to tmux; a full harness would be disproportionate.
- **Whole-second mtime (Q6).** `stat -c '%Y'` (seconds), not `%.9Y`. Ties
  resolve alphabetically — the tie-break is live logic, not dead code.
- **T RED corrected in step 1.** The plan's predicted T RED was empirically
  wrong; both this ledger and the plan's T-row RED cell now read
  `alpha2, zulu, mike`.

## Cross-references

- `docs/plans/tmux-cycle-paused-fifo/PLAN.md` — the plan (Design, scenario
  table, decisions Q1–Q6, TDD order).
- `tmux/.config/tmux/bin/tmux-cycle-paused` — the file under change (build,
  cold-entry, step, and message blocks).
- `tmux/.config/tmux/tmux.conf:64-66` — `M-S-Up`→`prev`, `M-S-Down`→`next`.
- `opencode/.config/opencode/plugins/notify.ts:158,193,213` — marker
  create/unlink/write (mtime source); unchanged.
- `opencode/.config/opencode/plugins/notify/lib.ts` — `tmuxSlug()` transform.
- `docs/archive/opencode/PLAN-tmux-pause-indicator.md` — anticipated this
  mtime revisit.
- Asana MASTER-1858 —
  https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1215984506081651
