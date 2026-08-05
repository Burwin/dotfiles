# tdl — drop the bottom terminal pane (2-pane layout)

**Asana:** MASTER-1972 (GID `1217187690537803`) — Project MASTER → REVIEW  
**Branch:** `MASTER-1972`  
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217187690537803

## TL;DR

Omarchy’s `tdl` builds a 3-pane layout: nvim (left), AI (right), empty
shell (bottom 15%). Dotfiles wrap it in `bash/.bashrc` only to force
editor width to 62%. Change: **every** `tdl` invocation starts as
**editor + AI only** (no bottom pane), **50/50** width. Escape hatch is
existing `M-Enter` vertical split — no new flag. Implementation is a
**full override** in `bash/.bashrc` (do not patch Omarchy).

**Live status (2026-08-05):** code is complete on `MASTER-1972`
(`525257e` / `80b396e` / `673e72c`) but **not live**. `~/.bashrc` →
`~/src/dotfiles/bash/.bashrc` (main worktree on `m`), which still has
the old 3-pane wrapper. Steps 6–8 ship it.

## Goal & scope

**In scope**

- Replace the `tdl` wrapper in `bash/.bashrc` with a full 2-pane
  implementation (no call to `original_tdl`).
- Drop the bottom `split-window -v -p 15`.
- Equal width: editor 50% / AI 50% (replaces `resize-pane -t 0 -x 62%`).
- Preserve: window rename, optional second AI (`tdl <ai> <ai2>` splits
  the AI pane vertically), nvim in editor pane, focus on editor,
  `tdlm` inheritance (it already calls `tdl`).
- Manual verification artifact pinning pane-count + layout expectations
  against a hermetic `tmux -L` fixture.
- **Deploy** the override onto the machine that sources `~/.bashrc`
  (merge to `m` + ff main worktree + reload shells).

**Out of scope (do not touch)**

- Omarchy source (`~/.local/share/omarchy/default/bash/fns/tmux`).
- `tdlm` / `tsl` bodies (tdlm inherits; tsl is unrelated).
- tmux keybindings (`M-Enter` already splits vertically).
- New CLI flags (`-t` / `--term`) or a separate `tdl3` command.
- Automated bash test harness / CI wiring (manual fixture only, same
  pattern as `docs/plans/tmux-cycle-paused-fifo/`).
- Repointing `~/.bashrc` at this worktree (wrong fix — main tracks `m`).

## Decisions (locked — from MASTER-1972 review)

| # | Decision | Source |
| --- | --- | --- |
| Q1 | **All `tdl`** drops the bottom pane (not only `c` / opencode). | review |
| Q2 | **Full override in `bash/.bashrc`** — do not patch Omarchy; stop calling `original_tdl`. | review |
| Q3 | **`tdlm` inherits** via existing `tdl` calls — no `tdlm` edits. | review |
| Q4 | **No escape-hatch flag** — use `M-Enter` when a bottom shell is needed. | review |
| Q5 | **50% / 50%** editor / AI (was `resize-pane -t 0 -x 62%`). | review |

## Design

### Current layout (Omarchy `tdl` + bashrc wrapper)

```
┌─────────────────┬──────────┐
│ editor (nvim)   │ AI       │  ← top ~85%
│                 │          │
├─────────────────┴──────────┤
│ bottom shell (empty)       │  ← 15%  ← REMOVE
└────────────────────────────┘
```

Wrapper then: `sleep 0.7; tmux resize-pane -t 0 -x 62%`.

### Target layout

