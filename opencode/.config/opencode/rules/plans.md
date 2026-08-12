# Plans

Conventions for multi-step plan docs at `docs/plans/<topic>/PLAN.md`. Loaded on
demand when **authoring or executing** a multi-step plan. See `@rules/workflow.md`
for commit/test cadence, `@rules/documentation.md` for the two-layer doc style,
and the `/bam-tdd-plan` command, which applies these rules to TDD plans.

Plans are executed **one step per fresh LLM session**, to keep each context
window small and cheap. Two conventions make that workflow run: a **trigger
sentence** that hands off to the next step, and a **model tier** naming which
LLM should run each step.

## Trigger sentences

- **Every step carries a trigger sentence for the _next_ step.** When a step
  completes, the executing agent posts the next step's trigger **verbatim** as
  the last thing it outputs. The human copies it into a fresh session to begin
  the next step.
- **Put the kickoff trigger (step 1) at the bottom of the plan** so execution
  starts with one copy-paste.
- **Just the trigger, nothing extra** — it carries only what the next session
  needs to load the plan, find the step, and continue. It is one logical line
  (it may wrap onto two for readability), and the `— plan: <path>` portion is
  required, never dropped.

Canonical shape (`N` = step number, `M` = total step count). `<label>` is the
step label: `<kind>: <title>` for TDD plans (where `<kind>` is `RED` / `GREEN`
/ `REFACTOR`), or just a short `<title>` for other plans:

> ▶️ Step `N` of `M` — `<label>` — model: `<tier>` — plan:
> `docs/plans/<topic>/PLAN.md`

Every trigger has exactly these four parts:

1. **Step `N` of `M`** — how far along we are.
2. **`<label>`** — the step label: `<kind>: <title>` for TDD, or a short
   `<title>` otherwise.
3. **model: `<tier>`** — the friendly tier name (see table), so the human knows
   which model to pick when opening the session.
4. **plan path** — so the session can load the plan and read the step.

## Model tiers

Name a tier for **every** step. Record it in a **Model** column in the plan's
step table and echo it in each trigger. Use the **friendly name** in triggers
and prose; use the **model id** in the model picker and in any command
frontmatter (where `model:` must be a full `provider/model-id`).

| Tier (use in triggers) | Model id (picker / frontmatter) | Use for |
| --- | --- | --- |
| **Grok Build 0.1** | `opencode/grok-build-0.1` | Mechanical: scaffolding, wiring, renames, boilerplate, tests written to a precise spec, running commands. |
| **Grok 4.6** | `xai/grok-4.6` (variant **high**) | Hard + mid: judgment, prose/prompts/docs, bounded implementation, risky live-config, deploy + review. |

Pick only a tier you're confident can do the step. When torn between two,
choose the stronger one and note why in the step row.
