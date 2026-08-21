# `/bam-specs-amend` — constitution amend (MASTER-2002)

**Asana:** MASTER-2002 (GID `1217688995259710`) — Formalize the constitution amend flow (`/bam-specs-amend`)
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217688995259710

## TL;DR

Ship `/bam-specs-amend` in the public dotfiles repo. One invocation starts
from an Asana ticket, asks stakeholder (user-perspective) clarifying
questions, proposes an amendment table, iterates until accepted, then
commits `constitution.md` in the target repo. Amendments only. Never init.

**Done** = `bam-specs-amend.md` + content tests in `commands.test.ts`,
deployed via the existing `commands/` symlink.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-amend.md` (`agent: build`;
  no `model:` pin)
- `describe("bam-specs-amend command")` in
  `opencode/.config/opencode/commands-validate/commands.test.ts`

### Out

- `/bam-specs-init` edits (its tests pin amend as out-of-scope for init)
- Changes to `validate.ts` or `install.sh` (`agent: build` already allowed;
  `commands/` already whole-dir linked)
- A constitution CLI / linter
- Drafting tests for the changed specs
- Fan-out Asana cards
- Opening a PR from this command
- New prefix / new section (that is `/bam-specs-init`)

## Decisions (locked)

From the MASTER-2002 pre-implementation review (comment 2026-08-20):

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Home | Dotfiles: `opencode/.config/opencode/commands/bam-specs-amend.md`. This TDD plan lives at `docs/plans/bam-specs-amend/PLAN.md` in `~/src/dotfiles/MASTER-2002`. Tools repo is reference only. |
| 2 | Runtime | Fresh Asana ticket (high-level feature). Stakeholder/user clarifying Q&A like `/bam-tdd-plan`. Propose a table, iterate until accepted, then commit `constitution.md`. Tests/cards out of scope. |
| 3 | Batch | No numeric cap. Any existing sections. |
| 4 | Missing law / new prefix | Abort and point at `/bam-specs-init`. Never init or append a section. |
| 5 | Land | `git add constitution.md` and commit in the target repo. No PR. |
| 6 | Agent | `agent: build` (edits + commit). No `model:` pin (user picks; recommend Grok 4.6). |
| 7 | On-disk tags | `[CANCELLED]` / `[REPLACED_BY: <id>]` / `[REPLACES: <id>]`. Never edit existing rule text. |
| 8 | Table | Columns: ID, description, action (`add` / `replace with X` / `drop` / `replaces X`). Related replace-pairs adjacent. Else chronological. |

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-amend.md         # NEW
└── commands-validate/commands.test.ts  # extend; validate.ts unchanged
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

### Command shape

```
---
description: Amend constitution.md from an Asana ticket. Stakeholder Q&A,
             propose a table, iterate until accepted, then commit. Never init.
agent: build
---

<intro: live session, ticket → Q&A → table → iterate → commit. Not init.>

$ARGUMENTS   (Asana task id: MASTER-NNNN, GID, or URL; optional path)
Current directory: !`pwd`

