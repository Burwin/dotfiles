# TDD plan routing: cheap / premium OpenRouter presets (MASTER-2033)

> **Status:** shipped; archived 2026-09-04. Nothing supersedes it.
> Merged to `m` via PR #25 (squash `34eb25c`). Asana MASTER-2033 → DONE.
> Shipped artifacts:
> - `opencode/.config/opencode/rules/plans.md` (cheap / premium table + legacy Grok one-liner)
> - `opencode/.config/opencode/commands/bam-tdd-plan.md` §4
> - `opencode/.config/opencode/commands/bam-resume.md` §4 example
> - `opencode/.config/opencode/AGENTS.md` Plans bullet
> - `opencode/.config/opencode/rules-validate/grok-tiers.test.ts`
> - `opencode/.config/opencode/commands-validate/commands.test.ts` (tier pins)
> Decision history below preserved as-is.

**Asana:** MASTER-2033 (GID `1218154115086110`) — `/bam-tdd-plan` needs to use new openrouter presets
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218154115086110
**Project:** MASTER / IN PROGRESS

Dotfiles follow-on to MASTER-2032 (runner + `opencode.json` presets already shipped). This card rewrites the live instruction copies so new plans say `cheap` / `premium`.

This plan's own steps use `cheap` / `premium`; `mapModelTier` already maps them.

## TL;DR

Replace the Grok-named two-tier table with OpenRouter cost bands. New steps say **cheap** (`openrouter/cheap`) and **premium** (`openrouter/premium`). Keep a one-liner that `Grok Build 0.1` / `Grok 4.6` still map. Leave in-flight `docs/plans/*` as written. Retarget the MASTER-1989 pin tests.

## Goal & scope

**Done means:** `/bam-tdd-plan` authors plans against `cheap` / `premium`; `@rules/plans.md` is the canonical table; `bam-resume` §4 example and the `AGENTS.md` Plans bullet match; pin tests green.

### In

- `opencode/.config/opencode/rules/plans.md` (canonical table + legacy-name one-liner)
- `opencode/.config/opencode/commands/bam-tdd-plan.md` §4
- `opencode/.config/opencode/commands/bam-resume.md` §4 example only
- `opencode/.config/opencode/AGENTS.md` Plans bullet
- Pin tests: `rules-validate/grok-tiers.test.ts` (plans.md + AGENTS.md describes) and `commands-validate/commands.test.ts` (bam-tdd-plan + bam-resume describes)

### Out

- `opencode.json` (presets already in `7854f62`)
- In-flight `docs/plans/*` and archives
- Tools repo (`mapModelTier`, failover, README)
- `bam-specs-init.md` (still says Grok 4.6; its tests do not pin the live routing table)
- `/bam-resume` alias-equivalence logic (Grok 4.6 ≡ premium). Example swap only. Mismatch stays a string compare.
- Renaming `grok-tiers.test.ts`
- Constitution

## Decisions (locked — MASTER-2033 review 2026-09-03)

| # | Decision | Source |
| --- | --- | --- |
| Q1 | Same live-instruction set as MASTER-1989. Not `opencode.json`, not existing PLAN.md files, not tools. | review |
| Q2 | New steps say **cheap** / **premium**. Ids `openrouter/cheap` / `openrouter/premium`. One-liner that Grok Build 0.1 / Grok 4.6 still map. When unsure, pick premium. | review (also MASTER-2032) |
| Q3 | Leave existing PLAN.md files as written. | review |
| Q4 | `/bam-resume`: update the §4 example only. No Grok-equals-band alias logic. | review |

## Design

### New `plans.md` table

Keep the "when torn, pick the stronger one" sentence. Stronger is now **premium**.

| Tier (use in triggers) | Model id (picker / frontmatter) | Use for |
| --- | --- | --- |
| **cheap** | `openrouter/cheap` | Mechanical: scaffolding, wiring, renames, boilerplate, tests written to a precise spec, running commands. |
| **premium** | `openrouter/premium` | Hard + mid: judgment, prose/prompts/docs, bounded implementation, risky live-config, deploy + review. |

One-liner immediately after the table (friendly names only, no old model ids):

> Legacy names `Grok Build 0.1` and `Grok 4.6` still map onto cheap and premium. New steps say cheap / premium.

Do not put `(high)` or `@preset/` in the trigger. The preset wiring is config.

### Live copies

- **bam-tdd-plan.md §4:** two-bullet list `**cheap**` / `**premium**` with the same Use-for gloss as the table. Point at `@rules/plans.md` for ids. Unsure → premium. No Grok names in this file.
- **bam-resume.md §4:** example becomes `` `cheap` / `premium` ``. No extra mismatch logic.
- **AGENTS.md Plans bullet:** `(cheap / premium)` in place of `(Grok 4.6 / Grok Build 0.1)`.

### Test seam

Rewrite the existing MASTER-1989 describes in place (do not add a parallel describe that still pins `xai/grok-4.6`). Leave the two `opencode.json` describes in `grok-tiers.test.ts` untouched.

