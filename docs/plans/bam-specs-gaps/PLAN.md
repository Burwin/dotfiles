# `/bam-specs-gaps` — constitution gaps flow (MASTER-2029)

**Asana:** MASTER-2029 (GID `1218127838174855`) — Formalize the constitution gaps flow (`/bam-specs-gaps`)
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218127838174855
**Plan path:** `docs/plans/bam-specs-gaps/PLAN.md`
**Worktree:** `~/src/dotfiles/MASTER-2029`

## TL;DR

Ship `/bam-specs-gaps` in the public dotfiles repo. One invocation diffs a target repo against its `constitution.md`, finds rules with no proper test, lists the gaps, asks filing mode each run (default: one plan on the current card), then files cards for the missing tests plus the code that makes them pass. This is the missing fan-out step that amend deliberately does not do; runnable after init or amend.

**Done** = `bam-specs-gaps.md` + content tests in `commands.test.ts`, deployed via the existing `commands/` symlink. No validator or installer change.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-gaps.md` (`agent: build`; no `model:` pin)
- `describe("bam-specs-gaps command")` in `opencode/.config/opencode/commands-validate/commands.test.ts`

### Out

- Edits to `/bam-specs-init` or `/bam-specs-amend` (their tests already pin amend as stop-after-commit; this command references them only as predecessors / abort target)
- Changes to `validate.ts` or `install.sh` (`agent: build` already allowed; `commands/` already whole-dir linked)
- A constitution CLI / linter or automated coverage prover
- Implementing the missing tests or the missing code from this command (cards only)
- Opening a PR from this command

## Decisions (locked)

From the MASTER-2029 kickoff (§2 summary + Q&A):

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Home | Dotfiles: `opencode/.config/opencode/commands/bam-specs-gaps.md` alongside init/amend, plus `commands-validate` tests. This TDD plan lives at `docs/plans/bam-specs-gaps/PLAN.md` in `~/src/dotfiles/MASTER-2029`. |
| 2 | Sibling relation | Sibling of MASTER-1988 (init, DONE) and MASTER-2002 (amend, DONE). Amend stops after the law commit and does not fan out tests; this command is that missing step, runnable after init or amend. |
| 3 | Filing default | (a) one plan on the current card. |
| 4 | Proper test | Automated test asserting the rule in almost all cases. Docs/process notes count only in rare cases where tests really do not make sense. |
| 5 | Runtime | List gaps, then ask filing mode each run (defaulting to current-card plan). Do not auto-create silently. |
| 6 | Scope | Whole `constitution.md` each run, with optional prefix/section filter for large repos. |
| 7 | Go / stale | Go: yes. Stale: no (created/modified 2026-09-03, TODO to IN PROGRESS today). |
| 8 | Agent | `agent: build` (reads repo + files Asana cards). No `model:` pin (user picks; recommend Grok 4.6). Rationale: filing via `asana_create_tasks` is a write action, same class as `bam-review-task` and `bam-specs-amend` which are both `build`. |
| 9 | Tiers in this plan | Grok 4.6 (judgment / prose) and Grok Build 0.1 (mechanical / tests-to-spec), per `@rules/plans.md`. |

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-gaps.md          # NEW
└── commands-validate/commands.test.ts  # extend; validate.ts unchanged
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

### Command shape

```
---
description: Diff a repo against constitution.md, list rules with no proper
             test, then file cards for the missing tests + the code that
             makes them pass. Runnable after init or amend.
agent: build
---

<intro: gap-finder + cards only, runnable after init/amend, stops after filing>

$ARGUMENTS   (optional path; optional prefix/section filter)
Current directory: !`pwd`

