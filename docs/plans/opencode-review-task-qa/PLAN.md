# `/bam-review-task` interactive ending — Q&A, plan handoff, card refresh (MASTER-1848)

Asana: MASTER-1848 — "/bam-review-task should end by asking me open questions
one at a time"
(https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1215963460966978).
Decisions locked in the card's review comment (2026-06-23).

## Goal

Make `/bam-review-task` finish the job instead of stopping at a report. After
its read-only analysis it should: (1) walk the open questions **one at a time**,
(2) offer to **hand off** a plan to `/bam-tdd-plan`, and (3) offer to **refresh
the Asana card**. All three are additive to the existing review flow; the report
itself is unchanged.

## Scope

**In:**

- Edit `opencode/.config/opencode/commands/bam-review-task.md`: switch
  `agent: plan` → `agent: build`; add an interactive Q&A section, a
  plan-handoff offer, and a card-refresh offer.
- Extend `opencode/.config/opencode/commands-validate/commands.test.ts` with
  assertions pinning the new contract.

**Out:**

- Authoring plan files inline (that's `/bam-tdd-plan`'s job — decision 3).
- Any change to `validate.ts` (build is already an allowed agent; description
  stays non-empty).
- Any change to the other `bam-*` commands or to `install.sh` (`commands/` is
  already whole-dir linked).
- Editing implementation code from inside the command — explicitly forbidden.

## Decisions (locked, from the MASTER-1848 review comment)

1. **Agent → `build`.** Analysis + Q&A stay read-only *by instruction*; the only
   writes are the plan-handoff and card-refresh, each on explicit confirmation;
   it never edits implementation code.
2. **Q&A flow: the `question` tool, one question at a time,** each carrying its
   recommended default so "use defaults" can short-circuit the rest. Do **not**
   add an in-body note about overriding `communication.md`'s consolidated-question
   preference — just implement one-at-a-time.
3. **Plan file: hand off to `/bam-tdd-plan`** (which owns
   `docs/plans/<topic>/PLAN.md`); don't author it inline.
4. **Card refresh: offer (a)** a plain-text comment summarizing outcome +
   answers, **and (b)** a description edit *only* when the staleness check found
   something concrete. Confirm each separately.
5. **Tests: extend `commands.test.ts`** with assertions for the new contract
   (one-at-a-time questioning, plan-handoff offer, card-refresh offer); keep the
   existing `task`/`resolv`/`clarif`/`stale|refresh` tokens + the
   `validateCommand(...) === []` pass.

## Design

### Command shape after the change (`bam-review-task.md`)

```
---
description: …resolve, summarize, surface clarifications, flag staleness, then
             walk the open questions one at a time and offer a plan handoff +
             card refresh.            # non-empty (validator)
agent: build                          # was: plan
---

<intro: read-and-think review; analysis + Q&A are read-only BY INSTRUCTION.
 The only writes this command may make are (1) the /bam-tdd-plan handoff and
 (2) refreshing the Asana card — each only on explicit confirmation. It never
 edits implementation code.>

## 1. Resolve the task            (unchanged)
## 2. Summarize the ask           (unchanged)
## 3. Clarifications & unblockers  (unchanged — open questions w/ defaults)
## 4. Staleness check              (unchanged)
## 5. Output  (the report: summary, go/no-go, open questions, stale?)   (unchanged)
## 6. Walk the open questions one at a time     (NEW)  — `question` tool, singly,
       each with its recommended default; "use defaults" short-circuits.
## 7. Offer the plan handoff                    (NEW)  — offer to continue via
       `/bam-tdd-plan` with the task + answers as context; no inline plan.
## 8. Offer to refresh the card                 (NEW)  — (a) plain-text comment
       (outcome + answers); (b) description edit only if staleness found
       something concrete; confirm each separately; never edit code.
```

### Test shape (`commands.test.ts`)

The existing `describe("bam-review-task command")` test stays **unchanged** — it
remains the regression guard for the old body tokens + `validateCommand(...) ===
[]`, and it keeps passing throughout (the re-authored command retains those
tokens and still validates as a `build` agent). A **new**
`describe("bam-review-task interactive contract (MASTER-1848)")` block adds one
focused test per new behavior. Each RED below adds (or first-fails) exactly one
such test.

