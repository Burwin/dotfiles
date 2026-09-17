# Copilot loop: escalate constitution / user-visible suggestions (MASTER-2050)

**Asana:** MASTER-2050 (GID `1218544467298175`) — Clarify Copilot review process: escalate (do not auto-accept) Copilot recommendations that would require a constitution.md amendment or significantly change user-visible functionality
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218544467298175
**Plan path:** `docs/plans/copilot-loop-escalate/PLAN.md`
**Worktree:** `~/src/dotfiles/MASTER-2050`

## TL;DR

`/bam-copilot-loop` currently treats every new Copilot comment as in-loop
work ("triage them, make real fixes"). That auto-accepts suggestions that
would amend `constitution.md` or change user-visible CLI/API/UX. Add an
explicit escalate guard so the loop pauses and hands those to a human.

**Done** = guard in `AGENTS.md` (canonical) + `bam-copilot-loop.md` §6 +
one-line exception in `bam-deploy-dev.md`. No new tests (locked). Existing
`commands.test.ts` stays green. Deploy via the existing `commands/` and
`AGENTS.md` symlinks.

## Goal & scope

### In

- `opencode/.config/opencode/AGENTS.md` → section `## GitHub Copilot review re-trigger` (new subsection at the end of that section, before `## Plans`)
- `opencode/.config/opencode/commands/bam-copilot-loop.md` §6, plus the one intro sentence that currently says the command exits only when clean
- `opencode/.config/opencode/commands/bam-deploy-dev.md` one-line exception (in §4 handoff and/or §5 gate; see Design)

### Out

- New tests in `commands.test.ts` (review lock 4)
- Sibling MASTER-2051 (Copilot success phrases: "Approval recommended" / "0 new")
- `workflow.md` "Review comments" (report-only; not the loop)
- `validate.ts`, `install.sh`, `opencode.json`
- Editing any `constitution.md`
- Changing the clean-exit phrase this card does not own

## Decisions (locked)

From the MASTER-2050 pre-implementation review (comment 2026-09-16):

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Where | Guard in `AGENTS.md` (canonical) + `bam-copilot-loop.md` §6 + a one-line exception in `bam-deploy-dev.md`. |
| 2 | Escalate vs stay | Escalate if the suggestion would amend `constitution.md`, change user-visible behavior (CLI/API/UX), or change a test pinned to a constitution rule. Stay in-loop for nits, docs, internal refactors, and tests not pinned to a constitution rule. |
| 3 | On escalate | Reply that it is out of loop (needs human/constitution decision). Do not implement. Do not dismiss. Stop **blocked**, not clean. Do not re-request until the human decides. |
| 4 | Tests | Prose only. No new tests. MASTER-2051 out of scope. |

Inferred, do not relitigate:

| # | Topic | Lock |
| --- | --- | --- |
| 5 | Mixed comments | If some comments are in-loop and some escalate: fix the in-loop ones, reply `Fixed in <sha>`, reply out-of-loop on the escalate ones, then stop blocked. Do not re-request. |
| 6 | Pinned test | "Test pinned to a constitution rule" means the test names a constitution ID, or is otherwise the pin for that rule. |
| 7 | Placement | Canonical text lives **inside** `## GitHub Copilot review re-trigger` (new `### Escalate, do not auto-accept` subsection after the etiquette paragraph). Do not add a sibling H2. `bam-copilot-loop.md` already points at that H2. |
| 8 | Ship together | Do not merge after step 1 or 2. The three files land in one deploy. |

## Design

```
opencode/.config/opencode/
├── AGENTS.md                         # canonical guard (always-loaded)
├── commands/bam-copilot-loop.md      # §6 operational copy
└── commands/bam-deploy-dev.md        # one-line blocked ≠ clean
```

Live `~/.config/opencode/AGENTS.md` is a symlink to the **main** checkout,
not this worktree. Edit only the worktree copies. Commands are a whole-dir
link (install.sh `FILES`). Do not run `install.sh` from this worktree.

Run after the edits: `bun test ./opencode/.config/opencode/commands-validate/`

Existing pins that must stay green (do not drop these tokens):

