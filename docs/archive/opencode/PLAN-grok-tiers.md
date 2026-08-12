# TDD plan routing: Grok only (MASTER-1989)

> **Status:** shipped; archived 2026-08-12. Nothing supersedes it.
> Merged to `m` via PR #20 (squash `fbff9d1`). Asana MASTER-1989 → DONE.
> Shipped artifacts:
> - `opencode/.config/opencode/rules/plans.md` (two-tier Grok table)
> - `opencode/.config/opencode/commands/bam-tdd-plan.md` §4
> - `opencode/.config/opencode/commands/bam-resume.md` §4 example
> - `opencode/.config/opencode/AGENTS.md` Plans bullet
> - `opencode/.config/opencode/opencode.json` (opus/glm blacklist; grok-4.6 high)
> - `opencode/.config/opencode/rules-validate/grok-tiers.test.ts`
> - `opencode/.config/opencode/commands-validate/commands.test.ts` (tier pins)
> Decision history below preserved as-is.

**Asana:** MASTER-1989 (GID `1217447645627005`) — Project MASTER → IN PROGRESS
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217447645627005

## TL;DR

Collapse plan-step routing from 3 tiers (Opus 4.8 / GLM 5.2 / Grok Build 0.1)
to 2 Grok tiers: **Grok 4.6** (`xai/grok-4.6`, variant **high**) for hard +
mid, **Grok Build 0.1** (`opencode/grok-build-0.1`) for easy. Hide Opus and
GLM in the `/models` picker. Leave in-flight plans as written.

## Goal & scope

**In**

- Rewrite the canonical tier table in
  `opencode/.config/opencode/rules/plans.md`.
- Update live instruction copies:
  `commands/bam-tdd-plan.md` §4, `commands/bam-resume.md` §4 example,
  `AGENTS.md` Plans section.
- Hide Opus + GLM from the picker via `provider.opencode.blacklist`.
- Make Grok 4.6 default to variant `high` (not `xhigh`) on both `xai` and
  `opencode` providers; disable `xhigh`.
- Pin the new contract with tests (commands + a new rules-validate file).

**Out**

- Do not rewrite existing `docs/plans/*` or archived plans.
- No aliases for leftover Opus / GLM trigger names (`/bam-resume` already
  warns on mismatch).
- Do not change `install.sh` (`opencode.json`, `rules/`, `AGENTS.md`,
  `commands/` are already whole-dir / file linked).
- Do not hide Fable, Grok Build, or other non-Opus/GLM zen models.
- Do not deny whole providers via `experimental.policies` (that would also
  kill `opencode/grok-build-0.1`).

## Decisions (locked — MASTER-1989 review 2026-08-12)

| # | Decision | Source |
| --- | --- | --- |
| Q1 | Docs + live instructions, **and** strip Opus/GLM from the picker. Grok 4.6 defaults to **high**, not xhigh. In-flight plans stay as written. | review |
| Q2 | Mid (ex-GLM 5.2) folds into **Grok 4.6 (high)**. | review |
| Q3 | Hard-tier model id is **`xai/grok-4.6`** (high). Grok Build stays `opencode/grok-build-0.1`. | review |
| Q4 | **No aliases** for leftover Opus/GLM triggers. | review |

## Design

### New `plans.md` table

| Tier (use in triggers) | Model id (picker / frontmatter) | Use for |
| --- | --- | --- |
| **Grok Build 0.1** | `opencode/grok-build-0.1` | Mechanical: scaffolding, wiring, renames, boilerplate, tests written to a precise spec, running commands. |
| **Grok 4.6** | `xai/grok-4.6` (variant **high**) | Hard + mid: judgment, prose/prompts/docs, bounded implementation, risky live-config, deploy + review. |

Keep the existing "when torn, pick the stronger one" sentence. Stronger is
now Grok 4.6.

Friendly name in triggers: `Grok 4.6`. Do not put `(high)` in the trigger;
the high default is config, not a third tier name.

### Picker hide

