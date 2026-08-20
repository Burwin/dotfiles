# `/bam-specs-init` — constitution-init PLAN author (MASTER-1988)

**Asana:** MASTER-1988 (GID `1217274099476522`) — Formalize the constitution init flow
**Permalink:** https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217274099476522

## TL;DR

Ship `/bam-specs-init` in the public dotfiles repo. One invocation authors a
constitution-init PLAN (1945/1943 shape) for a named scope in any git repo,
then posts the step-1 trigger and stops. Later steps run via `/bam-resume`.
Init only. File a follow-on card for `/bam-specs-amend`.

**Done** = `bam-specs-init.md` + content tests in `commands.test.ts`, deployed
via the existing `commands/` symlink, follow-on amend card filed.

## Goal & scope

### In

- `opencode/.config/opencode/commands/bam-specs-init.md` (`agent: plan`; no
  `model:` pin)
- `describe("bam-specs-init command")` in
  `opencode/.config/opencode/commands-validate/commands.test.ts`
- Follow-on Asana card for `/bam-specs-amend` (create only)

### Out

- `/bam-specs-amend` (follow-on card only)
- Running harvest / refine / ratify (those are steps of the *authored* PLAN)
- Changes to `validate.ts` or `install.sh` (`agent: plan` already allowed;
  `commands/` already whole-dir linked)
- A constitution CLI / linter
- Editing `constitution.md` in any target repo from this card

## Decisions (locked)

