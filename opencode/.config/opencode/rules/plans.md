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

- **Every step carries a trigger sentence for the _next_ step.** A step is
  complete only after Session-exit step 3: the executing agent **Read**s the
  plan, confirms that step's Progress line is `[x]` on disk, and **only then**
  posts the next step's trigger **verbatim** as the last thing it outputs. The
  human copies it into a fresh session to begin the next step.
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
| **cheap** | `openrouter/cheap` | Mechanical: scaffolding, wiring, renames, boilerplate, tests written to a precise spec, running commands. |
| **premium** | `openrouter/premium` | Hard + mid: judgment, prose/prompts/docs, bounded implementation, risky live-config, deploy + review. |

> Legacy names `Grok Build 0.1` and `Grok 4.6` still map onto cheap and premium. New steps say cheap / premium.

Pick only a tier you're confident can do the step. When torn between two,
choose the stronger one (**premium**) and note why in the step row.

## Human-gated steps

Any step that needs sudo, a TTY, or a human must include `human-gated` in
the label (or model tier). `sudo` in the step body (not `sudo-free`) also
gates even if unmarked. The runner advances only when that step's Progress
box is `[x]` on disk.

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
