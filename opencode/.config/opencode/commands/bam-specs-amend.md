---
description: Amend constitution.md from an Asana ticket. Stakeholder Q&A, propose a table, iterate until accepted, then commit. Never init.
agent: build
---

Amend `constitution.md` from an Asana ticket. The flow: resolve the **ticket** (§1), resolve the **target** (§2), **stakeholder Q&A** (§3), **propose the amendment table** (§4), **iterate until accepted** (§5), then **commit constitution.md and stop** (§6). Amendments only. Never init.

This command is `agent: build`. It amends existing law only. Name `/bam-specs-init` only as the abort target.

$ARGUMENTS   (Asana task id: MASTER-NNNN, GID, or URL; optional path)

Current directory: !`pwd`

## 1. Resolve the ticket

Parse `$ARGUMENTS` for an Asana task id (`MASTER-NNNN`, GID, or URL). If `$ARGUMENTS` is empty, infer the task from the current worktree directory name (same order as `AGENTS.md` / `/bam-review-task`).

Resolution order:

1. If the directory name ends in a task id like `MASTER-2002`, that is the task. Confirm the GID.
2. Otherwise use `asana_search_tasks` with the id as the `text` param (it searches the per-project task-number field, not only name).
3. If still ambiguous, narrow with `projects_any` filtered to the relevant project.

Confirm the match by `permalink_url` or project membership, not by name. The task name usually looks unrelated to the id.

The ticket is the high-level feature ask. Do not start amending until the ticket is resolved.

## 2. Resolve the target

- **Path** — default: the current directory (the `Current directory:` line above, from `pwd`). It must be a git repo: run `git rev-parse --show-toplevel` and use that toplevel. If `$ARGUMENTS` names a filesystem path, use that path instead (then resolve its git toplevel the same way).
- **Law file** — require `constitution.md` at the target root. This command amends existing law only.
- **Abort** — if `constitution.md` is missing, or the change needs a new prefix or a new section, abort. Tell the human to run `/bam-specs-init`. Do not write anything. Never init. Do not re-init.

Confirm the resolved `{path, ticket}` before asking product questions.

## 3. Stakeholder Q&A

Drill the ticket the way `/bam-tdd-plan` drills a feature. Ask plenty of clarifying questions with the `question` tool, **one at a time**, recommended default first.

Ask from the **stakeholder / user perspective** (the same voice as existing constitution rules), not from an implementation perspective. Do not ask about tests, file layout, or harnesses.

## 4. Propose the amendment table

Compose a proposed `constitution.md` diff and show it as a table:

| ID | description | action |
| --- | --- | --- |

Action values: `add` / `replace with <id>` / `drop` / `replaces <id>`.

- Related replace-pairs (`replace with` + `replaces`) sit next to each other.
- Otherwise chronological: existing IDs in order, new IDs after.
- On disk, never edit existing rule text. Tags only. Old line gets `[REPLACED_BY: <new>]` or `[CANCELLED]`. New line gets `[REPLACES: <old>]` when it replaces.
- IDs: short uppercase prefix + sequential number. Never reused. New IDs are the next unused number in that prefix.
- No cap. Any existing section. A new section is already an abort (see §2).
- Description is the actual constitution line that will land on disk, not a shorthand paraphrase.
- Put the tags that will be written in that cell: `add` is the new sentence(s); `replace with <id>` is the old sentence(s) plus `[REPLACED_BY: <new>]`; `replaces <id>` is the new sentence(s) plus `[REPLACES: <old>]`; `drop` is the old sentence(s) plus `[CANCELLED]`.
- If the line contains `|`, write it as `\|` so the markdown table holds.

## 5. Iterate until accepted

Offer keep / modify / drop options for the rows. Apply the human's changes and show the table again. Keep iterating until the human accepts the table. Do not commit until they accept.

## 6. Commit constitution.md and stop

From the git toplevel resolved in §2 (`git rev-parse --show-toplevel`), stage **only** `constitution.md`: `git add constitution.md`. Run the add from that toplevel so a subdirectory cwd cannot miss or mis-stage the file. Commit with Conventional Commits, e.g. `docs(constitution): amend from MASTER-NNNN`. Do not push. Do not open a PR. Tests and cards are out of scope: do not write tests, do not file cards. **Stop.**