| # | Topic | Lock |
| --- | --- | --- |
| 1 | Home | Dotfiles: `opencode/.config/opencode/commands/bam-specs-init.md`. This TDD plan lives at `docs/plans/bam-specs-init/PLAN.md` in `~/src/dotfiles/MASTER-1988`. Tools repo is reference only. |
| 2 | One invocation | Author a constitution-init PLAN, post step-1 trigger, stop. Later steps via `/bam-resume`. |
| 3 | Scope | Init only. File a follow-on card for amend. |
| 4 | ID scheme | Default: flat single prefix. Multi-section is opt-in. |
| 5 | Target | Any git repo (path + prefix). PLAN is written into the *target*. |
| 6 | Templates | MASTER-1945 (primary, flat) and MASTER-1943 (gmail, PR #88). Multi-section opt-in uses MASTER-1931. |
| 7 | Agent | `agent: plan`. No `model:` pin (user picks; recommend Grok 4.6). |
| 8 | Tiers in *this* plan | Preempt MASTER-1989: **Grok 4.6** (judgment / prose) and **Grok Build 0.1** (mechanical / tests-to-spec). |
| 9 | Tiers in *authored* PLANs | Harvest / refine / sweep / ratify / fan-out all **Grok 4.6** (mid folded into 4.6). |

## Design

```
opencode/.config/opencode/
├── commands/bam-specs-init.md          # NEW
└── commands-validate/commands.test.ts  # extend; validate.ts unchanged
```

Run: `bun test ./opencode/.config/opencode/commands-validate/`

### Command shape

```
---
description: Author a constitution-init PLAN (1945/1943 shape) for a named
             scope in any git repo, then post the step-1 trigger. Later
             steps via /bam-resume. Init only — not amend.
agent: plan
---

<intro: one shot, PLAN only, stop after kickoff trigger>

$ARGUMENTS   (freeform: scope, prefix, path — parse what you can)
Current directory: !`pwd`

## 1. Resolve the target
## 2. Lock the ID scheme
## 3. Author the PLAN
## 4. Post the step-1 trigger and stop
```

### §1 Resolve the target

Parse `$ARGUMENTS` for scope, prefix, and path. Missing bits: `question`
tool, one at a time, recommended default first.

- **Path** default: cwd (`!pwd`), must be a git repo
  (`git rev-parse --show-toplevel`). If `$ARGUMENTS` names a path, use that.
- **Scope** default: cwd basename or an obvious package dir the human named.
- **Prefix** default: short uppercase 3–5 chars derived from scope
  (e.g. `gmail` → `GMAIL`). Confirm it is unused in the target's existing
  prefix registry.
- Detect `constitution.md` at the target root. **Absent** = first-constitution
  branch. **Present** = append branch (never edit existing rule text).

Confirm the resolved `{path, scope, prefix, first-vs-append}` before writing.

### §2 Lock the ID scheme

Default **flat single prefix** (1945/1943): one heading, IDs `PREFIX-1`,
`PREFIX-2`, … Refine is 2–5 batches sized at harvest.

**Multi-section opt-in** (1931): ask only if the human requested it or the
scope is clearly multi-domain. Then: section-name gate at harvest, one refine
step per section, cap 6 sections.

### §3 Author the PLAN

Write `<target>/docs/plans/<topic>/PLAN.md`.

- **Topic**: worktree / Asana id if present (`MASTER-NNNN`), else kebab-case
  scope.
- **Shape**: copy 1945/1943 structure (or 1931 if multi-section). Required
  sections listed in the command-content spec below.
- **Do not run harvest.** The PLAN's step 1 is harvest; this command only
  authors the PLAN.
- Templates to read (tools repo, reference):
  - `~/src/bamboo/tools/docs/plans/MASTER-1945/PLAN.md` (+ `harvest.md`,
    `draft.md`, `sweep-report.md`)
  - `~/src/bamboo/tools/MASTER-1943/docs/plans/MASTER-1943/PLAN.md` (or the
    copy on `m` once merged)
  - `~/src/bamboo/tools/docs/plans/MASTER-1931/PLAN.md` (multi-section only)

### §4 Post trigger and stop

Emit the authored PLAN's kickoff trigger in `@rules/plans.md` shape. Tell the
human the next move is `/bam-resume` (or paste the trigger). **Stop.** Do not
start harvest. Do not mention `/bam-specs-amend` as something this command
does.

### Test shape

New `describe("bam-specs-init command")` in `commands.test.ts`, mirroring
`readResume()`: load inside each test, `existsSync`,
`validateCommand(...) === []`, frontmatter vs body split. One focused test
per behavior. Each RED hinges on tokens **absent** from the file at that
point.

## Command-content spec (GREEN authoring)

Encode these invariants in the command body. Do not invent new policy.

**Quality bar** (into the authored PLAN): stakeholder-legible; one assertion;
EARS-ish (`The <tool> shall …` / `WHEN …, … shall …`); true today against
code (`file:line`); unique; scope guard (user-facing / security / money /
schedules, not unit-test trivia).

**Confidence**: `[T:x V:y]` x,y ∈ H/M/L in working docs only. Ratify requires
**T:H**. V:M/L → fan-out. Aspirational / unbuilt dropped at harvest.

**Working-doc flow**: `harvest.md` → `draft.md` → `sweep-report.md` →
`constitution.md`.

**Authored step table (flat default, provisional M=8)**:

| # | Label | Model |
| --- | --- | --- |
| 1 | Blurry harvest + count gate + plan renumber | Grok 4.6 |
| 2–5 | Refine batches (≤5 rules/gate; accept / edit / drop / unsure) | Grok 4.6 |
| 6 | Sweep (exceptions only) | Grok 4.6 |
| 7 | Assemble + ratify (one PR) | Grok 4.6 |
| 8 | Fan-out test cards + closeout | Grok 4.6 |

Step 1 may rewrite 2–5 if harvest `n` wants fewer/more rounds (keep 2–5
refine sessions).

**Harvest source map**: the authored PLAN must list concrete files the
harvest step will mine. Build the map from the target: README, AGENTS.md,
sources, tests, systemd/install, `.env.example`, existing
`constitution.md`. Do not copy the asana/gmail file lists.

**First constitution** (no `constitution.md`): include the conventions
header (immutable rules; `CANCELLED` / `REPLACED_BY` / `REPLACES`; prefix
registry; no metadata in the law file) plus an AGENTS.md constitution-first
policy step if the target has AGENTS.md. One or two PRs; prefer one if small.

**Append** (existing law): registry row + intro packages-under-law + new `##`
section. Never edit existing rule text.

**Review ergonomics**: ≤5 rules per gate; tables ≤4 columns; exceptions-only
reports; verdicts **accept / edit / drop / unsure**; human full skim only at
ratify.

**Fan-out**: Asana MASTER / Client Bamboo / Project Tools when the target is
a Bamboo tools-family repo; otherwise list gaps and ask.

**Law file**: repo-root `constitution.md`.

## TDD implementation order

Each step is a single test **or** a single move, never both. **M = 18.**

Token discipline: each GREEN must not introduce a *later* test's tokens, or
the next RED will not fail.

### Phase A — scaffold + target + scheme

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 1 | RED | Add `describe("bam-specs-init command")` to `commands.test.ts`. First test: `bam-specs-init.md` exists, `validateCommand(...) === []`, frontmatter is `agent: plan` with **no** `model:` line. Fails (file absent). | Grok Build 0.1 |
| 2 | GREEN | Create minimal `bam-specs-init.md`: frontmatter + short intro + `$ARGUMENTS` + `Current directory: !`pwd``. Body must **not** contain: `prefix`, `constitution.md`, `harvest`, `trigger`, `amend`, `flat`. | Grok Build 0.1 |
| 3 | RED | Test: body encodes **target resolution** — tokens `/path/`, `/prefix/`, `/scope/`, `/constitution\.md/`, `/git/`. | Grok Build 0.1 |
| 4 | GREEN | Add **§1 Resolve the target** (parse args; `question` for gaps; cwd default; git toplevel; detect existing law; confirm before write). Do **not** add `flat`, `multi-section`, `harvest`, `refine`. | Grok 4.6 |
| 5 | RED | Test: body encodes **ID scheme** — tokens `/flat/`, `/multi-section/`, `/opt-in/`. | Grok Build 0.1 |
| 6 | GREEN | Add **§2 Lock the ID scheme** (flat default; multi-section opt-in + 1931 pointer). Do **not** add `harvest.md`, `refine`, `sweep`, `ratify`. | Grok 4.6 |

### Phase B — PLAN shape + stop

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 7 | RED | Test: body points at **PLAN output + templates** — tokens `/docs\/plans/`, `/1945/`, `/1943/`, `/PLAN\.md/`. | Grok Build 0.1 |
| 8 | GREEN | Add **§3a**: write `<target>/docs/plans/<topic>/PLAN.md`; name the 1945/1943 (and 1931) template paths. Do **not** enumerate harvest / refine / sweep / ratify / fan-out as loop steps. | Grok 4.6 |
| 9 | RED | Test: body encodes the **init loop** — tokens `/harvest/`, `/refine/`, `/sweep/`, `/ratify/`, `/fan-out/`. | Grok Build 0.1 |
| 10 | GREEN | Add **§3b**: provisional step table + per-step notes (count gate, ≤5/gate, working-doc flow, harvest source map built from the target, T:H-only). | Grok 4.6 |
| 11 | RED | Test: body encodes **first-vs-append + review contract** — tokens `/conventions/`, `/agents\.md/`, `/accept/` + `/edit/` + `/drop/` + `/unsure/`, `/≤5|\<=5|at most 5/`. | Grok Build 0.1 |
| 12 | GREEN | Add **§3c**: first-constitution conventions + AGENTS.md policy vs append-only; review ergonomics. Do **not** add `trigger`, `bam-resume`, `amend`. | Grok 4.6 |
| 13 | RED | Test: body **posts kickoff, stops, defers resume, excludes amend** — tokens `/trigger/`, `/bam-resume/`, `/stop/`, `/amend/`. | Grok Build 0.1 |
| 14 | GREEN | Add **§4**: emit kickoff trigger; stop; later via `/bam-resume`; this command does not amend (name `/bam-specs-amend` only as out of scope). | Grok 4.6 |
| 15 | REFACTOR | Coherence pass on intro + §1–§4 and the test block. Suite stays green. No behavior change. | Grok 4.6 |

### Phase C — verify, deploy, follow-on

| # | Kind | Step | Model |
| --- | --- | --- | --- |
| 16 | VERIFY | Full `bun test ./opencode/.config/opencode/commands-validate/` green. Restart opencode. Smoke `/bam-specs-init` against a throwaway path (or stop after the confirm of `{path, scope, prefix}`) so it does not write a real PLAN. Confirm the command surfaces in the TUI. | Grok 4.6 |
| 17 | DEPLOY | Per `@rules/workflow.md`: squash to one Conventional-Commits commit, push, PR → base **`m`**, `/bam-copilot-loop` until "no new comments". No `.github/workflows/` here; local suite is the merge gate. Merge on explicit confirm. Fast-forward main checkout, restart opencode, live re-smoke. | Grok 4.6 |
| 18 | FOLLOW-ON | Create Asana card via `asana_create_tasks` in MASTER (`1204506183888935`), then `asana-task-update` Client=Bamboo / Project=Tools. **Name:** `Formalize the constitution amend flow (/bam-specs-amend)`. **Notes:** sibling of MASTER-1988; ship `bam-specs-amend.md`; amendments only (`REPLACES` / `REPLACED_BY` / `CANCELLED`); do not re-init. Comment the new permalink on MASTER-1988. | Grok 4.6 |

## Testing strategy

- Content suite is the TDD seam. `validate.test.ts` and sibling command
  blocks stay green.
- No validator or installer change.
- Interactive bits (question flow, confirm, stop) are smoke-only at step 16.

## Risks & gotchas

| Risk | Mitigation |
| --- | --- |
| Token leak makes a later RED pass | Step 2/4/6/8/12 lists forbidden tokens. Do not "helpfully" draft ahead. |
| Command runs harvest | §4 stop + test pins `bam-resume` + `stop`. Intro says PLAN only. |
| Amend creeps in | Test 13 requires `amend` as out-of-scope. Step 18 owns the follow-on card. |
| Hardcoded asana/gmail source map | §3b says build the map from the *target*. |
| Tools vs dotfiles mixup | This plan executes only in `~/src/dotfiles/MASTER-1988`. |
| MASTER-1989 still in flight | This plan already uses Grok 4.6 / Grok Build. If 1989's friendly names differ at merge, fix triggers only if they diverge. |
| Restart required | opencode loads commands at startup. |
| 1943 path | Worktree `~/src/bamboo/tools/MASTER-1943/` until PR #88 is on `m`. |

## Progress

- [x] Phase A — scaffold + target + scheme (steps 1–6)
- [x] Phase B — PLAN shape + stop (steps 7–15)
- [x] Step 16 VERIFY (suite 28/28; command loads `agent: plan`; smoke stopped at confirm, no PLAN written)
- [ ] Step 17 DEPLOY (squash, PR → m, copilot-loop)
- [ ] Step 18 FOLLOW-ON (`/bam-specs-amend` card)

## References

- Card: MASTER-1988 + review comment 2026-08-12 (Q&A locks)
- Templates: `~/src/bamboo/tools/docs/plans/MASTER-1945/`,
  `~/src/bamboo/tools/MASTER-1943/docs/plans/MASTER-1943/`,
  `~/src/bamboo/tools/docs/plans/MASTER-1931/`
- Precedent: `docs/plans/opencode-bam-resume/PLAN.md` (command +
  `commands.test.ts`)
- Tiers: `docs/plans/opencode-grok-tiers/PLAN.md` (MASTER-1989)
- Conventions: `@rules/plans.md`, `@rules/workflow.md`

---

▶️ Step `1` of `18` — `RED: assert bam-specs-init.md exists + validates + agent: plan` — model: `Grok Build 0.1` — plan:
`docs/plans/bam-specs-init/PLAN.md`