`provider.blacklist` is the documented per-model hide
(https://opencode.ai/docs/providers#hiding-models). Policies only work at
provider grain, so they cannot hide Opus without also hiding Grok Build.

```json
"provider": {
  "opencode": {
    "blacklist": [
      "claude-opus-4-1",
      "claude-opus-4-5",
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-opus-5",
      "glm-4.6",
      "glm-4.7",
      "glm-4.7-free",
      "glm-5",
      "glm-5-free",
      "glm-5.1",
      "glm-5.2"
    ]
  }
}
```

Once blacklisted, the existing `claude-opus-4-7` / `claude-opus-4-8`
variant blocks in `opencode.json` are dead. Drop them in the same GREEN
as the blacklist. Keep `claude-fable-5`.

### Grok 4.6 → high, not xhigh

xAI `grok-4.6` reasoning efforts are `low` / `medium` / `high` / `xhigh`.
Configure both picker entries so neither defaults to xhigh:

```json
"provider": {
  "xai": {
    "models": {
      "grok-4.6": {
        "options": { "effort": "high" },
        "variants": { "xhigh": { "disabled": true } }
      }
    }
  },
  "opencode": {
    "models": {
      "grok-4.6": {
        "options": { "effort": "high" },
        "variants": { "xhigh": { "disabled": true } }
      }
    }
  }
}
```

`opencode/grok-4.6` is **not** the hard-tier id (that is `xai/grok-4.6`).
It stays visible; it just must not land on xhigh if someone picks it.

### Test seam

- Command bodies: extend
  `opencode/.config/opencode/commands-validate/commands.test.ts`
  (same token-pin style as MASTER-1848).
- `plans.md`, `AGENTS.md` Plans section, `opencode.json`: new
  `opencode/.config/opencode/rules-validate/grok-tiers.test.ts`
  (`rules-validate/` already reads `opencode.json` and `AGENTS.md`).

Run: `bun test ./opencode/.config/opencode/commands-validate/ ./opencode/.config/opencode/rules-validate/`

**Newly-absent tokens (force a clean RED):**

| File | Pin on | Why it is red today |
| --- | --- | --- |
| `plans.md` | `Grok 4.6` + `xai/grok-4.6`; absence of `opencode/claude-opus-4-8` and `opencode/glm-5.2` | Table is still the 3-tier zen ids |
| `bam-tdd-plan.md` | `Grok 4.6`; not `three tiers` | §4 still lists Opus / GLM / "three tiers" |
| `bam-resume.md` | `Grok 4.6` in the §4 example list | Example is still `Opus 4.8` / `GLM 5.2` / `Grok Build 0.1` |
| `AGENTS.md` | `Grok 4.6` in the Plans section | Still `Opus 4.8 / GLM 5.2 / Grok Build 0.1` |
| `opencode.json` | `provider.opencode.blacklist` contains the opus + glm ids | No blacklist key today |
| `opencode.json` | `provider.xai.models["grok-4.6"]` has `options.effort === "high"` and `variants.xhigh.disabled === true` | No `xai` provider block today |

Do not drive a RED off tokens that already appear (`Grok Build 0.1`,
`model`, `tier`). Do not mention Opus/GLM as current routing in the live
files (a historical aside would fail the absence pins).

## TDD implementation order

Each step is a single test **or** a single move, never both. M = 15.

### Phase A — Routing docs

| # | Kind | Step | Model |
|---|------|------|-------|
| 1 | RED | Add `describe("plans.md grok tiers (MASTER-1989)")` in `rules-validate/grok-tiers.test.ts`. Assert `plans.md` contains `Grok 4.6` and `xai/grok-4.6`, and does not contain `opencode/claude-opus-4-8` or `opencode/glm-5.2`. Fails today. | Grok Build 0.1 |
| 2 | GREEN | Rewrite the `plans.md` model-tier table to the two rows in Design. Drop Opus / GLM rows. Fold mid into the Grok 4.6 "Use for" cell. Test 1 passes. | Grok 4.6 |
| 3 | RED | In `commands.test.ts`, add `describe("bam-tdd-plan grok tiers (MASTER-1989)")`. Assert the body contains `Grok 4.6` and does not contain `three tiers`. Fails today. | Grok Build 0.1 |
| 4 | GREEN | Rewrite `bam-tdd-plan.md` §4 to the two-tier list (Grok Build 0.1 / Grok 4.6). Point at `@rules/plans.md`. Test 3 passes. Existing `bam-tdd-plan` token test stays green. | Grok 4.6 |
| 5 | RED | Add `describe("bam-resume grok tiers (MASTER-1989)")`. Assert §4's example list contains `Grok 4.6` and `Grok Build 0.1` and does not contain `Opus 4.8` or `GLM 5.2`. Fails today. | Grok Build 0.1 |
| 6 | GREEN | Change the `bam-resume.md` §4 example to `` `Grok 4.6` / `Grok Build 0.1` ``. Test 5 passes. Existing resume tests stay green. | Grok Build 0.1 |
| 7 | RED | In `grok-tiers.test.ts`, assert `AGENTS.md` Plans section contains `Grok 4.6` and does not contain `Opus 4.8` or `GLM 5.2`. Fails today. | Grok Build 0.1 |
| 8 | GREEN | Update the `AGENTS.md` Plans bullet to `Grok 4.6 / Grok Build 0.1`. Test 7 passes. Existing no-ai-tells AGENTS wiring test stays green. | Grok Build 0.1 |

### Phase B — Picker + default variant

| # | Kind | Step | Model |
|---|------|------|-------|
| 9 | RED | In `grok-tiers.test.ts`, assert `opencode.json` `provider.opencode.blacklist` is an array that includes every opus and glm id listed in Design. Fails today (no blacklist). | Grok Build 0.1 |
| 10 | GREEN | Add the blacklist. Remove the now-dead `claude-opus-4-7` and `claude-opus-4-8` variant blocks. Keep `claude-fable-5`. Test 9 passes. Existing `instructions` includes `no-ai-tells` test stays green. | Grok 4.6 |
| 11 | RED | Assert `provider.xai.models["grok-4.6"].options.effort === "high"` and `.variants.xhigh.disabled === true`, and the same pair under `provider.opencode.models["grok-4.6"]`. Fails today. | Grok Build 0.1 |
| 12 | GREEN | Add the `xai` + `opencode` grok-4.6 variant config from Design. Test 11 passes. Config still parses (`JSON.parse`) and keeps `$schema`. | Grok 4.6 |

### Phase C — Coherence, verify, deploy

| # | Kind | Step | Model |
|---|------|------|-------|
| 13 | REFACTOR | Tidy `grok-tiers.test.ts` (shared `readJson` / `readText` helpers, one describe per file). No behavior change. Both suites green. | Grok Build 0.1 |
| 14 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/ ./opencode/.config/opencode/rules-validate/` green. Restart opencode (config is not hot-reloaded). Smoke: `/models` has no Opus/GLM; picking Grok 4.6 lands on **high**; `/bam-tdd-plan` names only the two Grok tiers. | Grok 4.6 |
| 15 | DEPLOY | Per `@rules/workflow.md` + `/bam-deploy-dev`: one squashed Conventional-Commits commit, push, PR → base **`m`**, `/bam-copilot-loop` until "no new comments". Repo has no `.github/workflows/`, so the local suite is the merge gate. Merge on confirm; ff the main checkout; restart opencode; re-smoke `/models` + a throwaway `/bam-tdd-plan`. Archive this plan. | Grok 4.6 |

Adjacent trivial steps (e.g. 5→6) may run back-to-back, but each keeps its
own commit so the red→green history stays legible.

## Testing strategy

- **Content suite** — command token pins in `commands.test.ts`; table /
  AGENTS / `opencode.json` pins in `grok-tiers.test.ts`.
- **No validator change.** `validate.ts` does not know about model tiers.
- **Manual smoke (step 14)** — picker hide + default variant are not
  unit-testable beyond the JSON shape. Confirm after restart.

## Risks & gotchas

1. **Blacklist is picker-only.** A session can still pass
   `--model opencode/claude-opus-4-8`. That is fine; we are not denying
   the provider.
2. **New zen Opus/GLM ids.** A later `claude-opus-4-9` or `glm-5.3` will
   show until someone extends the blacklist. Pin today's catalog; do not
   try to glob.
3. **Anthropic-native Opus.** If `/connect` Anthropic is active, those
   models are a different provider and are not in this blacklist. Out of
   scope unless they appear in the smoke.
4. **Default variant vs last-used.** OpenCode remembers the last model +
   variant. Disabling `xhigh` plus `options.effort: high` is the durable
   default; a leftover last-used `xhigh` should fail closed (variant gone)
   and fall back. Confirm in step 14.
5. **Restart required.** `opencode.json`, commands, and `AGENTS.md` load
   at startup. Step 14 / 15 smokes are worthless without a quit + restart.
6. **In-flight plans.** `tdl-no-bottom-pane`, `tmux-cycle-paused-fifo`,
   and `hyprland-lid-externals-freeze` still name GLM / Opus. Leave them.
   `/bam-resume` will warn; proceed or switch by hand.
7. **Token traps.** `Grok Build 0.1` already appears everywhere. Drive
   REDs off `Grok 4.6`, `xai/grok-4.6`, `three tiers`, `blacklist`, and
   the xai block.
8. **This plan uses the new tier names.** Executing agents pick the model
   in the session picker; the live `plans.md` table will not match until
   step 2 lands. That is expected.

## Progress

- [x] Phase A — routing docs (steps 1–8)
- [x] Phase B — picker + default variant (steps 9–12)
- [x] Phase C — refactor + verify + deploy (steps 13–15)
  - [x] Step 13 REFACTOR — `grok-tiers.test.ts` helpers + one describe per file
  - [x] Step 14 VERIFY — suite 34/34. CLI smoke with
    `OPENCODE_CONFIG` + `OPENCODE_CONFIG_DIR` pointed at this worktree (fresh
    process, same as a restart): `opencode models opencode` has no Opus/GLM
    (Fable + Grok Build + Grok 4.6 stay); both `xai/grok-4.6` and
    `opencode/grok-4.6` resolve `options.effort=high` and drop `xhigh` from
    variants (low/medium/high only); resolved `/bam-tdd-plan` template names
    only the two Grok tiers. **Remaining gate:** live
    `~/.config/opencode` still points at the *main* checkout, so a
    post-merge TUI re-smoke (ff main, restart, `/models` + throwaway
    `/bam-tdd-plan`) folds into Step 15.
  - [x] Step 15 DEPLOY — PR #20 squash-merged to `m` as `fbff9d1`. Plan archived.

## References

- Task: Asana MASTER-1989 + review comment (2026-08-12).
- Canonical table: `opencode/.config/opencode/rules/plans.md`.
- Commands: `bam-tdd-plan.md`, `bam-resume.md`.
- Config: `opencode/.config/opencode/opencode.json`.
- Hide-models docs: https://opencode.ai/docs/providers#hiding-models
- Variant `disabled`: https://opencode.ai/docs/models#custom-variants
- House style: `docs/archive/opencode/PLAN-review-task-qa.md`.

## After-step triggers

- After 1 → ▶️ Step `2` of `15` — `GREEN: rewrite plans.md two-tier table` — model: `Grok 4.6` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 2 → ▶️ Step `3` of `15` — `RED: pin bam-tdd-plan two-tier §4` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 3 → ▶️ Step `4` of `15` — `GREEN: rewrite bam-tdd-plan §4` — model: `Grok 4.6` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 4 → ▶️ Step `5` of `15` — `RED: pin bam-resume example tiers` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 5 → ▶️ Step `6` of `15` — `GREEN: rewrite bam-resume example` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 6 → ▶️ Step `7` of `15` — `RED: pin AGENTS.md Plans two-tier` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 7 → ▶️ Step `8` of `15` — `GREEN: rewrite AGENTS.md Plans bullet` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 8 → ▶️ Step `9` of `15` — `RED: pin opencode.json opus/glm blacklist` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 9 → ▶️ Step `10` of `15` — `GREEN: blacklist opus/glm + drop dead opus variants` — model: `Grok 4.6` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 10 → ▶️ Step `11` of `15` — `RED: pin grok-4.6 high / xhigh disabled` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 11 → ▶️ Step `12` of `15` — `GREEN: add xai+opencode grok-4.6 high default` — model: `Grok 4.6` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 12 → ▶️ Step `13` of `15` — `REFACTOR: tidy grok-tiers.test.ts` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 13 → ▶️ Step `14` of `15` — `VERIFY: suite + restart + /models smoke` — model: `Grok 4.6` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
- After 14 → ▶️ Step `15` of `15` — `DEPLOY: PR → m + archive` — model: `Grok 4.6` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`

## Kickoff trigger

▶️ Step `1` of `15` — `RED: pin plans.md two-tier table` — model: `Grok Build 0.1` — plan: `docs/plans/opencode-grok-tiers/PLAN.md`