## 1. Resolve the target
## 2. Set the scope (whole law + optional filter)
## 3. Define proper test + diff each rule
## 4. List the gaps and stop for filing mode
## 5. File cards (default: one plan on the current card)
## 6. Relations + stop
```

### §1 Resolve the target

- **Path** default: cwd (`!pwd`), must be a git repo (`git rev-parse --show-toplevel`). If `$ARGUMENTS` names a path, use that.
- Require `constitution.md` at the target root.
- **Absent** `constitution.md`: abort, point at `/bam-specs-init`. Do not write anything. Never init.
- Confirm `{path}` before scanning.

### §2 Scope

- Default: whole `constitution.md` every run.
- Optional filter for large repos: prefix (e.g. `GMAIL`) or section name. Parse from `$ARGUMENTS`; if ambiguous ask via `question` tool. Filter narrows which rules are diffed, never rewrites the law.

### §3 Proper test + diff

Proper test = an automated test that asserts the rule holds in almost all cases (unit, integration, content/validator test such as `commands.test.ts`, systemd-timer check, CLI smoke with assertion). Docs/process notes count only in the rare case where a test really does not make sense; when claimed, the gap entry must say why.

Diff procedure per rule: read the rule ID + text, search the repo (tests dirs, `*test*`, validator suites, CI config) for an automated assertion of that rule, record hit with `file:line` or miss with searched locations. One rule, one verdict.

### §4 List the gaps

Emit a gap list (one row per rule with no proper test): ID, rule gist, why current coverage does not count, locations searched. Then stop for §5. Do not file anything before the human picks a mode.

### §5 Filing

Ask filing mode every run with the `question` tool, one at a time, recommended default first. Default: **one plan on the current card** covering the missing tests plus the code that makes them pass. Alternatives offered at runtime include list-only (no filing) and per-gap cards; the test pins only the default + test-and-code card shape, not the full alternative set. Resolve the current card the same way as amend §1 (worktree dirname, else `asana_search_tasks` with the id as `text`, confirm by `permalink_url` or project membership, not by name). File via `asana_create_tasks`. Do not auto-create silently. Do not implement the tests or code in this command.

### §6 Relations + stop

Runnable after `/bam-specs-init` or `/bam-specs-amend`. This command does not init (no new law, no new prefix/section) and does not amend (no `constitution.md` edit). It does not write tests or source; cards only. **Stop** after filing (or after list-only if the human chose no filing).

### Test shape

New `describe("bam-specs-gaps command")` in `commands.test.ts`, mirroring `readBamSpecsAmend()`: load inside each test, `existsSync`, `validateCommand(...) === []`, frontmatter vs body split. One focused test per behavior. Each RED hinges on tokens absent from the file at that point.

## Command-content spec (GREEN authoring)

Encode these invariants in the command body. Do not invent new policy.

**Law file:** repo-root `constitution.md`.

**Target:** cwd default + `git rev-parse --show-toplevel`; missing law aborts to `/bam-specs-init`, writes nothing.

**Scope:** whole law each run; optional prefix/section filter for large repos.

**Proper test:** automated test asserting the rule in almost all cases; docs-only in rare no-test-sense cases with a stated why.

**Gap list:** ID + gist + why-not-covered + searched locations; listed before any filing.

**Filing:** `question` tool, one at a time, ask every run, default one plan on current card, never silent auto-create. Card(s) cover both the missing test and the code that makes it pass. Current-card resolution via worktree/`asana_search_tasks` + `permalink_url`/membership confirm.

**Relations:** runnable after init/amend; inits nothing; amends nothing; implements nothing; stops after filing.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 19.**

Token discipline: each GREEN must not introduce a later test's tokens, or the next RED will not fail. Forbidden-token lists below are normative.

### Phase A — scaffold + target + scope

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | Add `describe("bam-specs-gaps command")` to `commands.test.ts`. First test: `bam-specs-gaps.md` exists, `validateCommand(...) === []`, frontmatter is `agent: build` with no `model:` line. Fails (file absent). | Grok Build 0.1 |
| 2 | GREEN | Create minimal `bam-specs-gaps.md`: frontmatter + short intro + `$ARGUMENTS` + `Current directory: !pwd`. Body must not contain: `constitution.md`, `gap`, `proper`, `filter`, `filing`, `cards`, `bam-specs-init`, `bam-specs-amend`, `question`. | Grok Build 0.1 |
| 3 | RED | Test: body encodes target resolution — tokens `/constitution\.md/`, `/git rev-parse --show-toplevel/`, `/bam-specs-init/` (abort target). | Grok Build 0.1 |
| 4 | GREEN | Add §1 Resolve the target (cwd default; git toplevel; require `constitution.md`; absent law aborts to `/bam-specs-init`, writes nothing). Do not add `filter`, `proper`, `gap`, `filing`, `cards`, `question`. | Grok 4.6 |
| 5 | RED | Test: body encodes scope — tokens `/whole/`, `/prefix/`, `/section/`, `/filter/`. | Grok Build 0.1 |
| 6 | GREEN | Add §2 Scope (whole law each run; optional prefix/section filter for large repos). Do not add `proper`, `automated`, `gap`, `filing`, `cards`. | Grok 4.6 |

### Phase B — proper test + gap list

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 7 | RED | Test: body defines proper test — tokens `/automated/`, `/assert/`, `/rare/`. | Grok Build 0.1 |
| 8 | GREEN | Add §3a proper-test definition (automated assertion in almost all cases; docs-only rare with stated why). Do not add `gap` list shape, `filing`, `cards`, `` `question` tool``. | Grok 4.6 |
| 9 | RED | Test: body diffs and lists gaps — tokens `/gap/`, `/list/`, `/searched\|locations searched/`. | Grok Build 0.1 |
| 10 | GREEN | Add §3b/§4 diff + list (per-rule search of tests/suites/CI; gap row = ID + gist + why-not-covered + searched locations). Do not add `filing`, `cards`, `` `question` tool``, `current card`. | Grok 4.6 |
| 11 | RED | Test: body asks filing mode without silent auto-create — tokens <code>/`question` tool/</code>, `/one at a time/`, `/filing/`, `/silently\|do not auto-create/`. | Grok Build 0.1 |
| 12 | GREEN | Add §5a ask filing mode each run (`question` tool one at a time, recommended default first; never file silently). Do not add `current card`, `one plan`, `asana_create_tasks`. | Grok 4.6 |

### Phase C — cards + stop + verify + deploy

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 13 | RED | Test: body files the default card covering test+code — tokens `/current card/`, `/one plan/`, `/asana_create_tasks/`, `/code/` (code that makes the test pass). | Grok Build 0.1 |
| 14 | GREEN | Add §5b file (default one plan on the current card for missing tests + code that makes them pass; current-card resolution via worktree / `asana_search_tasks` + `permalink_url`/membership; list-only alternative offered, no silent path). Do not add `bam-specs-init`/`bam-specs-amend` relation prose or `stop` finale. | Grok 4.6 |
| 15 | RED | Test: body states relations + stop — tokens `/bam-specs-init/`, `/bam-specs-amend/`, `/runnable after/`, `/stop/`, `/do not implement\|cards only/`. | Grok Build 0.1 |
| 16 | GREEN | Add §6 Relations + stop (runnable after init/amend; inits nothing; amends nothing; implements nothing, cards only; stop after filing or list-only). | Grok 4.6 |
| 17 | REFACTOR | Coherence pass on intro + §1-§6 and the test block. Suite stays green. No behavior change. | Grok 4.6 |
| 18 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode. Smoke `/bam-specs-gaps` against a throwaway path far enough to confirm target + scope + gap-list shape, stopping before any Asana write. Confirm the command surfaces in the TUI. | Grok 4.6 |
| 19 | DEPLOY | Per `@rules/workflow.md`: squash to one Conventional-Commits commit, push, PR with base `m`, `/bam-copilot-loop` until "no new comments". No `.github/workflows/` here; local suite is the merge gate. Merge on explicit confirm. Fast-forward main checkout, restart opencode, live re-smoke. | Grok 4.6 |

## Testing strategy

- Content suite is the TDD seam (`commands.test.ts` + `validate.ts`). `validate.test.ts` and sibling command blocks stay green throughout.
- No validator or installer change: `agent: build` already allowed; `install.sh` `FILES` already contains whole-dir `commands`.
- Interactive bits (filter clarify, filing-mode `question`, card confirm) are smoke-only at step 18. Never file a real Asana card during smoke; stop after the gap list.
- Token discipline is the main red-green guard: each GREEN lists forbidden tokens; do not draft ahead.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Token leak makes a later RED pass | Each GREEN lists forbidden tokens. Do not helpfully draft ahead. |
| Command edits law or inits sections | §1 abort + §6 pin init/amend as predecessors only, never actions. |
| Silent card creation | §5a + tests 11/13 pin ask-every-run and no-silent rule. Step 18 stops before any write. |
| Docs claimed as proper test for everything | §3a + test 7 pin automated-first with rare-only docs escape plus stated why. |
| Filter becomes partial-law excuse | §2 pins whole-law default; filter only narrows the diff for large repos. |
| Tools vs dotfiles mixup | This plan executes only in `~/src/dotfiles/MASTER-2029`. Tools constitutions are reference data only. |
| Restart required | opencode loads commands at startup; steps 18-19 include restart + re-smoke. |
| Filing-mode alternatives unscoped | Test pins only the default + test-and-code shape; other modes are offered at runtime, not frozen here. |

## Progress

- [x] Step 1 — RED: bam-specs-gaps.md exists + agent build
- [x] Step 2 — GREEN: minimal bam-specs-gaps.md
- [x] Step 3 — RED: target resolution tokens
- [x] Step 4 — GREEN: resolve the target
- [x] Step 5 — RED: scope tokens
- [x] Step 6 — GREEN: add scope
- [x] Step 7 — RED: proper test tokens
- [x] Step 8 — GREEN: proper-test definition
- [x] Step 9 — RED: gap list tokens
- [x] Step 10 — GREEN: diff and list gaps
- [x] Step 11 — RED: ask filing mode
- [x] Step 12 — GREEN: ask filing mode
- [x] Step 13 — RED: default card covering test+code
- [x] Step 14 — GREEN: file default card
- [x] Step 15 — RED: relations + stop
- [x] Step 16 — GREEN: relations + stop
- [x] Step 17 — REFACTOR: coherence pass
- [x] Step 18 — VERIFY: suite + smoke (suite 46/46; worktree `OPENCODE_CONFIG_DIR` loads `/bam-specs-gaps` `agent: build`; smoke on `/tmp/opencode/bam-specs-gaps-smoke` confirmed `{path}` + whole-law scope + gap-list shape `SMOKE-2` miss / `SMOKE-1` hit `tests/widget.test.ts:2`, stopped before any Asana write; abort path with no `constitution.md` points at `/bam-specs-init`. Remaining gate: live `~/.config/opencode/commands` still points at main, so TUI re-smoke folds into step 19.)
- [ ] Step 19 — DEPLOY: squash, PR, merge

## References

- Card: MASTER-2029 + §2 summary and locked Q&A in the kickoff prompt
- Siblings: `docs/plans/bam-specs-init/PLAN.md` (MASTER-1988), `docs/plans/bam-specs-amend/PLAN.md` (MASTER-2002)
- Precedent: `opencode/.config/opencode/commands/bam-specs-init.md`, `bam-specs-amend.md`, `commands-validate/commands.test.ts`, `validate.ts`, `install.sh` (`commands` whole-dir link)
- Ticket resolution: `opencode/.config/opencode/commands/bam-review-task.md`, amend §1 (`asana_search_tasks` + `permalink_url`)
- Law example (reference only): `~/src/bamboo/tools/constitution.md`
- Conventions: `@rules/plans.md`, `@rules/workflow.md`
- Test command: `bun test ./opencode/.config/opencode/commands-validate/`

---

After each step completes, post the next trigger verbatim.

- After 13 → ▶️ Step 14 of 19 — GREEN: file default card — model: Grok 4.6 — plan: `docs/plans/bam-specs-gaps/PLAN.md`
- After 14 → ▶️ Step 15 of 19 — RED: relations + stop — model: Grok Build 0.1 — plan: `docs/plans/bam-specs-gaps/PLAN.md`
- After 15 → ▶️ Step 16 of 19 — GREEN: relations + stop — model: Grok 4.6 — plan: `docs/plans/bam-specs-gaps/PLAN.md`
- After 16 → ▶️ Step 17 of 19 — REFACTOR: coherence pass — model: Grok 4.6 — plan: `docs/plans/bam-specs-gaps/PLAN.md`
- After 17 → ▶️ Step 18 of 19 — VERIFY: suite + smoke — model: Grok 4.6 — plan: `docs/plans/bam-specs-gaps/PLAN.md`
- After 18 → ▶️ Step 19 of 19 — DEPLOY: squash, PR, merge — model: Grok 4.6 — plan: `docs/plans/bam-specs-gaps/PLAN.md`

▶️ Step 13 of 19 — RED: default card covering test+code — model: Grok Build 0.1 — plan: `docs/plans/bam-specs-gaps/PLAN.md`
