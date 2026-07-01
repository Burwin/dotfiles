# `/bam-resume` — resume a plan's next step without copy-pasting the trigger (MASTER-1870)

Status: complete 2026-07-01 (MASTER-1870) — command + tests shipped; ready to archive on merge.

Asana: MASTER-1870 — "/bam-resume"
(https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1216177690944546).
Decisions locked in the `/bam-review-task` Q&A (2026-07-01) and recorded below.

## Goal

Add a new opencode command `/bam-resume` so that resuming a step-by-step plan no
longer requires copy-pasting the next **trigger sentence** into a fresh session
(slow, tedious, and error-prone — a trigger from the wrong stream/client has
been pasted before). Instead: start a fresh session, pick a model, type
`/bam-resume`, and it **auto-resolves the active card + plan file, finds the next
step from the last-posted trigger, echoes it, and — after a confirm — runs that
one step**, then posts the next trigger and stops.

"Done" = a `bam-resume.md` command file that resolves the plan, finds the next
step via the last-posted trigger, tier-checks the current model, runs exactly one
step behind a confirm gate, and emits the next trigger — guarded by a content
test in `commands.test.ts`, deployed via the existing whole-dir symlink.

## Scope

**In:**

- Create `opencode/.config/opencode/commands/bam-resume.md` (`agent: build`; no
  `model:` pin — the tier varies per step and is chosen per session).
- Extend `opencode/.config/opencode/commands-validate/commands.test.ts` with a
  new `describe("bam-resume command")` block pinning the contract.

**Out:**

- Any change to `validate.ts` — `agent: build` is already allowed
  (`validate.ts:51`), `bam-resume.md` already matches the filename regex, and the
  `description`/body stay non-empty, so `validateCommand(...) === []` holds
  throughout.
- Any change to `install.sh` — `commands/` is already whole-dir symlinked (the
  `install wiring` test guards this); a new command deploys with no installer
  change.
- **True auto model-switch** (execute the step *on* the step's named tier). No
  opencode primitive lets a running command reassign its own session model; the
  only path is shelling out to `opencode run --model <id>` (see Decision 1 /
  Risks). Deferred as a documented future enhancement, not v1.
- Editing implementation code from *inside this review/plan pass* — the command
  itself writes code only when executing a resolved step, one step at a time.

## Decisions (locked, from the MASTER-1870 review Q&A)

1. **"Run it" = one step in the current session, tier-checked.** There is no
   clean in-session model switch (frontmatter `model:` is static; nothing lets a
   running turn reassign its model). So `/bam-resume` runs the step on **whatever
   model the session already has**, but first compares the step's **named tier**
   to the current model and **warns / asks (proceed vs. stop-and-switch) on
   mismatch**. The `opencode run --model <id>` shell-out (true auto-tier
   execution) is noted as a **future enhancement**, not built now.
2. **Plan-file resolution order:** explicit `$ARGUMENTS` (plan path/topic) →
   the plan whose `PLAN.md` references the resolved task id (e.g. `MASTER-1870`)
   → if exactly one active plan dir exists, use it → else list candidates and
   ask. (`$ARGUMENTS` may also carry a pasted trigger to use directly.)
3. **Next step = the last-posted trigger, not checkbox inference.** Follow the
   `▶️ Step N of M …` trigger the previous step emitted.
4. **Trigger source = the previous session's transcript.** Use
   `opencode session list` / `opencode export` to find the most recent session in
   this cwd (excluding the current one) and extract the last trigger it emitted;
   **cross-check** against the plan's step table; **fall back** to the plan's
   kickoff trigger (step 1) for a fresh plan. Always **echo** the resolved step
   and **confirm** before executing.
5. **Boundary = exactly one step per invocation.** Run one step, post the next
   step's trigger verbatim, and **stop** — mirrors "one step per fresh session",
   keeps the human review checkpoint, and is what makes the tier warning (1)
   meaningful.

## Design

### Command shape (`bam-resume.md`)

```
---
description: Resume the active plan — resolve the card + plan file, find the next
             step from the last-posted trigger, tier-check the current model,
             then (after a confirm) run that one step and post the next trigger.
agent: build            # executes a step → writes code; the only writes are gated
---                     # NO model: pin — the step's tier is picked per session

<intro: fresh-session resume; find the next step from the last trigger and run
 exactly one, behind a confirm gate; then post the next trigger and stop.>

Optional override: $ARGUMENTS   (a plan path/topic, or a pasted trigger)
Current directory: !`pwd`

## 1. Resolve the card        — cwd → task id per AGENTS.md; confirm by
                                permalink/project membership, not by name.
## 2. Resolve the plan file    — $ARGUMENTS → PLAN.md referencing the task id →
                                sole active plan → else list + ask.
## 3. Find the next step       — read the most recent prior session for this cwd
                                via `opencode session list`/`export`; extract the
                                last `▶️ Step N of M …` trigger; cross-check the
                                plan's step table; fresh-plan fallback = kickoff.
## 4. Tier check               — compare the step's named tier to the current
                                model; on mismatch, warn + ask proceed / switch.
                                (Note the `opencode run --model` shell-out as a
                                future auto-switch option.)
## 5. Echo & confirm           — print the resolved step (N of M, label, tier,
                                action); confirm before executing.
## 6. Run exactly one step     — execute the step per the plan + @rules/workflow
                                commit cadence; do not run ahead.
## 7. Post the next trigger    — emit the next step's trigger verbatim and STOP.
```

### Resolution algorithm (§3 detail)

- List sessions for this directory: `opencode session list --format json`
  (per-directory; sorted by recency). Skip the **current** session (match by id,
  or take the most recent that actually contains a trigger).
- Export that session (`opencode export <id>`) and scan its last assistant
  message for the canonical trigger `▶️ Step N of M — <label> — model: <tier> —
  plan: <path>`.
- **Cross-check**: the trigger's `<path>` should match the resolved plan (§2) and
  `N of M` should line up with the plan's step table; if they diverge, surface it
  in the echo (§5) and let the human decide.
- **Fresh-plan fallback**: if no prior session/trigger exists, use the plan's
  **kickoff trigger** (step 1 at the bottom of the plan).

### Test shape (`commands.test.ts`)

A new `describe("bam-resume command")` block, one focused test per behavior, each
RED hinging on a token **absent from the file's state at that point** (the file is
authored section-by-section, so GREENs stay incremental). Mirrors the existing
per-command blocks: existence + `validateCommand(...) === []` + body tokens.
Run: `bun test ./opencode/.config/opencode/commands-validate/`.

