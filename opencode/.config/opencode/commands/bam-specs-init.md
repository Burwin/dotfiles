---
description: Author a constitution-init PLAN (1945/1943 shape) for a named scope in any git repo, then post the step-1 trigger. Later steps via /bam-resume. Init only, not amend.
agent: plan
---

Author a constitution-init PLAN for a named scope in any git repo. The flow: resolve the **target** (§1), lock the **ID scheme** (§2), **author the PLAN** (§3), then **post the step-1 kickoff trigger and stop** (§4). One invocation writes the PLAN only. Later steps run via `/bam-resume`.

This command is `agent: plan`. It does not execute the PLAN it writes, and it does not amend: name `/bam-specs-amend` only as out of scope.

$ARGUMENTS   (freeform: scope, prefix, path. Parse what you can.)

Current directory: !`pwd`

## 1. Resolve the target

Parse `$ARGUMENTS` for **scope**, **prefix**, and **path**. For any piece that is missing or ambiguous, ask with the `question` tool, **one at a time**, recommended default first.

- **Path** — default: the current directory (the `Current directory:` line above, from `pwd`). It must be a git repo: run `git rev-parse --show-toplevel` and use that toplevel. If `$ARGUMENTS` names a path, use that path instead (then resolve its git toplevel the same way).
- **Scope** — default: cwd basename, or an obvious package dir the human named.
- **Prefix** — default: a short uppercase 3-5 char token derived from the scope (e.g. `gmail` → `GMAIL`). Confirm it is unused in the target's existing prefix registry.
- **Existing law** — look for `constitution.md` at the target root. **Absent** = first-constitution branch. **Present** = append branch (do not change existing rule text).

Confirm the resolved `{path, scope, prefix, first-vs-append}` before writing anything.

## 2. Lock the ID scheme

Default: **flat** single prefix (MASTER-1945 / MASTER-1943). One heading, IDs `PREFIX-1`, `PREFIX-2`, and so on. Refine is 2-5 batches, sized at harvest.

**Multi-section** is **opt-in**. Ask only if the human requested it or the scope is clearly multi-domain. Then the authored PLAN follows MASTER-1931: section-name gate at harvest, one refine step per section, cap 6 sections.

## 3. Author the PLAN

Write `<target>/docs/plans/<topic>/PLAN.md`. Do not run harvest. The PLAN's step 1 is harvest; this command only authors the PLAN.

- **Topic** — worktree / Asana id if present (`MASTER-NNNN`), else kebab-case scope.
- **Shape** — copy MASTER-1945 / MASTER-1943 structure (or MASTER-1931 if multi-section).
- **Templates** (tools repo, reference only; read before writing):
  - `~/src/bamboo/tools/docs/plans/MASTER-1945/PLAN.md` (primary flat; also `harvest.md`, `draft.md`, `sweep-report.md` beside it)
  - `~/src/bamboo/tools/MASTER-1943/docs/plans/MASTER-1943/PLAN.md` (or the copy on `m` once merged)
  - `~/src/bamboo/tools/docs/plans/MASTER-1931/PLAN.md` (multi-section only)

### Init loop

Encode this loop in the authored PLAN (flat default, provisional M=8). Every step is Grok 4.6.

| # | Label | Model |
| --- | --- | --- |
| 1 | Blurry harvest + count gate + plan renumber | Grok 4.6 |
| 2-5 | Refine batches (≤5 rules/gate; accept / edit / drop / unsure) | Grok 4.6 |
| 6 | Sweep (exceptions only) | Grok 4.6 |
| 7 | Assemble + ratify (one PR) | Grok 4.6 |
| 8 | Fan-out test cards + closeout | Grok 4.6 |

**Count gate.** Step 1 may rewrite steps 2-5 if harvest `n` wants fewer or more rounds. Keep refine in the 2-5 session band.

**Working-doc flow.** `harvest.md` → `draft.md` → `sweep-report.md` → `constitution.md`.

**Harvest source map.** The authored PLAN must list concrete files the harvest step will mine. Build that map from the target itself: README, AGENTS.md, sources, tests, systemd/install, `.env.example`, and any existing `constitution.md`. Do not copy the asana or gmail file lists.

**Quality bar** (into the authored PLAN). Stakeholder-legible; one assertion per rule; EARS-ish (`The <tool> shall …` / `WHEN …, … shall …`); true today against code (`file:line`); unique; scope guard (user-facing / security / money / schedules, not unit-test trivia).

**T:H only.** Tag candidates `[T:x V:y]` (x,y in H/M/L) in working docs only. Ratify requires T:H. V:M/L go to fan-out. Cut aspirational or unbuilt candidates at harvest.

**Fan-out.** Asana MASTER / Client Bamboo / Project Tools when the target is a Bamboo tools-family repo; otherwise list gaps and ask.

### First constitution vs append

**Law file.** Repo-root `constitution.md`.

**First constitution** (no `constitution.md`). Seed the law file with the **conventions** header:

- Rules are immutable. Never edit the text of an existing rule.
- IDs: short uppercase section prefix + sequential number. Never reused.
- Retire with no successor: append `[CANCELLED]`. The line stays forever.
- Replace: old rule gets `[REPLACED_BY: <new-id>]`, new rule gets `[REPLACES: <old-id>]`.
- Prefix registry at the top of the file.
- No extra metadata (dates, authors, reasons, confidence) in the law file.

If the target has `AGENTS.md`, include a constitution-first policy step: `constitution.md` is the source of must-be-true behavior; `AGENTS.md` keeps how/why. When a runbook and a rule disagree, the constitution wins. Must-be-true changes go through the constitution first (same tags, same review gate). One or two PRs; prefer one if small.

**Append** (existing law, append-only). Add a prefix-registry row, update the intro packages-under-law line, and add a new `##` section. Never edit existing rule text.

### Review ergonomics

- ≤5 rules per gate
- tables ≤4 columns
- exceptions-only reports
- verdicts **accept / edit / drop / unsure**
- human full skim only at ratify

## 4. Post the step-1 trigger and stop

Emit the authored PLAN's kickoff trigger (step 1, at the bottom of the PLAN) in the `@rules/plans.md` shape:

> ▶️ Step `N` of `M` — `<label>` — model: `<tier>` — plan:
> `docs/plans/<topic>/PLAN.md`

Tell the human the next move is `/bam-resume` (or paste the trigger into a fresh session). **Stop.** Do not start harvest.

This command does not amend. Name `/bam-specs-amend` only as out of scope (follow-on).