**Token traps to avoid (must pick newly-absent tokens to get a clean RED):**
`comment`, `description`, `refresh`, and `question` already appear in today's
body, so they can't drive a red. The newly-absent tokens that force red are:
`agent: build` (frontmatter), `one at a time`, `bam-tdd-plan`, and `confirm`.

Run: `bun test ./opencode/.config/opencode/commands-validate/`.

## TDD implementation order

Each step is a single test **or** a single move — never both. RED = one failing
test for one new behavior; GREEN = the minimal change that makes it pass;
REFACTOR = tidy with the suite green. M = 11.

### Phase A — Interactive contract (red → green → refactor)

| # | Kind | Step | Model |
|---|------|------|-------|
| 1 | RED | In `commands.test.ts`, add a `describe("bam-review-task interactive contract (MASTER-1848)")` block whose first test asserts the frontmatter declares `agent: build` (e.g. `/^agent:\s*build$/m` on raw content). Fails today (`agent: plan`). | Grok Build 0.1 |
| 2 | GREEN | Flip frontmatter `agent: plan` → `agent: build` in `bam-review-task.md`. Test 1 passes; existing `validateCommand(...) === []` stays green (build is allowed). | Grok Build 0.1 |
| 3 | RED | Add a test asserting the body drives **one-at-a-time** Q&A via the `question` tool — newly-absent token `/one at a time/` plus `question`. Fails today. | Grok Build 0.1 |
| 4 | GREEN | Add §6 "Walk the open questions one at a time": right after the report, use the `question` tool to ask each open question singly, each carrying its recommended default, "use defaults" short-circuiting; and reframe the intro/closing to the build-era guard (analysis + Q&A read-only by instruction; only writes are the gated handoff + card refresh; never edit implementation code). Test 3 passes. | Opus 4.8 |
| 5 | RED | Add a test asserting the body offers a **plan handoff** to `/bam-tdd-plan` (token `bam-tdd-plan`), not an inline plan. Fails today. | Grok Build 0.1 |
| 6 | GREEN | Add §7 "Offer the plan handoff": once questions are answered, offer to continue with the `/bam-tdd-plan` flow (passing the resolved task + answers as context); do **not** author the plan inline. Test 5 passes. | GLM 5.2 |
| 7 | RED | Add a test asserting the body offers a **confirmed card refresh** — a plain-text comment plus a conditional description edit (newly-absent token `/confirm/`, alongside `comment` + `description`). Fails today. | Grok Build 0.1 |
| 8 | GREEN | Add §8 "Offer to refresh the card": offer (a) a plain-text Asana comment summarizing outcome + answers, and (b) a description edit **only** when the staleness check found something concrete; confirm each separately before writing; reiterate it never edits implementation code; replace the old plan-era "Stop here / do not implement" closing. Test 7 passes. | Opus 4.8 |
| 9 | REFACTOR | Coherence pass on the re-authored command (section flow 1→8, one consistent guard intro + closing) and the new test block (tidy/consolidate); confirm the original `bam-review-task` test still guards `task`/`resolv`/`clarif`/`stale|refresh` + validator, and the whole suite is green. No behavior change. | Opus 4.8 |

### Phase B — Verify & deploy

