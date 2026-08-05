# opencode waiting-for-input alerts — sticky halt + orphan prune

**Asana:** MASTER-1976 (GID `1217192468165875`) — Project MASTER → IN PROGRESS  
**Branch / worktree:** `MASTER-1976`

## TL;DR

tmux status glyphs, mako/ntfy alerts, and `tmux-cycle-paused` often miss
opencode sessions blocked on human input (especially the Question tool). Root
cause candidate: `notify/lib.ts` `dispatchEvent` **dismisses on any
non-halt event with a `sessionID`**, so mid-wait bus traffic (e.g.
`message.part.updated`) can clear the marker and toast immediately after
`question.asked` / `permission.asked` arms them.

**Fix:** sticky halt — arm on the four halt events; clear only on an explicit
**resume allowlist**. Plus lightweight prune of ~226 orphan marker files.

## Goal & scope

**In scope**

- `opencode/.config/opencode/plugins/notify/lib.ts` — `dispatchEvent` sticky
  resume semantics (pure; unit-tested).
- `opencode/.config/opencode/plugins/notify/notify.test.ts` — replace the
  “any sessionID event → dismiss” contract with resume-allowlist + sticky-noop
  cases covering all four halt states.
- `opencode/.config/opencode/plugins/notify.ts` — docstring / comments only if
  the entrypoint behavior is fully driven by `dispatchEvent` (no logic fork
  unless a step discovers otherwise).
- Orphan marker hygiene under `$XDG_STATE_HOME/opencode/paused/` — prune
  markers whose slug is not a live tmux session (bash side; cycle/status
  already ignore orphans for switching, but the dir is polluted).
- Short **temp** event trace during investigation only; **drop before ship**
  (review Q5).
- Manual dogfood: Question + permission waits show glyph + alert + cycle hit.

**Out of scope**

- Changing mako/ntfy urgency, ntfy topics, or glyph colors.
- FIFO cycle ordering (MASTER-1858 / `tmux-cycle-paused-fifo` — already shipped).
- Upstream opencode event emission (if `question.asked` is missing entirely,
  file upstream; this card still hardens dismiss so when it *does* fire it sticks).
- Permanent debug logging / new observability plugin.

## Decisions (locked — MASTER-1976 review)

| # | Decision | Source |
| --- | --- | --- |
| Q1 | Start from existing session/log evidence; add a **short temp trace** only if still needed to confirm arm→dismiss order. Logs alone lack plugin bus events. | review |
| Q2 | Fix **all four** halt states: `session.idle`, `session.error`, `permission.asked`, `question.asked`. Question is the primary repro. | review |
| Q3 | **Sticky halt until explicit resume** — not “dismiss allowlist of noisy events while keeping dismiss-default”. | review |
| Q4 | **Orphan prune in scope** — lightweight hygiene, not a blocker for the sticky fix. | review |
| Q5 | Diagnostic logging is **temporary**; remove before ship (no env-flagged keep). | review |

## Design

### Evidence (review pass, 2026-08-05)

- Live path: `notify.ts` arms/unlinks
  `~/.local/state/opencode/paused/<tmuxSlug(session)>` from `dispatchEvent`
  actions; `tmux-status-left` / `tmux-pause-glyph` / `tmux-cycle-paused` consume
  markers.
- Today’s markers included both `question` and `robot` tags → halt path
  **sometimes** works.
- `opencode.db` `event` table does **not** store plugin bus events
  (`question.asked`, `session.idle`, …) — only `message.*` / `session.created|updated`.
- During quiet Question waits, DB often has **0–1** mid-wait rows; the 0–1 is
  often a `message.part.updated` **text** part right after `question`→`running`.
  Under current `dispatchEvent`, that sessionID-bearing event → **dismiss**.
- ~226 orphan markers; live cycle intersects live sessions only (orphans do
  not break switch, but confuse ops and disk).

### Sticky `dispatchEvent` mapping

Keep halt arms unchanged. Replace the default “any sessionID → dismiss” with:

| Event | Action |
| --- | --- |
| `session.idle` / `session.error` / `permission.asked` / `question.asked` | `notify` (unchanged tags/urgency) |
| `session.status` | `noop` (unchanged — still races idle) |
| **Resume allowlist** → `dismiss` | `question.replied`, `question.rejected`, `permission.replied`, `message.updated` |
| Everything else (incl. `message.part.updated`, tool/stream/TUI noise) | `noop` |