```
┌──────────────────────┬──────────────────────┐
│ editor (nvim)  ~50%  │ AI  ~50%             │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

With optional second AI (`tdl c cx`):

```
┌──────────────────────┬──────────────────────┐
│ editor (nvim)  ~50%  │ AI                   │
│                      ├──────────────────────┤
│                      │ AI2                  │
└──────────────────────┴──────────────────────┘
```

### Authoritative end-state (`bash/.bashrc` tdl block)

Replace the current `original_tdl` rename + thin wrapper (lines ~70–78)
with a self-contained override. Do **not** leave a dead `original_tdl`
rename.

```bash
# tmux — override Omarchy tdl: editor + AI only (no bottom shell).
# Escape hatch for a terminal: M-Enter (vertical split). See MASTER-1972.
tdl() {
  [[ -z $1 ]] && { echo "Usage: tdl <c|cx|codex|other_ai> [<second_ai>]"; return 1; }
  [[ -z $TMUX ]] && { echo "You must start tmux to use tdl."; return 1; }

  local current_dir="${PWD}"
  local editor_pane ai_pane ai2_pane
  local ai="$1"
  local ai2="$2"

  editor_pane="$TMUX_PANE"
  tmux rename-window -t "$editor_pane" "$(basename "$current_dir")"

  # AI on the right, equal width (no bottom terminal pane)
  ai_pane=$(tmux split-window -h -p 50 -t "$editor_pane" -c "$current_dir" -P -F '#{pane_id}')

  if [[ -n $ai2 ]]; then
    ai2_pane=$(tmux split-window -v -t "$ai_pane" -c "$current_dir" -P -F '#{pane_id}')
    tmux send-keys -t "$ai2_pane" "$ai2" C-m
  fi

  tmux send-keys -t "$ai_pane" "$ai" C-m
  tmux send-keys -t "$editor_pane" "${EDITOR:-nvim} ." C-m
  tmux select-pane -t "$editor_pane"
}
```

Notes:

- No `sleep` / `resize-pane` — `-p 50` is the width contract; targeting
  pane index `0` was fragile across layouts anyway.
- `${EDITOR:-nvim}` matches Omarchy intent while surviving an unset
  `EDITOR`.
- `tdlm` keeps calling `tdl` and needs no change.

### Deploy model (why branch ≠ live)

```
~/.bashrc  →  ~/src/dotfiles/bash/.bashrc   (main worktree, branch m)
                    ↑
              only updates when m advances

