# Tmux session shortcuts + opencode pause indicator + smart cycle

Status: planning (not yet started).

## Problem

Cycling through tmux sessions with `Ctrl+b, Ctrl+P` is slow when 5+
opencode TUIs are running concurrently. We have no at-a-glance signal
for which sessions have paused opencodes waiting for input vs which
are still working, so we end up cycling through them all blindly.

We want:

1. Shorter, prefix-less keybindings for the common session ops
   (cycle / picker / new / rename / kill).
2. A visual indicator showing which tmux sessions have a paused
   opencode (idle, asking permission, asking a question, or errored).
3. "Smart cycle" — Alt+Shift+Up/Down jumps only between paused
   sessions, skipping ones still working.

## Decisions (locked, from initial conversation)

- **Pause state** covers all four halting events emitted by the
  notify plugin: `session.idle`, `session.error`, `permission.asked`,
  `question.asked`.
- **Indicator location**: both the `choose-tree` picker AND the
  always-visible `status-left` session list.
- **0-paused cycle behavior**: status-line message + (visible) bell;
  do not switch.
- **New keybindings**:
  - `Alt+s` → session picker
  - `Alt+Shift+Up` / `Alt+Shift+Down` → smart cycle
  - `Alt+n` → new session in home dir `~` (updated 2026-06-19: was pane cwd)
- **State source**: extend `~/.config/opencode/plugins/notify.ts` to
  write per-tmux-session marker files at
  `~/.local/state/opencode/paused/<tmux-session>`. Decoupled from
  mako's notification lifecycle (mako auto-expires `normal`-urgency
  toasts in 5s, so it cannot be the source of truth for `session.idle`).

## Background research findings

### Collision check — Alt+n / Alt+s are safe

- **Hyprland** (`~/.config/hypr/bindings.conf`): only uses `SUPER`-prefixed
  combos. No `ALT`-only bindings.
- **tmux** (`~/.config/tmux/tmux.conf`): existing `M-*` bindings are
  `M-1..9`, `M-Up/Down/Left/Right`, `M-Shift-Left/Right`. No `M-n`,
  `M-s`, `M-Shift-Up/Down`.