**Why `message.updated` is a resume signal:** user submit and assistant
turn boundaries show up here; DB samples show **no** `message.updated` between
question `running` and `completed` on quiet waits, so it should not clear a
live Question wait. **Why not `message.part.updated`:** it *does* fire mid-wait
(text part) and would reintroduce the flake.

If dogfood finds a wait that stays marked after the human has clearly resumed
(or clears while still blocked), adjust the resume allowlist in a follow-up RED
— do not reopen “dismiss everything”.

### Entrypoint

`notify.ts` already: `notify` → toast + write marker; `dismiss` →
`tracker.dismissAll` + unlink marker; `noop` → return. Sticky semantics in
`dispatchEvent` alone should be sufficient. No parallel state machine unless a
step proves otherwise.

### Orphan prune

Add a tiny bash helper used by the status path (runs every `status-interval`)
and/or cycle:

1. List live tmux session names → slug set (same `${name//[^A-Za-z0-9_-]/_}`
   transform as `tmux-pause-glyph`).
2. For each file in `$XDG_STATE_HOME/opencode/paused/`, if basename ∉ live set,
   `rm -f`.
3. Best-effort; never fail the status bar.

Prefer one shared snippet or sibling bin (e.g. `tmux-prune-paused-orphans`)
sourced/called from `tmux-status-left` so cycle stays focused. One-shot manual
prune during dogfood is fine as a kickoff hygiene, not a substitute for the
ongoing prune.

### Temp trace (investigation only)

If still needed after step 1’s test RED proves the contract: a few lines in
`notify.ts` appending `ISO type → kind` to a temp file, exercised once against
a live Question prompt, then **deleted in the same PR as GREEN** (Q5). Do not
merge with the trace left in.

## TDD implementation order (M = 9)

Each step is one test **or** one implementation move — never both. Commit per
step (Conventional Commits; body cites MASTER-1976). Phases ship independently.

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| **A — pin sticky contract** | | | |
| 1 | RED | In `notify.test.ts`, **replace** `unknown event with sessionID → dismiss` with failing expectations: (a) resume allowlist → `dismiss`; (b) sticky-noop set (`message.part.updated`, `tool.execute.before`, `tool.execute.after`, `todo.updated`, `tui.prompt.append`, `session.updated`, …) with sessionID → `noop`; (c) halt arms still `notify`. Run `bun test ./opencode/.config/opencode/plugins/notify/` — suite red on the old default. Commit `test(notify): pin sticky-halt dismiss allowlist`. | Grok Build 0.1 |
| 2 | GREEN | Implement sticky mapping in `dispatchEvent` (`lib.ts` only). Suite green. Commit `fix(notify): sticky halt until explicit resume events`. | Grok Build 0.1 |
| 3 | REFACTOR | Update `lib.ts` + `notify.ts` header comments to describe sticky halt (drop “any non-halting event dismisses”). No behavior change; suite still green. Commit `docs(notify): document sticky-halt resume allowlist`. | Grok Build 0.1 |
| **B — orphan prune** | | | |
| 4 | RED | Add a small testable prune script or pure bash function (prefer
  `tmux/.config/tmux/bin/tmux-prune-paused-orphans`) plus a hermetic check:
  temp marker dir with `live_a` + `orphan_x`; mock live list → only `orphan_x`
  removed. Record RED (script missing / no-op). Commit
  `test(tmux): pin orphan paused-marker prune`. | GLM 5.2 |
| 5 | GREEN | Implement prune; wire into `tmux-status-left` (best-effort call).
  Re-run hermetic check green. Commit
  `fix(tmux): prune orphan opencode paused markers`. | GLM 5.2 |
| **C — dogfood & ship** | | | |
| 6 | INTEGRATION | Deploy notify to the live config path the running opencode
  loads (`~/.config/opencode` → main `dotfiles` symlink today — merge/copy
  worktree changes as this repo’s normal flow requires). Restart or rely on
  next opencode launch. **Optional temp trace only if dogfood fails.** | Opus 4.8 |
