# `/bam-specs-gaps`: leftover cancelled pins (MASTER-2041)

**Asana:** MASTER-2041 (GID `1218398413494347`)
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218398413494347
**Plan path:** `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
**Worktree:** `~/src/dotfiles/MASTER-2041`

## TL;DR

A `[CANCELLED]` / `[REPLACED_BY: ...]` ID is not a silent skip when a test still names that dead ID. Those leftover mentions are tagged **cleanup** rows on the **same** §4 gap list and the **same** §5 handoff: remove leftover coverage and orphaned production code, preserving or splitting assertions that still pin a live successor or another live rule. Do not add new tests of cancelled/replaced-old text. Living successors stay new-tests-plus-code. This command **lists** only; `/bam-tdd-plan` specifies the deletes, and running that plan executes them. Mentions stay the only repo-file write; per-gap Asana card creation remains allowed.

**Done** = `bam-specs-gaps.md` §3/§4/§5/§6/intro + content tests. No validator/installer. No ImportTests / HH-86–HH-90 work.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-gaps.md` (keep `agent: build`; no `model:` pin)
- `describe("bam-specs-gaps command")` in `opencode/.config/opencode/commands-validate/commands.test.ts`

### Out

- Overwriting `docs/plans/bam-specs-gaps/PLAN.md` (MASTER-2029)
- Deleting leftover tests or production code from this command
- New tests of cancelled/replaced-old text
- ImportTests / HH-86–HH-90 (later hh gaps run)
- `validate.ts` / `install.sh`; edits to init/amend/review-task/tdd-plan
- Unlabeled leftover **behavior** (no dead-ID token) as a pin

## Decisions (locked)

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Leftover pin | Dead-ID mention only (name, fact title, comment, assert message). Not unlabeled leftover behavior. |
| 2 | List / handoff | Same gap list, tagged cleanup. Same §5 (handoff / list-only / per-gap). |
| 3 | Who deletes | List only. tdd-plan specifies deletes; running that plan executes them. Mentions stay the only write this command makes. |
| 4 | No leftover mention | Omit (silent skip). |
| 5 | Production code | On a cleanup row only if orphaned (no remaining callers or consumers: live successor, other live rule, or unrelated path). |
| 6 | Card scope | Command only (`bam-specs-gaps.md` + `commands.test.ts`). |

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-gaps.md          # edit §3, §4, §5, §6, intro/description
└── commands-validate/commands.test.ts  # add leftover-cleanup tests; keep live skip
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

Keep `scans live IDs only; skips [CANCELLED] / [REPLACED_BY] (§3)` green. Live coverage still skips those IDs. Add a **second** pass over the same dead IDs for leftover mentions.

### Target §3 / §4 / §5 / §6 shape

```
## 3. … diff each live rule
      - Live scan unchanged: skip [CANCELLED] / [REPLACED_BY: ...] for coverage.
      - Leftover pin: exact mention of that dead ID in a test (name, fact
        title, comment, assert message). Unlabeled leftover behavior is not
        a leftover pin.
      - Dead ID with leftover mention → cleanup candidate.
      - Dead ID with no leftover mention → omit.

## 4. List the gaps
      - Live true-miss rows unchanged.
      - Plus tagged cleanup rows on the same list (ID, gist, why leftover
        mention, every matching file:line, locations searched).
      - Unlabeled-but-pinning still never appears.
      - Then stop for §5.

## 5. Filing mode
      - Same three modes. Mixed list in one handoff.
      - Live-miss rows: missing tests plus the code that makes them pass.
      - Cleanup rows: remove leftover coverage and orphaned production
        code. Preserve or split assertions that still pin a live successor
        or another live rule. Do not add new tests of cancelled/replaced-old
        text.
      - Living successors stay the new-tests-plus-code path.
      - Per-gap cards: one card per row; cleanup cards are remove, not add.

## 6. Relations + stop
      - Mentions stay the only repo-file write. Per-gap Asana remains allowed.
      - This command does not delete tests or production code.
      - tdd-plan specifies the deletes; running that plan executes them.
```

### Test seam

Same as MASTER-2040: `readBamSpecsGaps()`, `slice3`/`slice4`/`slice5`/`slice5b`/`slice5c`/`slice6`. One focused test per behavior. Keep existing §1/§2/§3a/live-mention/live-skip/unlabeled-but-pinning/§5/§6 pins.