## 1. Resolve the ticket
## 2. Resolve the target
## 3. Stakeholder Q&A
## 4. Propose the amendment table
## 5. Iterate until accepted
## 6. Commit constitution.md and stop
```

### §1 Resolve the ticket

Parse `$ARGUMENTS` for an Asana task id (`MASTER-NNNN`, GID, or URL). If
empty, infer from the current worktree directory name (same order as
`AGENTS.md` / `/bam-review-task`). Confirm by `permalink_url` or project
membership, not by name.

The ticket is the high-level feature ask. Do not start amending until the
ticket is resolved.

### §2 Resolve the target

- **Path** default: cwd (`!pwd`), must be a git repo
  (`git rev-parse --show-toplevel`). If `$ARGUMENTS` names a path, use that.
- Require `constitution.md` at the target root.
- **Absent** `constitution.md`, or the change needs a **new prefix / new
  section**: abort. Tell the human to run `/bam-specs-init`. Do not write
  anything.
- Confirm the resolved `{path, ticket}` before asking product questions.

### §3 Stakeholder Q&A

Drill the ticket the way `/bam-tdd-plan` drills a feature: plenty of
clarifying questions, **one at a time** via the `question` tool, recommended
default first.

Ask from the **stakeholder / user** perspective (the same voice as existing
constitution rules), not from an implementation perspective. Do not ask
about tests, file layout, or harnesses.

### §4 Propose the amendment table

Compose a proposed `constitution.md` diff and show it as a table:

| ID | description | action |
| --- | --- | --- |

Action values: `add` / `replace with <id>` / `drop` / `replaces <id>`.

- Related replace-pairs (`replace with` + `replaces`) sit next to each other.
- Otherwise chronological (existing IDs in order, new IDs after).
- On disk: never edit existing rule text. Old line gets `[REPLACED_BY: <new>]`
  or `[CANCELLED]`. New line gets `[REPLACES: <old>]` when it replaces.
- New IDs: next unused number in that prefix.
- No cap. Any existing section. New section = abort to init (already handled
  in §2).

### §5 Iterate until accepted

Offer keep / modify / drop options for the rows. Keep iterating the table
until the human accepts it. Do not commit until they accept.

### §6 Commit and stop

Stage **only** `constitution.md` in the target repo and commit (Conventional
Commits, e.g. `docs(constitution): amend from MASTER-NNNN`). Do not push.
Do not open a PR. Do not write tests. Do not file cards. **Stop.**

### Test shape

New `describe("bam-specs-amend command")` in `commands.test.ts`, mirroring
`readBamSpecsInit()`: load inside each test, `existsSync`,
`validateCommand(...) === []`, frontmatter vs body split. One focused test
per behavior. Each RED hinges on tokens **absent** from the file at that
point.

## Command-content spec (GREEN authoring)

Encode these invariants in the command body. Do not invent new policy.

**Law file:** repo-root `constitution.md`.

**Immutability:** never edit the text of an existing rule. Tags only.

**IDs:** short uppercase prefix + sequential number. Never reused. Next
unused number in the prefix.

**Abort:** missing `constitution.md` or new prefix/section → `/bam-specs-init`.

**Q&A:** `question` tool, one at a time, stakeholder/user perspective,
recommended default first.

**Table:** ID, description, action. Related pairs adjacent. Else
chronological.

**Land:** `git add constitution.md` + commit in the target. No PR, no
tests, no cards.

**Init is out of scope.** Name `/bam-specs-init` only as the abort target.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 19.**

Token discipline: each GREEN must not introduce a *later* test's tokens, or
the next RED will not fail.

### Phase A — scaffold + ticket + target

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | Add `describe("bam-specs-amend command")` to `commands.test.ts`. First test: `bam-specs-amend.md` exists, `validateCommand(...) === []`, frontmatter is `agent: build` with **no** `model:` line. Fails (file absent). | Grok Build 0.1 |
| 2 | GREEN | Create minimal `bam-specs-amend.md`: frontmatter + short intro + `$ARGUMENTS` + `Current directory: !`pwd``. Body must **not** contain: `asana`, `constitution.md`, `table`, `commit`, `bam-specs-init`, `question`. | Grok Build 0.1 |
| 3 | RED | Test: body encodes **ticket resolution** — tokens `/asana/`, `/task/`, `/resolv/`. | Grok Build 0.1 |
| 4 | GREEN | Add **§1 Resolve the ticket** (parse `$ARGUMENTS`; worktree/cwd fallback; confirm via permalink or project). Do **not** add `constitution.md`, `git rev-parse`, `table`, `commit`. | Grok 4.6 |
| 5 | RED | Test: body encodes **target resolution** — tokens `/constitution\.md/`, `/git rev-parse --show-toplevel/`. | Grok Build 0.1 |
| 6 | GREEN | Add **§2a Resolve the target** (cwd default; git toplevel; require `constitution.md`). Do **not** add `bam-specs-init`, `table`, `commit`, `question`. | Grok 4.6 |
| 7 | RED | Test: body **aborts to init** — tokens `/bam-specs-init/`, `/abort\|never init\|do not re-init/`. | Grok Build 0.1 |
| 8 | GREEN | Add **§2b**: missing law or new prefix/section → abort, point at `/bam-specs-init`. Do **not** add `table`, `commit`, `question`. | Grok 4.6 |

### Phase B — Q&A + table + commit

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 9 | RED | Test: body drives **stakeholder Q&A** — tokens `/one at a time/`, `/`question` tool/`, `/stakeholder\|user perspective/`. | Grok Build 0.1 |
| 10 | GREEN | Add **§3 Stakeholder Q&A** (user-perspective questions; recommended default first). Do **not** add table columns (`action`, `replace with`) or `commit`. | Grok 4.6 |
| 11 | RED | Test: body encodes the **amendment table** — tokens `/id/`, `/description/`, `/action/`, `/replace/`. | Grok Build 0.1 |
| 12 | GREEN | Add **§4 Propose the amendment table** (columns; related pairs adjacent; chronological else; on-disk `[CANCELLED]` / `[REPLACED_BY]` / `[REPLACES]`; never edit existing rule text). Do **not** add `git commit` / `git add`. | Grok 4.6 |
| 13 | RED | Test: body **iterates until accepted** — tokens `/iterate/`, `/accept/`. | Grok Build 0.1 |
| 14 | GREEN | Add **§5 Iterate until accepted** (keep / modify / drop rows; loop until the human accepts the table). Do **not** add `git commit` / `git add`. | Grok 4.6 |
| 15 | RED | Test: body **commits constitution.md and excludes tests/cards** — tokens `/git add/`, `/commit/`, `/tests/` (out of scope), `/cards/` (out of scope). | Grok Build 0.1 |
| 16 | GREEN | Add **§6 Commit constitution.md and stop** (stage only that file; Conventional Commits; no push, no PR, no tests, no cards). | Grok 4.6 |
| 17 | REFACTOR | Coherence pass on intro + §1–§6 and the test block. Suite stays green. No behavior change. | Grok 4.6 |

### Phase C — verify + deploy

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 18 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode. Smoke `/bam-specs-amend` against a throwaway ticket/path far enough to confirm ticket + target resolution (stop before any commit). Confirm the command surfaces in the TUI. | Grok 4.6 |
| 19 | DEPLOY | Per `@rules/workflow.md`: squash to one Conventional-Commits commit, push, PR → base **`m`**, `/bam-copilot-loop` until "no new comments". No `.github/workflows/` here; local suite is the merge gate. Merge on explicit confirm. Fast-forward main checkout, restart opencode, live re-smoke. | Grok 4.6 |

## Testing strategy

- Content suite is the TDD seam. `validate.test.ts` and sibling command
  blocks stay green.
- No validator or installer change.
- Interactive bits (question flow, table iterate, commit) are smoke-only
  at step 18. Do not commit against a real constitution during smoke.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Token leak makes a later RED pass | Each GREEN lists forbidden tokens. Do not draft ahead. |
| Command inits a constitution | §2b abort + test 7 pins `/bam-specs-init/` as abort-only. |
| Accidental PR / tests / cards | §6 + test 15 pin those as out of scope. |
| Commit of extra files | §6 stages only `constitution.md`. |
| Tools vs dotfiles mixup | This plan executes only in `~/src/dotfiles/MASTER-2002`. |
| Restart required | opencode loads commands at startup. |
| Live commit during smoke | Step 18 stops before §6. |

## Progress

- [x] Phase A — scaffold + ticket + target (steps 1–8)
- [x] Phase B — Q&A + table + commit (steps 9–17)
- [x] Step 18 VERIFY (suite 38/38; worktree `OPENCODE_CONFIG_DIR` loads `/bam-specs-amend` `agent: build`; smoke resolved MASTER-2002 + throwaway path `{path, ticket}` then stopped, no commit; abort path with no `constitution.md` points at `/bam-specs-init`. Remaining gate: live `~/.config/opencode/commands` still points at main, so TUI re-smoke folds into step 19.)
- [ ] Step 19 DEPLOY

(Partial: step 18 VERIFY done; next is 19 DEPLOY)

## References

- Card: MASTER-2002 + review comment 2026-08-20 (Q&A locks)
- Sibling: `docs/plans/bam-specs-init/PLAN.md` (MASTER-1988)
- Precedent: `opencode/.config/opencode/commands/bam-specs-init.md` +
  `commands-validate/commands.test.ts`
- Ticket resolution: `opencode/.config/opencode/commands/bam-review-task.md`
- Q&A shape: `/bam-tdd-plan` (stakeholder clarifying questions)
- Law conventions: `~/src/bamboo/tools/constitution.md` (reference)
- Tiers: `@rules/plans.md`

---

▶️ Step `19` of `19` — `DEPLOY: squash, PR → m, copilot-loop, merge on confirm, ff + live re-smoke` — model: `Grok 4.6` — plan:
`docs/plans/bam-specs-amend/PLAN.md`
