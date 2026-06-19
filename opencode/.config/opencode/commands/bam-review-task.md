---
description: Review an Asana task before starting — resolve it, summarize the ask, surface clarifications/unblockers, and flag whether it has gone stale.
agent: plan
---

Review a task before any implementation begins. **Do not write or change code** — this is a read-and-think pass that ends with a go/no-go and a list of open questions with recommended defaults.

## 1. Resolve the task

Target task: $ARGUMENTS

If `$ARGUMENTS` is empty, infer the task from the current worktree directory name (per `AGENTS.md` → "Resolving task references").

Current directory: !`pwd`

Resolution order (from `AGENTS.md`):

1. If the directory name ends in a task id like `SH-264` / `ENG-123` / `MASTER-1804`, that is the task — just confirm the GID.
2. Otherwise use `asana_search_tasks` with the id as the `text` param (it searches the per-project task-number field, not only name/description).
3. If still ambiguous, narrow with `projects_any` filtered to the relevant project.

Confirm the match by `permalink_url` or project membership, **not** by name — the task name usually looks unrelated to the id (e.g. `SH-264` → "Change 'Approve' to 'Complete'").

## 2. Summarize the ask

In 2–4 sentences: what is actually being requested, and what does "done" look like? Note the project/section the task sits in and its current status.

## 3. Clarifications & unblockers

Surface anything that would block or derail the work before it starts:

- Open questions that need a human decision.
- Missing inputs, access, credentials, or dependencies.
- Ambiguities in scope or acceptance criteria.

For every open question, give a **recommended default** so work could proceed even if no answer arrives.

## 4. Staleness check

Has the task gone stale since it was last touched? Compare the last-modified / last-comment dates against the description and decide whether it needs a refresh — assumptions that may no longer hold, references to work that has since merged or been abandoned, or decisions that have changed. Recommend refreshing the task (and what to update) if warranted.

## 5. Output

Produce, in this order:

- **Summary** of the ask.
- **Go / no-go** on starting now.
- **Open questions** — each with a recommended default.
- **Stale?** — yes/no, plus what to refresh if yes.

Stop here. Do **not** begin implementing — that is a separate, explicit step.