| 7 | INTEGRATION | Manual acceptance (all must pass): (1) Question tool wait →
  red `question` glyph + critical toast + `tmux-cycle-paused` finds session;
  (2) permission prompt wait → red `lock` glyph + toast + cycle; (3) plain
  end-of-turn idle → yellow `robot` glyph; (4) answering / new prompt clears
  marker; (5) orphan count drops after status refresh. If sticky clears too
  early or too late, add a RED test for the missing event and loop to step 2. | Opus 4.8 |
| 8 | REFACTOR | Delete any temp trace; confirm suite green and no debug files. Commit only if there is something to remove. | Grok Build 0.1 |
| 9 | INTEGRATION | Asana MASTER-1976 → REVIEW; plain-text comment with SHAs + acceptance notes; tick Progress. PR only if asked. | GLM 5.2 |

## Testing strategy

- **Automated:** `bun test ./opencode/.config/opencode/plugins/notify/` from
  repo root (existing harness; see `notify.test.ts` header).
- **Bash prune:** hermetic temp dir + fake live-session list (no need for a
  full `tmux -L` server unless convenient).
- **Acceptance:** live multi-session tmux dogfood (step 7) — this is the flake
  the card was filed for; unit tests cannot see mako/tmux.

## Risks & gotchas

- **Live config symlink** points at `~/src/dotfiles/opencode/...`, not this
  worktree. GREEN in-tree does nothing for dogfood until merged/copied to the
  path opencode loads. Step 6 owns that.
- **`message.updated` as resume** is evidence-based but not formally
  guaranteed by upstream. Dogfood step 7 is the gate; extend allowlist via RED
  if needed.
- **Auto-allowed permissions** never fire `permission.asked` — out of scope;
  only interactive permission waits count.
- **Plugin load clears own marker** (`unlink` at startup) — correct; don’t
  “fix” that away.
- **status-left prune every 5s** must stay cheap and silent on errors.
- **Do not** reintroduce dismiss-on-`message.part.updated`.

## Progress

- [x] 1 — RED: sticky-halt test contract
- [x] 2 — GREEN: `dispatchEvent` sticky mapping
- [x] 3 — REFACTOR: notify docs/comments
- [x] 4 — RED: orphan prune hermetic check
- [x] 5 — GREEN: prune bin + status-left wire
- [x] 6 — INTEGRATION: deploy to live opencode config path
- [x] 7 — INTEGRATION: manual acceptance (Question / permission / idle / clear / orphans)
- [ ] 8 — REFACTOR: strip temp trace if any
- [ ] 9 — INTEGRATION: Asana → REVIEW + bookkeeping

## References

- Asana MASTER-1976 —
  https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217192468165875
- `opencode/.config/opencode/plugins/notify.ts` — entrypoint (marker + toast)
- `opencode/.config/opencode/plugins/notify/lib.ts` — `dispatchEvent`
- `opencode/.config/opencode/plugins/notify/notify.test.ts` — suite
- `tmux/.config/tmux/bin/tmux-{status-left,pause-glyph,cycle-paused}`
- `docs/archive/opencode/PLAN-tmux-pause-indicator.md` — original marker design
- `docs/archive/opencode/PLAN-dismiss.md` — prior dismiss semantics
- Review note: `opencode.db` lacks plugin bus events; markers + bun tests are
  the reliable signals

## Triggers

Post the **next** step’s trigger verbatim when a step completes.

- After 1 → ▶️ Step `2` of `9` — `GREEN: dispatchEvent sticky halt` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 2 → ▶️ Step `3` of `9` — `REFACTOR: document sticky-halt` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 3 → ▶️ Step `4` of `9` — `RED: pin orphan paused-marker prune` — model: `GLM 5.2` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 4 → ▶️ Step `5` of `9` — `GREEN: prune orphan markers` — model: `GLM 5.2` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 5 → ▶️ Step `6` of `9` — `INTEGRATION: deploy to live opencode config` — model: `Opus 4.8` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 6 → ▶️ Step `7` of `9` — `INTEGRATION: manual acceptance dogfood` — model: `Opus 4.8` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 7 → ▶️ Step `8` of `9` — `REFACTOR: strip temp trace if any` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
- After 8 → ▶️ Step `9` of `9` — `INTEGRATION: Asana → REVIEW + bookkeeping` — model: `GLM 5.2` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`

### Kickoff

▶️ Step `1` of `9` — `RED: pin sticky-halt dismiss allowlist` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-waiting-alerts/PLAN.md`
