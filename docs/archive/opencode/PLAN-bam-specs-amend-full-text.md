# `/bam-specs-amend` — amendment table shows full constitution line (MASTER-2039)

> **Status:** shipped; archived 2026-09-11. Nothing supersedes it.
> Merged to `m` via PR #27 (squash `68f30b8`). Asana MASTER-2039 → DONE.
> Shipped artifact: `opencode/.config/opencode/commands/bam-specs-amend.md` §4
> (full on-disk constitution line in the amendment table; no new test).
> Decision history below preserved as-is.

**Asana:** MASTER-2039 (GID `1218419098261639`) — specs-amend: amendment table must show full constitution rule text
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218419098261639
**Plan path:** `docs/plans/bam-specs-amend-full-text/PLAN.md`
**Worktree:** `~/src/dotfiles/MASTER-2039`

## TL;DR

`/bam-specs-amend` §4 currently names columns (`ID | description | action`)
but does not say what `description` is. Shorthand paraphrases made H-174
unreviewable. Change §4 so each row's description is the exact constitution
line that will land on disk (full sentence(s) plus tags).

**Done** = `bam-specs-amend.md` §4 encodes that rule. No new test (locked).
Existing `commands.test.ts` must stay green. Deploy via the existing
`commands/` symlink.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-amend.md` §4 only
  (keep §1–§3, §5–§6 and frontmatter)

### Out

- New tests in `commands.test.ts` (review Q1: command file only)
- `/bam-specs-init`, `/bam-specs-gaps`
- The shipped MASTER-2002 plan (`docs/plans/bam-specs-amend/PLAN.md`)
- `validate.ts`, `install.sh`
- Editing any `constitution.md` from this card

## Decisions (locked)

From the MASTER-2039 pre-implementation review:

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Change surface | `bam-specs-amend.md` §4 only. No new test. Not init. Not the MASTER-2002 plan. |
| 2 | Description cell | Exact on-disk line, tags included. No paraphrase. `add` = new sentence(s). `replace with <id>` = old sentence(s) plus `[REPLACED_BY: <new>]`. `replaces <id>` = new sentence(s) plus `[REPLACES: <old>]`. `drop` = old sentence(s) plus `[CANCELLED]`. |
| 3 | Table layout | Keep `ID \| description \| action`. Escape `\|` in cells. No alternate layout. |
| 4 | Go / stale | Go after Q&A. Stale: no. |

## Design

File: `opencode/.config/opencode/commands/bam-specs-amend.md`

Keep the existing table header and action values. Add, under §4, that
description is the actual constitution line that will land on disk, the
per-action mapping above, an explicit ban on shorthand, and `\|` escaping.

Existing test `body encodes the amendment table (§4)` already pins
`| id | description | action |`, `replace with`, and `replaces`. It stays
green if those tokens remain.

Run after the edit: `bun test ./opencode/.config/opencode/commands-validate/`

### §4 after the change (authoring spec)

Keep current bullets (related pairs adjacent, chronological else, on-disk
tags, IDs, no cap, new section aborts). Insert these invariants:

- Description is the constitution line itself, not a paraphrase.
- Include tags that will be written (`[REPLACED_BY]`, `[REPLACES]`,
  `[CANCELLED]`) in that cell, per the mapping in Decision 2.
- If the line contains `|`, write it as `\|` so the markdown table holds.

Do not invent new action values or a new column.

## TDD implementation order

No RED: review Q1 forbade a new test. Each step is still a single move.
**M = 3.**

### Phase A — command prose

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | GREEN | Edit `bam-specs-amend.md` §4 to the authoring spec above. Do not touch other sections, tests, or sibling commands. | premium |

### Phase B — verify + deploy

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 2 | VERIFY | `bun test ./opencode/.config/opencode/commands-validate/` green (existing amend tests still pass). | cheap |
| 3 | DEPLOY | Per `@rules/workflow.md`: Conventional-Commits commit, push, PR → base `m`, `/bam-copilot-loop` until "no new comments". Merge on explicit confirm. Fast-forward main checkout, restart opencode. | premium |

## Testing strategy

- No new coverage. The content suite is a regression gate only.
- Interactive table rendering is smoke-only after deploy (next real amend).
  Do not amend a live constitution as part of this card.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Long constitution lines wrap badly in the TUI | Accepted. Decision 3 keeps the 3-col table. |
| `|` in a rule splits the table | §4 requires `\|` escaping. |
| Existing §4 test goes red | Keep the header row and `replace with` / `replaces` tokens. |
| Agent still paraphrases | Spell "not a shorthand paraphrase" and "actual" / "on disk" in §4. |
| Scope creep into tests or init | Decision 1. Step 1 edits one file. |
| Restart required | opencode loads commands at startup (step 3). |

## Progress

- [x] Step 1 — GREEN: edit §4 so description is the on-disk constitution line
- [x] Step 2 — VERIFY: commands-validate suite
- [x] Step 3 — DEPLOY: squash, PR → m, copilot-loop, merge on confirm

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

- Card: MASTER-2039
- Review Q&A (this session): command-only; exact on-disk line; keep 3-col table
- Sibling shipped command: `opencode/.config/opencode/commands/bam-specs-amend.md`
- Sibling shipped tests: `opencode/.config/opencode/commands-validate/commands.test.ts` (`describe("bam-specs-amend command")`)
- Incident: H-174 shorthand table was unreviewable
- Tiers: `@rules/plans.md`

---

After each step completes, post the next trigger verbatim.

- After 1 → ▶️ Step 2 of 3 — VERIFY: commands-validate suite — model: cheap — plan: `docs/plans/bam-specs-amend-full-text/PLAN.md`
- After 2 → ▶️ Step 3 of 3 — DEPLOY: squash, PR → m, copilot-loop, merge on confirm — model: premium — plan: `docs/plans/bam-specs-amend-full-text/PLAN.md`

▶️ Step 1 of 3 — GREEN: edit §4 so description is the on-disk constitution line — model: premium — plan: `docs/plans/bam-specs-amend-full-text/PLAN.md`
