---
description: Diff a repo against constitution.md, list rules with no proper test, then file cards for the missing tests + the code that makes them pass. Runnable after init or amend.
agent: build
---

Diff a repo against `constitution.md`, list rules with no proper test, then file cards for the missing tests plus the code that makes them pass. The flow: resolve the **target** (§1), set the **scope** (§2), define a **proper test** and **diff each rule** (§3), **list the gaps** (§4), **ask filing mode** then **file** (§5), then **stop** (§6). Cards only. Do not implement.

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

## 3. Define a proper test, then diff each rule

A rule counts as covered only when a **proper test** pins it: an automated test that asserts the rule holds in almost all cases. Any of these shapes can be a proper test: a unit test, an integration test, a content/validator test (e.g. `commands.test.ts`), a systemd-timer check, or a CLI smoke run with an assertion.

Docs and process notes do not count. They qualify only in the rare case where a test really does not make sense, and when that exception is claimed the reason must be stated explicitly.

With the definition set, diff the law against the repo, one rule at a time:

- **Search** — for each rule, read its ID and text, then search the target repo for an automated test that asserts it. Search test directories, files matching `*test*`, validator suites, and CI config.
- **Record** — a hit gets `file:line`; a miss gets the locations searched. One rule, one verdict. No batching, no skipping.

## 4. List the gaps

Emit a gap list: one row per rule with no proper test. Each row carries:

- the rule **ID**
- a one-line **gist** of the rule
- **why** the current coverage does not count
- the **locations searched**

Then stop for §5. Do not file anything before the human picks a mode.

## 5. File cards

### 5a. Ask the filing mode

- **Ask every run.** The filing mode is never carried over from a previous run and never assumed. After the gap list, ask the human which mode this run uses.
- **How to ask:** with the `question` tool, **one at a time**, recommended default first. §5b names the default and what gets filed under it.
- **Never file silently.** Do not auto-create anything without an explicit answer. No mode is chosen on the human's behalf, and no filing happens until they pick one.

### 5b. File the default card

- **Default:** one plan on the current card. That plan covers the missing tests plus the code that makes them pass.
- **Resolve the current card** the same way as `/bam-specs-amend` §1:
  1. If the worktree directory name ends in a task id (`MASTER-NNNN` or similar), that is the card. Confirm the GID.
  2. Otherwise use `asana_search_tasks` with the id as the `text` param (it searches the per-project task-number field, not only name).
  3. If still ambiguous, narrow with `projects_any` filtered to the relevant project.
  Confirm the match by `permalink_url` or project membership, not by name. The card name usually looks unrelated to the id.
- **How to file:** `asana_create_tasks`. Filing happens only after the human picks a mode in §5a. There is no silent path.
- **List-only alternative:** offer list-only (no filing) alongside the default. Other modes (for example per-gap cards) may be offered at runtime; they are not the default.

## 6. Relations + stop

Runnable after `/bam-specs-init` or `/bam-specs-amend`. This command does not init (no new law, no new prefix or section) and does not amend (no `constitution.md` edit). Do not implement the missing tests or the missing code; cards only.

**Stop** after filing, or after the gap list if the human chose list-only.