## TDD implementation order

Each step is a single test **or** a single move — never both. RED = one failing
test for one new behavior; GREEN = the minimal change that makes it pass;
REFACTOR = tidy with the suite green. **M = 13.**

### Phase A — command contract (red → green → refactor)

| #  | Kind | Step | Model |
|----|------|------|-------|
| 1  | RED | Add `describe("bam-resume command")` to `commands.test.ts` with a first test: `bam-resume.md` **exists**, `validateCommand(...) === []`, and its frontmatter is `agent: build` with **no** `model:` line. Fails today (file absent). | Grok Build 0.1 |
| 2  | GREEN | Create minimal `bam-resume.md`: frontmatter (`agent: build`, non-empty `description`) + a short intro body, the optional `$ARGUMENTS` line, and `Current directory: !`pwd``. Keep the body free of the section tokens later tests pin. Test 1 passes; validator green. | Grok Build 0.1 |
| 3  | RED | Add a test asserting the body encodes **card + plan resolution** — newly-absent tokens `/resolv/` and `/docs\/plans/` (plus a fallback-order marker, e.g. `/ask/`). Fails after step 2. | Grok Build 0.1 |
| 4  | GREEN | Add **§1 Resolve the card** (cwd → task id per `AGENTS.md`; confirm by permalink/project) and **§2 Resolve the plan file** (arg → `PLAN.md` referencing the task id → sole active plan → else ask). Test 3 passes. | Opus 4.8 |
| 5  | RED | Add a test asserting **next-step-by-last-posted-trigger via the prior session transcript** — tokens `/trigger/`, `/opencode (session|export)/` (or `session list`), and `/transcript/`. Fails. | Grok Build 0.1 |
| 6  | GREEN | Add **§3 Find the next step**: read the most recent prior session for this cwd via `opencode session list`/`export` (skip the current one), extract the last `▶️ Step N of M …` trigger, cross-check the plan step table, fresh-plan fallback = kickoff trigger. Test 5 passes. | Opus 4.8 |
| 7  | RED | Add a test asserting a **model-tier check + confirm gate** — tokens `/tier/`, `/mismatch/`, and `/confirm/`. Fails. | Grok Build 0.1 |
| 8  | GREEN | Add **§4 Tier check** (compare step tier vs. current model; warn + ask proceed/stop-and-switch on mismatch; note the `opencode run --model` shell-out as a future option) and **§5 Echo & confirm** (print step N of M, label, tier, action; confirm before executing). Test 7 passes. | Opus 4.8 |
| 9  | RED | Add a test asserting **run-exactly-one-step then post the next trigger and stop** — tokens `/one step/`, `/next .*trigger|next step's trigger/`, and `/stop/`. Fails. | Grok Build 0.1 |
| 10 | GREEN | Add **§6 Run exactly one step** (execute per the plan + `@rules/workflow.md` commit cadence; don't run ahead) and **§7 Post the next trigger** (emit the next step's trigger verbatim, then stop). Test 9 passes. | Opus 4.8 |
| 11 | REFACTOR | Coherence pass on the command (intro + §1–§7 flow, one consistent guard: only writes are the gated step-run + trigger; confirm before executing) and the test block (tidy/consolidate). Confirm `validateCommand(...) === []` and the whole suite stays green. No behavior change. | Opus 4.8 |

### Phase B — verify & deploy

