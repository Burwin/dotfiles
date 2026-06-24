---
description: Review an Asana task before starting — resolve it, summarize the ask, surface clarifications/unblockers, and flag whether it has gone stale; then walk the open questions one at a time and offer a /bam-tdd-plan handoff plus an Asana card refresh.
agent: build
---

Review a task before any implementation begins. This is a read-and-think pass: the analysis (§1–§5) and the Q&A (§6) are **read-only by instruction**. §1–§5 produce the report — a go/no-go plus a list of open questions with recommended defaults — and §6 then walks those questions one at a time and records the answers. The only writes this command may make are a **gated plan handoff** and a **gated Asana card refresh** — each only on your explicit go-ahead. It **never edits implementation code**.

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

## 6. Walk the open questions one at a time

With the report on the page, work through the open questions **one at a time** — never as a single batched prompt. For each one, ask with the `question` tool and lead with that question's **recommended default** as the first option, so the default is the obvious pick.

Wait for each answer before moving on to the next question. If the reply is "use the defaults" (or anything equivalent), **short-circuit**: stop asking, adopt the recommended default for every remaining question, and say which defaults you applied. Keep the answers — whether explicit or defaulted — as the outcome of the review.

## 7. Offer the plan handoff

Once the open questions are answered (explicitly or by adopted default), offer — do not assume — to continue with the `/bam-tdd-plan` flow. If the user says yes, hand off by passing the **resolved task** (GID + the §2 summary) plus the **Q&A answers** as context into `/bam-tdd-plan`; that command owns `docs/plans/<topic>/PLAN.md` and the red-green-refactor sequencing.

Do **not** author the plan inline — this command never writes a plan file and never starts a RED/GREEN step. Whether the user accepts or declines the handoff, the review outcome (summary + answers) stands on its own; either way, move on to the card-refresh offer below.

## 8. Offer to refresh the card

Whether or not the plan handoff happened, offer — do not assume — to refresh the Asana card with what this review turned up. Two writes are possible and they are **independent**, so treat them as separate decisions:

- **(a) A plain-text comment** summarizing the outcome — the go/no-go plus the open questions and their answers (explicit or defaulted from §6). Post it with `asana_add_comment` using the plain `text` field (not HTML), and only after the user gives the go-ahead for this comment.
- **(b) A description edit — only when §4 found something concrete.** If, and only if, the staleness check surfaced a concrete fix (a stale assumption, a merged or abandoned reference, a changed decision), offer to correct the task description with `asana_update_tasks` — editing the task's `notes` (plain text), or `html_notes` when the correction needs formatting — and only after the user gives the go-ahead for this edit. If §4 found nothing concrete, do not raise this option at all.

Confirm each separately before writing: the comment and the description edit are two distinct go-aheads, and either may be declined on its own. Even at this final step the command **never edits implementation code** — the only writes it ever makes are this comment and, when warranted, that one description edit. Once each has been accepted or declined, the review is done; stop there.
