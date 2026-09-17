# Copilot loop exit signals (MASTER-2049)

**Asana:** MASTER-2049 (GID `1218544511796219`) — Update Copilot PR review driver to recognize new GitHub success messages
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218544511796219
**Project:** MASTER / IN PROGRESS

## TL;DR

Copilot's clean-review body changed. The live loop still exits only on the
legacy phrase `generated no new comments`. New reviews emit
`Comments generated: 0 new` (plus supporting lines that are **not**
standalone exits). Teach AGENTS.md, `/bam-copilot-loop`, and
`/bam-deploy-dev` both signals, and pin them in `commands.test.ts`.

**Done** = those four live surfaces treat `Comments generated: 0 new` **or**
the legacy phrase as clean. Archived and in-flight plan prose stay as
written.

## Goal & scope

### In

- `opencode/.config/opencode/AGENTS.md` (GitHub Copilot review re-trigger
  → Loop exit signal)
- `opencode/.config/opencode/commands/bam-copilot-loop.md` (description,
  intro, §6)
- `opencode/.config/opencode/commands/bam-deploy-dev.md` (§4 handoff, §5
  Copilot-clean line)
- `opencode/.config/opencode/commands-validate/commands.test.ts` (new
  MASTER-2049 pins; existing `no new comments` pin stays)

### Out

- Archived `docs/archive/**` and in-flight `docs/plans/**` prose
- `validate.ts`, `install.sh` (`commands/` and `AGENTS.md` already linked)
- A compiled poller / parser (this is LLM command text)
- Treating `Approval recommended` or `No unresolved blocking issues were
  identified` as sufficient exits
- Changing re-trigger mechanics (`@copilot`, GraphQL `botIds`, REST
  validation)

## Decisions (locked — MASTER-2049 review 2026-09-16)

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Files | All four live surfaces. No archived or in-flight plans. |
| 2 | Clean signal | Exit on legacy `generated no new comments` **or** new `Comments generated: 0 new`. Substring match: `Comments generated: 0 new, 2 resolved` still counts. |
| 3 | Supporting phrases | `Approval recommended` and `No unresolved blocking issues were identified` are supporting text only, not standalone exits. |
| 4 | Legacy | Keep the old phrase as an equal clean signal. Existing `no new comments` test must stay green. |

## Design

```
opencode/.config/opencode/
├── AGENTS.md                              # Loop exit signal paragraph
├── commands/bam-copilot-loop.md           # intro + §6
├── commands/bam-deploy-dev.md             # §4 + §5
└── commands-validate/commands.test.ts     # new MASTER-2049 describe
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

### Exit rule (author into the three prose files)

Clean when the Copilot review **body** contains **either**:

1. Legacy: `generated no new comments` (full signal still: `Copilot
   reviewed N out of N changed files in this pull request and generated
   no new comments`)
2. New: `Comments generated: 0 new`

Do **not** exit solely on `Approval recommended` or `No unresolved
blocking issues were identified` (those can sit next to nits).

### Test seam

New `describe("copilot loop exit signals (MASTER-2049)")` in
`commands.test.ts`. Load files inside each test. Pin the newly-absent
token `comments generated: 0 new` (lowercase). Keep the existing
`bam-copilot-loop command` test that pins `no new comments`.

**Newly-absent today (force a clean RED):**

| File | Pin | Why red today |
| --- | --- | --- |
| `bam-copilot-loop.md` | body has `comments generated: 0 new`; still has `no new comments` | Only the legacy phrase |
| `bam-deploy-dev.md` | body has `comments generated: 0 new` | Only the legacy phrase |
| `AGENTS.md` | Copilot section has `comments generated: 0 new`; still has `generated no new comments` | Only the legacy paragraph |

Token trap: do **not** pin bare `0 new` or `no new comments` as the new
signal. Pin the full `comments generated: 0 new`. `no new comments` already
exists and must remain.

AGENTS.md path from `commands-validate/`: `join(import.meta.dir, "..", "AGENTS.md")`.
Slice the Copilot section with `/## GitHub Copilot review re-trigger([\s\S]*?)(?=\n## |$)/`
so the pin does not false-hit other docs.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 8.**

### Phase A — Loop command

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | Add `describe("copilot loop exit signals (MASTER-2049)")` in `commands.test.ts`. First test: `bam-copilot-loop.md` body (frontmatter stripped, lowercased) contains `comments generated: 0 new` and still contains `no new comments`. Fails today. Do not edit the command. Existing `bam-copilot-loop command` test stays. | cheap |
| 2 | GREEN | Update `bam-copilot-loop.md` description, intro, and §6 to the Design exit rule (either signal; supporting phrases not standalone). Keep `@copilot` / GraphQL / `botIds`. Test 1 passes. Existing `no new comments` pin stays green. | premium |

### Phase B — Deploy command + AGENTS.md

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 3 | RED | Same describe. Test: `bam-deploy-dev.md` body contains `comments generated: 0 new`. Fails today. Do not edit the command. Existing deploy token test stays. | cheap |
| 4 | GREEN | Update `bam-deploy-dev.md` §4 handoff and §5 Copilot-clean line to the Design exit rule. Test 3 passes. | premium |
| 5 | RED | Same describe. Test: AGENTS.md Copilot section contains `comments generated: 0 new` and still contains `generated no new comments`. Fails today. Do not edit AGENTS.md. | cheap |
| 6 | GREEN | Rewrite the AGENTS.md Loop exit signal paragraph to the Design exit rule. Test 5 passes. `grok-tiers` / `no-ai-tells` AGENTS pins stay green. | premium |