Run: `bun test ./opencode/.config/opencode/commands-validate/ ./opencode/.config/opencode/rules-validate/`

**Newly-absent tokens (force a clean RED):**

| File | Pin on | Why it is red today |
| --- | --- | --- |
| `plans.md` | `openrouter/cheap` + `openrouter/premium`; still has `Grok 4.6` (alias note); no `xai/grok-4.6` or `opencode/grok-build-0.1`; still no opus/glm ids | Table still has Grok rows + old ids |
| `bam-tdd-plan.md` | body has `**cheap**` and `**premium**`; no `Grok 4.6`; still no `three tiers` | §4 still lists Grok Build 0.1 / Grok 4.6 |
| `bam-resume.md` | §4 has `cheap` and `premium`; no `Grok 4.6`; still no Opus 4.8 / GLM 5.2 | Example is still Grok 4.6 / Grok Build 0.1 |
| `AGENTS.md` | Plans section has `cheap` and `premium`; no `Grok 4.6`; still no Opus 4.8 / GLM 5.2 | Bullet is still `Grok 4.6 / Grok Build 0.1` |

**Token trap:** `plans.md` already contains the word "cheap" ("window small and cheap"). Never pin bare `cheap` in that file. Pin `openrouter/cheap` and the table cell `**cheap**`. `bam-tdd-plan.md` / `bam-resume.md` §4 / AGENTS Plans section do not contain `cheap` or `premium` today, so those pins are safe.

Do not mention Opus/GLM as current routing in the live files.

## TDD implementation order

Each step is a single test **or** a single move, never both. M = 10.

### Phase A — Routing docs

| # | Kind | Step | Model |
|---|------|------|-------|
| 1 | RED | Rewrite `describe("plans.md grok tiers (MASTER-1989)")` in `rules-validate/grok-tiers.test.ts` to MASTER-2033. Assert `plans.md` contains `openrouter/cheap`, `openrouter/premium`, and `Grok 4.6`; does not contain `xai/grok-4.6` or `opencode/grok-build-0.1`; still does not contain `opencode/claude-opus-4-8` or `opencode/glm-5.2`. Fails today. Do not edit `plans.md`. Leave the two `opencode.json` describes untouched. | cheap |
| 2 | GREEN | Rewrite the `plans.md` model-tier table to the two rows in Design. Add the legacy-name one-liner. Drop `xai/grok-4.6` and `opencode/grok-build-0.1`. Stronger tier is premium. Test 1 passes. | premium |
| 3 | RED | Rewrite `describe("bam-tdd-plan grok tiers (MASTER-1989)")` in `commands.test.ts` to MASTER-2033. Assert the body contains `**cheap**` and `**premium**` and does not contain `Grok 4.6`; keep `three tiers` absent. Fails today. Do not edit `bam-tdd-plan.md`. Existing `bam-tdd-plan command` token test stays green. | cheap |
| 4 | GREEN | Rewrite `bam-tdd-plan.md` §4 to the two-bullet cheap / premium list. Point at `@rules/plans.md`. Unsure → premium. No Grok names. Test 3 passes. | premium |
| 5 | RED | Rewrite `describe("bam-resume grok tiers (MASTER-1989)")` to MASTER-2033. Assert §4 contains `cheap` and `premium` and does not contain `Grok 4.6`; keep Opus 4.8 / GLM 5.2 absent. Fails today. Do not edit `bam-resume.md`. | cheap |
| 6 | GREEN | Change the `bam-resume.md` §4 example to `` `cheap` / `premium` ``. No mismatch logic. Test 5 passes. Existing resume tests stay green. | cheap |
| 7 | RED | Rewrite the AGENTS.md describe in `grok-tiers.test.ts` to MASTER-2033. Assert the Plans section contains `cheap` and `premium` and does not contain `Grok 4.6`; keep Opus 4.8 / GLM 5.2 absent. Fails today. Do not edit `AGENTS.md`. | cheap |
| 8 | GREEN | Update the `AGENTS.md` Plans bullet to `cheap / premium`. Test 7 passes. Existing no-ai-tells AGENTS wiring test stays green. | cheap |

### Phase B — Verify, deploy

