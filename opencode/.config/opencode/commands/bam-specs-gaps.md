---
description: "Diff a repo against constitution.md; a live ID is covered only when a test mentions it. Leftover dead-ID mentions are tagged cleanup on the same list. Add unlabeled mentions after one confirm. Lists only; tdd-plan deletes. Handoff (default), list-only, or per-gap. Runnable after init or amend."
agent: build
---

Diff a repo against `constitution.md`. A live ID is covered only when a test mentions that ID. Unlabeled tests that already pin a rule get the ID added after one confirm per run; they are not gaps. True misses stay on the gap list. Leftover mentions of `[CANCELLED]` / `[REPLACED_BY: ...]` IDs are tagged cleanup rows on the same list. The flow: resolve the **target** (§1), set the **scope** (§2), define a **proper test** and **diff each live rule** (§3), **list the gaps** (§4), **ask filing mode** then hand off or file per the pick (§5), then **stop** (§6). Mentions stay the only write. Do not implement missing tests or missing code.

This command is `agent: build`. Runnable after `/bam-specs-init` or `/bam-specs-amend`. It does not init and does not amend. It lists only; `/bam-tdd-plan` does the deletes.

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

Docs and process notes do not count. They qualify only in the rare case where a test really does not make sense, and when that exception is claimed the reason must be stated explicitly. That exception is not coverage: coverage still requires the ID token in a test. Do not invent a mention write for it. Record it as a gap with the stated reason.

Scan `constitution.md` for live IDs. Skip `[CANCELLED]` and `[REPLACED_BY: ...]` for live coverage.

A live rule is covered only if a test mentions that exact ID in the name, fact title, comment, or assert message. Match the ID as a standalone token, not as a substring of a longer ID (HH-1 does not cover HH-10). A stray mention of the exact ID still counts as covered, even if that test does not assert the rule. Inferred behavior without that ID token does not count.

If a test already pins the rule (it asserts the rule) but does not mention the ID, add the mention to that test after one confirm per run. Ask with the `question` tool, recommended default first: one yes/no over the full candidate set (`file:line` for each unlabeled pin). One mention-write ask per run, not per ID. That ask does not replace the §2 scope question or the §5 filing-mode question. Mentions go only onto tests that already assert the rule. The allowed edit is add-only: insert the ID into a test name, fact title, comment, or assert message; do not change test logic. Do not put that rule on the gap list. If the confirm is declined, leave the tests unlabeled: they are not covered and still not a gap; the next run asks again.

Then a second pass over those skipped IDs:

- A leftover pin is an exact mention of that dead ID in a test (name, fact title, comment, or assert message). Unlabeled leftover behavior is not a leftover pin.
- A dead ID with a leftover mention is a cleanup candidate for §4.
- Omit a dead ID with no leftover mention.

With the definition set, diff the law against the repo, one live rule at a time:

- **Search** — for each live rule, read its ID and text, then search the target repo for an automated test that asserts it and for that exact ID in a test name, fact title, comment, or assert message. Search test directories, files matching `*test*` or `*spec*`, validator suites, and CI config.
- **Record** — ID token hit: covered (`file:line`), including a stray mention. Pin without the ID: unlabeled-but-pinning (not a gap; add the mention after the one confirm above). Miss (no pin and no ID-token hit): record the locations searched. One live rule, one verdict. No batching of verdicts. The mention confirm is still one ask over the full candidate set. Do not skip live IDs.

## 4. List the gaps

Emit a gap list.

**Live true-miss rows** — one row per live ID with no ID-token hit (true miss only). Unlabeled-but-pinning never appears here. A claimed rare docs exception still appears, with the stated reason. Each live-miss row carries:

- the rule **ID**
- a one-line **gist** of the rule
- **why** the current coverage does not count
- the **locations searched**

**Tagged cleanup rows** — leftover mentions of dead IDs, on the same list. Each cleanup row carries:

- the dead-ID **ID**
- a one-line **gist**
- **why** it is a leftover mention
- the mention **file:line**
- the **locations searched**

Then stop for §5. Do not file anything before the human picks a mode.

## 5. Filing mode

### 5a. Ask the filing mode

- **Ask every run.** The filing mode is never carried over from a previous run and never assumed. After the gap list, ask the human which mode this run uses.
- **How to ask:** with the `question` tool, **one at a time**, recommended default first. The three options are **handoff** (default, §5b), **list-only**, and **per-gap** cards (§5c).
- **Never file silently.** Do not auto-create anything without an explicit answer. No mode is chosen on the human's behalf, and no filing happens until they pick one.

### 5b. Default: one-plan /bam-tdd-plan handoff

- **Default:** one plan on the current card. The mixed list from §4 goes in one handoff.
- **Live-miss rows:** missing tests plus the code that makes them pass.
- **Cleanup rows:** remove those leftover tests and orphaned production code. Do not add new tests of cancelled/replaced-old text. Living successors stay the new-tests-plus-code path.
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
- **per-gap cards:** resolve the current card first (same as §5b) so creates land in that project. Then file one card per row via `asana_create_tasks`. Live-miss cards: missing tests plus the code that makes them pass. Cleanup cards: remove leftover tests and orphaned production code, not add. This is the only create path.

## 6. Relations + stop

Runnable after `/bam-specs-init` or `/bam-specs-amend`. This command does not init (no new law, no new prefix or section) and does not amend (no `constitution.md` edit). This command never writes a plan file.

- This command lists only.
- Do not implement missing tests or missing code.
- Mentions stay the only write: writing ID mentions into existing tests.
- This command does not delete tests or production code. tdd-plan does the deletes.

Stop after mentions (if any), then the chosen §5 path: the handoff snippet, list-only, or per-gap filing.
