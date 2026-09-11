# `/bam-specs-gaps`: every live ID named in a test (MASTER-2040)

**Asana:** MASTER-2040 (GID `1218396585569979`) — `/bam-specs-gaps`: every constitution ID must be named in a test
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218396585569979
**Plan path:** `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
**Worktree:** `~/src/dotfiles/MASTER-2040`

## TL;DR

Change `/bam-specs-gaps` so a live constitution ID is covered only when a test names that ID (name, fact title, comment, or assert message), not by inferred behavior. Unlabeled tests that already pin a rule get the ID added after one confirm per run; they are not gap cards. True misses stay gaps and still use existing §5 (handoff / list-only / per-gap). Skip `[CANCELLED]` / `[REPLACED_BY: ...]` for live coverage; leftover-cancelled cleanup is MASTER-2041.

**Done** = `bam-specs-gaps.md` §3/§4/§6/intro + content tests in `commands.test.ts`. No validator or installer change.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-gaps.md` (keep `agent: build`; no `model:` pin)
- `describe("bam-specs-gaps command")` in `opencode/.config/opencode/commands-validate/commands.test.ts`

### Out

- MASTER-2041 (cleanup tests that still pin cancelled / replaced-old rules)
- Implementing missing tests or missing production code for true gaps
- Authoring a TDD plan from `/bam-specs-gaps` itself; in-session invoke of `/bam-tdd-plan`
- Edits to `/bam-specs-init`, `/bam-specs-amend`, `/bam-review-task`, `/bam-tdd-plan`
- `validate.ts` / `install.sh`
- Overwriting `docs/plans/bam-specs-gaps/PLAN.md` (MASTER-2029) or the handoff archive

## Decisions (locked)

From the 2026-09-11 MASTER-2040 review:

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Unlabeled-but-pinning | This command adds the ID after one confirm per run. Those are not gap cards. |
| 2 | Covered | Exact live ID token in a test (name, title, comment, or assert) is enough. Mentions are added only onto tests that already pin the rule. Already-labeled IDs are not re-judged. Stray mentions still count as covered. |
| 3 | Dead IDs | Live IDs only. Add the `[CANCELLED]` / `[REPLACED_BY: ...]` skip. Leftover-cancelled cleanup stays MASTER-2041. |
| 4 | True gaps | Existing §5 (handoff / list-only / per-gap). No new auto-create. |
| 5 | Agent | Keep `agent: build` (gated test-file edits plus optional per-gap Asana writes). |
| 6 | Proper-test keep | Keep the current "automated test that asserts the rule" language as the test for *where* to add a mention. Coverage *signal* is the ID token. |

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-gaps.md          # edit §3, §4, §6, intro/description
└── commands-validate/commands.test.ts  # add ID-mention tests; keep §1/§2/§5 pins
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

### Target §3 / §4 / §6 shape

```
## 3. Define a proper test, then diff each live rule
      - Scan constitution.md for live IDs. Skip [CANCELLED] / [REPLACED_BY: ...].
      - Proper test (unchanged): automated test that asserts the rule.
      - Covered: only if a test explicitly mentions that exact ID
        (name, fact title, comment, or assert message).
      - Unlabeled-but-pinning: after one confirm per run, add the mention
        to that test. Do not put it on the gap list.
      - No pin: miss. Record searched locations.

## 4. List the gaps
      - One row per live ID with no ID-token hit (true miss only).
      - Unlabeled-but-pinning never appears here.
      - A claimed rare docs exception still appears, with the stated reason.

## 5. Filing mode
      - Unchanged (handoff default / list-only / per-gap).

## 6. Relations + stop
      - Do not implement missing tests or missing code.
      - Writing ID mentions into existing tests is the allowed write.
      - Stop after mentions (if any) plus handoff snippet, list-only, or per-gap.
```

### Test seam

Same as MASTER-2029 / MASTER-2034: load inside each test via `readBamSpecsGaps()`, `existsSync`, `validateCommand(...) === []`, body lowercased. One focused test per behavior. Keep existing §1/§2/§5/§5a/§5b/§5c tests green.

**Keep** `body defines proper test (§3a)` (`automated`, `assert`, `rare`). That is the pin-check, not the coverage signal.