| # | Kind | Step | Model |
|---|------|------|-------|
| 9 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/ ./opencode/.config/opencode/rules-validate/` green. Restart opencode (commands / AGENTS / rules are not hot-reloaded). Smoke: a throwaway `/bam-tdd-plan` names only cheap / premium. | premium |
| 10 | DEPLOY | Per `@rules/workflow.md` + `/bam-deploy-dev`: one squashed Conventional-Commits commit, push, PR → base **`m`**, `/bam-copilot-loop` until "no new comments". Repo has no `.github/workflows/`, so the local suite is the merge gate. Merge on confirm; ff the main checkout; restart opencode; re-smoke `/bam-tdd-plan`. Archive this plan. | premium |

Adjacent trivial steps (e.g. 5→6) may run back-to-back, but each keeps its own commit so the red→green history stays legible.

## Testing strategy

- **Content suite** — command token pins in `commands.test.ts`; table / AGENTS pins in `grok-tiers.test.ts`.
- **No validator change.** `validate.ts` does not know about model tiers.
- **No `opencode.json` change.** The two JSON describes in `grok-tiers.test.ts` stay as MASTER-1989 left them.
- **Manual smoke (step 9)** — command text is not unit-testable beyond tokens. Confirm after restart.

## Risks & gotchas

1. **Rewrite, don't stack, the 1989 describes.** A GREEN that drops `xai/grok-4.6` will fail the old pin if that pin is still in the file. The matching RED must replace those assertions first.
2. **Token trap in `plans.md`.** Bare `cheap` already appears. Pin `openrouter/cheap` / `**cheap**` only.
3. **Alias note vs absence pins.** `plans.md` must keep the friendly names `Grok 4.6` / `Grok Build 0.1` in the one-liner, so that file cannot assert their absence. `bam-tdd-plan.md`, `bam-resume.md` §4, and the AGENTS Plans section can.
4. **In-flight plans.** Active `docs/plans/*` still name Grok tiers. Leave them. `/bam-resume` will warn on string mismatch; proceed or switch by hand. `bamboo plans run` already remaps.
5. **`bam-specs-init.md` still says Grok 4.6.** Out of scope. Do not drive a RED off it.
6. **Restart required.** Commands and `AGENTS.md` load at startup. Step 9 / 10 smokes are worthless without a quit + restart.
7. **This plan uses the new tier names.** Executing agents pick cheap / premium in the session picker; the live `plans.md` table will not match until step 2 lands. The runner already maps. Expected.

## Progress

- [x] Step 1 — RED: pin plans.md cheap/premium table
- [x] Step 2 — GREEN: rewrite plans.md cheap/premium table
- [x] Step 3 — RED: pin bam-tdd-plan cheap/premium §4
- [x] Step 4 — GREEN: rewrite bam-tdd-plan §4
- [x] Step 5 — RED: pin bam-resume example tiers
- [x] Step 6 — GREEN: rewrite bam-resume example
- [x] Step 7 — RED: pin AGENTS.md Plans cheap/premium
- [x] Step 8 — GREEN: rewrite AGENTS.md Plans bullet
- [x] Step 9 — VERIFY: suite + restart + /bam-tdd-plan smoke (suite 57/57. CLI smoke with `OPENCODE_CONFIG` + `OPENCODE_CONFIG_DIR` pointed at this worktree (fresh process, same as a restart): resolved `/bam-tdd-plan` template names only cheap / premium, no Grok 4.6 / Grok Build. Remaining gate: live `~/.config/opencode` still points at the main checkout, so a post-merge TUI re-smoke (ff main, restart, throwaway `/bam-tdd-plan`) folds into Step 10.)
- [x] Step 10 — DEPLOY: PR → m + archive

## References

- Task: Asana MASTER-2033 + review comment (2026-09-03).
- Predecessor: MASTER-2032 (GID `1218142814291874`) — `mapModelTier` + `opencode.json` `@preset/cheap` / `@preset/premium`.
- Canonical table: `opencode/.config/opencode/rules/plans.md`.
- Commands: `bam-tdd-plan.md`, `bam-resume.md`.
- House style: `docs/archive/opencode/PLAN-grok-tiers.md`.
- Parser: Progress must be `- [ ] Step N — label`; triggers must not backtick N/M/label/model (`parsePlanMd` does not strip those).

---

### Per-step triggers

After each step, post the **next** step's trigger verbatim.

**Step 1 → 2:**

> ▶️ Step 2 of 10 — GREEN: rewrite plans.md cheap/premium table — model: premium — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 2 → 3:**

> ▶️ Step 3 of 10 — RED: pin bam-tdd-plan cheap/premium §4 — model: cheap — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 3 → 4:**

> ▶️ Step 4 of 10 — GREEN: rewrite bam-tdd-plan §4 — model: premium — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 4 → 5:**

> ▶️ Step 5 of 10 — RED: pin bam-resume example tiers — model: cheap — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 5 → 6:**

> ▶️ Step 6 of 10 — GREEN: rewrite bam-resume example — model: cheap — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 6 → 7:**

> ▶️ Step 7 of 10 — RED: pin AGENTS.md Plans cheap/premium — model: cheap — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 7 → 8:**

> ▶️ Step 8 of 10 — GREEN: rewrite AGENTS.md Plans bullet — model: cheap — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 8 → 9:**

> ▶️ Step 9 of 10 — VERIFY: suite + restart + /bam-tdd-plan smoke — model: premium — plan: `docs/plans/tdd-plan-presets/PLAN.md`

**Step 9 → 10:**

> ▶️ Step 10 of 10 — DEPLOY: PR → m + archive — model: premium — plan: `docs/plans/tdd-plan-presets/PLAN.md`

### Kickoff trigger (step 1)

> ▶️ Step 1 of 10 — RED: pin plans.md cheap/premium table — model: cheap — plan: `docs/plans/tdd-plan-presets/PLAN.md`
