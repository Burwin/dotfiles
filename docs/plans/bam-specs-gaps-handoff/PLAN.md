# `/bam-specs-gaps` §5: hand off to `/bam-tdd-plan` (MASTER-2034)

**Asana:** MASTER-2034 (GID `1218176378652847`) — bam-specs-gaps: hand off to /bam-tdd-plan, do not file a plan
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1218176378652847
**Plan path:** `docs/plans/bam-specs-gaps-handoff/PLAN.md`
**Worktree:** `~/src/dotfiles/MASTER-2034`

## TL;DR

H-150 is DONE; the §5b bug is still live. Default stays "one plan" (missing tests plus the code that makes them pass) but **do not file an Asana plan subtask and do not write `PLAN.md`**. After the gap list and filing-mode pick, emit a **copy-paste `/bam-tdd-plan` snippet** for a fresh session. Modes: (1) handoff snippet (default), (2) list-only, (3) per-gap cards.

**Done** = `bam-specs-gaps.md` §5/§6/intro + content tests in `commands.test.ts`. No validator/installer change.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-gaps.md` (keep `agent: build`; no `model:` pin)
- `describe("bam-specs-gaps command")` in `opencode/.config/opencode/commands-validate/commands.test.ts`

### Out

- Implementing HH-63–HH-67 / anything on H-150
- Authoring a TDD plan from `/bam-specs-gaps` itself
- In-session invoke of `/bam-tdd-plan`
- Edits to `/bam-specs-init`, `/bam-specs-amend`, `/bam-review-task`, `/bam-tdd-plan`
- `validate.ts` / `install.sh`
- Overwriting `docs/plans/bam-specs-gaps/PLAN.md` (MASTER-2029)

## Decisions (locked)

From the 2026-09-08 review comment on MASTER-2034:

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Default intent | Still "one plan" covering missing tests + code. |
| 2 | Default mechanism | Copy-paste `/bam-tdd-plan` snippet for a **fresh** session. Not `asana_create_tasks`. Not `PLAN.md` from this command. Not in-session invoke. |
| 3 | Modes | (1) handoff snippet (default), (2) list-only, (3) per-gap cards. Ask every run via `question` tool, recommended default first. |
| 4 | Precedent | Mirror `bam-review-task.md` §7: offer, do not assume; never author the plan inline. Stricter than review-task: **paste only**, no in-session handoff. |
| 5 | Snippet payload | Resolved card (task id + GID + summary) + the gap list. |
| 6 | Per-gap | Non-default; still files via `asana_create_tasks` (test + code per gap). |
| 7 | List-only | Keep. Stop after the gap list. No snippet, no cards. |
| 8 | Agent | Keep `agent: build` (per-gap still writes). |

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-gaps.md          # edit §5, §6, intro/description
└── commands-validate/commands.test.ts  # replace §5b test; add handoff tests
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

### Target §5 / §6 shape

```
## 5. Filing mode
### 5a. Ask every run  (unchanged: question tool, one at a time, never silent)
### 5b. Default: one-plan /bam-tdd-plan handoff
      - still resolve current card (worktree / asana_search_tasks + permalink)
      - emit paste snippet; do not write PLAN.md; do not create a plan subtask
      - snippet: /bam-tdd-plan — <TASK-ID> (GID …) — <summary> plus the gap list
### 5c. Alternatives
      - list-only: stop, no snippet, no cards
      - per-gap cards: asana_create_tasks (the only remaining create path)
## 6. Relations + stop
      Stop after snippet, or list-only, or per-gap filing.
      Do not implement. This command never writes a plan file.
```

### Test seam

Same as MASTER-2029: load inside each test via `readBamSpecsGaps()`, `existsSync`, `validateCommand(...) === []`, body lowercased. One focused test per behavior.

**Must replace** the current §5b test (`commands.test.ts:573`) which pins `/asana_create_tasks/` on the default path. If we only add a new test, GREEN cannot satisfy both once `asana_create_tasks` moves to per-gap (and a body-wide `/asana_create_tasks/` would still pass anyway). Scope default assertions to `### 5b` when checking that the default path does **not** call `asana_create_tasks`.

Tokens **absent today** in `bam-specs-gaps.md` (use these for RED): `bam-tdd-plan`, `handoff`, `paste`, `fresh`, `plan.md`, `subtask`, `gid`.

Tokens **present** (do not use as the sole new pin): `one plan`, `current card`, `list-only`, `per-gap`, `asana_create_tasks`, `cards only`.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 11.**

Token discipline: each GREEN must not introduce a later test's tokens.

### Phase A — default is handoff, not an Asana plan card

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | In `describe("bam-specs-gaps command")`, **replace** `body files the default card covering test+code (§5b)` so it pins default handoff: `/bam-tdd-plan/`, `/handoff/`, `/one plan/`, `/current card/`, `/code/`. Drop `/asana_create_tasks/`. Optionally extract `### 5b` and `expect(s5b).not.toContain("asana_create_tasks")`. Fails: `bam-tdd-plan` and `handoff` are absent. | cheap |
| 2 | GREEN | Rewrite §5b default: one plan on the current card, hand off to `/bam-tdd-plan`, do not `asana_create_tasks` in §5b. Keep current-card resolution. Forbidden in this step: `paste`, `fresh`, `plan.md`, `subtask`, `gid`. Do not add a 5c yet. | premium |

### Phase B — paste snippet, never a plan file or plan subtask

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 3 | RED | New test: default handoff is copy-paste into a fresh session, never a plan file, never a plan subtask. Tokens: `/paste/`, `/fresh/`, `/plan\.md/`, `/subtask/`. Mirror review-task §7 phrasing ("never writes a plan file" / "do not author the plan inline"). | cheap |
| 4 | GREEN | Add those constraints to §5b. Forbidden: `gid`, `asana_create_tasks`. | premium |