**Keep** the live skip test and `/do not implement/` in §6.

Tokens **absent today** in `bam-specs-gaps.md` (use these for RED): `leftover`, `cleanup`, `omit`, `orphaned`, `successor`, `deletes`.

Tokens **present** (do not use as the sole new pin): `cancelled`, `replaced_by`, `skip`, `mention`, `gap list`, `do not implement`, `existing tests`, `silently`, `list-only`, `handoff`, `code`.

Do not pin `/silent/`: it matches §5a `silently`.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 13.**

Token discipline: each GREEN must not introduce a later test's tokens.

### Phase A — leftover mention is a tagged cleanup row (or omit)

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | New test: leftover pin = exact dead-ID mention only, not unlabeled leftover behavior. Scope to `## 3`. Token: `/leftover/`. Keep the live skip test. Fails: `leftover` is absent. | cheap |
| 2 | GREEN | Add leftover-pin definition to §3 (second pass over skipped IDs). Keep live skip sentence. Forbidden: `cleanup`, `omit`, `orphaned`, `successor`, `deletes`. | premium |
| 3 | RED | New test: leftover mentions go on the same gap list, tagged cleanup. Scope `/cleanup/` to `## 4`. | cheap |
| 4 | GREEN | §4: live true-miss rows plus tagged cleanup rows (ID, gist, why leftover mention, `file:line`). Forbidden: `omit`, `orphaned`, `successor`, `deletes`. | premium |
| 5 | RED | New test: dead ID with no leftover mention is omitted (not a gap row). Token: `/omit/`. Scope to §3 or §4. Do not pin `/silent/`. | cheap |
| 6 | GREEN | Omit dead IDs with no leftover mention. Forbidden: `orphaned`, `successor`, `deletes`. | premium |

### Phase B — same §5; cleanup is remove, live is add

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 7 | RED | New test scoped to `## 5`: cleanup rows in the handoff mean remove leftover tests and orphaned production code; do not add new tests of cancelled/replaced-old text; living successors stay new-tests-plus-code. Tokens: `/orphaned/`, `/successor/`. Keep existing `/code/` and `/bam-tdd-plan/` pins. | cheap |
| 8 | GREEN | Mixed-list §5b/§5c. Cleanup = remove tests + orphaned code. Live miss = new tests + code. Per-gap cleanup cards are remove, not add. Forbidden: `deletes`. Do not rewrite intro/§6 yet. | premium |