| # | Kind | Step | Model |
|---|------|------|-------|
| 10 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/` green; restart opencode (no `install.sh` change — `commands/` is already whole-dir linked); smoke `/bam-review-task MASTER-1848`: confirm it prints the report, then walks the questions one at a time, then offers the `/bam-tdd-plan` handoff and the card comment + conditional description edit — writing nothing without confirmation and never touching code. | Opus 4.8 |
| 11 | DEPLOY | Per `@rules/workflow.md` + `@rules/safety.md`: commit (Conventional Commits — **one squashed commit** per Step-10 Q&A), push, open PR → **`m`**, run `/bam-copilot-loop` until "no new comments", confirm CI green + Copilot clean, then merge. **Then close the Step-10 gate:** pull `m` into the main dotfiles checkout, restart opencode, and re-smoke `/bam-review-task MASTER-1848` live (now loading the new body via the symlink). | Opus 4.8 |

Adjacent trivial steps (e.g. 1→2) may run back-to-back, but each keeps its own
commit so the red→green history stays legible.

## Testing strategy

- **Content suite** — `bun test ./opencode/.config/opencode/commands-validate/`.
  The new `describe` block pins the interactive contract; the existing
  `bam-review-task` test and `validate.test.ts` guard the old tokens + validator
  and must stay green throughout.
- **No validator change.** `agent: build` is already accepted (`validate.ts:51`);
  the `description` stays non-empty; `validateCommand(...) === []` holds the whole
  way.
- **Manual smoke (Step 10)** — interactive behaviors (the `question` tool, the
  two offers) aren't unit-testable, so verify them by running the command against
  MASTER-1848 itself after an opencode restart.

## Risks & gotchas

1. **Agent escalation `plan` → `build`.** The command can now write. The guard is
   *instructional*, not sandboxed: analysis + Q&A read-only by instruction; the
   only writes (plan handoff, card comment, description edit) are confirm-gated;
   it never edits implementation code. Keep that language prominent (intro + §8).
2. **Token traps.** `comment`/`description`/`refresh`/`question` already appear
   today, so they can't drive a clean RED — use `agent: build`, `one at a time`,
   `bam-tdd-plan`, `confirm` to force red. Already-present tokens may stay in the
   tests as contract docs, but the red must hinge on a newly-absent one.
3. **communication.md consolidated-question rule.** `@rules/communication.md`
   (lines 43–44) prefers one consolidated question over one-at-a-time chains.
   This command deliberately does one-at-a-time; per decision 2 do **not** add an
   in-body override note — just implement it. (Recorded here so a reviewer
   doesn't "fix" it.)
4. **Command-to-command handoff isn't a hard opencode primitive.** Phrase §7 as
   *offer to continue with the `/bam-tdd-plan` flow* (task + answers as context);
   don't author the plan inline (decision 3).
5. **Restart required.** opencode loads command defs at startup; the edited body
   won't take effect until restart. No `install.sh` change needed.
6. **Don't drop retained tokens.** Re-authoring must keep
   `task`/`resolv`/`clarif`/`stale|refresh` and a non-empty `description` so the
   original test + validator stay green (Step 9 verifies).

## Progress

- [x] Phase A — interactive contract red-green-refactor (steps 1–9)
- [~] Phase B — verify + deploy (steps 10–11)
  - [x] Step 10 VERIFY — suite green (16/16); direct-execution smoke against
    MASTER-1848 passed (report → one-at-a-time Q&A → declined `/bam-tdd-plan`
    handoff → posted card comment; §8(b) description edit correctly suppressed,
    nothing stale; wrote nothing un-confirmed, touched no code). **Carried
    decisions:** Step 11 = one squashed Conventional-Commits commit; PR base =
    `m`. **Remaining gate:** the live `~/.config/opencode/commands` symlink
    points at the *main* checkout (old `agent: plan` body), so a **post-merge
    live re-smoke** (pull main, restart opencode, run `/bam-review-task
    MASTER-1848`) is required to fully close Step 10 — fold it into the tail of
    Step 11.
  - [~] Step 11 DEPLOY — shipping Phase A as one squashed Conventional-Commits
    commit; PR opened against `m`, `/bam-copilot-loop` run to "no new comments",
    CI + Copilot confirmed clean, then merged. The post-merge live re-smoke
    (pull `m`, restart opencode, run `/bam-review-task MASTER-1848` through the
    refreshed symlink) closes the Step-10 gate in the same session.

## References

- Task: Asana MASTER-1848 + its locked-decisions comment (the design source of
  truth).
- Command under change:
  `opencode/.config/opencode/commands/bam-review-task.md`.
- Tests/validator:
  `opencode/.config/opencode/commands-validate/commands.test.ts`,
  `validate.ts`.
- Handoff target: `opencode/.config/opencode/commands/bam-tdd-plan.md`.
- Rules: `@rules/plans.md` (triggers + tiers), `@rules/workflow.md`,
  `@rules/safety.md`, `@rules/communication.md` (the consolidated-question note).
- Predecessor plan (house style + how these commands/tests were created):
  `docs/archive/opencode/PLAN-slash-commands.md`.

## Kickoff trigger

> ▶️ Step `1` of `11` — RED: assert `agent: build` in bam-review-task frontmatter
> — model: Grok Build 0.1 — plan:
> `docs/plans/opencode-review-task-qa/PLAN.md`