| #  | Kind | Step | Model |
|----|------|------|-------|
| 12 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/` green; restart opencode; smoke `/bam-resume` (safe: the §5 confirm gate stops before any execution) — confirm it resolves *this* plan, reads the last-posted trigger, echoes the step + tier, warns on model mismatch, and would post the next trigger + stop after one step. Prefer a throwaway scratch plan (or just stop at the confirm) so the smoke doesn't kick off a real step. | Opus 4.8 |
| 13 | DEPLOY | Per `@rules/workflow.md` + `@rules/safety.md` (or hand off to `/bam-deploy-dev`): one squashed Conventional-Commits commit, push, open PR → base **`m`** (verified), run `/bam-copilot-loop` until "no new comments"; the repo has no `.github/workflows/`, so the local suite is the merge gate; merge with explicit confirmation; then fast-forward the main dotfiles checkout, restart opencode, and live re-smoke `/bam-resume`. Archive this plan. | Opus 4.8 |

Adjacent trivial steps (e.g. 1→2) may run back-to-back, but each keeps its own
commit so the red→green history stays legible.

## Testing strategy

- **Content suite** — `bun test ./opencode/.config/opencode/commands-validate/`.
  The new `describe` block pins the contract; `validate.test.ts` and the other
  command blocks must stay green throughout.
- **No validator/installer change.** `agent: build` is accepted, the filename
  matches, `description`/body stay non-empty; `commands/` is already whole-dir
  linked (the `install wiring` test still passes).
- **Manual smoke (Step 12)** — the interactive behaviors (transcript read, tier
  warning, confirm gate, one-step boundary) aren't unit-testable, so verify them
  live after an opencode restart. The confirm gate keeps the smoke side-effect
  free.

## Risks & gotchas

1. **No in-session model switch (Decision 1).** The tier handling is a
   *warn/ask*, not an automatic switch. Keep the frontmatter free of a `model:`
   pin (the tier is per-step, per-session). If true auto-tier execution is wanted
   later, the path is `opencode run --model <id> "<step prompt>"` — but it runs
   the step in a **separate non-interactive subprocess**, needs `--auto` to avoid
   blocking on permission prompts (a safety loosening for code-writing steps),
   spins a second session (cost-tracker attribution noise), and replaces live
   tool approvals with a log dump. Document it; don't build it in v1.
2. **Finding the right prior session (Decision 4).** `opencode session list` is
   per-directory and recency-sorted; **exclude the current session** (by id, or
   take the most recent that actually contains a trigger). If the last session
   didn't emit a trigger (e.g. it errored), fall back to the plan's step table /
   kickoff and say so in the echo.
3. **Trigger ↔ plan drift.** The transcript trigger and the plan's step table can
   disagree (hand-edited plan, out-of-order runs). Cross-check and surface the
   discrepancy in the §5 echo rather than silently trusting one source.
4. **Token discipline in the RED sequence.** Because the file is authored
   section-by-section, keep each GREEN from including a *later* test's token
   early (e.g. don't write "trigger"/"tier"/"one step" into the step-2 stub), or
   a later RED won't fail cleanly.
5. **`agent: build` writes code.** Unlike `/bam-review-task` (read-only by
   instruction) and `/bam-tdd-plan` (plan-only), `/bam-resume` executes a step
   and therefore edits implementation code — but only **one** step, only **after
   the confirm**, and never runs ahead. Keep that guard prominent (intro + §5–§7).
6. **Restart required.** opencode loads command defs at startup; `bam-resume.md`
   won't be invocable until a restart (no `install.sh` change needed).
7. **Self-referential smoke.** Smoking `/bam-resume` against *this* plan would try
   to resume it at the next pending step; the §5 confirm gate makes that safe, but
   prefer a throwaway scratch plan for the smoke so a stray "yes" can't launch a
   real step/deploy.

## Progress

- [x] Phase A — command contract red-green-refactor (steps 1–11)
- [x] Phase B — verify + deploy (steps 12–13)

## References

- Task: Asana MASTER-1870 + the `/bam-review-task` Q&A that locked the five
  decisions (design source of truth).
- Command to create:
  `opencode/.config/opencode/commands/bam-resume.md`.
- Tests/validator:
  `opencode/.config/opencode/commands-validate/commands.test.ts`,
  `validate.ts` (unchanged).
- Conventions: `@rules/plans.md` (trigger shape + model tiers),
  `@rules/workflow.md` (commits/PR/base `m`), `@rules/safety.md`.
- Sibling commands (house style):
  `bam-review-task.md`, `bam-tdd-plan.md`, `bam-deploy-dev.md`,
  `bam-copilot-loop.md`.
- Closest precedent (create/modify a `bam-*` command + tests + deploy):
  `docs/archive/opencode/PLAN-review-task-qa.md`,
  `docs/archive/opencode/PLAN-slash-commands.md`.

## Kickoff trigger

> ▶️ Step `1` of `13` — RED: assert `bam-resume.md` exists + validates +
> `agent: build` — model: Grok Build 0.1 — plan:
> `docs/plans/opencode-bam-resume/PLAN.md`