### Phase C — list only; tdd-plan deletes; then ship

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 9 | RED | Extend the §6 test: this command lists only; tdd-plan does the deletes; mentions stay the only write. Scope `/deletes/` to `## 6`. Keep `/do not implement/` and `/existing tests/`. | cheap |
| 10 | GREEN | Rewrite intro, frontmatter `description:`, and §6. Stay `agent: build`. | premium |
| 11 | REFACTOR | Coherence pass on intro + §3–§6 and the new tests. Suite stays green. No behavior change. | premium |
| 12 | VERIFY | `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode. Smoke `/bam-specs-gaps` on a throwaway path: cancelled ID still mentioned → cleanup row; cancelled ID with no mention → omit; live miss unchanged. **Stop before mention writes, deletes, or Asana.** Do not use HH ImportTests. | premium |
| 13 | DEPLOY (human-gated) | Squash to one Conventional-Commits commit, push, PR with base `m`, `/bam-copilot-loop` until no new comments. Merge on explicit confirm. | premium |

## Testing strategy

- Content suite is the TDD seam. Sibling command blocks stay green.
- Do not weaken the live skip test. Leftover scan is additional.
- Do not add a body-wide `/silent/` pin.
- Interactive bits are smoke-only at step 12. Never delete real tests or file Asana during smoke.
- Token discipline is the red-green guard. Do not draft ahead.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Live skip test vs scanning dead IDs | Keep skip as live-coverage only; leftover is a second pass. |
| `/silent/` matches `silently` in §5a | Pin `/omit/` only. |
| `/do not implement/` vs "remove those tests" | Handoff *describes* deletes; this command still does not delete. Step 9–10 make that explicit. |
| Unlabeled leftover behavior | Out of scope (lock 1). Do not hunt cancelled *text* without the dead ID. |
| Folding HH-86–HH-90 / ImportTests | Out of scope (lock 6). |
| Clobber MASTER-2029 plan | New dir `docs/plans/bam-specs-gaps-cancelled-cleanup/`. |
| Restart required | Steps 12–13 include restart + smoke. |

## Progress

- [x] Step 1 — RED: leftover pin = dead-ID mention only
- [x] Step 2 — GREEN: leftover-pin definition in §3
- [x] Step 3 — RED: leftover mentions on the gap list, tagged cleanup
- [x] Step 4 — GREEN: §4 tagged cleanup rows
- [x] Step 5 — RED: no leftover mention → omit
- [x] Step 6 — GREEN: omit dead IDs with no leftover mention
- [x] Step 7 — RED: cleanup handoff = remove tests + orphaned code; successors stay add
- [x] Step 8 — GREEN: mixed-list §5
- [x] Step 9 — RED: §6 lists only; tdd-plan does the deletes
- [x] Step 10 — GREEN: rewrite intro + §6
- [x] Step 11 — REFACTOR: coherence pass
- [x] Step 12 — VERIFY: suite + smoke (suite 56/56; worktree `OPENCODE_CONFIG_DIR` loads `/bam-specs-gaps` `agent: build` with leftover/cleanup/omit/orphaned/successor/deletes; smoke on `/tmp/opencode/bam-specs-gaps-cancelled-cleanup-smoke`: skip SMOKE-3/SMOKE-4 for live coverage, SMOKE-3 leftover cleanup `tests/widget.test.ts:9`, SMOKE-4 omit, SMOKE-1 covered `tests/widget.test.ts:1`, SMOKE-2 unlabeled-but-pinning not a gap, SMOKE-5 live miss unchanged; stopped before mention write, deletes, or Asana. Remaining gate: live `~/.config/opencode/commands` still points at main, so TUI re-smoke folds into step 13.)
- [x] Step 13 — DEPLOY (human-gated): squash, PR, merge

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

- Card: MASTER-2041 + 2026-09-11 review comment
- Predecessor: `docs/archive/opencode/PLAN-bam-specs-gaps-id-mentions.md` (MASTER-2040)
- Handoff: `docs/archive/opencode/PLAN-bam-specs-gaps-handoff.md` (MASTER-2034)
- Do not overwrite: `docs/plans/bam-specs-gaps/PLAN.md` (MASTER-2029)
- Files: `opencode/.config/opencode/commands/bam-specs-gaps.md:35`, `commands-validate/commands.test.ts:594`
- Test command: `bun test ./opencode/.config/opencode/commands-validate/`

---

After each step completes, post the next trigger verbatim.

Kickoff trigger (use only to start this plan from step 1):

- After 1 → ▶️ Step 2 of 13 — GREEN: leftover-pin definition in §3 — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 2 → ▶️ Step 3 of 13 — RED: leftover mentions on the gap list, tagged cleanup — model: cheap — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 3 → ▶️ Step 4 of 13 — GREEN: §4 tagged cleanup rows — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 4 → ▶️ Step 5 of 13 — RED: no leftover mention → omit — model: cheap — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 5 → ▶️ Step 6 of 13 — GREEN: omit dead IDs with no leftover mention — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 6 → ▶️ Step 7 of 13 — RED: cleanup handoff = remove tests + orphaned code; successors stay add — model: cheap — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 7 → ▶️ Step 8 of 13 — GREEN: mixed-list §5 — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 8 → ▶️ Step 9 of 13 — RED: §6 lists only; tdd-plan does the deletes — model: cheap — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 9 → ▶️ Step 10 of 13 — GREEN: rewrite intro + §6 — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 10 → ▶️ Step 11 of 13 — REFACTOR: coherence pass — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 11 → ▶️ Step 12 of 13 — VERIFY: suite + smoke — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
- After 12 → ▶️ Step 13 of 13 — DEPLOY (human-gated): squash, PR, merge — model: premium — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`

▶️ Step 1 of 13 — RED: leftover pin = dead-ID mention only — model: cheap — plan: `docs/plans/bam-specs-gaps-cancelled-cleanup/PLAN.md`