Tokens **absent today** in `bam-specs-gaps.md` (use these for RED): `mention`, `fact title`, `cancelled`, `replaced_by`, `add the mention`, `one confirm`, `existing tests`.

Tokens **present** (do not use as the sole new pin): `assert`, `comment`, `name`, `confirm` (path confirm in §1), `explicitly` (rare-docs line), `do not implement`, `gap`, `question`.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 13.**

Token discipline: each GREEN must not introduce a later test's tokens.

### Phase A — coverage is an explicit ID mention

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | In `describe("bam-specs-gaps command")`, add a test: a live rule is covered only if a test mentions that ID in the name, fact title, comment, or assert message. Tokens: `/mention/`, `/fact title/`. Keep the existing §3a proper-test test. Fails: `mention` and `fact title` are absent. | cheap |
| 2 | GREEN | Rewrite §3 coverage: covered iff the exact ID token appears in a test (name, fact title, comment, or assert message). Keep proper-test language for the pin-check. Forbidden in this step: `cancelled`, `replaced_by`, `add the mention`, `one confirm`, `existing tests`. | premium |

### Phase B — live IDs only

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 3 | RED | New test: scan live IDs only; skip `[CANCELLED]` / `[REPLACED_BY: ...]`. Tokens: `/cancelled/`, `/replaced_by/`. | cheap |
| 4 | GREEN | Add the skip to §3. Do not mention leftover-cancelled cleanup (MASTER-2041). Forbidden: `add the mention`, `one confirm`, `existing tests`. | premium |

### Phase C — unlabeled-but-pinning is a gated write, not a gap

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 5 | RED | New test: if a test already pins the rule but does not mention the ID, add the mention; do not put that rule on the gap list. Token: `/add the mention/`. | cheap |
| 6 | GREEN | Add that path to §3/§4 (true misses only on the gap list). Mentions go only onto tests that already assert the rule. Forbidden: `one confirm`, `existing tests`. | premium |
| 7 | RED | New test: adding mentions waits for one confirm per run (question tool, recommended default first). Token: `/one confirm/`. Do not treat §1's path `confirm` as this pin. | cheap |
| 8 | GREEN | Gate the write in §3. One ask per run, not per ID. Forbidden: `existing tests`. Do not rewrite intro/§6 yet. | premium |