~/src/dotfiles/MASTER-1972/bash/.bashrc     (this worktree — has override)
```

There is **no** install step for bashrc — the home symlink already
points at the main checkout. "Deploy" = land the override on `m` so
the file behind `~/.bashrc` changes, then reload shells.

Do **not**:

- Repoint `~/.bashrc` at the worktree (breaks the single-source-of-truth
  main checkout).
- Copy/paste the function by hand into main's bashrc (diverges from git).
- Expect already-open shells to pick it up without `source ~/.bashrc`.

### Verification model (manual / hermetic tmux)

No bash unit harness in this repo for shell functions. Same approach as
`tmux-cycle-paused-fifo`: a committed `MANUAL-VERIFICATION.md` driven by
a private tmux server. Use inert commands (`true` / `sleep 60`) instead
of real `opencode`/`nvim` so the fixture is non-interactive.

Fixture sketch (author the full recipe in step 1):

```bash
SOCK=tdltest
tmux -L "$SOCK" kill-server 2>/dev/null || true
# Load ONLY the tdl function under test (extract or source bashrc carefully)
tmux -L "$SOCK" new-session -d -s home -c /tmp
tmux -L "$SOCK" send-keys -t home:0 'tdl true' C-m
# after settle:
tmux -L "$SOCK" list-panes -t home:0 -F '#{pane_index} #{pane_width} #{pane_height} #{pane_title}'
# expect: exactly 2 panes; roughly equal widths; window name = basename of cwd
tmux -L "$SOCK" kill-server
```

Scenarios to pin:

| ID | Setup | Expect |
| --- | --- | --- |
| S1 | `tdl true` | pane count **2** (not 3) |
| S2 | `tdl true` | widths ≈ equal (±2 cols); one row only (no bottom strip) |
| S3 | `tdl true false` (second AI) | pane count **3** (editor + AI + AI2); AI column split vertically; still no full-width bottom shell |
| S4 | outside tmux | prints "You must start tmux…" and returns non-zero |
| S5 | no args | prints Usage and returns non-zero |
| T  | teardown | `tmux -L tdltest kill-server` clean |

**RED column:** run S1–S3 against **current** wrapper (Omarchy 3-pane) —
S1 fails (count=3), S2 fails (bottom strip present).  
**GREEN column:** after override, all match Expect.

### Deploy verification (steps 6–7)

| ID | Check | Expect |
| --- | --- | --- |
| D1 | `readlink -f ~/.bashrc` | `…/src/dotfiles/bash/.bashrc` (main) |
| D2 | `rg -n 'split-window -h -p 50|original_tdl' "$(readlink -f ~/.bashrc)"` | has `-p 50` override; **no** `original_tdl` |
| D3 | `git -C ~/src/dotfiles branch --show-current` + log | on `m`, contains `80b396e` (or squash equivalent) |
| D4 | fresh shell / `source ~/.bashrc` then `tdl c` in throwaway dir | 2 panes, ~50/50, nvim + opencode, no bottom shell |
| D5 | `tdl c cx` | 3 panes; AI column stacked; still no full-width bottom |

## TDD implementation order

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | Author `docs/plans/tdl-no-bottom-pane/MANUAL-VERIFICATION.md` (two-layer: human recipe + LLM scenario table). Run S1–S5 + T against the **current, unmodified** `bash/.bashrc` tdl wrapper via `tmux -L tdltest`; fill RED column (S1 count=3, S2 bottom present). Commit `test(bash): pin 2-pane tdl layout expectations`. | GLM 5.2 |
| 2 | GREEN | Replace the `original_tdl` rename + thin wrapper in `bash/.bashrc` with the Design end-state (full 2-pane override, 50/50, no bottom split). Re-run S1–S5 + T; fill GREEN column = all match. Commit `fix(bash): tdl starts as editor+AI only (no bottom pane)`. | GLM 5.2 |
| 3 | REFACTOR | Comment polish only: brief header on why we override Omarchy (MASTER-1972 + M-Enter escape); drop any leftover `original_tdl` residue if still present. No behavior change; re-smoke S1–S3. Commit `docs(bash): note tdl 2-pane override rationale`. | Grok Build 0.1 |
| 4 | INTEGRATION | Dogfood on the **real** tmux server against the **worktree** bashrc (`source` worktree file or open a shell that loads it): `tdl c` in a throwaway dir, confirm 2 panes / ~50-50 / nvim + opencode / no bottom shell; `tdl c cx` still stacks a second AI. If red, loop back to step 2. **Does not** make the change live system-wide. | Opus 4.8 |
| 5 | INTEGRATION | Asana → move MASTER-1972 to REVIEW; comment with commit SHAs + dogfood result. Leave plan active until deploy (do **not** archive yet). | GLM 5.2 |
| 6 | DEPLOY | Push `MASTER-1972`, open PR → `m`, get it merged (squash or merge — match recent repo style). Confirm remote `m` contains the bashrc override. Commit message / PR title reference MASTER-1972. | GLM 5.2 |
| 7 | DEPLOY | Fast-forward main worktree: `git -C ~/src/dotfiles checkout m && git pull` (or equivalent). Verify D1–D3. In every shell that should pick it up: `source ~/.bashrc` (or open a new shell). Live smoke D4–D5. If D2 still shows `original_tdl`, main did not ff — stop and fix before claiming live. | Opus 4.8 |
| 8 | INTEGRATION | Asana → DONE; comment with PR URL + merge SHA + D1–D5 pass. Archive plan: `git mv` → `docs/archive/bash/PLAN-tdl-no-bottom-pane.md` (+ ledger), prepend archive header, commit `docs(archive): archive tdl-no-bottom-pane plan (MASTER-1972)`. | GLM 5.2 |

## Testing strategy

- **Primary:** hermetic `tmux -L tdltest` + `MANUAL-VERIFICATION.md`
  checklist (RED before change, GREEN after).
- **Worktree dogfood (step 4):** real `tdl c` / `tdl c cx` with the
  worktree bashrc loaded — proves the function, not the deploy path.
- **Live deploy smoke (step 7):** D1–D5 against the file behind
  `~/.bashrc` after `m` advances.
- **Not required:** bun/jest harness, CI job, or changes under `tmux/`.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| `~/.bashrc` symlink points at main worktree, not this worktree | **By design.** Deploy = merge to `m` + ff main (steps 6–7). Never repoint the symlink at a feature worktree. |
| Step 4 dogfood can pass while system still runs 3-pane | Expected until step 7. Step 4 must `source` worktree bashrc explicitly if the shell loaded main. |
| Main worktree dirty / wrong branch blocks ff | `git -C ~/src/dotfiles status` first; stash or finish other work before pull. |
| Already-open shells keep old `tdl` function | `source ~/.bashrc` or new shell after D2 is green. Function is defined at shell start, not re-read per call. |
| `split-window -h -p 50` percentage is of the **target pane**, not always exact columns | S2 allows ±2 cols; if wildly off, add `tmux resize-pane -t "$editor_pane" -x 50%` in GREEN |
| Sending real `opencode`/`nvim` into the fixture hangs the server | Fixture uses `true` / `false` / `sleep` only; live apps only in steps 4 and 7 |
| Omarchy updates reintroduce a different `tdl` | Our bashrc **overrides** after sourcing Omarchy rc — name collision is intentional; do not call `original_tdl` |
| `tdlm` sends `tdl $ai $ai2` into panes — empty `$ai2` still OK | Unchanged Omarchy tdlm behavior; our tdl treats empty ai2 as absent |
| Pane index `0` resize was wrong under multi-pane | Design uses `$editor_pane` id only; no `-t 0` |
| Premature archive (step 5 once archived before deploy) | Rolled back 2026-08-05; archive only in step 8 after D1–D5 pass |

## Progress

- [x] 1 — RED: pin 2-pane expectations (MANUAL-VERIFICATION)
- [x] 2 — GREEN: full tdl override in bashrc
- [x] 3 — REFACTOR: comment / residue cleanup
- [x] 4 — Dogfood on live tmux (worktree; acceptance; no commit)
- [x] 5 — Asana → REVIEW + comment (plan left active for deploy)
- [ ] 6 — Push / PR / merge to `m`
- [ ] 7 — FF main worktree + reload shells + D1–D5 smoke
- [ ] 8 — Asana → DONE + archive plan

## References

- `bash/.bashrc` — full 2-pane `tdl` override (MASTER-1972)
- `~/.local/share/omarchy/default/bash/fns/tmux` — upstream 3-pane `tdl`
- `~/.local/share/omarchy/default/bash/aliases` — `c='opencode'`, `ic='tdl c'`
- Review comment on task `1217187690537803` (Q1–Q5 locked)
- Sibling manual-fixture pattern: `docs/plans/tmux-cycle-paused-fifo/PLAN.md`
- Deploy path: `~/.bashrc` → `~/src/dotfiles/bash/.bashrc` (main / `m`)

## Kickoff

After each step completes, post the **next** trigger verbatim.

- After 1 → ▶️ Step `2` of `8` — `GREEN: full tdl override in bashrc` — model: `GLM 5.2` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
- After 2 → ▶️ Step `3` of `8` — `REFACTOR: comment / residue cleanup` — model: `Grok Build 0.1` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
- After 3 → ▶️ Step `4` of `8` — `INTEGRATION: dogfood on live tmux` — model: `Opus 4.8` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
- After 4 → ▶️ Step `5` of `8` — `INTEGRATION: Asana → REVIEW + bookkeeping` — model: `GLM 5.2` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
- After 5 → ▶️ Step `6` of `8` — `DEPLOY: push / PR / merge to m` — model: `GLM 5.2` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
- After 6 → ▶️ Step `7` of `8` — `DEPLOY: ff main + reload shells + smoke` — model: `Opus 4.8` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
- After 7 → ▶️ Step `8` of `8` — `INTEGRATION: Asana DONE + archive` — model: `GLM 5.2` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`

▶️ Step `6` of `8` — `DEPLOY: push / PR / merge to m` — model: `GLM 5.2` — plan: `docs/plans/tdl-no-bottom-pane/PLAN.md`
