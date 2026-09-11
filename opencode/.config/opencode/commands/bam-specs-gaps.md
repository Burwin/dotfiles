---
description: Diff a repo against constitution.md; a live ID is covered only when a test mentions it. Add unlabeled mentions after one confirm. True misses: handoff (default), list-only, or per-gap. Runnable after init or amend.
agent: build
---

Diff a repo against `constitution.md`. A live ID is covered only when a test mentions that ID. Unlabeled tests that already pin a rule get the ID added after one confirm per run; they are not gaps. True misses stay on the gap list and use §5 (handoff default, list-only, or per-gap). The flow: resolve the **target** (§1), set the **scope** (§2), define a **proper test** and **diff each live rule** (§3), **list the gaps** (§4), **ask filing mode** then hand off or file per the pick (§5), then **stop** (§6). Do not implement missing tests or missing code.

This command is `agent: build`. Runnable after `/bam-specs-init` or `/bam-specs-amend`. It does not init and does not amend.

$ARGUMENTS   (optional path; optional prefix/section filter)

Current directory: !`pwd`

## 1. Resolve the target

- **Path** — default: the current directory (the `Current directory:` line above, from `pwd`). It must be a git repo: run `git rev-parse --show-toplevel` and use that toplevel. If `$ARGUMENTS` names a filesystem path, use that path instead (then resolve its git toplevel the same way).
- **Law file** — require `constitution.md` at the target root. This command audits existing law only.
- **Abort** — if `constitution.md` is missing, abort. Tell the human to run `/bam-specs-init`. Do not write anything. Never init.

Confirm the resolved `{path}` before scanning.

## 2. Set the scope

- **Default:** the whole `constitution.md`, every run. The audit covers every rule in the law; nothing is exempt by default.
- **Optional filter, for large repos:** `$ARGUMENTS` may also carry a rule prefix (e.g. `GMAIL`) or a section name. Parse it from the arguments alongside the path.
- **Ambiguity:** if an argument could be a path, a prefix, or a section name, ask the human which they meant via the `question` tool, **one at a time**, recommended default first, before scanning.
- **The filter never rewrites the law:** it only narrows which rules this run examines. No edits to `constitution.md`, and no new prefixes or sections.

## 3. Define a proper test, then diff each live rule

A **proper test** is an automated test that asserts the rule holds in almost all cases. Any of these shapes can be a proper test: a unit test, an integration test, a content/validator test (e.g. `commands.test.ts`), a systemd-timer check, or a CLI smoke run with an assertion.

Docs and process notes do not count. They qualify only in the rare case where a test really does not make sense, and when that exception is claimed the reason must be stated explicitly.

Scan `constitution.md` for live IDs. Skip `[CANCELLED]` and `[REPLACED_BY]`.

A live rule is covered only if a test mentions that exact ID in the name, fact title, comment, or assert message. Inferred behavior without that ID token does not count.

If a test already pins the rule (it asserts the rule) but does not mention the ID, add the mention to that test after one confirm per run. Ask with the `question` tool, recommended default first. One ask per run, not per ID. Mentions go only onto tests that already assert the rule. Do not put that rule on the gap list.

With the definition set, diff the law against the repo, one live rule at a time:

- **Search** — for each live rule, read its ID and text, then search the target repo for an automated test that asserts it and for that exact ID in a test name, fact title, comment, or assert message. Search test directories, files matching `*test*`, validator suites, and CI config.
- **Record** — ID token hit: covered (`file:line`). Pin without the ID: unlabeled-but-pinning (not a gap; add the mention after the one confirm above). Miss (no pin): record the locations searched. One live rule, one verdict. No batching. Do not skip live IDs.

## 4. List the gaps

Emit a gap list: one row per live ID with no proper test (true miss only). Unlabeled-but-pinning never appears here. Each row carries:

- the rule **ID**
- a one-line **gist** of the rule
- **why** the current coverage does not count
- the **locations searched**

Then stop for §5. Do not file anything before the human picks a mode.

## 5. Filing mode

### 5a. Ask the filing mode

- **Ask every run.** The filing mode is never carried over from a previous run and never assumed. After the gap list, ask the human which mode this run uses.
- **How to ask:** with the `question` tool, **one at a time**, recommended default first. The three options are **handoff** (default, §5b), **list-only**, and **per-gap** cards (§5c).
- **Never file silently.** Do not auto-create anything without an explicit answer. No mode is chosen on the human's behalf, and no filing happens until they pick one.

### 5b. Default: one-plan /bam-tdd-plan handoff

- **Default:** one plan on the current card. That plan covers the missing tests plus the code that makes them pass.
- **Resolve the current card** the same way as `/bam-specs-amend` §1:
  1. If the worktree directory name ends in a task id (`MASTER-NNNN` or similar), that is the card. Confirm the GID and summary.
  2. If the worktree name has no task id, ask for a task id or permalink via the `question` tool before searching. Do not guess. `$ARGUMENTS` is path/filter only, not a task id.
  3. If given a permalink, extract the GID from the URL and fetch the task (`asana-task-get` / `asana_get_task`). Do not pass the URL to `asana_search_tasks`. Read the task-number field for `{TASK-ID}`.
  4. If given a task id, use `asana_search_tasks` with that id as the `text` param (it searches the per-project task-number field, not only name).
  5. If still ambiguous, narrow with `projects_any` filtered to the relevant project.
  Confirm the match by `permalink_url` or project membership, not by name. The card name usually looks unrelated to the id. Fetch GID and summary either way so the snippet can be formed.
- **Handoff:** when the human picks handoff in §5a, emit a copy-paste `/bam-tdd-plan` prompt for a **fresh session**. Do **not** author the plan inline. This command never writes a `PLAN.md` and never creates a plan subtask. Do not invoke `/bam-tdd-plan` in this session.
- **Snippet payload:** `/bam-tdd-plan {TASK-ID} (GID {gid}): {summary}`, plus the gap list from §4.

### 5c. Alternatives

- **list-only:** stop after the gap list. No snippet, no cards.
- **per-gap cards:** resolve the current card first (same as §5b) so creates land in that project. Then file one card per gap via `asana_create_tasks` (test + code per gap). This is the only create path.

## 6. Relations + stop

Runnable after `/bam-specs-init` or `/bam-specs-amend`. This command does not init (no new law, no new prefix or section) and does not amend (no `constitution.md` edit). Do not implement missing tests or missing code. Writing ID mentions into existing tests is the allowed write. This command never writes a plan file.

Stop after mentions (if any), then the chosen §5 path: the handoff snippet, list-only, or per-gap filing.
