---
description: Resume the active plan — resolve the card + plan file, find the next step from the last-posted trigger, tier-check the current model, then (after a confirm) run that one step and post the next trigger.
agent: build
---

Resume the active plan from a fresh session, so picking up a step-by-step plan no longer means copy-pasting its next trigger by hand. The flow: resolve the **card** and its **plan file** (§1–§2), find the **next step** from the last trigger the previous session posted (§3), **tier-check** that step against the model this session is on (§4), then **echo and confirm** (§5) before **running exactly one step** (§6) and **posting the next step's trigger** for a fresh session to continue — then stopping (§7).

This command is `agent: build`, so unlike the read-only reviews it **executes a step** and writes code. Keep the guard tight: the one **gated step-run** (§6) is the only place it writes code or commits, it always **confirms before executing** (§5), it runs **exactly one step** and **never runs ahead**, and once the step is done it only **posts the next trigger** (§7) and stops.

Optional override: $ARGUMENTS   (a plan path or topic, or a pasted trigger to use directly)

Current directory: !`pwd`

## 1. Resolve the card

Identify the Asana card this plan belongs to from the current directory name (shown above), per `AGENTS.md` → "Resolving task references":

1. If the directory name ends in a task id like `MASTER-1870` / `SH-264` / `ENG-123`, that is the card — just resolve its GID.
2. If the directory name has **no** task id, **ask the human** for the id or permalink rather than guessing — this command's `$ARGUMENTS` is reserved for the plan/trigger override, not the card.
3. Given an id, confirm it with `asana_search_tasks` (the id as the `text` param — it searches the per-project task-number field, not only name/description); if still ambiguous, narrow with `projects_any` filtered to the relevant project.

Verify the match by `permalink_url` or project membership, **not** by name — the card name usually looks unrelated to the id.

## 2. Resolve the plan file

Find the active plan file, in this order:

1. **Explicit override** — if `$ARGUMENTS` names a plan path or topic, use it (a `docs/plans/<topic>/PLAN.md` path, or a topic that resolves to one).
2. **By card** — otherwise pick the `docs/plans/<topic>/PLAN.md` whose contents reference the resolved card id (e.g. `MASTER-1870`).
3. **Sole active plan** — if exactly one active plan dir exists under `docs/plans/`, use it.
4. **Else ask** — if none or several match, list the candidate plans under `docs/plans/` and ask which one to resume.

## 3. Find the next step

The step to run is the one named by the **last trigger the previous session posted** — follow that trigger, don't infer the step from which checkboxes are ticked. If `$ARGUMENTS` already carries a pasted `▶️ Step N of M …` trigger, use it directly and skip the transcript scan below; otherwise read it from the prior session's transcript:

1. **List the sessions for this directory** — `opencode session list` (it is per-directory and recency-sorted). **Skip the current session** (match it by id, or take the most recent session that actually contains a trigger).
2. **Export that session's transcript** — `opencode export <id>` — and scan it **from the end for the last occurrence** of the canonical **trigger sentence** (don't assume it's in the final assistant message — a session may have continued past the trigger with follow-up Q&A). The shape is defined in `@rules/plans.md` (backticked fields; one logical line that may wrap onto two; the `— plan:` path never dropped):

   > ▶️ Step `N` of `M` — `<label>` — model: `<tier>` — plan:
   > `docs/plans/<topic>/PLAN.md`
3. **Cross-check it against the plan's step table** (from §2): the trigger's `plan:` path should match the resolved plan, and its `N of M` should line up with a row in that table. If they diverge (a hand-edited plan, an out-of-order run), surface the discrepancy for the human rather than silently trusting one source.
4. **Fresh-plan fallback** — if there is no prior session, or its transcript holds no trigger (a brand-new plan, or a session that errored before posting), fall back to the plan's **kickoff trigger** (step 1, at the bottom of the plan file), and say so.

## 4. Tier check

The trigger from §3 names a **model tier** (e.g. `Opus 4.8` / `GLM 5.2` / `Grok Build 0.1`, per `@rules/plans.md`). Compare that named tier against the model **this** session is actually running on:

1. **Match** — the current model already is the step's tier: carry on to the echo below.
2. **Mismatch** — the tiers differ: **warn** and **ask** which way to go — **proceed** on the current model anyway, or **switch** (start a fresh session on the step's tier and resume there rather than running now). Never silently run a step on the wrong tier.

There is no clean in-session model switch — the frontmatter `model:` is static and nothing lets a running turn reassign its own model — so this is a *warn/ask*, not an automatic switch. Running the step on its named tier via the `opencode run --model <id> "<prompt>"` shell-out (a separate subprocess) is noted as a **future** auto-switch option, not done here.

## 5. Echo & confirm

Before touching anything, **echo the resolved step** so the human can sanity-check it, then **confirm**:

- **Step N of M** and its **label**.
- The step's named **tier**, alongside the model this session is on (flag any §4 mismatch).
- The **action** the step will take — what it will write or change.
- Any trigger ↔ plan-table discrepancy noted in §3.

**Confirm before executing**: wait for an explicit go-ahead, and do not begin the step until the human approves.

## 6. Run exactly one step

Only after the §5 confirm, execute **exactly one step** — the step resolved in §3, and nothing beyond it:

1. **Do the work the step names** — follow the plan's own instructions for that step and its TDD discipline (RED = one failing test; GREEN = the minimal change that makes it pass; REFACTOR = tidy with the suite green), running the plan's verification check before calling it done.
2. **Commit on the plan's cadence** — keep this step's change as its own Conventional-Commits commit per `@rules/workflow.md`, so the red→green history stays legible (the per-step commits are squashed at deploy).
3. **Don't run ahead** — stop at this one step even when the next looks trivial. One step per session is what keeps the human review checkpoint and the §4 tier warning meaningful.

## 7. Post the next trigger

With the step done, **emit the next step's trigger verbatim** for the following row of the plan's step table — in the exact canonical shape from `@rules/plans.md` (backticked fields; one logical line that may wrap onto two; the `— plan:` path never dropped):

> ▶️ Step `N` of `M` — `<label>` — model: `<tier>` — plan:
> `docs/plans/<topic>/PLAN.md`

Then **stop** — ready to paste into a fresh session. Do not begin that next step here; resuming it is the next invocation's job.
