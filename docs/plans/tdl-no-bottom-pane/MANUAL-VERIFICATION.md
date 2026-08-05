# MANUAL-VERIFICATION — tdl 2-pane layout (no bottom shell)

**Asana:** MASTER-1972 · **Plan:** `docs/plans/tdl-no-bottom-pane/PLAN.md`

Test ledger for the `tdl` layout change. No automated bash harness (plan
decision / out of scope); a hermetic `tmux -L tdltest` fixture drives a
**red → green** record. Step 1 (RED) fills **Observed RED** against the
*current* bashrc wrapper + Omarchy 3-pane `tdl`. Step 2 (GREEN) re-runs the
same scenarios against the full 2-pane override and fills **Observed GREEN**.
✅ rows are differentiators (must flip); 🛡 rows are regression guards.

## TL;DR

Private tmux server (`-L tdltest`), inert commands only (`true` / `false`,
`EDITOR=true`). Run S1–S5 + T before and after the override. Scenario table
in [Reference / Scenario table](#scenario-table) is the pass/fail ledger.
RED ≠ GREEN on ✅ rows proves the patch took.

## Prerequisites

- `tmux` ≥ 3.x, `bash` ≥ 4, GNU coreutils.
- Worktree `bash/.bashrc` (current wrapper for RED; override for GREEN).
- Omarchy upstream `tdl` at
  `~/.local/share/omarchy/default/bash/fns/tmux` (RED loader only).
- Do **not** send real `opencode` / `nvim` into the fixture (hangs the
  server). Live apps only in plan step 4 dogfood.

## Steps

### 1. Build the loader (RED = current wrapper)

```bash
SOCK=tdltest
LOAD=/tmp/tdltest_load.sh
OMARCHY_TMUX=~/.local/share/omarchy/default/bash/fns/tmux
mkdir -p /tmp/tdltest_cwd

# RED loader: Omarchy tdl + current bashrc thin wrapper
{
  sed -n '/^tdl() {/,/^}/p' "$OMARCHY_TMUX"
  echo 'eval "$(declare -f tdl | sed '\''s/^tdl/original_tdl/'\'')"'
  cat <<'WRAP'
tdl() {
    original_tdl "$@"
    sleep 0.7
    tmux resize-pane -t 0 -x 62%
}
WRAP
} > "$LOAD"
```

For GREEN (step 2), replace the loader body with the Design end-state
`tdl` from the plan (full override, no `original_tdl`).

### 2. Run a layout scenario (S1–S3)

```bash
tmux -L "$SOCK" kill-server 2>/dev/null || true
tmux -L "$SOCK" new-session -d -s home -c /tmp/tdltest_cwd -x 120 -y 40 -n scratch
tmux -L "$SOCK" send-keys -t 'home:scratch' \
  "source $LOAD; export EDITOR=true; cd /tmp/tdltest_cwd; tdl true; echo RC:\$?" C-m
sleep 1.8

tmux -L "$SOCK" list-panes -t home -F \
  'idx=#{pane_index} id=#{pane_id} w=#{pane_width} h=#{pane_height} top=#{pane_top} left=#{pane_left}'
tmux -L "$SOCK" display-message -t home -p \
  'name=#{window_name} W=#{window_width} H=#{window_height}'
```

S3: same recipe with `tdl true false` instead of `tdl true`.

### 3. Guard scenarios (S4–S5)

```bash
# S4 — outside tmux
unset TMUX TMUX_PANE
bash -c "source $LOAD; tdl true; echo RC:\$?"

# S5 — no args (inside fixture)
tmux -L "$SOCK" kill-server 2>/dev/null || true
tmux -L "$SOCK" new-session -d -s home -c /tmp/tdltest_cwd -x 120 -y 40 -n scratch
tmux -L "$SOCK" send-keys -t 'home:scratch' \
  "source $LOAD; tdl; echo RC:\$?" C-m
sleep 0.8
tmux -L "$SOCK" capture-pane -t home:scratch -p -S -20
tmux -L "$SOCK" list-panes -t home -F '#{pane_id}' | wc -l
```

### 4. Teardown (T)

```bash
tmux -L tdltest kill-server
# expect: "no server running on /tmp/tmux-$UID/tdltest"
```

---

## Reference

### Scenario table

**Observed RED** recorded 2026-08-05 against unmodified worktree
`bash/.bashrc` wrapper (lines 70–78) + Omarchy
`~/.local/share/omarchy/default/bash/fns/tmux` `tdl`, fixture geometry
`120×40`. **Observed GREEN** recorded 2026-08-05 against the full
2-pane override in `bash/.bashrc` (Design end-state), same geometry.

| ID | Setup | Expected GREEN | Observed GREEN | Observed RED (current) |
| --- | --- | --- | --- | --- |
| ✅S1 | `tdl true` | pane count **2** | pane count **2** | pane count **3** |
| ✅S2 | `tdl true` | widths ≈ equal (±2 cols); one row only (no full-width bottom strip) | widths **59 / 60** (Δ1); both **h=40 top=0** — one row, no bottom strip | widths **83 / 36** (not equal); bottom strip **120×6 @ top=34** present |
| ✅S3 | `tdl true false` | pane count **3** (editor + AI + AI2); AI column split vertically; no full-width bottom shell | pane count **3**; editor **59×40**; AI col **60×20 + 60×19** stacked; no full-width bottom | pane count **4**; AI col split (36×16 + 36×16); bottom strip **120×6** still present |
| 🛡S4 | outside tmux | prints `You must start tmux to use tdl.` · non-zero rc · no layout | prints `You must start tmux to use tdl.` · **RC=1** · no stray resize error | prints `You must start tmux to use tdl.` · then wrapper `can't find pane: 0` · **RC=1** |
| 🛡S5 | no args (in tmux) | prints Usage · non-zero rc · still 1 pane | prints Usage · **RC=1** · pane count **1** · no stray resize error | prints Usage · then wrapper `can't find pane: 0` · **RC=1** · pane count **1** |
| 🛡T | teardown | `tmux -L tdltest kill-server` clean | clean — `no server running on /tmp/tmux-1000/tdltest` | clean — `no server running on /tmp/tmux-1000/tdltest` |

**Pass criteria**

- ✅ rows are **differentiators**: Observed GREEN must equal Expected GREEN
  and must differ from Observed RED on the layout contract (count / bottom
  strip / width equality).
- 🛡 rows are **regression guards**: message text + non-zero rc (S4/S5) and
  clean teardown (T) must hold. GREEN may drop the RED-only
  `can't find pane: 0` side effect (wrapper always ran `resize-pane` after
  `original_tdl`, even on early return) — that is an improvement, not a
  regression.

**RED pane dump (S1/S2, geometry 120×40)**

```
idx=1 id=%0 w=83 h=33 top=0  left=0    # editor (top-left)
idx=2 id=%2 w=36 h=33 top=0  left=84   # AI     (top-right)
idx=3 id=%1 w=120 h=6 top=34 left=0    # bottom shell (full width)
window name=tdltest_cwd
```

**GREEN pane dump (S1/S2, geometry 120×40)**

```
idx=1 id=%0 w=59 h=40 top=0 left=0     # editor (full height)
idx=2 id=%1 w=60 h=40 top=0 left=60    # AI     (full height)
window name=tdltest_cwd
```

**RED pane dump (S3)**

```
idx=1 id=%0 w=83 h=33 top=0  left=0    # editor
idx=2 id=%2 w=36 h=16 top=0  left=84   # AI
idx=3 id=%3 w=36 h=16 top=17 left=84   # AI2
idx=4 id=%1 w=120 h=6 top=34 left=0    # bottom shell
window name=tdltest_cwd
```

**GREEN pane dump (S3)**

```
idx=1 id=%0 w=59 h=40 top=0  left=0    # editor (full height)
idx=2 id=%1 w=60 h=20 top=0  left=60   # AI
idx=3 id=%2 w=60 h=19 top=21 left=60   # AI2
window name=tdltest_cwd
```

### Layout model

- **RED (pre-fix):** Omarchy `tdl` does `split-window -v -p 15` (bottom
  shell), then `split-window -h -p 30` on the editor (AI right). Optional
  `ai2` vertically splits the AI pane. bashrc wrapper then
  `sleep 0.7; tmux resize-pane -t 0 -x 62%`. Result: always a full-width
  bottom strip; with one AI → 3 panes; with two AIs → 4 panes. Window
  renamed to `basename $PWD`.
- **GREEN (target):** no vertical bottom split. Single
  `split-window -h -p 50` for AI; optional vertical split of AI for
  `ai2`. No `sleep` / `resize-pane`. One AI → 2 panes ≈50/50; two AIs →
  3 panes (editor full height, AI column stacked). Same window rename,
  same S4/S5 messages, `${EDITOR:-nvim}` for the editor command.

### Observable protocol

```bash
# pane geometry (count = number of lines)
tmux -L tdltest list-panes -t home -F \
  'idx=#{pane_index} w=#{pane_width} h=#{pane_height} top=#{pane_top} left=#{pane_left}'

# bottom strip present iff some pane has left=0 and width==window_width
# and top>0 (full-width row below the top row)

# widths equal (S2 GREEN): the two top-row panes differ by ≤2 cols
```

Inert fixture contract: `export EDITOR=true` and pass `true` / `false` as
AI args so panes exit immediately and never block on TUI apps.

---

## Implementation notes

### Hermetic server

`tmux -L tdltest` uses `/tmp/tmux-$UID/tdltest`, isolated from the default
server. Fixture cwd is `/tmp/tdltest_cwd` so the window name is stable
(`tdltest_cwd`). Geometry pinned with `new-session -x 120 -y 40` so width
ratios are comparable across RED/GREEN runs.

### Loader extraction

Sourcing full `bash/.bashrc` pulls Omarchy rc, nvm, gcloud, etc., and bails
on non-interactive shells (`[[ $- != *i* ]] && return`). The fixture loads
**only** the `tdl` function under test: Omarchy body via
`sed -n '/^tdl() {/,/^}/p'`, then the bashrc wrapper (RED) or the Design
override (GREEN). Same approach as plan §Verification model.

### Why wrapper emits `can't find pane: 0` on S4/S5 (RED only)

Current wrapper unconditionally runs `tmux resize-pane -t 0 -x 62%` after
`original_tdl "$@"`, even when `original_tdl` early-returns on missing
args or missing `$TMUX`. On this host `pane-base-index` is not 0 (panes
enumerate from 1), so the resize also misfires under multi-pane layouts —
one reason the Design drops `-t 0` entirely. GREEN override returns before
any tmux mutation on S4/S5, so the stray error should disappear.

### Why S4/S5/T are guards

S4/S5 pin the usage/`$TMUX` gates. T pins teardown hygiene so leftover
`tdltest` servers do not leak into later sessions. None of these are the
layout differentiator; S1–S3 are.

## Decisions log

- **No bash harness.** Manual/hermetic ledger only (matches
  `tmux-cycle-paused-fifo` and plan out-of-scope).
- **Inert commands only in fixture.** `EDITOR=true`, AI args `true`/`false`.
  Real `tdl c` / `tdl c cx` deferred to step 4 dogfood.
- **Geometry 120×40.** Arbitrary but fixed; S2 ±2 col tolerance absorbs
  `split-window -p` rounding.
- **S4/S5 RED include wrapper side-effect.** Recorded honestly; GREEN may
  clean it up without failing the guard (message + non-zero rc remain).

## Cross-references

- `docs/plans/tdl-no-bottom-pane/PLAN.md` — Design end-state, decisions
  Q1–Q5, TDD order, deploy steps 6–8.
- `bash/.bashrc` — full 2-pane `tdl` override (MASTER-1972); RED was the
  prior `original_tdl` + resize wrapper.
- `~/.local/share/omarchy/default/bash/fns/tmux` — upstream 3-pane `tdl`
  (overridden; not called).
- Sibling pattern: `docs/plans/tmux-cycle-paused-fifo/MANUAL-VERIFICATION.md`.
- Asana MASTER-1972 —
  https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217187690537803