### Phase C — snippet payload + named modes

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 5 | RED | New test: snippet includes resolved card GID + the gap list; question options are handoff (default), list-only, per-gap cards; per-gap is the `asana_create_tasks` path. Tokens: `/gid/`, `/gap list/`, `/list-only/`, `/per-gap/`, `/asana_create_tasks/`. After step 4, `gid` and `asana_create_tasks` are absent so this RED is real. | cheap |
| 6 | GREEN | Snippet payload = task id + GID + summary + gap list. Name the three modes in §5a/§5c. Restore `asana_create_tasks` only under per-gap. Do not rewrite intro/§6 stop finale yet. | premium |

### Phase D — stop condition + intro, then ship

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 7 | RED | Update §6 test: stop after handoff snippet, or list-only, or per-gap filing; keep `/do not implement/`; drop relying on `/cards only/` as the story. Pin `/stop/` plus `/handoff/` or `/snippet/` in the relations/stop sense. Add an intro/description pin if needed so "file cards" is no longer the default outcome. | cheap |
| 8 | GREEN | Rewrite intro, frontmatter `description:`, and §6 to match. Command stays `agent: build`. | premium |
| 9 | REFACTOR | Coherence pass on intro + §5–§6 and the test block. Suite stays green. No behavior change. | premium |
| 10 | VERIFY | `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode. Smoke `/bam-specs-gaps` on a throwaway path through the gap list + mode question; confirm default prompt is the handoff snippet; **stop before any Asana write**. | premium |
| 11 | DEPLOY | Per `@rules/workflow.md`: squash to one Conventional-Commits commit, push, PR with base `m`, `/bam-copilot-loop` until "no new comments". Merge on explicit confirm. | premium |

## Testing strategy

- Content suite is the TDD seam. Sibling command blocks stay green.
- Do not add a body-wide `expect(/asana_create_tasks/).toBe(false)`: per-gap brings it back in step 6. Scope the negative to `### 5b`.
- Interactive bits (mode `question`, snippet wording) are smoke-only at step 10. Never file a real Asana card during smoke.
- Token discipline is the red-green guard. Do not draft ahead.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Old §5b test still requires `asana_create_tasks` | Step 1 **replaces** that test, does not add a parallel one. |
| Token leak (`gid` / `paste` in step 2) | Forbidden-token lists on each GREEN. |
| Body-wide negative on `asana_create_tasks` breaks step 6 | Section-scope §5b only. |
| Intro still says "file cards"; agent files anyway | Step 7–8 pin intro/§6. Until then, step 2 already removes default create from §5b. |
| Confusing with review-task in-session handoff | Gaps is paste-only; tests pin `paste` + `fresh`. |
| Clobber MASTER-2029 plan | New dir `docs/plans/bam-specs-gaps-handoff/`. |
| Restart required | Steps 10–11 include restart + smoke. |

## Progress

- [x] Step 1 — RED: replace §5b test with handoff tokens
- [x] Step 2 — GREEN: rewrite §5b default to `/bam-tdd-plan` handoff
- [x] Step 3 — RED: paste / fresh / never plan.md / never subtask
- [x] Step 4 — GREEN: add paste-snippet constraints
- [x] Step 5 — RED: GID + gap list + three modes + per-gap create
- [x] Step 6 — GREEN: snippet payload + §5c per-gap
- [x] Step 7 — RED: §6/intro stop after handoff
- [x] Step 8 — GREEN: rewrite intro + §6
- [x] Step 9 — REFACTOR: coherence pass
- [x] Step 10 — VERIFY: suite + smoke
- [ ] Step 11 — DEPLOY: squash, PR, merge

## References

- Card: MASTER-2034 + 2026-09-08 review comment
- Incident: H-150 (DONE); bug remains in `bam-specs-gaps.md` §5b
- Precedent: `bam-review-task.md` §7 (`commands.test.ts` "offers a /bam-tdd-plan handoff")
- Predecessor: `docs/plans/bam-specs-gaps/PLAN.md` (MASTER-2029, shipped `f30fdac`)
- Files: `opencode/.config/opencode/commands/bam-specs-gaps.md:59`, `commands-validate/commands.test.ts:573`
- Conventions: `@rules/plans.md`, `@rules/workflow.md`
- Test command: `bun test ./opencode/.config/opencode/commands-validate/`

---

After each step completes, post the next trigger verbatim.

- After 1 → ▶️ Step 2 of 11 — GREEN: rewrite §5b default to `/bam-tdd-plan` handoff — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 2 → ▶️ Step 3 of 11 — RED: paste / fresh / never plan.md / never subtask — model: cheap — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 3 → ▶️ Step 4 of 11 — GREEN: add paste-snippet constraints — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 4 → ▶️ Step 5 of 11 — RED: GID + gap list + three modes + per-gap create — model: cheap — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 5 → ▶️ Step 6 of 11 — GREEN: snippet payload + §5c per-gap — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 6 → ▶️ Step 7 of 11 — RED: §6/intro stop after handoff — model: cheap — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 7 → ▶️ Step 8 of 11 — GREEN: rewrite intro + §6 — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 8 → ▶️ Step 9 of 11 — REFACTOR: coherence pass — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 9 → ▶️ Step 10 of 11 — VERIFY: suite + smoke — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
- After 10 → ▶️ Step 11 of 11 — DEPLOY: squash, PR, merge — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`

▶️ Step 2 of 11 — GREEN: rewrite §5b default to `/bam-tdd-plan` handoff — model: premium — plan: `docs/plans/bam-specs-gaps-handoff/PLAN.md`