- `bam-copilot-loop`: `@copilot`, `graphql`, `botids`, `no new comments`
- `bam-deploy-dev`: `commit`, `push`, `\bpr\b|pull request`, `base branch`, `copilot`, `merge`

### `AGENTS.md` authoring spec (step 1)

Keep the re-trigger mechanics, validation gotchas, loop-exit signal, and
reply-then-re-request etiquette as they are. After the etiquette paragraph,
still under `## GitHub Copilot review re-trigger`, add:

```
### Escalate, do not auto-accept

Copilot suggestions are not auto-accepted when they would change law or
user-visible behavior. Triage each new comment before implementing.

Escalate (do not implement inside the loop) if the suggestion would:
- amend `constitution.md`
- change user-visible behavior (CLI, API, or UX)
- change a test pinned to a constitution rule (the test names a
  constitution ID, or is otherwise the pin for that rule)

Stay in-loop for nits, docs, internal refactors, and tests not pinned
to a constitution rule.

On escalate:
- Reply on the inline comment that it is out of loop and needs a human
  / constitution decision. Do not implement. Do not dismiss.
- If some comments are in-loop, fix those, reply "Fixed in <sha>", then
  escalate the rest.
- Stop **blocked**, not clean. Do not re-request until the human decides.

Canonical for `/bam-copilot-loop` §6 and `/bam-deploy-dev`.
```

Do not retitle the H2. Do not touch `## Plans` or anything above the
Copilot section.

### `bam-copilot-loop.md` authoring spec (step 2)

**Intro (one sentence).** Today: "exiting only when Copilot's review reads
**generated no new comments**". That fights the new blocked exit. Change
it so the command exits on clean **or** stops blocked (see §6). Keep the
rest of the intro, frontmatter, and §1–§5.

**§6** replace the two-bullet loop with three paths. Keep the "do not
merge" closer. Keep the token `no new comments` on the clean path.

```
## 6. Loop or exit

Triage every new comment against `AGENTS.md` → "GitHub Copilot review
re-trigger" → "Escalate, do not auto-accept" before implementing.

- **In-loop** (nits, docs, internal refactors, tests not pinned to a
  constitution rule) → real fixes, commit, reply "Fixed in <sha>",
  return to **step 2** with the new sha.
- **Escalate** (would amend `constitution.md`, change user-visible
  CLI/API/UX, or change a test pinned to a constitution rule) → reply
  that it is out of loop (needs human/constitution decision). Do not
  implement. Do not dismiss. If mixed, still apply the in-loop fixes
  first. Then **stop blocked** (not clean). Do not re-request until
  the human decides.
- **Clean** → exit when the review body reads **"generated no new
  comments"** (full signal unchanged). Report that clean state so the
  caller (e.g. `/bam-deploy-dev`) can proceed.

Stop at clean or blocked. This command only drives the review. **Do not
merge**; merging is the caller's explicit, separately-confirmed step.
```

Do not change the clean-exit phrase itself (MASTER-2051).

### `bam-deploy-dev.md` authoring spec (step 3)

One exception, not a rewrite. In §4, after the handoff to
`/bam-copilot-loop`, add this line:

```
If the loop stops **blocked** (escalated), that is not clean: do not
merge; wait for the human.
```

Leave §1–§3, §6, and the CI-green bullet in §5 alone. The existing
"Copilot clean = no new comments" bullet in §5 stays true: blocked is
simply not that state.

## TDD implementation order

No RED: review lock 4 forbade a new test. Each step is still a single
move. **M = 5.**

### Phase A — guard prose (not shipped until step 5)

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | GREEN | Edit `AGENTS.md` to the authoring spec above. Do not touch commands. | premium |
| 2 | GREEN | Edit `bam-copilot-loop.md` intro + §6 to the authoring spec. Keep `@copilot` / `graphql` / `botids` / `no new comments`. Do not touch `bam-deploy-dev.md`. | premium |
| 3 | GREEN | Add the one-line blocked exception to `bam-deploy-dev.md` §4. Keep existing deploy tokens. | premium |

