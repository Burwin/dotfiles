---
description: Draft a test-by-test red-green-refactor plan at docs/plans/<topic>/PLAN.md — each step a separate test or move, with per-step trigger sentences and model tags. Plan only, no implementation.
agent: plan
---

Draft a TDD implementation plan for a feature or task. **Do not implement anything** — this pass ends with a written plan file and nothing else. The output is a plan another agent (or you, later) can execute step-by-step, where the test history reads red → green → refactor.

Feature / task to plan: $ARGUMENTS

If `$ARGUMENTS` is empty, infer the target from the conversation or the current worktree (per `AGENTS.md` → "Resolving task references") and confirm it before planning.

## 1. Understand the work

Before decomposing, get the ask straight: what is being built, what "done" looks like, and what the natural seam for testing is. Skim the relevant code so the plan references real files, functions, and test commands — not guesses. If the testable unit isn't obvious (e.g. markdown, config, prose), find or propose the smallest meaningful artifact that *can* be tested (a validator, a schema check, a parse) and build the red-green cycle around that.

## 2. Decompose into a test-by-test sequence

Break the work into the smallest ordered steps where **each step is a single test OR a single implementation move — never both**:

- **RED** = write one failing test that pins down one new behavior.
- **GREEN** = the minimal change that makes that test (and the suite) pass.
- **REFACTOR** = restructure with the suite green; no behavior change.

Rules for the decomposition:

- **Each step is a separate test** or a separate move. A test step never also implements; an implementation step never also adds new test coverage. Keeping test steps separate from implementation steps is what makes the red→green history legible and each commit reviewable.
- Order steps so each builds on the last — setup/scaffold first, then the core behaviors, then edge cases, then refactors, then wiring/integration, then deploy.
- Group steps into phases; every phase should be independently shippable.
- Only mark a step as already done if that work genuinely exists.

## 3. Trigger sentence per step

**Every step carries an explicit trigger sentence** so the next step — and the model that should run it — is unambiguous. When a step completes, the executing agent posts the **next** step's trigger verbatim. Use the canonical shape from `@rules/plans.md` (`N` = step number, `M` = total step count; `<label>` is the step label — for TDD, `<kind>: <title>` where `<kind>` is `RED` / `GREEN` / `REFACTOR`):

> ▶️ Step `N` of `M` — `<label>` — model: `<tier>` — plan:
> `docs/plans/<topic>/PLAN.md`

`<tier>` is the friendly model-tier name (see §4). Put the trigger for step 1 (the kickoff) at the bottom of the plan so execution can begin with one copy-paste.

## 4. Name a model tier for every step

**Every step names a model tier** capable of executing it with confidence — don't leave it implicit. Use the three tiers and routing in `@rules/plans.md`:

- **Grok Build 0.1** — mechanical / well-specified steps (scaffolding, wiring, writing a test to a precise spec, renames).
- **GLM 5.2** — mid: moderate but bounded logic, straightforward well-specified implementation.
- **Opus 4.8** — judgment-heavy steps (designing the decomposition, authoring prose/prompts, the deploy + review loop, anything needing taste).

Record the tier in a **Model** column in the step table and echo it in each trigger sentence — the friendly name in the trigger; the full `provider/model-id` lives in the `@rules/plans.md` table. Pick only a tier you're confident can do the step; if unsure, choose the stronger one and say why.

## 5. Write the plan file

Output the plan to `docs/plans/<topic>/PLAN.md` (kebab-case `<topic>` derived from the feature/task). Include:

- **Goal & scope** — what's in, what's explicitly out.
- **Decisions** — anything locked from the kickoff discussion.
- **Design** — the shape of what's being built (interfaces, file layout).
- **TDD implementation order** — the numbered step table (`# | Kind | Step | Model`), grouped by phase, with `M` = the total step count.
- **Testing strategy**, **risks & gotchas**, **progress checkboxes**, **references**.
- The **kickoff trigger** sentence at the end.

## 6. Stop

Produce the plan and stop. **Do not begin implementing** — executing step 1 is a separate, explicit action the human (or the next agent) takes after reviewing the plan.