- **opencode TUI** (per https://opencode.ai/docs/keybinds): `alt+a/b/d/e/f/
  left/right/return/delete/backspace/shift+a/...` are bound for input
  editing, but `alt+n` and `alt+s` are not in the keybind map.
- **bash readline / vim**: neither binds `Alt+n` or `Alt+s` by default.

`bind -n M-n` / `bind -n M-s` will intercept the keystroke before any
inner program sees it, but since none of the inner programs bind these
keys we lose nothing.

### Mapping tmux session → opencode session

The notify plugin (`notify.ts:115-126`) resolves
`tmux display-message -p '#S'` once at plugin load and uses the result
as the title on every notification. This means **the tmux session name
is already embedded in every notify event side-effect**. We use the
tmux session name as the marker-file key — no fuzzy matching, no
database lookups, no HTTP probes.

### Why mako alone is insufficient

`/home/mbh/.local/share/omarchy/default/mako/core.ini`:

```ini
default-timeout=5000
[urgency=critical]
default-timeout=0
```

`session.idle` events fire with `urgency: "normal"` (`lib.ts:82`), so
the mako toast disappears in 5s. `permission.asked` / `question.asked`
/ `session.error` fire with `critical` and persist, but idle is the
most common "waiting for me" state. Reading `makoctl list -j` would
miss idle sessions almost immediately. Hence the marker-file approach.

### Existing notify plugin behavior we leverage

- `lib.ts:dispatchEvent` returns one of three actions:
  - `notify` (with `tag` ∈ `{robot, lock, question, warning}` and
    optional `sessionID`) — fired on the four halting events.
  - `dismiss` (with `sessionID`) — fired on **any other** event for a
    session, signaling that the agent / user is moving again.
  - `noop` — for `session.status` (overloaded; would race with
    `session.idle`) and events without a sessionID.
- `notify.ts:138-172` handles each action: `notify-send -p` for mako,
  `pingNtfy` for ntfy, `tracker.dismissAll` for `dismiss`.

This dispatch flow is exactly what we want — `notify` arms the marker
file, `dismiss` removes it. No other event coverage needed.

## Architecture

```
opencode (per pane)
  └─ NotifyPlugin (extended)
       ├─ on notify  action → touch  ~/.local/state/opencode/paused/<tmux-session>
       └─ on dismiss action → unlink ~/.local/state/opencode/paused/<tmux-session>

tmux
  ├─ status-left          → tmux-status-left script  (lists sessions, calls glyph script per row)
  ├─ choose-tree (Alt+s)  → format string with #() to tmux-pause-glyph
  └─ Alt+Shift+Up/Down    → tmux-cycle-paused script (find marker dir, switch-client)
```

Marker file content = the `tag` from the notify action
(`robot` / `lock` / `question` / `warning`) so the glyph script can
render different colors for idle vs urgent states.

## Files to change / create

### 1. `opencode/.config/opencode/plugins/notify.ts` — modify

Add ~25 lines for state-file management:

- At plugin init (after `tmuxSession` is resolved):
  - `mkdir -p ~/.local/state/opencode/paused/`
  - **Clean up any stale marker** for this `tmuxSession` (handles
    crash-recovery: if the prior process died without dismissing,
    its marker would otherwise persist).
- **Sanitize `tmuxSession`** for filesystem safety. tmux's
  `rename-session` accepts arbitrary strings (including `/` and `..`);
  must not allow path traversal. Replace anything outside
  `[A-Za-z0-9_-]` with `_`. Helper goes in `lib.ts` for testability.
- In the event handler:
  - `case "notify"`: after `notify-send` + `pingNtfy`, write the
    marker file with content = `action.tag`.
  - `case "dismiss"`: after `tracker.dismissAll`, unlink the marker.
- All file ops `.catch(() => {})` to preserve the plugin's
  never-crash invariant.

Skip all of the above if `tmuxSession` is empty (opencode launched
outside tmux). The marker-file system only makes sense for tmux-hosted
sessions.

Key invariant: the marker is keyed by **tmux session name**, not
opencode session id. This matches the user's mental model (one tmux
session = one workstream). If two opencode instances run in the same
tmux session, the file is shared — last writer wins, which is
acceptable. (Single-pane-of-glass per tmux session is the typical
workflow.)

### 2. `opencode/.config/opencode/plugins/notify/lib.ts` — modify

Add a pure `tmuxSlug(name: string): string` helper. Keep all I/O in
`notify.ts` so `lib.ts` stays side-effect-free at module load
(per its existing convention, lib.ts:32-34).

### 3. `opencode/.config/opencode/plugins/notify/notify.test.ts` — modify

Add tests:

- `tmuxSlug` sanitization: `"a/b"` → `"a_b"`, `".."` → `"__"`,
  `"SH-280"` → `"SH-280"`, `"my session"` → `"my_session"`.
- Regression: `dispatchEvent` action shape unchanged (the new code is
  consumer-side, not dispatch-side).

### 4. `tmux/.config/tmux/bin/tmux-pause-glyph` — new

```bash
#!/usr/bin/env bash
# Render a paused-indicator glyph for one tmux session.
# Args: $1 = tmux session name (already filesystem-safe, but we just
#            stat the file — no shell-metachar risk here).
# Output: tmux-format string with the glyph, or empty if not paused.
d="${XDG_STATE_HOME:-$HOME/.local/state}/opencode/paused"
[[ -f "$d/$1" ]] || exit 0
tag=$(<"$d/$1")
case "$tag" in
  lock|warning|question)  printf '#[fg=red,bold]●' ;;     # urgent
  robot|*)                printf '#[fg=yellow,bold]●' ;;  # idle
esac
```

Two-tier color so `permission.asked` / `question.asked` /
`session.error` stand out from idle.

### 5. `tmux/.config/tmux/bin/tmux-status-left` — new

Replaces the inline `status-left` format on `tmux.conf:87` (which is
double-escaped and hard to evolve). Iterates `list-sessions`, injects
the glyph after each session name, preserves the existing
attached-session highlight (background-color block).

### 6. `tmux/.config/tmux/bin/tmux-cycle-paused` — new

```bash
#!/usr/bin/env bash
# Args: $1 = "next" | "prev"
d="${XDG_STATE_HOME:-$HOME/.local/state}/opencode/paused"
mapfile -t paused < <([[ -d "$d" ]] && \
    find "$d" -maxdepth 1 -type f -printf '%f\n' | sort)

