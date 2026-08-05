# MASTER-1980: no-ai-tells / no emdash

Status: ready to execute (plan only; no implementation yet).

Asana: MASTER-1980: "no emdash in anything written"
(https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217187690537816,
GID `1217187690537816`).

## Goal

Stop AI prose from reading as AI. Em dash is the main tell; also broader
common AI patterns. Done = agent writing no longer uses em dashes or the
top AI tells, via a lean always-loaded rule plus an on-demand skill, both
pinned by content tests.

## Scope

**In:**

- `opencode/.config/opencode/rules/no-ai-tells.md` (~1 screen, always-loaded)
- Wire into `opencode.json` `instructions`, `communication.md` pointer,
  `AGENTS.md` always-loaded list
- `opencode/.config/opencode/skills/no-ai-tells/SKILL.md` (on-demand
  humanize jobs)
- Content-test suite at `rules-validate/` (TDD seam; mirror of
  `commands-validate/`)

**Out:**

- Runtime/CI enforcement of agent output (prompt-only v1)
- Scrubbing existing docs (forward-only)
- Vendoring full blader/humanizer (distill MIT patterns; no submodule/API)
- Changes to `install.sh` (`rules/` and `skills/` already whole-dir linked)
- Expanding brevity/layman rules beyond a one-line cross-ref

## Decisions (locked, from review)

1. **Vehicle:** both — lean always-loaded rule + on-demand skill
2. **Scope:** all agent-written prose (chat + outbound); exempt code, logs,
   quotes, user samples
3. **Depth:** fuller but short — hard ban on `—` / `–` / prose `--` + top AI
   vocab, significance inflation, "It's not X it's Y", rule-of-three,
   chatbot tics (~1 screen always-loaded)