### Phase D — stop condition + intro, then ship

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 9 | RED | Update/extend the §6 test: still `/do not implement/` for missing tests and missing code; writing mentions into existing tests is the allowed write. Scope the new pin to `## 6`. Token: `/existing tests/`. Keep intro from selling "file cards". | cheap |
| 10 | GREEN | Rewrite intro, frontmatter `description:`, and §6 to match. Command stays `agent: build`. §5 unchanged. | premium |
| 11 | REFACTOR | Coherence pass on intro + §3–§6 and the new tests. Suite stays green. No behavior change. | premium |
| 12 | VERIFY | `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode. Smoke `/bam-specs-gaps` on a throwaway path far enough to see live-ID skip + mention-vs-gap split + the one-confirm ask; **stop before writing tests or Asana**. | premium |
| 13 | DEPLOY (human-gated) | Per `@rules/workflow.md`: squash to one Conventional-Commits commit, push, PR with base `m`, `/bam-copilot-loop` until "no new comments". Merge on explicit confirm. | premium |

## Testing strategy

- Content suite is the TDD seam. Sibling command blocks stay green.
- Do not weaken `/do not implement/` until step 9–10, and then only by adding the mention-write exception in §6.
- Do not add a body-wide negative on `confirm`; §1 already confirms the path. Pin `one confirm` as a phrase.
- Interactive bits (mention confirm, filing-mode `question`) are smoke-only at step 12. Never edit a real repo's tests or file a real Asana card during smoke.
- Token discipline is the red-green guard. Do not draft ahead.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Existing §3a test (`automated`/`assert`/`rare`) fights the new coverage sentence | Keep proper-test as the pin-check; ID mention is a second sentence. |
| `confirm` already in §1 | Pin the phrase `one confirm`, not `/confirm/`. |
| `do not implement` in intro blocks gated writes | Steps 9–10 narrow it to missing tests/code. Until then GREEN 6–8 live in §3/§4 only. |
| Folding MASTER-2041 | Out of scope. Skip dead IDs; do not put leftover cancelled tests on the gap list. |
| Command writes ID mentions into existing tests (new) | One confirm per run. Still never implements true-gap tests or production code. |
| Clobber MASTER-2029 plan | New dir `docs/plans/bam-specs-gaps-id-mentions/`. |
| Restart required | Steps 12–13 include restart + smoke. |

## Progress

- [x] Step 1 — RED: coverage = ID mention in name / fact title / comment / assert
- [x] Step 2 — GREEN: rewrite §3 coverage sentence
- [x] Step 3 — RED: skip cancelled / replaced_by
- [x] Step 4 — GREEN: live IDs only
- [x] Step 5 — RED: add the mention, not a gap
- [x] Step 6 — GREEN: unlabeled-but-pinning path
- [x] Step 7 — RED: one confirm per run
- [x] Step 8 — GREEN: gate the mention write
- [x] Step 9 — RED: §6 allowed write into existing tests
- [x] Step 10 — GREEN: rewrite intro + §6
- [x] Step 11 — REFACTOR: coherence pass
- [x] Step 12 — VERIFY: suite + smoke (suite 52/52; worktree `OPENCODE_CONFIG_DIR` loads `/bam-specs-gaps` `agent: build` with mention/cancelled/replaced_by/one confirm; smoke on `/tmp/opencode/bam-specs-gaps-id-mentions-smoke`: skip SMOKE-3/SMOKE-4, SMOKE-1 covered `tests/widget.test.ts:1`, SMOKE-2 unlabeled-but-pinning not a gap, SMOKE-5 miss; stopped before mention write or Asana. Remaining gate: live `~/.config/opencode/commands` still points at main, so TUI re-smoke folds into step 13.)
- [ ] Step 13 — DEPLOY: squash, PR, merge

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

- Card: MASTER-2040 + 2026-09-11 review comment
- Sibling: MASTER-2041 (cancelled leftover cleanup; later)
- Trigger incident: H-174 (`hh.Tests` only names HH-141, HH-142, HH-146)
- Predecessor: `docs/plans/bam-specs-gaps/PLAN.md` (MASTER-2029); `docs/archive/opencode/PLAN-bam-specs-gaps-handoff.md` (MASTER-2034)
- Files: `opencode/.config/opencode/commands/bam-specs-gaps.md:29`, `commands-validate/commands.test.ts:560`
- Conventions: `@rules/plans.md`, `@rules/workflow.md`
- Test command: `bun test ./opencode/.config/opencode/commands-validate/`

---

After each step completes, post the next trigger verbatim.

Kickoff trigger (use only to start this plan from step 1):

- After 1 → ▶️ Step 2 of 13 — GREEN: rewrite §3 coverage sentence — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 2 → ▶️ Step 3 of 13 — RED: skip cancelled / replaced_by — model: cheap — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 3 → ▶️ Step 4 of 13 — GREEN: live IDs only — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 4 → ▶️ Step 5 of 13 — RED: add the mention, not a gap — model: cheap — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 5 → ▶️ Step 6 of 13 — GREEN: unlabeled-but-pinning path — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 6 → ▶️ Step 7 of 13 — RED: one confirm per run — model: cheap — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 7 → ▶️ Step 8 of 13 — GREEN: gate the mention write — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 8 → ▶️ Step 9 of 13 — RED: §6 allowed write into existing tests — model: cheap — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 9 → ▶️ Step 10 of 13 — GREEN: rewrite intro + §6 — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 10 → ▶️ Step 11 of 13 — REFACTOR: coherence pass — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 11 → ▶️ Step 12 of 13 — VERIFY: suite + smoke — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
- After 12 → ▶️ Step 13 of 13 — DEPLOY (human-gated): squash, PR, merge — model: premium — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`

▶️ Step 1 of 13 — RED: coverage = ID mention in name / fact title / comment / assert — model: cheap — plan: `docs/plans/bam-specs-gaps-id-mentions/PLAN.md`