if (( ${#paused[@]} == 0 )); then
  tmux display-message "no opencode sessions waiting"
  # Visible bell only — terminal-bell behavior is inconsistent.
  exit 0
fi

# locate current; pick neighbor with wrap-around; switch-client -t
```

Behavior matrix:

| State                         | Action                       |
|------------------------------|------------------------------|
| 0 paused                     | message + no switch          |
| 1 paused, current is it      | no-op (stay)                 |
| 1 paused, current is not it  | switch to it                 |
| 2+ paused, current in list   | wrap-around to neighbor      |
| 2+ paused, current not in    | jump to first in list        |

Sort: alphabetical for v1. Alternative would be by mtime (oldest
paused first → longest-waiting comes up first); revisit if v1 ordering
feels wrong.

### 7. `tmux/.config/tmux/tmux.conf` — modify

```diff
+ # New session in home dir, no prefix
+ bind -n M-n new-session -c "#{HOME}"

+ # Session picker with paused indicator
+ bind -n M-s choose-tree -sZ -F \
+   '#{?session_attached,*, } #{session_name} #(~/.config/tmux/bin/tmux-pause-glyph #{session_name})  (#{session_windows} windows)'

+ # Smart cycle: jump to prev/next paused opencode session
+ bind -n M-S-Up   run-shell "~/.config/tmux/bin/tmux-cycle-paused prev"
+ bind -n M-S-Down run-shell "~/.config/tmux/bin/tmux-cycle-paused next"

  # Status bar: replace inline format with script
- set -g status-left "#(tmux list-sessions -F '##{?##{==:##{session_name},#{session_name}},#[fg=black#,bg=blue#,bold] ##S #[bg=default] ,#[fg=brightblack] ##S }' | tr -d '\n')"
+ set -g status-left "#(~/.config/tmux/bin/tmux-status-left)"
```

### 8. One-time: ~~convert `~/.config/tmux/tmux.conf` to symlink~~ — ALREADY DONE

**Resolved 2026-06-19 (step 3): the premise below was wrong; no action
taken.** `~/.config/tmux` is itself a **directory symlink**:

```
~/.config/tmux -> ../src/dotfiles/tmux/.config/tmux   (main checkout)
```

So `~/.config/tmux/tmux.conf` is **already the same inode** as the
dotfiles file (verified: inode `7315061` for both; `diff` of worktree
vs main checkout is identical). It was never a manually-synced real
file. The functional goal — live config == dotfiles, zero drift — is
already met. Bonus: because it's a *directory* symlink (stow tree-fold),
the new `bin/` scripts appear live automatically once merged.

**Do NOT run the original command** below — it is destructive:

```bash
# ❌ DESTRUCTIVE — do not run.
# Dest resolves *through the parent symlink* back to the dotfiles file
# itself, so `ln -sf` would unlink the real repo file and create a
# self-referential symlink.
ln -sf ~/src/dotfiles/tmux/.config/tmux/tmux.conf ~/.config/tmux/tmux.conf
```

(Form note: `hypr/bindings.conf` and `opencode/plugins/notify.ts` are
*per-file* symlinks under *real* parent dirs; tmux differs in form
(dir symlink) but achieves the same result. Keeping the dir symlink —
it also auto-exposes `bin/`.)

## Edge cases & gotchas

1. **Stale state files after opencode crashes.** Plugin `dismiss`
   doesn't fire if the process is killed. Mitigation: at plugin init,
   the new code unlinks the marker for the **current** `tmuxSession`,
   so a fresh launch in the same tmux session always starts clean.
   Orphan markers from a tmux session that was later renamed/closed
   linger silently. Low impact (only matters if a future tmux session
   takes the same name).

2. **Tmux session renamed mid-flight.** `notify.ts` caches
   `tmuxSession` at load. After `:rename-session`, future events still
   write to the old name's marker. Two paths:
   - Accept and document — rename is rare; restart opencode after
     rename. **v1: do this.**
   - Re-resolve `tmux display-message -p '#S'` on every event — adds a
     subprocess per notify call.
   - Future option: subscribe to tmux's session-renamed hook and
     update the cached name + migrate the marker file.

3. **`choose-tree` `#()` evaluation cost.** The picker invokes
   `tmux-pause-glyph` once per session row when opened. Cost: ~3–5ms
   per call × 5–10 sessions = <50ms total. Acceptable. tmux does not
   cache `#()` results inside `choose-tree` formats by default, so
   each picker open is fresh.

4. **`status-left` refresh cost.** `status-interval=5` (tmux.conf:77),
   `tmux-status-left` runs every 5s. With ~10 sessions and a stat-only
   check per session, total ~10–20ms. Negligible.

5. **`session_attached` indicator.** Existing format uses background
   color on the active session. The new script preserves that
   highlight; the paused glyph is additive (one can be both
   attached AND paused).

6. **opencode running outside tmux.** `tmuxSession` empty → no marker
   written. Indicator never shows for that opencode (correct — it has
   no tmux session to show against).

7. **Plugin reload on opencode auto-update.** Plugin instance
   reinits → init-time stale-file cleanup runs again. Idempotent.

8. **mako auto-dismiss interaction.** Idle (`normal`-urgency) toasts
   disappear from screen after 5s. Marker file persists past that —
   indicator stays on until a non-halting event resumes the session. ✓
   This is the whole reason we don't read mako directly.

9. **Bell choice.** `tmux send-keys '\a'` is unreliable across
   terminals (many filter it). v1: `tmux display-message` only;
   visible status-line message is the feedback.

## Implementation order

Phases are independently shippable. Each leaves the system working.

Each step ends with a **Next →** handoff trigger: a one-sentence,
paste-ready prompt naming the next step (N of 19), its title, the model
it calls for, and this plan's path — so a fresh LLM session can resume
cold. Model routing: **Opus 4.8** for design, real code logic, test
authoring, and risky live-config edits; **Grok Build 0.1** for
mechanical scaffolding, verbatim config-line adds, and
command/reload/test runs.

### Phase A — Alt+n + symlink + scripts skeleton
1. `mkdir -p tmux/.config/tmux/bin` in dotfiles.
   - **Next →** step 2 of 19, *add the three no-op stub scripts and `chmod +x`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
2. Add placeholder `tmux-pause-glyph`, `tmux-status-left`,
   `tmux-cycle-paused` (no-op stubs that return empty / "not yet
   implemented"). Make executable.
   - **Next →** step 3 of 19, *convert `~/.config/tmux/tmux.conf` to a symlink (diff-verify byte parity first)*, with **Opus 4.8** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
3. ~~Convert `~/.config/tmux/tmux.conf` to symlink.~~ **DONE (no-op):**
   already a symlink via the `~/.config/tmux` directory symlink → main
   checkout (same inode, byte parity verified). See §8 — the literal
   `ln -sf` would have been destructive and was not run.
   - **Next →** step 4 of 19, *add the `bind -n M-n new-session -c "#{HOME}"` line to `tmux.conf`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
4. Add `bind -n M-n new-session -c "#{HOME}"` to
   `tmux.conf`.
   - **Next →** step 5 of 19, *reload tmux (`prefix + q`) and test Alt+n*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
5. Reload tmux (`prefix + q`). Test Alt+n.
   - **Next →** step 6 of 19, *add the pure `tmuxSlug` helper to `notify/lib.ts`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.

### Phase B — Plugin state-file write/unlink
6. Add `tmuxSlug` helper to `notify/lib.ts`.
   - **Next →** step 7 of 19, *add init-time stale-marker cleanup + marker write/unlink to `notify.ts` (preserve the never-crash invariant)*, with **Opus 4.8** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
7. Add init-time cleanup + write/unlink to `notify.ts`.
   - **Next →** step 8 of 19, *add `tmuxSlug` + dispatch-regression tests in `notify/notify.test.ts`*, with **Opus 4.8** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
8. Add tests for `tmuxSlug` in `notify/notify.test.ts`.
   - **Next →** step 9 of 19, *run `bun test ./opencode/.config/opencode/plugins/`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
9. Run `bun test ./opencode/.config/opencode/plugins/`.
   - **Next →** step 10 of 19, *run `opencode-plugin-smoke --live` to confirm the plugin still loads*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
10. Run `opencode-plugin-smoke --live` (per repo `README.md`) to
    verify the plugin still loads in a real opencode runtime.
    - **Next →** step 11 of 19, *restart active opencode TUIs to load the new plugin*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
11. Restart any active opencode TUIs to pick up the new plugin.
    - **Next →** step 12 of 19, *implement `tmux-pause-glyph` and `tmux-status-left` for real*, with **Opus 4.8** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.

### Phase C — Indicator wiring
12. Implement `tmux-pause-glyph` and `tmux-status-left` for real.
    - **Next →** step 13 of 19, *rewire `status-left` in `tmux.conf` to call `tmux-status-left`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
13. Update `status-left` in `tmux.conf` to call the script.
    - **Next →** step 14 of 19, *reload tmux and visually verify `status-left` with no paused sessions*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
14. Reload tmux. Visually verify status-left still renders correctly
    when no sessions are paused.
    - **Next →** step 15 of 19, *force a `session.idle` and confirm the glyph appears, then clears on follow-up*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
15. Force a `session.idle` (let an opencode finish responding) →
    expect yellow glyph in status-left. Type a follow-up → expect
    glyph disappears.
    - **Next →** step 16 of 19, *add the `bind -n M-s choose-tree -sZ -F ...` picker line to `tmux.conf`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.

### Phase D — Picker + smart cycle
16. Add `bind -n M-s choose-tree -sZ -F ...` to `tmux.conf`.
    - **Next →** step 17 of 19, *implement `tmux-cycle-paused` for real (neighbor selection + wrap-around per the behavior matrix)*, with **Opus 4.8** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
17. Implement `tmux-cycle-paused` for real.
    - **Next →** step 18 of 19, *add the `bind -n M-S-Up` / `bind -n M-S-Down` smart-cycle bindings to `tmux.conf`*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
18. Add `bind -n M-S-Up` / `bind -n M-S-Down` to `tmux.conf`.
    - **Next →** step 19 of 19, *test smart cycle with 0, 1, and 2+ paused sessions*, with **Grok Build 0.1** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.
19. Test with 0, 1, 2+ paused sessions.
    - **Done →** no step 20 — implementation complete; tick the Progress boxes and archive the plan per AGENTS.md, with **Opus 4.8** — plan: `docs/plans/tmux-opencode-pause-indicator/PLAN.md`.

## Testing strategy

- **Plugin unit tests**:
  `bun test ./opencode/.config/opencode/plugins/notify/notify.test.ts`
  — covers `tmuxSlug` and dispatch regression.
- **Plugin smoke**: `opencode-plugin-smoke --live` (defined in repo
  README) — verifies the plugin loads in a real opencode runtime
  without crashing.
- **Manual tmux**:
  - Open opencode in a fresh tmux session.
  - Send a prompt; wait for response. Observe glyph appears in
    status-left and in `Alt+s` picker.
  - Type a follow-up. Observe glyph disappears.
  - Trigger a permission prompt. Observe **red** glyph (vs yellow).
  - With ≥2 paused sessions, test `Alt+Shift+Up` / `Alt+Shift+Down`
    cycling.
  - With 0 paused sessions, test 0-paused message behavior.

## Open questions to resolve at start of build

1. **Script location**: `~/.config/tmux/bin/` (dotfiles-tracked,
   tmux-scoped) vs `~/.local/bin/` (PATH, follows existing
   `toggl-tmux-status` convention from a different repo)?
   - Lean: `~/.config/tmux/bin/`. Tmux-specific helpers belong with
     the tmux package; tmux.conf already references full paths to
     `~/.config/opencode/bin/opencode-cost-tmux-status`, so adding
     `~/.config/tmux/bin/...` is consistent.
2. **Convert `~/.config/tmux/tmux.conf` to symlink as part of this
   work?** RESOLVED (step 3): no conversion needed — `~/.config/tmux`
   is already a directory symlink to the dotfiles main checkout, so
   `tmux.conf` is already the same inode. See §8.
3. **Smart-cycle sort order**: alphabetical (matches `M-Up`/`M-Down`
   intuition) vs mtime (oldest-paused first → longest-waiting comes
   up first)? Lean: alphabetical for v1.
4. **Whether to also extend mako config** to make opencode toasts
   never expire (so the on-screen popup matches the marker-file
   state). Out of scope for v1 — different concern (notification UX
   vs paused-state tracking).

## Progress

- [x] Phase A — Alt+n + scripts skeleton + tmux.conf symlink
- [ ] Phase B — notify.ts state-file write/unlink + tests
- [ ] Phase C — pause-glyph + status-left script + status-left rewire
- [ ] Phase D — Alt+s picker + smart cycle bindings + cycle script

## References

- `~/.config/tmux/tmux.conf` (lines 49-55 session controls,
  line 87 status-left)
- `~/.config/opencode/plugins/notify.ts` (lines 115-126 tmuxSession
  resolution, lines 138-172 event dispatch)
- `~/.config/opencode/plugins/notify/lib.ts` (lines 70-146
  `dispatchEvent`)
- `~/.local/share/omarchy/default/mako/core.ini` (default-timeout
  rules)
- https://opencode.ai/docs/keybinds (collision check for `alt+n`,
  `alt+s`)