4. **Source:** distill [blader/humanizer](https://github.com/blader/humanizer)
   (MIT) + Wikipedia Signs of AI writing; no paid API
5. **Enforcement:** prompt-only v1
6. **Retroactive:** forward-only (don't scrub existing docs)

## Design

```
opencode/.config/opencode/
├── opencode.json                 # instructions += "rules/no-ai-tells.md"
├── AGENTS.md                     # always-loaded list += no-ai-tells
├── rules/
│   ├── communication.md          # short pointer (like brevity)
│   └── no-ai-tells.md            # NEW — always-loaded (~1 screen)
├── skills/
│   └── no-ai-tells/
│       └── SKILL.md              # NEW — on-demand humanize
└── rules-validate/               # NEW — not in install FILES (dev/CI only)
    └── no-ai-tells.test.ts       # content contract tests
```

### Always-loaded rule (`rules/no-ai-tells.md`)

Sibling to `brevity.md` in shape; unlike brevity, **always-loaded** (applies
to all agent prose, not just outbound compression).

Sections (keep ≤ ~1 screen):

1. **Scope** — chat replies + outbound; exempt code/logs/quotes/user samples
2. **Hard ban** — no `—`, `–`, or prose double-hyphen `--` (show chars only
   in examples/fences; instructional prose uses commas/periods/colons/parens)
3. **Top tells** (short bullets, distilled from humanizer §§1,7,9,10,20,22):
   AI vocab list, significance inflation, negative parallelism, rule-of-three,
   chatbot tics
4. **Fix** — rewrite with periods/commas/colons; plain words; state the
   point once

### Skill (`skills/no-ai-tells/SKILL.md`)

On-demand when user asks to humanize / strip AI tells / rewrite prose.
Distill humanizer process, not all 33 patterns:

- Frontmatter `name: no-ai-tells`; description triggers: humanize, remove AI
  tells, strip em dashes, make less AI
- Process: identify → draft rewrite → "still AI?" audit → final
  (no-fabrication)
- Modes: pasted text / file / embedded (match humanizer)
- Fuller pattern checklist than the always-loaded rule; still short
- Same exemptions; voice-sample style match noted (dash ban still wins)
- Attribution: based on Wikipedia + blader/humanizer MIT

### Test seam

Markdown isn't otherwise testable. `rules-validate/no-ai-tells.test.ts`
under `bun:test` pins:

| Block | Asserts |
|-------|---------|
| rule file | exists; documents `—`/`–`/`--` bans; tokens for vocab, significance, not-x-y / negative parallel, rule of three, chatbot; scope + exemptions |
| wiring | `opencode.json` instructions includes `rules/no-ai-tells.md`; `communication.md` references it; `AGENTS.md` always-loaded lists it |
| skill | `skills/no-ai-tells/SKILL.md` exists; frontmatter name+description; body has process, patterns, exemptions, no-fabrication, modes |

Run: `bun test ./opencode/.config/opencode/rules-validate/`

No installer change: `rules` and `skills` already in `FILES`.

### Authoring gotcha

The rule/skill must **show** banned dash characters in examples while
instructional prose stays clean. Tests pin presence of the ban characters
as documented targets, not absence from the whole file.

## TDD implementation order

Each step is a single test **or** a single implementation move — never
both. RED = write one failing test. GREEN = minimal change that passes.
REFACTOR = restructure with suite green. **M = 18.**

When a step completes, post the **next** step's trigger verbatim (canonical
shape from `@rules/plans.md`).

### Phase A — Always-loaded rule

| # | Kind | Step | Model |
|---|------|------|-------|
| 1 | RED | Scaffold `rules-validate/no-ai-tells.test.ts`. First test: `rules/no-ai-tells.md` exists and body documents hard ban on em dash (`—`), en dash (`–`), and prose `--`. Fails (file absent). Confirm `bun test ./opencode/.config/opencode/rules-validate/` runs and RED. | Grok Build 0.1 |
| 2 | GREEN | Create minimal `rules/no-ai-tells.md` with title + hard-ban section only (show banned chars in an example line; fix guidance = periods/commas/colons/parens). Test 1 passes. | Grok Build 0.1 |
| 3 | RED | Test: rule body covers top tells — AI vocab (at least 3 of: delve, tapestry, testament, landscape, pivotal, showcase, underscore), significance inflation, negative parallelism / "not X…Y", rule of three, chatbot tics (hope this helps / let me know / great question). Fails. | Grok Build 0.1 |
| 4 | GREEN | Expand rule with short top-tells bullets + one-line fix guidance. Stay lean. Test 3 passes. | Opus 4.8 |
| 5 | RED | Test: rule states scope (all agent prose / chat + outbound) and exemptions (code, logs, quotes, user samples). Fails. | Grok Build 0.1 |
| 6 | GREEN | Add scope + exemptions section. Test 5 passes. | Opus 4.8 |
| 7 | RED | Test: `opencode.json` `instructions` array includes `rules/no-ai-tells.md`. Fails. | Grok Build 0.1 |
| 8 | GREEN | Append `"rules/no-ai-tells.md"` to `instructions` (keep safety + communication). Test 7 passes. | Grok Build 0.1 |
| 9 | RED | Test: `communication.md` references `no-ai-tells` (or `@rules/no-ai-tells.md`); `AGENTS.md` always-loaded bullet lists `rules/no-ai-tells.md`. Fails. | Grok Build 0.1 |
| 10 | GREEN | Add brief "No AI tells" section to `communication.md` (pointer only, like brevity). Add always-loaded bullet in `AGENTS.md`. Test 9 passes. | Opus 4.8 |
| 11 | REFACTOR | Tighten `no-ai-tells.md` to ~1 screen; consistent voice with `brevity.md`/`communication.md`; no instructional em/en dashes outside example spans. Full `rules-validate` suite green. | Opus 4.8 |

### Phase B — On-demand skill

| # | Kind | Step | Model |
|---|------|------|-------|
| 12 | RED | Test: `skills/no-ai-tells/SKILL.md` exists; YAML frontmatter has `name: no-ai-tells` and `description` mentioning humanize / AI tells / em dash (or equivalent triggers). Fails. | Grok Build 0.1 |
| 13 | GREEN | Scaffold `SKILL.md` with valid frontmatter + short stub body (no later tokens). Test 12 passes. | Grok Build 0.1 |
| 14 | RED | Test: skill body encodes process (identify → rewrite → audit), hard dash ban, pattern checklist beyond the rule, exemptions, no-fabrication, and invocation modes (pasted / file / embedded). Fails. | Grok Build 0.1 |
| 15 | GREEN | Author skill: distill blader/humanizer + Wikipedia (MIT attribution); procedure + modes + fuller checklist; keep shorter than upstream SKILL.md. Test 14 passes. | Opus 4.8 |
| 16 | REFACTOR | Coherence pass on skill (frontmatter triggers accurate; process matches modes; no contradiction with always-loaded rule). Suite green. | Opus 4.8 |

### Phase C — Verify & deploy

| # | Kind | Step | Model |
|---|------|------|-------|
| 17 | VERIFY | Full `bun test ./opencode/.config/opencode/rules-validate/` green; existing `commands-validate` still green; run `./opencode/install.sh` if needed; restart opencode; smoke: (a) new session loads without error, (b) ask a short chat reply and confirm no em dashes / no chatbot closer, (c) invoke skill on a pasted AI-ish paragraph and confirm rewrite drops dashes + top tells. | Opus 4.8 |
| 18 | DEPLOY | Per `@rules/workflow.md` + `@rules/safety.md` (or `/bam-deploy-dev`): Conventional Commit(s), push branch `MASTER-1980`, PR → base **`m`**, `/bam-copilot-loop` until clean; merge with confirm; fast-forward main checkout; restart opencode; archive plan → `docs/archive/opencode/PLAN-no-ai-tells.md`. | Opus 4.8 |

**M = 18.** Adjacent trivial RED→GREEN pairs may run back-to-back in one
session only if the human asks; default remains one step per fresh session.
Each step keeps its own commit so red→green history stays legible.

### Next-step triggers (post verbatim on completion)

| After finishing | Post this trigger |
|-----------------|-------------------|
| 1 | ▶️ Step 2 of 18 — GREEN: minimal no-ai-tells.md dash ban — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 2 | ▶️ Step 3 of 18 — RED: top-tells content test — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 3 | ▶️ Step 4 of 18 — GREEN: expand rule top-tells — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 4 | ▶️ Step 5 of 18 — RED: scope + exemptions test — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 5 | ▶️ Step 6 of 18 — GREEN: add scope + exemptions — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 6 | ▶️ Step 7 of 18 — RED: opencode.json instructions test — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 7 | ▶️ Step 8 of 18 — GREEN: wire instructions — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 8 | ▶️ Step 9 of 18 — RED: communication.md + AGENTS.md wiring test — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 9 | ▶️ Step 10 of 18 — GREEN: pointer + always-loaded list — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 10 | ▶️ Step 11 of 18 — REFACTOR: tighten rule to ~1 screen — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 11 | ▶️ Step 12 of 18 — RED: skill exists + frontmatter test — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 12 | ▶️ Step 13 of 18 — GREEN: scaffold SKILL.md — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 13 | ▶️ Step 14 of 18 — RED: skill process/patterns/modes test — model: Grok Build 0.1 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 14 | ▶️ Step 15 of 18 — GREEN: author skill (humanizer distill) — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 15 | ▶️ Step 16 of 18 — REFACTOR: skill coherence — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 16 | ▶️ Step 17 of 18 — VERIFY: suite + live smoke — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |
| 17 | ▶️ Step 18 of 18 — DEPLOY: PR → m, Copilot, merge, archive — model: Opus 4.8 — plan: `docs/plans/no-ai-tells/PLAN.md` |

## Testing strategy

- **Unit:** `bun test ./opencode/.config/opencode/rules-validate/` — hermetic
  content/wiring tests
- **Regression:** `bun test ./opencode/.config/opencode/commands-validate/`
  must stay green
- **No install.sh change** — `rules`/`skills` already in `FILES`
- **Manual smoke (step 17):** restart opencode; chat reply + skill rewrite
  on a known AI-ish paste

## Risks & gotchas

1. **Token discipline in RED sequence.** Each GREEN must not introduce
   tokens the *next* RED pins (same as bam-resume).
2. **Showing banned chars.** Tests require the rule to document
   `—`/`–`/`--`; put them only in example/fence lines so instructional
   prose stays clean.
3. **Context budget.** Always-loaded rule is ~1 screen; dump the long
   checklist into the skill only.
4. **Prompt-only v1.** No guarantee models obey; smoke is subjective.
   Future: optional scanner CI — out of scope.
5. **Restart required.** `instructions` and skills load at opencode startup.
6. **PR base is `m`.**
7. **Do not scrub existing docs** (decision 6).
8. **MIT attribution** in skill; short distill + link, not a wholesale copy
   of blader/humanizer.
9. **Conflict with system brevity rules.** Global opencode brevity already
   fights chatbot tics; no-ai-tells reinforces, does not replace, that.

## Progress

- [x] Phase A — always-loaded rule (steps 1–11)
- [x] Phase B — skill (steps 12–16)
- [x] Phase C — verify (step 17); deploy pending (step 18)

## References

- Asana: MASTER-1980
  (https://app.asana.com/1/1203819684139908/project/1204506183888935/task/1217187690537816)
- Pattern siblings: `rules/brevity.md`, `rules/communication.md` (layman,
  MASTER-1950)
- TDD precedent: `docs/archive/opencode/PLAN-slash-commands.md`,
  `PLAN-bam-resume.md`
- Source: https://github.com/blader/humanizer (MIT);
  https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- Load path: `opencode.json` `instructions`; skills auto-discovered under
  `skills/<name>/SKILL.md`
- `@rules/plans.md` — triggers + model tiers

## Kickoff trigger

> ▶️ Step 1 of 18 — RED: scaffold rules-validate + dash-ban test — model: Grok Build 0.1 — plan:
> `docs/plans/no-ai-tells/PLAN.md`