### Phase C — Verify & deploy

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 7 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode (commands / AGENTS.md are not hot-reloaded). Smoke: `/bam-copilot-loop` description and body name both signals. | premium |
| 8 | DEPLOY (human-gated) | Per `@rules/workflow.md` + `/bam-deploy-dev`: one squashed Conventional-Commits commit, push, PR → base **`m`**, `/bam-copilot-loop` until clean (legacy phrase **or** `Comments generated: 0 new`). No `.github/workflows/` here; local suite is the merge gate. Merge on explicit confirm. Fast-forward main checkout, restart opencode, live re-smoke. Archive this plan → `docs/archive/opencode/PLAN-copilot-loop-exit.md`. | premium |

Adjacent trivial RED→GREEN pairs may run back-to-back only if the human
asks; default is one step per fresh session. Each step keeps its own
commit.

## Testing strategy

- Content suite is the TDD seam. Sibling command blocks and
  `rules-validate/` stay green.
- No validator or installer change.
- Interactive loop behavior is smoke-only at step 7 / 8.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Token leak makes a later RED pass | Each GREEN edits only the file that step names. Do not draft ahead. |
| Dropping the legacy phrase | Existing `no new comments` pin + step 1/5 "still contains" assertions. |
| LLM exits on Approval recommended | GREEN 2/4/6 must say those phrases are not standalone. |
| Pinning bare `0 new` | Use the full `comments generated: 0 new`. |
| Restart required | Commands and AGENTS.md load at startup. Step 7/8 smokes need quit + restart (or `OPENCODE_CONFIG_DIR` pointed at this worktree). |
| This plan's own Copilot loop | Step 8 must accept the new signal; do not wait forever for the legacy phrase. |

## Progress

- [x] Step 1 — RED: pin bam-copilot-loop Comments generated: 0 new
- [x] Step 2 — GREEN: bam-copilot-loop either-signal exit
- [x] Step 3 — RED: pin bam-deploy-dev Comments generated: 0 new
- [x] Step 4 — GREEN: bam-deploy-dev either-signal exit
- [x] Step 5 — RED: pin AGENTS.md Copilot Comments generated: 0 new
- [x] Step 6 — GREEN: AGENTS.md Loop exit signal
- [x] Step 7 — VERIFY: suite + restart + smoke (suite 62/62. CLI smoke with `OPENCODE_CONFIG` + `OPENCODE_CONFIG_DIR` pointed at this worktree (fresh process, same as a restart): resolved `/bam-copilot-loop` description and body name both `generated no new comments` and `Comments generated: 0 new`. Remaining gate: live `~/.config/opencode` still points at the main checkout, so a post-merge TUI re-smoke (ff main, restart) folds into Step 8.)
- [x] Step 8 — DEPLOY (human-gated): squash, PR → m, copilot-loop (merge/ff/restart/archive gated)

## Session exit (MANDATORY)

A step is not done until that step's `## Progress` line is `- [x]`
**on disk**. `bamboo plans run` re-reads PLAN.md after exit 0; a
remaining `- [ ]` prints `unchecked` and does not advance.

Exact order (no shortcuts):

1. Finish the step's work (the test or move the step names; run the
   listed verification).
2. Edit this PLAN.md: change that step's `- [ ]` to `- [x]`.
3. **Check the progress (do not skip):** before you output *anything*
   that looks like a trigger, **use the Read tool** on this PLAN.md.
   Read `## Progress`. Explicitly confirm in your reasoning that the
   line for the step you just finished now contains `[x]`. If it does
   not, go back to step 2.
4. Only after that Read shows the tick: commit (work + this plan file)
   on the plan's cadence, then print the **next** step's trigger
   sentence **verbatim** as the very last output. Nothing after the
   trigger.

Hard rule: do not print a `▶️ Step ...` trigger while this step's
Progress line is still `[ ]` on disk.

## References

- Card: MASTER-2049 + 2026-09-16 review Q&A
- Origin: H-188 Copilot drive (new GitHub success copy)
- Files: `commands/bam-copilot-loop.md:89`, `commands/bam-deploy-dev.md:37`,
  `AGENTS.md:260`, `commands-validate/commands.test.ts:181`
- Conventions: `@rules/plans.md`, `@rules/workflow.md`
- Test command: `bun test ./opencode/.config/opencode/commands-validate/`

---

After each step completes, post the next trigger verbatim.

- After 1 → ▶️ Step 2 of 8 — GREEN: bam-copilot-loop either-signal exit — model: premium — plan: `docs/plans/copilot-loop-exit/PLAN.md`
- After 2 → ▶️ Step 3 of 8 — RED: pin bam-deploy-dev Comments generated: 0 new — model: cheap — plan: `docs/plans/copilot-loop-exit/PLAN.md`
- After 3 → ▶️ Step 4 of 8 — GREEN: bam-deploy-dev either-signal exit — model: premium — plan: `docs/plans/copilot-loop-exit/PLAN.md`
- After 4 → ▶️ Step 5 of 8 — RED: pin AGENTS.md Copilot Comments generated: 0 new — model: cheap — plan: `docs/plans/copilot-loop-exit/PLAN.md`
- After 5 → ▶️ Step 6 of 8 — GREEN: AGENTS.md Loop exit signal — model: premium — plan: `docs/plans/copilot-loop-exit/PLAN.md`
- After 6 → ▶️ Step 7 of 8 — VERIFY: suite + restart + smoke — model: premium — plan: `docs/plans/copilot-loop-exit/PLAN.md`
- After 7 → ▶️ Step 8 of 8 — DEPLOY (human-gated): squash, PR → m, copilot-loop, merge, archive — model: premium — plan: `docs/plans/copilot-loop-exit/PLAN.md`

Kickoff trigger (use only to start this plan from step 1):

▶️ Step 1 of 8 — RED: pin bam-copilot-loop Comments generated: 0 new — model: cheap — plan: `docs/plans/copilot-loop-exit/PLAN.md`