### Phase B — verify + deploy

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 4 | VERIFY | `bun test ./opencode/.config/opencode/commands-validate/` green (existing copilot-loop + deploy-dev tests still pass). | cheap |
| 5 | DEPLOY (human-gated) | Per `@rules/workflow.md`: squash to one Conventional-Commits commit, push, PR → base **`m`**, `/bam-copilot-loop`. **Follow this card's escalate rule on this PR's own Copilot comments** (the new text is the point of the PR; it is not live in opencode until merge + restart). Merge on explicit confirm. Fast-forward the main checkout, restart opencode, archive this plan → `docs/archive/opencode/PLAN-copilot-loop-escalate.md`. | premium |

Why premium on 1–3 and 5: prose/prompts/docs plus deploy + review.
Why cheap on 4: run an existing suite.

## Testing strategy

- No new coverage. The content suite is a regression gate only.
- No AGENTS.md content tests exist; do not add one.
- Interactive loop behavior is smoke-only after deploy, on the next real
  Copilot drive. Do not invent a fake Copilot review as part of this card.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Intro still says "exit only when clean" | Step 2 edits that one intro sentence with §6. |
| Existing copilot-loop test goes red | Keep `@copilot`, `graphql`, `botids`, `no new comments` on the clean path. |
| Existing deploy-dev test goes red | Keep `commit` / `push` / PR / `base branch` / `copilot` / `merge`. |
| Command fights AGENTS.md if shipped alone | Decision 8: one deploy, three files. |
| `workflow.md` also talks about Copilot comments | Out of scope (report-only). |
| MASTER-2051 success phrases | Do not change the clean-exit sentence. |
| Live AGENTS.md is a symlink to main, not this worktree | Edit worktree only. ff + restart in step 5. |
| This PR's Copilot loop might suggest user-visible command changes | Step 5 follows the new escalate rule even before merge. |
| Restart required | opencode loads AGENTS.md + commands at startup (step 5). |
| Agent still auto-fixes escalate-class comments | Spell "do not implement" / "do not dismiss" / "stop blocked" / "do not re-request" in both AGENTS.md and §6. |

## Progress

- [x] Step 1 — GREEN: AGENTS.md escalate guard
- [x] Step 2 — GREEN: bam-copilot-loop §6 escalate path
- [x] Step 3 — GREEN: bam-deploy-dev blocked-is-not-clean exception
- [x] Step 4 — VERIFY: commands-validate suite
- [ ] Step 5 — DEPLOY (human-gated): squash, PR → m, copilot-loop, merge on confirm, ff + restart + archive

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

## References

- Card: MASTER-2050 (GID `1218544467298175`)
- Review Q&A: comment `1218557152072046` (2026-09-16)
- Files: `opencode/.config/opencode/AGENTS.md`,
  `opencode/.config/opencode/commands/bam-copilot-loop.md`,
  `opencode/.config/opencode/commands/bam-deploy-dev.md`
- Existing pins: `commands-validate/commands.test.ts`
  `describe("bam-copilot-loop command")` /
  `describe("bam-deploy-dev command")`
- Prose-only precedent: `docs/archive/opencode/PLAN-bam-specs-amend-full-text.md`
- Sibling (out of scope): MASTER-2051
- Tiers: `@rules/plans.md`

---

After each step completes, post the next trigger verbatim.

- After 1 → ▶️ Step 2 of 5 — GREEN: bam-copilot-loop §6 escalate path — model: premium — plan: `docs/plans/copilot-loop-escalate/PLAN.md`
- After 2 → ▶️ Step 3 of 5 — GREEN: bam-deploy-dev blocked-is-not-clean exception — model: premium — plan: `docs/plans/copilot-loop-escalate/PLAN.md`
- After 3 → ▶️ Step 4 of 5 — VERIFY: commands-validate suite — model: cheap — plan: `docs/plans/copilot-loop-escalate/PLAN.md`
- After 4 → ▶️ Step 5 of 5 — DEPLOY (human-gated): squash, PR → m, copilot-loop, merge on confirm, ff + restart + archive — model: premium — plan: `docs/plans/copilot-loop-escalate/PLAN.md`

▶️ Step 1 of 5 — GREEN: AGENTS.md escalate guard — model: premium — plan:
`docs/plans/copilot-loop-escalate/PLAN.md`
